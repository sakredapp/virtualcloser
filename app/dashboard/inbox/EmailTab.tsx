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
import {
  getMailboxScope,
  loadThreadForMember,
  resolveMailbox,
  type Mailbox,
  type MailboxScope,
} from '@/lib/email/mailboxAccess'
import {
  approveAllDrafts,
  approveDraft,
  dismissThread,
  listMailboxThreads,
  snoozeThread,
} from '@/lib/email/inbox'
import { draftEmailReply } from '@/lib/claude'
import { activeTextModel } from '@/lib/aiProvider'
import { startOfTodayIn } from '@/lib/today'
import { threadNeedsReply } from '@/lib/email/needsReply'

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

// Mailbox access (owner 10-09, security): the viewer only ever sees, drafts,
// sends, snoozes or dismisses threads in their OWN connected mailbox. The
// page resolves which box; every server action re-checks the thread against
// the member's scope (lib/email/mailboxAccess) before touching it.
async function loadThreads(scope: MailboxScope, box: Mailbox | null): Promise<ThreadWithDraft[]> {
  const listing = await listMailboxThreads(scope, box, 'triage', 200)
  return listing.threads.map((r) => ({
    ...r,
    draft: listing.draftByThread.get(r.id) ?? null,
    latestInbound: listing.latestByThread.get(r.id) ?? null,
  }))
}

async function viewerScope(): Promise<MailboxScope> {
  const { tenant, member } = await requireMember()
  return getMailboxScope(tenant.id, member)
}

export default async function EmailTab({ mailboxKey }: { mailboxKey: string }) {
  const { tenant, member } = await requireMember()
  const scope = await getMailboxScope(tenant.id, member)
  const box = resolveMailbox(scope, mailboxKey)
  const threads = await loadThreads(scope, box)

  // ── Server actions ────────────────────────────────────────────────────────

  async function onApprove(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const draftId = String(formData.get('draftId') ?? '')
    const editedBody = String(formData.get('body') ?? '').trim()
    const editedSubject = String(formData.get('subject') ?? '').trim()
    if (!threadId || !draftId) return
    await approveDraft(await viewerScope(), threadId, draftId, { body: editedBody, subject: editedSubject })
    revalidatePath('/dashboard/inbox')
  }

  // Batch: approve + send every pending draft in the viewer's selected
  // mailbox (never another member's, never a shared box they don't own).
  async function onApproveAll(formData: FormData) {
    'use server'
    const scope = await viewerScope()
    const target = resolveMailbox(scope, String(formData.get('account') ?? ''))
    if (!target) return
    await approveAllDrafts(scope, target)
    revalidatePath('/dashboard/inbox')
  }

  async function onDismiss(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    if (!threadId) return
    await dismissThread(await viewerScope(), threadId)
    revalidatePath('/dashboard/inbox')
  }

  async function onSnooze(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const hours = parseInt(String(formData.get('hours') ?? '24'), 10) || 24
    if (!threadId) return
    await snoozeThread(await viewerScope(), threadId, hours)
    revalidatePath('/dashboard/inbox')
  }

  async function onRegenerate(formData: FormData) {
    'use server'
    const threadId = String(formData.get('threadId') ?? '')
    const styleNote = String(formData.get('styleNote') ?? '').trim() || null
    if (!threadId) return
    const { tenant, member } = await requireMember()
    const scope = await getMailboxScope(tenant.id, member)
    const hit = await loadThreadForMember<{ id: string; rep_id: string; owner_member_id: string | null; created_at: string | null; lead_id: string | null }>(
      scope,
      threadId,
      'lead_id',
    )
    if (!hit) return
    const thread = hit.thread

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
      const r = rep as { display_name: string | null; slug: string | null; timezone: string | null } | null
      return {
        name: r?.display_name ?? r?.slug ?? 'the rep',
        email: hit.mailbox.email ?? null,
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
      model_used: activeTextModel(process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'),
      status: 'pending',
      feedback: styleNote,
    })
    await supabase
      .from('email_threads')
      .update({ status: 'drafted', updated_at: new Date().toISOString() })
      .eq('id', threadId)
      .eq('rep_id', tenant.id)

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
    .filter(threadNeedsReply)
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
  // "Sent today" = replies actually sent since local midnight from the threads
  // this viewer may see (never another member's mailbox).
  const sentToday = await (async () => {
    const ids = threads.map((t) => t.id)
    if (ids.length === 0) return 0
    let since: string
    try {
      since = startOfTodayIn(tenant.timezone || 'America/New_York').toISOString()
    } catch {
      since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    }
    const { count } = await supabase
      .from('email_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', tenant.id)
      .eq('status', 'sent')
      .gte('sent_at', since)
      .in('thread_id', ids)
    return count ?? 0
  })()

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
          <p className="value small">{sentToday}</p>
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
              <input type="hidden" name="account" value={box?.key ?? ''} />
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
