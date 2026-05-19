// Active Inbox — a live, chronological view of every synced thread.
//
// This is the "Gmail-style" tab. It shows everything we've pulled from
// the rep's Google Inbox, sorted by most recent message, with the AI
// draft surfaced inline when one exists. Click any row to expand and
// read the latest inbound body, see the draft, and act on it.
//
// Companion to EmailTab (which is bucketed by triage status — drafts,
// needs-reply, etc.). Active Inbox is for "I just want to scroll my
// inbox in VC."

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'
import { replyToGmailThread, markGmailRead } from '@/lib/google'
import LiveInboxRefresh from './LiveInboxRefresh'
import InboxSearch from './InboxSearch'

const LIMIT = 200

type ThreadRow = {
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
  message_count: number
  lead_id: string | null
  owner_member_id: string | null
}

type DraftRow = {
  id: string
  subject: string | null
  body: string
  edited_by_human: boolean
}

type LatestInbound = {
  bodyText: string | null
  bodyHtml: string | null
  sentAt: string | null
  unread: boolean
}

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: 'rgba(225, 29, 72, 0.12)', fg: '#9f1239' },
  high: { bg: 'rgba(234, 88, 12, 0.12)', fg: '#9a3412' },
  normal: { bg: 'rgba(15, 23, 42, 0.06)', fg: '#475569' },
  low: { bg: 'rgba(15, 23, 42, 0.04)', fg: '#64748b' },
  noise: { bg: 'rgba(15, 23, 42, 0.04)', fg: '#94a3b8' },
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
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

async function loadActive(repId: string): Promise<{
  threads: ThreadRow[]
  draftByThread: Map<string, DraftRow>
  latestByThread: Map<string, LatestInbound>
}> {
  const { data: threads } = await supabase
    .from('email_threads')
    .select(
      'id, gmail_thread_id, subject, from_address, from_name, snippet, last_message_at, priority, category, needs_reply, reasoning, status, message_count, lead_id, owner_member_id',
    )
    .eq('rep_id', repId)
    .not('status', 'in', '("dismissed","archived")')
    .order('last_message_at', { ascending: false })
    .limit(LIMIT)

  const rows = (threads ?? []) as ThreadRow[]
  if (rows.length === 0) {
    return { threads: rows, draftByThread: new Map(), latestByThread: new Map() }
  }

  // SAFETY: rows already filtered by rep_id, so threadIds belong to this tenant.
  const threadIds = rows.map((r) => r.id)
  const [draftsRes, msgsRes] = await Promise.all([
    supabase
      .from('email_drafts')
      .select('id, thread_id, subject, body, edited_by_human, status')
      .in('thread_id', threadIds)
      .eq('status', 'pending'),
    supabase
      .from('email_messages')
      .select('thread_id, from_address, body_text, body_html, sent_at, direction')
      .in('thread_id', threadIds)
      .eq('direction', 'inbound')
      .order('sent_at', { ascending: false }),
  ])

  const draftByThread = new Map<string, DraftRow>()
  for (const d of (draftsRes.data ?? []) as Array<{
    id: string
    thread_id: string
    subject: string | null
    body: string
    edited_by_human: boolean
    status: string
  }>) {
    draftByThread.set(d.thread_id, {
      id: d.id,
      subject: d.subject,
      body: d.body,
      edited_by_human: d.edited_by_human,
    })
  }

  const latestByThread = new Map<string, LatestInbound>()
  for (const m of (msgsRes.data ?? []) as Array<{
    thread_id: string
    body_text: string | null
    body_html: string | null
    sent_at: string | null
  }>) {
    if (latestByThread.has(m.thread_id)) continue
    latestByThread.set(m.thread_id, {
      bodyText: m.body_text,
      bodyHtml: m.body_html,
      sentAt: m.sent_at,
      unread: false, // we don't currently persist the UNREAD label; can be added later
    })
  }

  return { threads: rows, draftByThread, latestByThread }
}

export default async function ActiveInbox() {
  const { tenant } = await requireMember()
  const { threads, draftByThread, latestByThread } = await loadActive(tenant.id)

  // ── Server actions (mirror EmailTab actions so users can act here too) ──

  async function onApprove(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const draftId = String(formData.get('draftId') ?? '')
    const editedBody = String(formData.get('body') ?? '').trim()
    const editedSubject = String(formData.get('subject') ?? '').trim()
    if (!threadId || !draftId) return
    const { tenant, member } = await requireMember()

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
    if (!draft || (draft as { status: string }).status !== 'pending') return

    const { getGmailThread } = await import('@/lib/google')
    const gmailRes = await getGmailThread(
      (thread as { rep_id: string }).rep_id,
      (thread as { owner_member_id: string | null }).owner_member_id ?? null,
      (thread as { gmail_thread_id: string }).gmail_thread_id,
    )
    if (!gmailRes.ok) return
    const inbound = (gmailRes.messages ?? []).filter((m) => !m.labelIds.includes('SENT'))
    const lastInbound = inbound[inbound.length - 1]
    if (!lastInbound) return

    const finalBody = editedBody || (draft as { body: string }).body
    const finalSubject =
      editedSubject || (draft as { subject: string | null }).subject || lastInbound.subject || ''

    const send = await replyToGmailThread((thread as { rep_id: string }).rep_id, {
      threadId: (thread as { gmail_thread_id: string }).gmail_thread_id,
      to: lastInbound.fromAddress,
      subject: /^re:/i.test(finalSubject) ? finalSubject : `Re: ${finalSubject}`,
      body: finalBody,
      inReplyTo: lastInbound.messageIdHeader,
      references: lastInbound.referencesHeader,
      memberId: (thread as { owner_member_id: string | null }).owner_member_id ?? null,
    })
    if (!send.ok) return

    const now = new Date().toISOString()
    await supabase
      .from('email_drafts')
      .update({
        status: 'sent',
        body: finalBody,
        subject: finalSubject,
        edited_by_human: Boolean(editedBody || editedSubject),
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
        sent_by_member_id: member.id,
      },
    })
    if (lastInbound.id) {
      await markGmailRead(
        (thread as { rep_id: string }).rep_id,
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

  // ── Render ───────────────────────────────────────────────────────────────

  function PriorityChip({ p }: { p: string | null }) {
    if (!p) return null
    const style = PRIORITY_STYLE[p] ?? PRIORITY_STYLE.normal
    return (
      <span
        style={{
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          background: style.bg,
          color: style.fg,
          fontWeight: 700,
        }}
      >
        {p}
      </span>
    )
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.8rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Active inbox — {threads.length} threads
          </h2>
          <LiveInboxRefresh />
        </div>
        <p className="meta" style={{ margin: 0, fontSize: '0.8rem' }}>
          Synced from Gmail every ~30 seconds. New mail appears here live.
        </p>
      </div>

      <InboxSearch />

      {threads.length === 0 && (
        <section
          className="card"
          style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--muted)' }}
        >
          <p style={{ margin: 0 }}>
            No threads synced yet. Make sure Google is connected at{' '}
            <a href="/dashboard/integrations">/dashboard/integrations</a>.
          </p>
        </section>
      )}

      <div
        style={{
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: '10px',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {threads.map((t) => {
          const draft = draftByThread.get(t.id) ?? null
          const latest = latestByThread.get(t.id) ?? null
          const sender = t.from_name || t.from_address || '(unknown)'
          const body =
            latest?.bodyText ?? htmlToText(latest?.bodyHtml ?? null) ?? t.snippet ?? ''
          const gmailHref = `https://mail.google.com/mail/u/0/#inbox/${t.gmail_thread_id}`
          const bold = t.status === 'new' || t.status === 'drafted' || draft !== null
          return (
            <details
              key={t.id}
              style={{
                borderBottom: '1px solid var(--border, #e2e8f0)',
              }}
            >
              <summary
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(140px, 200px) 1fr auto',
                  gap: '0.75rem',
                  alignItems: 'center',
                  padding: '0.65rem 0.9rem',
                  cursor: 'pointer',
                  listStyle: 'none',
                }}
              >
                <div
                  style={{
                    fontWeight: bold ? 700 : 500,
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={t.from_address ?? ''}
                >
                  {sender}
                  {t.message_count > 1 && (
                    <span style={{ color: 'var(--muted)', marginLeft: '0.3rem' }}>
                      ({t.message_count})
                    </span>
                  )}
                </div>
                <div style={{ minWidth: 0, overflow: 'hidden' }}>
                  <span
                    style={{
                      fontWeight: bold ? 700 : 500,
                      fontSize: '0.9rem',
                      marginRight: '0.5rem',
                    }}
                  >
                    {t.subject || '(no subject)'}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                    {t.snippet}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: '0.4rem',
                    alignItems: 'center',
                    whiteSpace: 'nowrap',
                    fontSize: '0.78rem',
                    color: 'var(--muted)',
                  }}
                >
                  {draft && (
                    <span
                      style={{
                        background: 'rgba(67, 56, 202, 0.12)',
                        color: 'var(--royal, #4338ca)',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                      }}
                    >
                      DRAFT
                    </span>
                  )}
                  <PriorityChip p={t.priority} />
                  <span>{formatTime(t.last_message_at)}</span>
                </div>
              </summary>

              <div style={{ padding: '0.4rem 1rem 1rem', background: 'rgba(15,23,42,0.02)' }}>
                {t.reasoning && (
                  <p
                    className="meta"
                    style={{ margin: '0 0 0.5rem', fontStyle: 'italic', fontSize: '0.82rem' }}
                  >
                    <strong>AI read:</strong> {t.reasoning}
                  </p>
                )}

                <div
                  style={{
                    padding: '0.6rem 0.8rem',
                    background: '#fff',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '6px',
                    maxHeight: '280px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.87rem',
                    lineHeight: 1.5,
                    marginBottom: '0.7rem',
                  }}
                >
                  {body || '(no body)'}
                </div>

                {draft ? (
                  <form action={onApprove}>
                    <input type="hidden" name="threadId" value={t.id} />
                    <input type="hidden" name="draftId" value={draft.id} />
                    <p
                      className="meta"
                      style={{
                        margin: '0 0 0.3rem',
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--royal, #4338ca)',
                        fontWeight: 700,
                      }}
                    >
                      AI-drafted reply — edit anything before approving
                    </p>
                    <input
                      type="text"
                      name="subject"
                      defaultValue={draft.subject ?? ''}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border, #e2e8f0)',
                        marginBottom: '0.35rem',
                        fontSize: '0.88rem',
                      }}
                    />
                    <textarea
                      name="body"
                      defaultValue={draft.body}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.65rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border, #e2e8f0)',
                        fontFamily: 'inherit',
                        fontSize: '0.88rem',
                        lineHeight: 1.5,
                      }}
                    />
                    <div className="actions" style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                      <button type="submit" className="btn approve">
                        Approve &amp; Send
                      </button>
                    </div>
                  </form>
                ) : null}

                <div
                  style={{
                    marginTop: '0.5rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                  }}
                >
                  {!draft && (
                    <a href={gmailHref} target="_blank" rel="noopener noreferrer" className="btn approve" style={{ textDecoration: 'none' }}>
                      Reply in Gmail ↗
                    </a>
                  )}
                  <a href={gmailHref} target="_blank" rel="noopener noreferrer" className="btn dismiss" style={{ textDecoration: 'none' }}>
                    Open in Gmail
                  </a>
                  <form action={onDismiss}>
                    <input type="hidden" name="threadId" value={t.id} />
                    <button type="submit" className="btn dismiss">
                      Dismiss
                    </button>
                  </form>
                </div>
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
