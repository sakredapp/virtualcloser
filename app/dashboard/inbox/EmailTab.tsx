// Email triage UI — renders the rep's pending Gmail threads grouped by status
// and provides inline server actions for approve / dismiss / snooze /
// regenerate.
//
// Rendered server-side. Each thread card carries a small <form> for each
// action; the textarea is uncontrolled so reps can edit before approving
// without needing a client component.

import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'
import { replyToGmailThread, markGmailRead } from '@/lib/google'
import { draftEmailReply } from '@/lib/claude'

type ThreadWithDraft = {
  id: string
  gmail_thread_id: string
  subject: string | null
  from_address: string | null
  from_name: string | null
  snippet: string | null
  last_message_at: string | null
  priority: string | null
  category: string | null
  needs_reply: boolean
  reasoning: string | null
  status: string
  snoozed_until: string | null
  lead_id: string | null
  draft: {
    id: string
    subject: string | null
    body: string
    created_at: string
    edited_by_human: boolean
  } | null
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3, noise: 4 }
const PRIORITY_TONE: Record<string, string> = {
  urgent: 'bg-rose-100 text-rose-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-slate-100 text-slate-700',
  low: 'bg-slate-50 text-slate-500',
  noise: 'bg-slate-50 text-slate-400',
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    if (diffMs < 60_000) return 'just now'
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3600_000)}h ago`
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

async function loadThreads(repId: string): Promise<ThreadWithDraft[]> {
  const { data: threads } = await supabase
    .from('email_threads')
    .select('id, gmail_thread_id, subject, from_address, from_name, snippet, last_message_at, priority, category, needs_reply, reasoning, status, snoozed_until, lead_id, owner_member_id')
    .eq('rep_id', repId)
    .in('status', ['new', 'triaged', 'drafted', 'snoozed', 'sent'])
    .order('last_message_at', { ascending: false })
    .limit(100)

  const rows = (threads ?? []) as Array<Omit<ThreadWithDraft, 'draft'>>
  if (rows.length === 0) return []

  const threadIds = rows.map((r) => r.id)
  const { data: drafts } = await supabase
    .from('email_drafts')
    .select('id, thread_id, subject, body, created_at, edited_by_human, status')
    .in('thread_id', threadIds)
    .eq('status', 'pending')

  const draftByThread = new Map<string, ThreadWithDraft['draft']>()
  for (const d of (drafts ?? []) as Array<{
    id: string; thread_id: string; subject: string | null; body: string
    created_at: string; edited_by_human: boolean; status: string
  }>) {
    draftByThread.set(d.thread_id, {
      id: d.id,
      subject: d.subject,
      body: d.body,
      created_at: d.created_at,
      edited_by_human: d.edited_by_human,
    })
  }

  return rows.map((r) => ({ ...r, draft: draftByThread.get(r.id) ?? null }))
}

async function loadLastMessage(threadId: string): Promise<{
  fromAddress: string | null
  messageIdHeader: string | null
  referencesHeader: string | null
  ccAddresses: string[] | null
}> {
  // We didn't persist Message-ID / References headers on email_messages, so
  // we'll need to re-fetch the thread from Gmail at send time to grab them.
  // Returning the from address for now; the action handler refetches the rest.
  const { data } = await supabase
    .from('email_messages')
    .select('from_address, to_addresses, cc_addresses')
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return {
    fromAddress: (data as { from_address: string | null } | null)?.from_address ?? null,
    messageIdHeader: null,
    referencesHeader: null,
    ccAddresses: (data as { cc_addresses: string[] | null } | null)?.cc_addresses ?? null,
  }
}

export default async function EmailTab() {
  const { tenant, member } = await requireMember()
  const threads = await loadThreads(tenant.id)

  // Server actions
  async function onApprove(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const draftId = String(formData.get('draftId') ?? '')
    const editedBody = String(formData.get('body') ?? '').trim()
    const editedSubject = String(formData.get('subject') ?? '').trim()
    if (!threadId || !draftId) return

    const { tenant, member } = await requireMember()

    // Fetch the thread + draft to send.
    const { data: thread } = await supabase
      .from('email_threads')
      .select('id, gmail_thread_id, rep_id, owner_member_id, lead_id')
      .eq('id', threadId)
      .eq('rep_id', tenant.id)
      .maybeSingle()
    if (!thread) return

    const { data: draft } = await supabase
      .from('email_drafts')
      .select('id, subject, body, status')
      .eq('id', draftId)
      .eq('thread_id', threadId)
      .maybeSingle()
    if (!draft || draft.status !== 'pending') return

    // Find the latest inbound message to thread off of. We re-fetch the thread
    // from Gmail to get the Message-ID + References headers we need.
    const { getGmailThread } = await import('@/lib/google')
    const gmailRes = await getGmailThread(
      thread.rep_id,
      (thread as { owner_member_id: string | null }).owner_member_id ?? null,
      (thread as { gmail_thread_id: string }).gmail_thread_id,
    )
    if (!gmailRes.ok) return
    const inboundMessages = (gmailRes.messages ?? []).filter((m) => !m.labelIds.includes('SENT'))
    const lastInbound = inboundMessages[inboundMessages.length - 1]
    if (!lastInbound) return

    const finalBody = editedBody || (draft as { body: string }).body
    const finalSubject = editedSubject || (draft as { subject: string | null }).subject || lastInbound.subject || ''
    const bodyEdited = editedBody && editedBody !== (draft as { body: string }).body
    const subjectEdited = editedSubject && editedSubject !== ((draft as { subject: string | null }).subject ?? '')

    const send = await replyToGmailThread(thread.rep_id, {
      threadId: (thread as { gmail_thread_id: string }).gmail_thread_id,
      to: lastInbound.fromAddress,
      subject: /^re:/i.test(finalSubject) ? finalSubject : `Re: ${finalSubject}`,
      body: finalBody,
      inReplyTo: lastInbound.messageIdHeader,
      references: lastInbound.referencesHeader,
      memberId: (thread as { owner_member_id: string | null }).owner_member_id ?? null,
    })

    if (!send.ok) {
      console.error('[email-triage] approve send failed', send.error)
      return
    }

    const now = new Date().toISOString()
    await supabase
      .from('email_drafts')
      .update({
        status: 'sent',
        body: finalBody,
        subject: finalSubject,
        edited_by_human: bodyEdited || subjectEdited,
        sent_at: now,
        gmail_message_id: send.messageId ?? null,
      })
      .eq('id', draftId)

    await supabase
      .from('email_threads')
      .update({ status: 'sent', updated_at: now })
      .eq('id', threadId)

    await supabase.from('outbound_messages').insert({
      rep_id: thread.rep_id,
      lead_id: (thread as { lead_id: string | null }).lead_id ?? null,
      channel: 'email',
      direction: 'outbound',
      to_address: lastInbound.fromAddress,
      body: finalBody,
      status: 'sent',
      external_id: send.messageId ?? null,
      metadata: { gmail_thread_id: (thread as { gmail_thread_id: string }).gmail_thread_id, sent_by_member_id: member.id },
    })

    // Best-effort: mark the inbound message read so Gmail's red dot goes away.
    if (lastInbound.id) {
      await markGmailRead(
        thread.rep_id,
        (thread as { owner_member_id: string | null }).owner_member_id ?? null,
        lastInbound.id,
      )
    }

    revalidatePath('/dashboard/inbox')
  }

  async function onDismiss(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    if (!threadId) return
    const { tenant } = await requireMember()
    const now = new Date().toISOString()
    await supabase
      .from('email_drafts')
      .update({ status: 'dismissed' })
      .eq('thread_id', threadId)
      .eq('status', 'pending')
    await supabase
      .from('email_threads')
      .update({ status: 'dismissed', updated_at: now })
      .eq('id', threadId)
      .eq('rep_id', tenant.id)
    revalidatePath('/dashboard/inbox')
  }

  async function onSnooze(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const hours = parseInt(String(formData.get('hours') ?? '24'), 10) || 24
    if (!threadId) return
    const { tenant } = await requireMember()
    const until = new Date(Date.now() + hours * 3600_000).toISOString()
    await supabase
      .from('email_threads')
      .update({ status: 'snoozed', snoozed_until: until, updated_at: new Date().toISOString() })
      .eq('id', threadId)
      .eq('rep_id', tenant.id)
    revalidatePath('/dashboard/inbox')
  }

  async function onRegenerate(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const styleNote = String(formData.get('styleNote') ?? '').trim() || null
    if (!threadId) return
    const { tenant } = await requireMember()

    const { data: thread } = await supabase
      .from('email_threads')
      .select('id, rep_id, owner_member_id, lead_id, from_address')
      .eq('id', threadId)
      .eq('rep_id', tenant.id)
      .maybeSingle()
    if (!thread) return

    // Load the persisted messages to feed the model.
    const { data: msgs } = await supabase
      .from('email_messages')
      .select('direction, from_address, to_addresses, subject, body_text, body_html, sent_at')
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true })

    if (!msgs || msgs.length === 0) return

    const repInfo = await (async () => {
      const { data: rep } = await supabase
        .from('reps')
        .select('id, name, slug')
        .eq('id', thread.rep_id)
        .maybeSingle()
      const { data: token } = await supabase
        .from('google_tokens')
        .select('email')
        .eq('rep_id', thread.rep_id)
        .is('member_id', null)
        .maybeSingle()
      return {
        name: ((rep as { name: string | null; slug: string | null } | null)?.name) ??
              ((rep as { name: string | null; slug: string | null } | null)?.slug) ?? 'the rep',
        email: (token as { email: string | null } | null)?.email ?? null,
      }
    })()

    const lead = thread.lead_id
      ? await (async () => {
          const { data } = await supabase
            .from('leads')
            .select('name, company, status, notes')
            .eq('id', thread.lead_id as string)
            .maybeSingle()
          return data as { name: string; company: string | null; status: string; notes: string | null } | null
        })()
      : null

    const drafted = await draftEmailReply({
      repName: repInfo.name,
      repEmail: repInfo.email,
      messages: (msgs as Array<{
        direction: 'inbound' | 'outbound' | null
        from_address: string | null
        to_addresses: string[] | null
        subject: string | null
        body_text: string | null
        body_html: string | null
        sent_at: string | null
      }>).map((m) => ({
        direction: (m.direction ?? 'inbound') as 'inbound' | 'outbound',
        from: m.from_address ?? '',
        to: m.to_addresses ?? [],
        subject: m.subject,
        body: m.body_text,
        sentAt: m.sent_at,
      })),
      matchedLead: lead
        ? { name: lead.name, company: lead.company ?? '', status: lead.status, notes: lead.notes }
        : null,
      styleNote,
    })

    // Supersede any existing pending draft; insert the new one.
    await supabase
      .from('email_drafts')
      .update({ status: 'superseded' })
      .eq('thread_id', threadId)
      .eq('status', 'pending')
    await supabase.from('email_drafts').insert({
      thread_id: threadId,
      rep_id: thread.rep_id,
      owner_member_id: (thread as { owner_member_id: string | null }).owner_member_id ?? null,
      subject: drafted.subject,
      body: drafted.body,
      model_used: process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5',
      status: 'pending',
      feedback: styleNote,
    })
    await supabase
      .from('email_threads')
      .update({ status: 'drafted', updated_at: new Date().toISOString() })
      .eq('id', threadId)
    revalidatePath('/dashboard/inbox')
  }

  // Group threads into buckets for display.
  const needsReply = threads
    .filter((t) => (t.status === 'new' || t.status === 'triaged') && t.needs_reply && t.priority !== 'noise')
    .sort((a, b) => (PRIORITY_RANK[a.priority ?? 'normal'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'normal'] ?? 2))
  const drafted = threads
    .filter((t) => t.status === 'drafted' && t.draft)
    .sort((a, b) => (PRIORITY_RANK[a.priority ?? 'normal'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'normal'] ?? 2))
  const sent = threads
    .filter((t) => t.status === 'sent')
    .slice(0, 10)
  const snoozed = threads.filter((t) => t.status === 'snoozed')

  return (
    <div>
      <section className="grid-4" style={{ marginBottom: '1rem' }}>
        <article className="card stat">
          <p className="label">Drafted, awaiting you</p>
          <p className="value small">{drafted.length}</p>
        </article>
        <article className="card stat">
          <p className="label">Needs reply (no draft yet)</p>
          <p className="value small">{needsReply.length}</p>
        </article>
        <article className="card stat">
          <p className="label">Snoozed</p>
          <p className="value small">{snoozed.length}</p>
        </article>
        <article className="card stat">
          <p className="label">Sent today</p>
          <p className="value small">{sent.length}</p>
        </article>
      </section>

      {drafted.length === 0 && needsReply.length === 0 && (
        <section className="card" style={{ padding: '1.2rem 1.2rem' }}>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Inbox triage is caught up. New emails get triaged automatically every ~2 minutes
            and replies show up here for you to approve.
          </p>
        </section>
      )}

      {drafted.length > 0 && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Drafts ready to approve</h2>
            <p>{drafted.length} waiting</p>
          </div>
          <ul className="list drafts" style={{ maxHeight: 'none' }}>
            {drafted.map((t) => {
              const gmailHref = `https://mail.google.com/mail/u/0/#inbox/${t.gmail_thread_id}`
              const priorityChip = t.priority && PRIORITY_TONE[t.priority]
                ? <span className="status" style={{ background: 'var(--royal-soft)', color: 'var(--royal)' }}>{t.priority}</span>
                : null
              return (
                <li key={t.id} className="draft">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                    <p className="name" style={{ margin: 0 }}>
                      {t.from_name || t.from_address || '(unknown sender)'}
                    </p>
                    <p className="meta" style={{ margin: 0 }}>{formatTime(t.last_message_at)}</p>
                  </div>
                  <p className="subject" style={{ marginTop: '0.2rem' }}>{t.subject || '(no subject)'}</p>
                  <p className="meta" style={{ margin: '0 0 0.4rem' }}>
                    {priorityChip}{' '}
                    {t.category && <span className="meta" style={{ marginLeft: '0.3rem' }}>{t.category}</span>}
                    {t.reasoning && <span className="meta" style={{ marginLeft: '0.3rem', fontStyle: 'italic' }}>&mdash; {t.reasoning}</span>}
                  </p>
                  <p className="body" style={{ background: 'var(--bg-soft, #f8fafc)', padding: '0.5rem 0.7rem', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>
                    {t.snippet}
                  </p>

                  {t.draft && (
                    <form action={onApprove} style={{ marginTop: '0.6rem' }}>
                      <input type="hidden" name="threadId" value={t.id} />
                      <input type="hidden" name="draftId" value={t.draft.id} />
                      <input
                        type="text"
                        name="subject"
                        defaultValue={t.draft.subject ?? ''}
                        placeholder="Subject"
                        style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border, #e2e8f0)', marginBottom: '0.4rem', fontSize: '0.9rem' }}
                      />
                      <textarea
                        name="body"
                        defaultValue={t.draft.body}
                        rows={6}
                        style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '6px', border: '1px solid var(--border, #e2e8f0)', fontFamily: 'inherit', fontSize: '0.9rem' }}
                      />
                      <div className="actions" style={{ marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="submit" className="btn approve">Approve &amp; Send</button>
                      </div>
                    </form>
                  )}

                  <div className="actions" style={{ marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <form action={onRegenerate} style={{ display: 'flex', gap: '0.3rem' }}>
                      <input type="hidden" name="threadId" value={t.id} />
                      <input
                        type="text"
                        name="styleNote"
                        placeholder='e.g. "shorter", "warmer"'
                        style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border, #e2e8f0)', fontSize: '0.85rem' }}
                      />
                      <button type="submit" className="btn dismiss">Regenerate</button>
                    </form>
                    <form action={onSnooze}>
                      <input type="hidden" name="threadId" value={t.id} />
                      <input type="hidden" name="hours" value="24" />
                      <button type="submit" className="btn dismiss">Snooze 1d</button>
                    </form>
                    <form action={onSnooze}>
                      <input type="hidden" name="threadId" value={t.id} />
                      <input type="hidden" name="hours" value="168" />
                      <button type="submit" className="btn dismiss">Snooze 1w</button>
                    </form>
                    <form action={onDismiss}>
                      <input type="hidden" name="threadId" value={t.id} />
                      <button type="submit" className="btn dismiss">Dismiss</button>
                    </form>
                    <a href={gmailHref} target="_blank" rel="noopener noreferrer" className="btn dismiss" style={{ textDecoration: 'none' }}>
                      Open in Gmail
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {needsReply.length > 0 && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Needs reply — draft pending</h2>
            <p>{needsReply.length} threads</p>
          </div>
          <ul className="list" style={{ maxHeight: 'none' }}>
            {needsReply.map((t) => (
              <li key={t.id} className="row">
                <div>
                  <p className="name">{t.from_name || t.from_address}</p>
                  <p className="meta">{t.subject || '(no subject)'}</p>
                  <p className="meta">
                    {t.priority && <span>{t.priority}</span>}
                    {t.reasoning && <span style={{ fontStyle: 'italic' }}> &mdash; {t.reasoning}</span>}
                  </p>
                </div>
                <div className="right">
                  <p className="meta">{formatTime(t.last_message_at)}</p>
                  <a
                    href={`https://mail.google.com/mail/u/0/#inbox/${t.gmail_thread_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn dismiss"
                    style={{ textDecoration: 'none' }}
                  >
                    Open in Gmail
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snoozed.length > 0 && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Snoozed</h2>
            <p>{snoozed.length}</p>
          </div>
          <ul className="list">
            {snoozed.map((t) => (
              <li key={t.id} className="row">
                <div>
                  <p className="name">{t.from_name || t.from_address}</p>
                  <p className="meta">{t.subject}</p>
                </div>
                <div className="right">
                  <p className="meta">until {formatTime(t.snoozed_until)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sent.length > 0 && (
        <section className="card" style={{ marginBottom: '0.8rem' }}>
          <div className="section-head">
            <h2>Sent recently</h2>
            <p>{sent.length}</p>
          </div>
          <ul className="list">
            {sent.map((t) => (
              <li key={t.id} className="row">
                <div>
                  <p className="name">{t.from_name || t.from_address}</p>
                  <p className="meta">{t.subject}</p>
                </div>
                <div className="right">
                  <p className="meta">{formatTime(t.last_message_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
