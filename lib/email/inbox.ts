// Inbox reads + actions, scoped to the viewer's own mailbox (owner 10-09).
//
// The Inbox page (EmailTab, ActiveInbox) and its server actions call these
// instead of querying email_threads by tenant. Every function takes the
// member's MailboxScope; a thread outside it is treated as not found, so a
// guessed id, another member's mailbox, the old shared mailbox or an inactive
// member's mail can never be listed, read, drafted, sent, approved, snoozed
// or dismissed. Nothing here deletes mail.

import { supabase } from '@/lib/supabase'
import { getGmailThread, markGmailRead, replyToGmailThread } from '@/lib/google'
import {
  loadThreadForMember,
  scopeThreadQuery,
  threadInMailbox,
  type Mailbox,
  type MailboxScope,
} from '@/lib/email/mailboxAccess'

export type InboxThread = {
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
  message_count: number | null
  lead_id: string | null
  owner_member_id: string | null
  created_at: string | null
}

export type InboxDraft = {
  id: string
  subject: string | null
  body: string
  created_at: string
  edited_by_human: boolean
}

export type InboxLatestInbound = {
  fromAddress: string | null
  bodyText: string | null
  bodyHtml: string | null
  sentAt: string | null
}

export type InboxListing = {
  threads: InboxThread[]
  draftByThread: Map<string, InboxDraft>
  latestByThread: Map<string, InboxLatestInbound>
}

const THREAD_COLS =
  'id, gmail_thread_id, subject, from_address, from_name, snippet, last_message_at, priority, category, needs_reply, reasoning, status, snoozed_until, message_count, lead_id, owner_member_id, created_at'

const EMPTY = (): InboxListing => ({ threads: [], draftByThread: new Map(), latestByThread: new Map() })

/**
 * Threads in ONE mailbox the member owns. `box` null (no Google connected, or
 * a mailbox they don't own was asked for) → nothing.
 * view 'triage' = the AI drafts tab; 'active' = the live inbox.
 */
export async function listMailboxThreads(
  scope: MailboxScope,
  box: Mailbox | null,
  view: 'triage' | 'active',
  limit = 200,
): Promise<InboxListing> {
  if (!box || !scope.mailboxes.some((m) => m.key === box.key)) return EMPTY()
  let q = supabase.from('email_threads').select(THREAD_COLS).eq('rep_id', scope.tenantId)
  q = scopeThreadQuery(q, box)
  q = view === 'triage'
    ? q.in('status', ['new', 'triaged', 'drafted', 'snoozed', 'sent'])
    : q.not('status', 'in', '("dismissed","archived")')
  const { data } = await q.order('last_message_at', { ascending: false }).limit(limit)
  // Belt and braces: re-check every row in memory against the mailbox.
  const threads = ((data ?? []) as InboxThread[]).filter((t) => threadInMailbox(box, scope, { ...t, rep_id: scope.tenantId }))
  if (threads.length === 0) return EMPTY()

  const threadIds = threads.map((t) => t.id)
  const [draftsRes, msgsRes] = await Promise.all([
    supabase
      .from('email_drafts')
      .select('id, thread_id, subject, body, created_at, edited_by_human, status')
      .eq('rep_id', scope.tenantId)
      .in('thread_id', threadIds)
      .eq('status', 'pending'),
    supabase
      .from('email_messages')
      .select('thread_id, from_address, body_text, body_html, sent_at, direction')
      .in('thread_id', threadIds)
      .eq('direction', 'inbound')
      .order('sent_at', { ascending: false }),
  ])
  const draftByThread = new Map<string, InboxDraft>()
  for (const d of (draftsRes.data ?? []) as Array<InboxDraft & { thread_id: string }>) {
    draftByThread.set(d.thread_id, { id: d.id, subject: d.subject, body: d.body, created_at: d.created_at, edited_by_human: d.edited_by_human })
  }
  const latestByThread = new Map<string, InboxLatestInbound>()
  for (const m of (msgsRes.data ?? []) as Array<{ thread_id: string; from_address: string | null; body_text: string | null; body_html: string | null; sent_at: string | null }>) {
    if (latestByThread.has(m.thread_id)) continue
    latestByThread.set(m.thread_id, { fromAddress: m.from_address, bodyText: m.body_text, bodyHtml: m.body_html, sentAt: m.sent_at })
  }
  return { threads, draftByThread, latestByThread }
}

/** One thread + its messages, only when it sits in the member's own mailbox. */
export async function readMailboxThread(scope: MailboxScope, threadId: string) {
  const hit = await loadThreadForMember<InboxThread & { rep_id: string }>(scope, threadId, THREAD_COLS)
  if (!hit) return null
  const { data: messages } = await supabase
    .from('email_messages')
    .select('direction, from_address, to_addresses, subject, body_text, body_html, sent_at')
    .eq('thread_id', hit.thread.id)
    .order('sent_at', { ascending: true })
  return { thread: hit.thread, mailbox: hit.mailbox, messages: messages ?? [] }
}

export type SendResult = { ok: boolean; reason?: string }

/**
 * Send one pending draft as a Gmail reply and record it. The thread must be
 * in the member's mailbox; the reply goes out from that mailbox's account.
 */
export async function approveDraft(
  scope: MailboxScope,
  threadId: string,
  draftId: string,
  edits?: { body?: string; subject?: string },
): Promise<SendResult> {
  if (!threadId || !draftId) return { ok: false, reason: 'missing' }
  const hit = await loadThreadForMember<{ id: string; rep_id: string; owner_member_id: string | null; created_at: string | null; gmail_thread_id: string; lead_id: string | null }>(
    scope,
    threadId,
    'gmail_thread_id, lead_id',
  )
  if (!hit) return { ok: false, reason: 'no_thread' }
  const { thread, mailbox } = hit

  const { data: draftRow } = await supabase
    .from('email_drafts')
    .select('id, subject, body, status')
    .eq('id', draftId)
    .eq('thread_id', threadId)
    .eq('rep_id', scope.tenantId)
    .maybeSingle()
  const draft = draftRow as { id: string; subject: string | null; body: string; status: string } | null
  if (!draft || draft.status !== 'pending') return { ok: false, reason: 'not_pending' }

  const gmailRes = await getGmailThread(scope.tenantId, mailbox.memberId, thread.gmail_thread_id, { accountId: mailbox.accountId })
  if (!gmailRes.ok) return { ok: false, reason: 'gmail_fetch' }
  const inbound = (gmailRes.messages ?? []).filter((m) => !m.labelIds.includes('SENT'))
  const lastInbound = inbound[inbound.length - 1]
  if (!lastInbound) return { ok: false, reason: 'no_inbound' }

  const editedBody = (edits?.body ?? '').trim()
  const editedSubject = (edits?.subject ?? '').trim()
  const finalBody = editedBody || draft.body
  const finalSubject = editedSubject || draft.subject || lastInbound.subject || ''
  const bodyEdited = Boolean(editedBody) && editedBody !== draft.body
  const subjectEdited = Boolean(editedSubject) && editedSubject !== (draft.subject ?? '')

  const send = await replyToGmailThread(scope.tenantId, {
    threadId: thread.gmail_thread_id,
    to: lastInbound.fromAddress,
    subject: /^re:/i.test(finalSubject) ? finalSubject : `Re: ${finalSubject}`,
    body: finalBody,
    inReplyTo: lastInbound.messageIdHeader,
    references: lastInbound.referencesHeader,
    memberId: mailbox.memberId,
    accountId: mailbox.accountId,
  })
  if (!send.ok) {
    console.error('[email-triage] send failed', send.error)
    return { ok: false, reason: 'send_failed' }
  }

  const now = new Date().toISOString()
  await supabase
    .from('email_drafts')
    .update({ status: 'sent', body: finalBody, subject: finalSubject, edited_by_human: bodyEdited || subjectEdited, sent_at: now, gmail_message_id: send.messageId ?? null })
    .eq('id', draftId)
    .eq('rep_id', scope.tenantId)
  await supabase.from('email_threads').update({ status: 'sent', updated_at: now }).eq('id', threadId).eq('rep_id', scope.tenantId)
  await supabase.from('outbound_messages').insert({
    rep_id: scope.tenantId,
    lead_id: thread.lead_id ?? null,
    channel: 'email',
    direction: 'outbound',
    to_address: lastInbound.fromAddress,
    body: finalBody,
    status: 'sent',
    external_id: send.messageId ?? null,
    metadata: { gmail_thread_id: thread.gmail_thread_id, sent_by_member_id: scope.memberId },
  })
  if (lastInbound.id) await markGmailRead(scope.tenantId, mailbox.memberId, lastInbound.id, { accountId: mailbox.accountId })
  return { ok: true }
}

/** "Approve & send all": every pending draft in ONE of the member's mailboxes. */
export async function approveAllDrafts(scope: MailboxScope, box: Mailbox | null): Promise<{ sent: number; skipped: number }> {
  const listing = await listMailboxThreads(scope, box, 'triage', 500)
  let sent = 0
  let skipped = 0
  for (const t of listing.threads) {
    const d = listing.draftByThread.get(t.id)
    if (!d) continue
    try {
      const r = await approveDraft(scope, t.id, d.id)
      if (r.ok) sent++
      else skipped++
    } catch (err) {
      skipped++
      console.error('[email-triage] approve-all item failed', d.id, err)
    }
  }
  return { sent, skipped }
}

/** Dismiss (archive out of the Inbox) one thread in the member's mailbox. */
export async function dismissThread(scope: MailboxScope, threadId: string): Promise<boolean> {
  const hit = await loadThreadForMember(scope, threadId, 'id')
  if (!hit) return false
  const now = new Date().toISOString()
  await supabase.from('email_drafts').update({ status: 'dismissed' }).eq('thread_id', threadId).eq('rep_id', scope.tenantId).eq('status', 'pending')
  await supabase.from('email_threads').update({ status: 'dismissed', updated_at: now }).eq('id', threadId).eq('rep_id', scope.tenantId)
  return true
}

/** Snooze one thread in the member's mailbox. */
export async function snoozeThread(scope: MailboxScope, threadId: string, hours: number): Promise<boolean> {
  const hit = await loadThreadForMember(scope, threadId, 'id')
  if (!hit) return false
  const until = new Date(Date.now() + Math.max(1, hours) * 3600_000).toISOString()
  await supabase
    .from('email_threads')
    .update({ status: 'snoozed', snoozed_until: until, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('rep_id', scope.tenantId)
  return true
}
