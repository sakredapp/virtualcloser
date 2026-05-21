// Gmail inbox sync tick.
//
// Pulls new threads into email_threads / email_messages for every active
// tenant that has granted gmail.readonly. Runs inside the Hetzner worker
// (every Nth campaign tick) and is also exposed via /api/cron/gmail-sync for
// manual testing.
//
// Triage is intentionally separate — see lib/email/triageTick.ts.

import { supabase } from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import {
  getGmailHistory,
  getGmailProfile,
  getGmailThread,
  listGmailThreads,
  type ParsedGmailMessage,
} from '@/lib/google'

// On first connect we pull this many recent inbox threads. Gmail caps a
// single list call at 100; we paginate up to SEED_MAX_PAGES to get a
// meaningful backlog without timing out the worker tick.
const SEED_PER_PAGE = 100
const SEED_MAX_PAGES = 2 // up to 200 threads on first run
const MAX_THREADS_PER_RUN = 50

// The full-inbox membership reconcile (catches archives that happened before
// our history cursor) is expensive on a large inbox, so we only run it every
// RECONCILE_INTERVAL_MS per rep rather than every 30s tick. Incremental
// history (labelRemoved) handles real-time archives between reconciles.
const RECONCILE_INTERVAL_MS = 10 * 60_000 // 10 min
// Bound on how many inbox threads we'll page through. Spencer's inbox is
// ~1-2k; 10k is a wide guard. If an inbox somehow exceeds this we skip the
// sweep rather than risk false-archiving threads beyond what we listed.
const RECONCILE_MAX_INBOX = 10_000
const lastReconcileAt = new Map<string, number>()

export type SyncTarget = { repId: string; memberId: string | null; email: string | null }

export type TargetSyncResult = {
  repId: string
  email: string | null
  mode: 'seeded' | 'incremental' | 'skipped'
  threadsPersisted: number
  newThreads: number
  error?: string
}

export type GmailSyncTickResult = {
  totalNew: number
  totalPersisted: number
  results: TargetSyncResult[]
}

/**
 * Allow-list of rep_ids enabled for email triage.
 *  - unset → feature off everywhere (returns Set with the magic "__off__" entry)
 *  - "*"   → enabled for every active tenant (returns null = no filter)
 *  - "id1,id2,id3" → enabled only for these rep_ids
 *
 * The worker also checks Boolean(process.env.EMAIL_TRIAGE_REP_IDS) before
 * firing, so unset means the worker never even calls runGmailSyncTick.
 */
export function enabledReps(): Set<string> | null {
  const raw = process.env.EMAIL_TRIAGE_REP_IDS
  if (!raw) return new Set(['__off__']) // never matches any real rep_id
  const trimmed = raw.trim()
  if (trimmed === '*') return null // wildcard: no filter, all tenants enabled
  return new Set(trimmed.split(',').map((s) => s.trim()).filter(Boolean))
}

async function loadSyncTargets(tenants: Tenant[]): Promise<SyncTarget[]> {
  const repIds = tenants.map((t) => t.id)
  if (repIds.length === 0) return []
  const { data, error } = await supabase
    .from('google_tokens')
    .select('rep_id, member_id, email, scope')
    .in('rep_id', repIds)
  if (error) {
    console.error('[gmail-sync] failed to load tokens', error.message)
    return []
  }
  const targets: SyncTarget[] = []
  for (const row of (data ?? []) as Array<{
    rep_id: string
    member_id: string | null
    email: string | null
    scope: string | null
  }>) {
    if (!row.scope || !row.scope.includes('gmail.readonly')) continue
    targets.push({ repId: row.rep_id, memberId: row.member_id, email: row.email })
  }
  return targets
}

async function loadCursor(
  repId: string,
  memberId: string | null,
): Promise<{ lastHistoryId: string | null } | null> {
  let q = supabase
    .from('gmail_sync_state')
    .select('last_history_id')
    .eq('rep_id', repId)
  q = memberId === null ? q.is('member_id', null) : q.eq('member_id', memberId)
  const { data } = await q.maybeSingle()
  if (!data) return null
  return { lastHistoryId: (data as { last_history_id: string | null }).last_history_id }
}

async function saveCursor(
  repId: string,
  memberId: string | null,
  fields: { lastHistoryId?: string | null; lastError?: string | null; ok: boolean },
): Promise<void> {
  // Atomic upsert in a single statement — see migration
  // gmail_sync_state_atomic_upsert_fn. Replaces a previous read-modify-write
  // pattern that lost consecutive_errors increments under concurrent ticks
  // and could create duplicate rows when member_id is null.
  const { error } = await supabase.rpc('gmail_sync_state_record', {
    p_rep_id: repId,
    p_member_id: memberId,
    p_history_id: fields.lastHistoryId ?? null,
    p_ok: fields.ok,
    p_error: fields.lastError ?? null,
  })
  if (error) {
    console.error('[gmail-sync] saveCursor rpc failed', error.message)
  }
}

async function persistThread(
  repId: string,
  ownerMemberId: string | null,
  threadId: string,
  messages: ParsedGmailMessage[],
): Promise<{ wasNew: boolean } | null> {
  if (messages.length === 0) return null
  const last = messages[messages.length - 1]
  const lastInbound = [...messages].reverse().find((m) => !m.labelIds.includes('SENT')) ?? last
  const lastMessageAt = last.internalDate
    ? new Date(Number(last.internalDate)).toISOString()
    : null

  const { data: existing } = await supabase
    .from('email_threads')
    .select('id, status, message_count')
    .eq('rep_id', repId)
    .eq('gmail_thread_id', threadId)
    .maybeSingle()

  const threadFields: Record<string, unknown> = {
    rep_id: repId,
    owner_member_id: ownerMemberId,
    gmail_thread_id: threadId,
    gmail_history_id: last.historyId ?? null,
    subject: last.subject || lastInbound.subject || '(no subject)',
    from_address: lastInbound.fromAddress || null,
    from_name: lastInbound.fromName,
    snippet: last.snippet || lastInbound.snippet || '',
    last_message_at: lastMessageAt,
    message_count: messages.length,
    updated_at: new Date().toISOString(),
  }

  let threadRowId: string | null = null
  let wasNew = false

  if (existing) {
    threadRowId = (existing as { id: string }).id
    const prevCount = (existing as { message_count: number }).message_count ?? 0
    if (messages.length > prevCount) {
      // New inbound activity → bump back to 'new' so the triage worker re-runs.
      threadFields.status = 'new'
    }
    await supabase.from('email_threads').update(threadFields).eq('id', threadRowId)
    // Supersede any pending draft tied to a stale message count.
    if (messages.length > prevCount) {
      await supabase
        .from('email_drafts')
        .update({ status: 'superseded' })
        .eq('thread_id', threadRowId)
        .eq('status', 'pending')
    }
  } else {
    threadFields.status = 'new'
    const { data: inserted, error } = await supabase
      .from('email_threads')
      .insert(threadFields)
      .select('id')
      .single()
    if (error) {
      console.error('[gmail-sync] insert thread failed', error.message)
      return null
    }
    threadRowId = (inserted as { id: string }).id
    wasNew = true
  }

  const rows = messages.map((m) => ({
    thread_id: threadRowId,
    gmail_message_id: m.id,
    direction: m.labelIds.includes('SENT') ? 'outbound' : 'inbound',
    from_address: m.fromAddress || null,
    to_addresses: m.toAddresses,
    cc_addresses: m.ccAddresses,
    subject: m.subject || null,
    body_text: m.bodyText,
    body_html: m.bodyHtml,
    sent_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
  }))

  for (const row of rows) {
    const { error } = await supabase.from('email_messages').insert(row)
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.error('[gmail-sync] insert message failed', error.message)
    }
  }

  return { wasNew }
}

async function syncTarget(target: SyncTarget): Promise<TargetSyncResult> {
  const cursor = await loadCursor(target.repId, target.memberId)

  if (!cursor?.lastHistoryId) {
    const profile = await getGmailProfile(target.repId, target.memberId)
    if (!profile.ok) {
      await saveCursor(target.repId, target.memberId, { ok: false, lastError: profile.error })
      return {
        repId: target.repId,
        email: target.email,
        mode: 'skipped',
        threadsPersisted: 0,
        newThreads: 0,
        error: profile.error,
      }
    }
    // Paginate through up to SEED_MAX_PAGES pages of inbox threads.
    let pageToken: string | undefined
    let persisted = 0
    let newCount = 0
    for (let page = 0; page < SEED_MAX_PAGES; page++) {
      const list = await listGmailThreads(target.repId, target.memberId, {
        q: 'in:inbox',
        maxResults: SEED_PER_PAGE,
        pageToken,
      })
      if (!list.ok) {
        await saveCursor(target.repId, target.memberId, { ok: false, lastError: list.error })
        return {
          repId: target.repId,
          email: target.email,
          mode: 'skipped',
          threadsPersisted: persisted,
          newThreads: newCount,
          error: list.error,
        }
      }
      for (const entry of list.threads ?? []) {
        if (!entry.id) continue
        const t = await getGmailThread(target.repId, target.memberId, entry.id)
        if (!t.ok) continue
        const result = await persistThread(target.repId, target.memberId, entry.id, t.messages ?? [])
        if (result) {
          persisted++
          if (result.wasNew) newCount++
        }
      }
      if (!list.nextPageToken) break
      pageToken = list.nextPageToken
    }
    await saveCursor(target.repId, target.memberId, {
      ok: true,
      lastHistoryId: profile.historyId ?? null,
    })
    return {
      repId: target.repId,
      email: target.email,
      mode: 'seeded',
      threadsPersisted: persisted,
      newThreads: newCount,
    }
  }

  const hist = await getGmailHistory(target.repId, target.memberId, cursor.lastHistoryId, {
    maxResults: MAX_THREADS_PER_RUN,
  })
  if (!hist.ok) {
    if (hist.error === 'gmail_404') {
      // History expired (7 days) → drop cursor so next run re-seeds.
      await saveCursor(target.repId, target.memberId, { ok: true, lastHistoryId: null })
      return {
        repId: target.repId,
        email: target.email,
        mode: 'skipped',
        threadsPersisted: 0,
        newThreads: 0,
        error: 'history_expired_reseed_next_run',
      }
    }
    await saveCursor(target.repId, target.memberId, { ok: false, lastError: hist.error })
    return {
      repId: target.repId,
      email: target.email,
      mode: 'skipped',
      threadsPersisted: 0,
      newThreads: 0,
      error: hist.error,
    }
  }
  let persisted = 0
  let newCount = 0
  for (const tid of hist.threadIds ?? []) {
    const t = await getGmailThread(target.repId, target.memberId, tid)
    if (!t.ok) continue
    const result = await persistThread(target.repId, target.memberId, tid, t.messages ?? [])
    if (result) {
      persisted++
      if (result.wasNew) newCount++
    }
  }

  // Archived/trashed in Gmail (INBOX label removed) → drop off the VC inbox.
  // We don't touch threads the user already sent/dismissed in VC (those are
  // terminal states); archiving an active thread moves it to 'archived' so
  // it leaves the Active Inbox + Drafts views. SSE pushes the change to the
  // browser, so a Gmail archive disappears from the dashboard within ~30s.
  await reconcileArchivedThreads(target.repId, hist.archivedThreadIds ?? [])
  // Moved back into inbox in Gmail → un-archive so it re-triages.
  await reconcileRestoredThreads(target.repId, hist.restoredThreadIds ?? [])
  // Safety net: catch threads archived BEFORE our cursor (history only covers
  // changes since lastHistoryId, so an old archive wouldn't appear above).
  // Lists the full current inbox and archives any active VC thread no longer
  // in it. Only runs when we can see the complete inbox (no pagination), so
  // it never false-archives threads beyond our listing window.
  await reconcileInboxMembership(target.repId, target.memberId)

  await saveCursor(target.repId, target.memberId, {
    ok: true,
    lastHistoryId: hist.historyId ?? cursor.lastHistoryId,
  })
  return {
    repId: target.repId,
    email: target.email,
    mode: 'incremental',
    threadsPersisted: persisted,
    newThreads: newCount,
  }
}

/**
 * Mark threads archived locally when Gmail removed their INBOX label.
 * Skips threads in terminal VC states (sent / dismissed) — those already
 * left the active views and shouldn't be disturbed. Also supersedes any
 * pending draft on a newly-archived thread (no point drafting a reply to
 * something the rep archived).
 */
async function reconcileArchivedThreads(repId: string, gmailThreadIds: string[]): Promise<void> {
  if (gmailThreadIds.length === 0) return
  const now = new Date().toISOString()
  const { data: rows } = await supabase
    .from('email_threads')
    .select('id')
    .eq('rep_id', repId)
    .in('gmail_thread_id', gmailThreadIds)
    .in('status', ['new', 'triaged', 'drafted', 'snoozed'])
  const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return
  await supabase
    .from('email_threads')
    .update({ status: 'archived', updated_at: now })
    .in('id', ids)
  await supabase
    .from('email_drafts')
    .update({ status: 'superseded' })
    .in('thread_id', ids)
    .eq('status', 'pending')
}

/**
 * Bring threads back when Gmail re-added the INBOX label (un-archive).
 * Only revives ones we'd previously archived; flips them to 'new' so the
 * triage worker re-evaluates.
 */
async function reconcileRestoredThreads(repId: string, gmailThreadIds: string[]): Promise<void> {
  if (gmailThreadIds.length === 0) return
  const now = new Date().toISOString()
  await supabase
    .from('email_threads')
    .update({ status: 'new', updated_at: now })
    .eq('rep_id', repId)
    .eq('status', 'archived')
    .in('gmail_thread_id', gmailThreadIds)
}

/**
 * Catch threads archived in Gmail BEFORE our history cursor existed.
 *
 * Incremental history only reports changes since lastHistoryId, so a thread
 * archived days ago (or before the feature shipped) would silently linger in
 * the VC inbox. This pages the rep's CURRENT inbox (cheap — one list call per
 * 100 threads regardless of inbox size) and archives any active VC thread
 * that's no longer in it.
 *
 * Time-gated to RECONCILE_INTERVAL_MS per rep so we don't re-enumerate a
 * large inbox every 30s tick — incremental history keeps things correct in
 * between. Pass force=true to run it immediately (manual catch-up).
 *
 * SAFETY: pages through the COMPLETE inbox before diffing. Only bails (no
 * archiving) if the inbox exceeds RECONCILE_MAX_INBOX, so it can never
 * false-archive threads beyond what it listed.
 */
async function reconcileInboxMembership(
  repId: string,
  memberId: string | null,
  force = false,
): Promise<void> {
  const key = `${repId}:${memberId ?? ''}`
  const last = lastReconcileAt.get(key) ?? 0
  if (!force && Date.now() - last < RECONCILE_INTERVAL_MS) return

  const inboxIds = new Set<string>()
  let pageToken: string | undefined
  do {
    const list = await listGmailThreads(repId, memberId, {
      q: 'in:inbox',
      maxResults: 100,
      pageToken,
    })
    if (!list.ok) return // transient API error — leave state untouched
    for (const t of list.threads ?? []) {
      if (t.id) inboxIds.add(t.id)
    }
    pageToken = list.nextPageToken
    if (inboxIds.size > RECONCILE_MAX_INBOX) return // pathologically large — skip
  } while (pageToken)

  // Mark this reconcile done only after a clean full enumeration.
  lastReconcileAt.set(key, Date.now())

  // We now hold the COMPLETE current inbox. Archive any active VC thread
  // whose gmail_thread_id isn't in it.
  const { data: active } = await supabase
    .from('email_threads')
    .select('id, gmail_thread_id')
    .eq('rep_id', repId)
    .in('status', ['new', 'triaged', 'drafted', 'snoozed'])
  const stale = ((active ?? []) as Array<{ id: string; gmail_thread_id: string }>)
    .filter((r) => !inboxIds.has(r.gmail_thread_id))
    .map((r) => r.id)
  if (stale.length === 0) return

  const now = new Date().toISOString()
  await supabase
    .from('email_threads')
    .update({ status: 'archived', updated_at: now })
    .in('id', stale)
  await supabase
    .from('email_drafts')
    .update({ status: 'superseded' })
    .in('thread_id', stale)
    .eq('status', 'pending')
}

export async function runGmailSyncTick(): Promise<GmailSyncTickResult> {
  const allowList = enabledReps()
  const tenants = (await getAllActiveTenants()).filter(
    (t) => !allowList || allowList.has(t.id),
  )
  const targets = await loadSyncTargets(tenants)
  const results: TargetSyncResult[] = []
  for (const target of targets) {
    try {
      results.push(await syncTarget(target))
    } catch (err) {
      console.error('[gmail-sync] target failed', target.repId, err)
      results.push({
        repId: target.repId,
        email: target.email,
        mode: 'skipped',
        threadsPersisted: 0,
        newThreads: 0,
        error: String(err),
      })
    }
  }
  return {
    totalNew: results.reduce((s, r) => s + r.newThreads, 0),
    totalPersisted: results.reduce((s, r) => s + r.threadsPersisted, 0),
    results,
  }
}
