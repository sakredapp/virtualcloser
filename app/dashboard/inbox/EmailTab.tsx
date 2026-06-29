// Email triage UI — Gmail-style inbox with collapsible thread rows.
//
// Each thread row is a `<details>` element. Collapsed it shows
// sender / subject / snippet / priority chip / time. Expanding it
// reveals the most recent inbound message body, the AI draft (editable),
// and the action buttons (approve, edit + send, regenerate, snooze,
// dismiss, open in Gmail).
//
// Server-rendered. Native <details> handles open/close with zero JS.
// Server actions handle every mutation.

import { revalidatePath } from 'next/cache'
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
  owner_member_id: string | null
  draft: {
    id: string
    subject: string | null
    body: string
    created_at: string
    edited_by_human: boolean
  } | null
  latestInbound: {
    fromAddress: string | null
    bodyText: string | null
    bodyHtml: string | null
    sentAt: string | null
  } | null
}

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
  noise: 4,
}
const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: 'rgba(225, 29, 72, 0.12)', fg: '#9f1239' },
  high: { bg: 'rgba(234, 88, 12, 0.12)', fg: '#9a3412' },
  normal: { bg: 'rgba(15, 23, 42, 0.06)', fg: 'var(--muted)' },
  low: { bg: 'rgba(15, 23, 42, 0.04)', fg: 'var(--muted)' },
  noise: { bg: 'rgba(15, 23, 42, 0.04)', fg: 'var(--muted)' },
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    if (diffMs < 60_000) return 'just now'
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m`
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3600_000)}h`
    if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function htmlToText(html: string | null): string | null {
  if (!html) return null
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 'all' = every connected account, 'shared' = the workspace/owner account
// (owner_member_id null), or a member uuid for one person's inbox.
export type AccountFilter = 'all' | 'shared' | string

async function loadThreads(repId: string, account: AccountFilter): Promise<ThreadWithDraft[]> {
  let q = supabase
    .from('email_threads')
    .select(
      'id, gmail_thread_id, subject, from_address, from_name, snippet, last_message_at, priority, category, needs_reply, reasoning, status, snoozed_until, lead_id, owner_member_id',
    )
    .eq('rep_id', repId)
  if (account === 'shared') q = q.is('owner_member_id', null)
  else if (account !== 'all') q = q.eq('owner_member_id', account)
  const { data: threads } = await q
    .in('status', ['new', 'triaged', 'drafted', 'snoozed', 'sent'])
    .order('last_message_at', { ascending: false })
    .limit(200)

  const rows = (threads ?? []) as Array<Omit<ThreadWithDraft, 'draft' | 'latestInbound'>>
  if (rows.length === 0) return []

  // SAFETY: rows are pre-filtered to repId above (.eq('rep_id', repId)), so
  // every threadId here belongs to the viewer's tenant. Queries below use
  // .in('thread_id', threadIds) which is therefore implicitly tenant-scoped.
  const threadIds = rows.map((r) => r.id)
  const { data: drafts } = await supabase
    .from('email_drafts')
    .select('id, thread_id, subject, body, created_at, edited_by_human, status')
    .in('thread_id', threadIds)
    .eq('status', 'pending')

  const draftByThread = new Map<string, ThreadWithDraft['draft']>()
  for (const d of (drafts ?? []) as Array<{
    id: string
    thread_id: string
    subject: string | null
    body: string
    created_at: string
    edited_by_human: boolean
    status: string
  }>) {
    draftByThread.set(d.thread_id, {
      id: d.id,
      subject: d.subject,
      body: d.body,
      created_at: d.created_at,
      edited_by_human: d.edited_by_human,
    })
  }

  // Pull the latest inbound message per thread so we can show its body when
  // the user expands a row. One query covering all threads.
  const { data: messages } = await supabase
    .from('email_messages')
    .select('thread_id, from_address, body_text, body_html, sent_at, direction')
    .in('thread_id', threadIds)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })

  const latestInboundByThread = new Map<string, ThreadWithDraft['latestInbound']>()
  for (const m of (messages ?? []) as Array<{
    thread_id: string
    from_address: string | null
    body_text: string | null
    body_html: string | null
    sent_at: string | null
  }>) {
    if (latestInboundByThread.has(m.thread_id)) continue
    latestInboundByThread.set(m.thread_id, {
      fromAddress: m.from_address,
      bodyText: m.body_text,
      bodyHtml: m.body_html,
      sentAt: m.sent_at,
    })
  }

  return rows.map((r) => ({
    ...r,
    draft: draftByThread.get(r.id) ?? null,
    latestInbound: latestInboundByThread.get(r.id) ?? null,
  }))
}

// Send one pending draft as a Gmail reply + record it. Shared by the single
// approve action (which may carry edits) and the batch "approve all" action
// (which sends each draft as-is). Tenant-scoped: every lookup filters by
// repId so a guessed id can't touch another tenant's data. Returns ok/skip.
async function sendOneDraft(
  repId: string,
  memberId: string,
  threadId: string,
  draftId: string,
  edits?: { body?: string; subject?: string },
): Promise<{ ok: boolean; reason?: string }> {
  const { data: thread } = await supabase
    .from('email_threads')
    .select('id, gmail_thread_id, rep_id, owner_member_id, lead_id')
    .eq('id', threadId)
    .eq('rep_id', repId)
    .maybeSingle()
  if (!thread) return { ok: false, reason: 'no_thread' }

  const { data: draft } = await supabase
    .from('email_drafts')
    .select('id, subject, body, status')
    .eq('id', draftId)
    .eq('thread_id', threadId)
    .maybeSingle()
  if (!draft || (draft as { status: string }).status !== 'pending') return { ok: false, reason: 'not_pending' }

  const { getGmailThread } = await import('@/lib/google')
  const gmailRes = await getGmailThread(
    (thread as { rep_id: string }).rep_id,
    (thread as { owner_member_id: string | null }).owner_member_id ?? null,
    (thread as { gmail_thread_id: string }).gmail_thread_id,
  )
  if (!gmailRes.ok) return { ok: false, reason: 'gmail_fetch' }
  const inbound = (gmailRes.messages ?? []).filter((m) => !m.labelIds.includes('SENT'))
  const lastInbound = inbound[inbound.length - 1]
  if (!lastInbound) return { ok: false, reason: 'no_inbound' }

  const editedBody = (edits?.body ?? '').trim()
  const editedSubject = (edits?.subject ?? '').trim()
  const finalBody = editedBody || (draft as { body: string }).body
  const finalSubject =
    editedSubject || (draft as { subject: string | null }).subject || lastInbound.subject || ''
  const bodyEdited = Boolean(editedBody) && editedBody !== (draft as { body: string }).body
  const subjectEdited =
    Boolean(editedSubject) && editedSubject !== ((draft as { subject: string | null }).subject ?? '')

  const send = await replyToGmailThread((thread as { rep_id: string }).rep_id, {
    threadId: (thread as { gmail_thread_id: string }).gmail_thread_id,
    to: lastInbound.fromAddress,
    subject: /^re:/i.test(finalSubject) ? finalSubject : `Re: ${finalSubject}`,
    body: finalBody,
    inReplyTo: lastInbound.messageIdHeader,
    references: lastInbound.referencesHeader,
    memberId: (thread as { owner_member_id: string | null }).owner_member_id ?? null,
  })
  if (!send.ok) {
    console.error('[email-triage] send failed', send.error)
    return { ok: false, reason: 'send_failed' }
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
    rep_id: (thread as { rep_id: string }).rep_id,
    lead_id: (thread as { lead_id: string | null }).lead_id ?? null,
    channel: 'email',
    direction: 'outbound',
    to_address: lastInbound.fromAddress,
    body: finalBody,
    status: 'sent',
    external_id: send.messageId ?? null,
    metadata: {
      gmail_thread_id: (thread as { gmail_thread_id: string }).gmail_thread_id,
      sent_by_member_id: memberId,
    },
  })
  if (lastInbound.id) {
    await markGmailRead(
      (thread as { rep_id: string }).rep_id,
      (thread as { owner_member_id: string | null }).owner_member_id ?? null,
      lastInbound.id,
    )
  }
  return { ok: true }
}

export default async function EmailTab({ account = 'all' }: { account?: AccountFilter }) {
  const { tenant } = await requireMember()
  const threads = await loadThreads(tenant.id, account)

  // ── Server actions ────────────────────────────────────────────────────────

  async function onApprove(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const draftId = String(formData.get('draftId') ?? '')
    const editedBody = String(formData.get('body') ?? '').trim()
    const editedSubject = String(formData.get('subject') ?? '').trim()
    if (!threadId || !draftId) return

    const { tenant, member } = await requireMember()
    await sendOneDraft(tenant.id, member.id, threadId, draftId, {
      body: editedBody,
      subject: editedSubject,
    })
    revalidatePath('/dashboard/inbox')
  }

  // Batch: approve + send every pending draft as-is (no edits). For the exec
  // who's reviewed the queue and wants to clear it in one tap. Sends serially
  // so one Gmail failure doesn't abort the rest.
  async function onApproveAll() {
    'use server'
    const { tenant, member } = await requireMember()
    const { data: pending } = await supabase
      .from('email_drafts')
      .select('id, thread_id')
      .eq('rep_id', tenant.id)
      .eq('status', 'pending')
    for (const d of (pending ?? []) as Array<{ id: string; thread_id: string }>) {
      try {
        await sendOneDraft(tenant.id, member.id, d.thread_id, d.id)
      } catch (err) {
        console.error('[email-triage] approve-all item failed', d.id, err)
      }
    }
    revalidatePath('/dashboard/inbox')
  }

  async function onDismiss(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    if (!threadId) return
    const { tenant } = await requireMember()
    const now = new Date().toISOString()
    // Tenant-scope BOTH writes so a guessed thread_id can't dismiss
    // another tenant's pending draft.
    await supabase
      .from('email_drafts')
      .update({ status: 'dismissed' })
      .eq('thread_id', threadId)
      .eq('rep_id', tenant.id)
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
      .update({
        status: 'snoozed',
        snoozed_until: until,
        updated_at: new Date().toISOString(),
      })
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
      .select('id, rep_id, owner_member_id, lead_id')
      .eq('id', threadId)
      .eq('rep_id', tenant.id)
      .maybeSingle()
    if (!thread) return

    // SAFETY: threadId is verified to belong to tenant.id by the previous
    // query (line above). Do not remove that check without also filtering
    // this query via a join on email_threads.rep_id, otherwise you'd
    // expose another tenant's email bodies to whoever guesses a thread id.
    const { data: msgs } = await supabase
      .from('email_messages')
      .select('direction, from_address, to_addresses, subject, body_text, body_html, sent_at')
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true })
    if (!msgs || msgs.length === 0) return

    const repInfo = await (async () => {
      const { data: rep } = await supabase
        .from('reps')
        .select('id, display_name, slug, timezone')
        .eq('id', (thread as { rep_id: string }).rep_id)
        .maybeSingle()
      const { data: token } = await supabase
        .from('google_tokens')
        .select('email')
        .eq('rep_id', (thread as { rep_id: string }).rep_id)
        .is('member_id', null)
        .maybeSingle()
      const r = rep as { display_name: string | null; slug: string | null; timezone: string | null } | null
      return {
        name: r?.display_name ?? r?.slug ?? 'the rep',
        email: (token as { email: string | null } | null)?.email ?? null,
        timezone: r?.timezone ?? 'America/New_York',
      }
    })()

    // Pull current free-slot availability so Regenerate proposes a time
    // that actually fits the rep's calendar instead of inventing one.
    const { loadCalendarContext } = await import('@/lib/email/calendarContext')
    const availability = await loadCalendarContext(
      (thread as { rep_id: string }).rep_id,
      (thread as { owner_member_id: string | null }).owner_member_id ?? null,
      repInfo.timezone,
    )

    const lead = (thread as { lead_id: string | null }).lead_id
      ? await (async () => {
          const { data } = await supabase
            .from('leads')
            .select('name, company, status, notes')
            .eq('id', (thread as { lead_id: string }).lead_id)
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
      availability,
      repId: (thread as { rep_id: string }).rep_id,
    })

    // The thread row above was already verified for tenant.id, so threadId
    // belongs to the viewer. But scope this update too for defense-in-depth
    // so a future refactor can't silently break tenant isolation.
    await supabase
      .from('email_drafts')
      .update({ status: 'superseded' })
      .eq('thread_id', threadId)
      .eq('rep_id', tenant.id)
      .eq('status', 'pending')
    await supabase.from('email_drafts').insert({
      thread_id: threadId,
      rep_id: (thread as { rep_id: string }).rep_id,
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

    // Make the correction durable: "shorter / warmer / more direct" becomes a
    // standing email-style rule that draftEmailReply reads on every future draft
    // for this rep — so the same tone fix isn't requested over and over. Scope
    // is locked to 'email' (the synthesizer only knows the Plaud scopes).
    if (styleNote) {
      try {
        const { learnFromFeedback } = await import('@/lib/plaud/guidance')
        await learnFromFeedback({
          repId: tenant.id,
          claudeKey: (tenant as { claude_api_key?: string | null }).claude_api_key ?? null,
          source: 'manual',
          scope: 'email',
          lockScope: true,
          signal: 'correction',
          context: 'Email reply drafting',
          reason: styleNote,
        })
      } catch (err) {
        console.warn('[email-regenerate] learn failed', err instanceof Error ? err.message : String(err))
      }
    }

    revalidatePath('/dashboard/inbox')
  }

  // ── Group threads into buckets ────────────────────────────────────────────

  const drafted = threads
    .filter((t) => t.status === 'drafted' && t.draft)
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority ?? 'normal'] ?? 2) -
        (PRIORITY_RANK[b.priority ?? 'normal'] ?? 2),
    )
  const needsReply = threads
    .filter(
      (t) =>
        (t.status === 'new' || t.status === 'triaged') &&
        t.needs_reply &&
        t.priority !== 'noise',
    )
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority ?? 'normal'] ?? 2) -
        (PRIORITY_RANK[b.priority ?? 'normal'] ?? 2),
    )
  const fyi = threads.filter(
    (t) =>
      (t.status === 'triaged' || t.status === 'new') &&
      !t.needs_reply &&
      t.priority !== 'noise',
  )
  const noise = threads.filter(
    (t) => t.priority === 'noise' || t.category === 'noise' || t.category === 'newsletter',
  )
  const snoozed = threads.filter((t) => t.status === 'snoozed')
  const sent = threads.filter((t) => t.status === 'sent').slice(0, 20)
  const totalSynced = threads.length

  // ── Helpers ──────────────────────────────────────────────────────────────

  function PriorityChip({ p }: { p: string | null }) {
    if (!p) return null
    const style = PRIORITY_STYLE[p] ?? PRIORITY_STYLE.normal
    return (
      <span
        style={{
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: '0.15rem 0.5rem',
          borderRadius: '4px',
          background: style.bg,
          color: style.fg,
          fontWeight: 600,
        }}
      >
        {p}
      </span>
    )
  }

  function ThreadRow({
    t,
    showDraft,
  }: {
    t: ThreadWithDraft
    showDraft: boolean
  }) {
    const sender = t.from_name || t.from_address || '(unknown)'
    const gmailHref = `https://mail.google.com/mail/u/0/#inbox/${t.gmail_thread_id}`
    const bodyToShow =
      t.latestInbound?.bodyText ?? htmlToText(t.latestInbound?.bodyHtml ?? null) ?? ''

    return (
      <details
        style={{
          borderBottom: '1px solid var(--border, var(--border-soft))',
        }}
      >
        <summary
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 200px) 1fr auto',
            gap: '0.75rem',
            alignItems: 'center',
            padding: '0.7rem 0.9rem',
            cursor: 'pointer',
            listStyle: 'none',
          }}
        >
          <div
            style={{
              fontWeight: t.status === 'new' || t.status === 'drafted' ? 600 : 500,
              fontSize: '0.92rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={t.from_address ?? ''}
          >
            {sender}
          </div>
          <div
            style={{
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                fontWeight: t.status === 'new' || t.status === 'drafted' ? 600 : 500,
                fontSize: '0.92rem',
                marginRight: '0.6rem',
              }}
            >
              {t.subject || '(no subject)'}
            </span>
            <span
              style={{
                color: 'var(--muted)',
                fontSize: '0.88rem',
              }}
            >
              {t.snippet}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              fontSize: '0.8rem',
              color: 'var(--muted)',
              whiteSpace: 'nowrap',
            }}
          >
            <PriorityChip p={t.priority} />
            <span>{formatRelativeTime(t.last_message_at)}</span>
          </div>
        </summary>

        <div
          style={{
            padding: '0.4rem 1rem 1rem',
            background: 'rgba(15,23,42,0.02)',
          }}
        >
          {t.reasoning && (
            <p
              className="meta"
              style={{ margin: '0 0 0.6rem', fontStyle: 'italic', fontSize: '0.85rem' }}
            >
              <strong>AI read:</strong> {t.reasoning}
            </p>
          )}

          <div
            style={{
              padding: '0.7rem 0.9rem',
              background: '#fff',
              border: '1px solid var(--border, var(--border-soft))',
              borderRadius: '6px',
              maxHeight: '300px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              fontSize: '0.88rem',
              lineHeight: 1.5,
              marginBottom: '0.8rem',
            }}
          >
            {bodyToShow || t.snippet || '(no body)'}
          </div>

          {showDraft && t.draft ? (
            <form action={onApprove}>
              <input type="hidden" name="threadId" value={t.id} />
              <input type="hidden" name="draftId" value={t.draft.id} />
              <p
                className="meta"
                style={{
                  margin: '0 0 0.3rem',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--royal, #4338ca)',
                  fontWeight: 600,
                }}
              >
                AI-drafted reply — edit anything before approving
              </p>
              <input
                type="text"
                name="subject"
                defaultValue={t.draft.subject ?? ''}
                placeholder="Subject"
                style={{
                  width: '100%',
                  padding: '0.45rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border, var(--border-soft))',
                  marginBottom: '0.4rem',
                  fontSize: '0.9rem',
                  background: '#fff',
                }}
              />
              <textarea
                name="body"
                defaultValue={t.draft.body}
                rows={7}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.7rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border, var(--border-soft))',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  lineHeight: 1.5,
                  background: '#fff',
                }}
              />
              <div
                className="actions"
                style={{
                  marginTop: '0.6rem',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                  alignItems: 'center',
                }}
              >
                <button type="submit" className="btn approve">
                  Approve &amp; Send
                </button>
              </div>
            </form>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              {t.needs_reply
                ? 'AI flagged this needs a reply but hasn’t drafted one yet — it should arrive on the next triage tick (~2 min).'
                : 'AI didn’t flag this as needing a reply. Use the buttons below if you want to draft one anyway.'}
            </p>
          )}

          <div
            style={{
              marginTop: '0.6rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.4rem',
              alignItems: 'center',
            }}
          >
            <form action={onRegenerate} style={{ display: 'flex', gap: '0.3rem' }}>
              <input type="hidden" name="threadId" value={t.id} />
              <input
                type="text"
                name="styleNote"
                placeholder='e.g. "shorter", "warmer"'
                style={{
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border, var(--border-soft))',
                  fontSize: '0.85rem',
                  width: '180px',
                }}
              />
              <button type="submit" className="btn dismiss">
                {t.draft ? 'Regenerate' : 'Draft a reply'}
              </button>
            </form>
            <form action={onSnooze}>
              <input type="hidden" name="threadId" value={t.id} />
              <input type="hidden" name="hours" value="24" />
              <button type="submit" className="btn dismiss">
                Snooze 1d
              </button>
            </form>
            <form action={onSnooze}>
              <input type="hidden" name="threadId" value={t.id} />
              <input type="hidden" name="hours" value="168" />
              <button type="submit" className="btn dismiss">
                Snooze 1w
              </button>
            </form>
            <form action={onDismiss}>
              <input type="hidden" name="threadId" value={t.id} />
              <button type="submit" className="btn dismiss">
                Dismiss
              </button>
            </form>
            <a
              href={gmailHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn dismiss"
              style={{ textDecoration: 'none' }}
            >
              Open in Gmail ↗
            </a>
          </div>
        </div>
      </details>
    )
  }

  function Section({
    title,
    count,
    children,
    defaultOpen = true,
    accent,
  }: {
    title: string
    count: number
    children: React.ReactNode
    defaultOpen?: boolean
    accent?: 'royal' | 'amber'
  }) {
    return (
      <details
        open={defaultOpen}
        style={{
          marginBottom: '0.9rem',
          border: '1px solid var(--border, var(--border-soft))',
          borderRadius: '10px',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        <summary
          style={{
            padding: '0.7rem 1rem',
            cursor: 'pointer',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background:
              accent === 'royal'
                ? 'rgba(67, 56, 202, 0.06)'
                : accent === 'amber'
                  ? 'rgba(234, 179, 8, 0.08)'
                  : 'rgba(15, 23, 42, 0.025)',
            borderBottom: '1px solid var(--border, var(--border-soft))',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{title}</h2>
          <span className="meta" style={{ margin: 0, fontSize: '0.85rem' }}>
            {count}
          </span>
        </summary>
        <div>{children}</div>
      </details>
    )
  }

  return (
    <div>
      <section className="grid-4" style={{ marginBottom: '1rem' }}>
        <article className="card stat">
          <p className="label">Drafts to approve</p>
          <p className="value small">{drafted.length}</p>
        </article>
        <article className="card stat">
          <p className="label">Needs reply (no draft)</p>
          <p className="value small">{needsReply.length}</p>
        </article>
        <article className="card stat">
          <p className="label">Synced threads</p>
          <p className="value small">{totalSynced}</p>
        </article>
        <article className="card stat">
          <p className="label">Sent today</p>
          <p className="value small">{sent.length}</p>
        </article>
      </section>

      {totalSynced === 0 && (
        <section
          className="card"
          style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--muted)' }}
        >
          <p style={{ margin: '0 0 0.5rem' }}>
            No threads synced yet. The worker pulls your inbox every ~2 minutes.
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            Make sure your Google connection at <code>/dashboard/integrations</code> shows
            the Email Triage scopes granted.
          </p>
        </section>
      )}

      {drafted.length > 0 && (
        <Section title="Drafts ready to approve" count={drafted.length} accent="royal">
          {drafted.length > 1 && (
            <form
              action={onApproveAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '0.6rem 0.9rem',
                borderBottom: '1px solid var(--border, var(--border-soft))',
                background: 'var(--paper-2)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                Reviewed them all? Send every draft as-is in one go.
              </span>
              <button
                type="submit"
                className="btn approve"
                style={{ fontSize: 13, padding: '6px 14px' }}
              >
                Approve &amp; send all ({drafted.length})
              </button>
            </form>
          )}
          {drafted.map((t) => (
            <ThreadRow key={t.id} t={t} showDraft={true} />
          ))}
        </Section>
      )}

      {needsReply.length > 0 && (
        <Section title="Needs reply — draft pending" count={needsReply.length} accent="amber">
          {needsReply.map((t) => (
            <ThreadRow key={t.id} t={t} showDraft={false} />
          ))}
        </Section>
      )}

      {fyi.length > 0 && (
        <Section title="FYI — no reply needed" count={fyi.length} defaultOpen={false}>
          {fyi.map((t) => (
            <ThreadRow key={t.id} t={t} showDraft={false} />
          ))}
        </Section>
      )}

      {snoozed.length > 0 && (
        <Section title="Snoozed" count={snoozed.length} defaultOpen={false}>
          {snoozed.map((t) => (
            <ThreadRow key={t.id} t={t} showDraft={false} />
          ))}
        </Section>
      )}

      {sent.length > 0 && (
        <Section title="Sent recently" count={sent.length} defaultOpen={false}>
          {sent.map((t) => (
            <ThreadRow key={t.id} t={t} showDraft={false} />
          ))}
        </Section>
      )}

      {noise.length > 0 && (
        <Section
          title="Newsletters &amp; noise"
          count={noise.length}
          defaultOpen={false}
        >
          {noise.map((t) => (
            <ThreadRow key={t.id} t={t} showDraft={false} />
          ))}
        </Section>
      )}
    </div>
  )
}
