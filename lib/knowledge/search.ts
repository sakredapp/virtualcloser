/**
 * Company search (Suite CXO, gap C2): one query across the company's own data.
 *
 * Sources: meeting notes and transcripts (plaud_notes), board cards, to-dos,
 * in-app messages, brain items, and the caller's OWN Gmail and Google
 * Calendar (read-only, their own connected account only).
 *
 * Postgres full-text search (search_tsv generated columns + GIN indexes,
 * supabase/cxo_company_search.sql). Until that migration is applied the
 * database half falls back to ILIKE on the same columns, so the tool works
 * either way. No embeddings, no AI call: the search itself never leaves our
 * database and Google.
 *
 * Every query is pinned to the caller's tenant and narrowed by role where
 * the database can do it; then every row goes through canSeeHit
 * (searchShared) before anything is returned. Payroll and comp tables are
 * not searched at all.
 */
import { supabase } from '@/lib/supabase'
import { findCalendarEventsByQuery, getGmailThreadMetadata, listGmailThreads } from '@/lib/google'
import { pickSenderAccount } from '@/lib/partners'
import {
  ALL_SOURCES,
  canSeeHit,
  finalizeHits,
  queryTerms,
  tsQuery,
  type RawHit,
  type SearchResult,
  type SearchScope,
  type SearchSource,
} from './searchShared'

export type SearchCaller = {
  repId: string
  memberId: string
  email: string | null
  displayName: string | null
  isExec: boolean
  timezone: string
}

export type CompanySearchOutcome = {
  query: string
  results: SearchResult[]
  searched: SearchSource[]
  /** Sources that could not answer (not connected, timed out), so Mira can say so. */
  unavailable: Array<{ source: SearchSource; reason: string }>
}

const PER_SOURCE_MS = 7000
const CANDIDATES = 120

type Row = Record<string, unknown>
type Res = { data: unknown; error: { code?: string; message?: string } | null }
/** A PostgREST builder, loosely typed: every filter returns the builder, awaiting it gives rows. */
type Query = PromiseLike<Res> & { [method: string]: (...args: unknown[]) => Query }

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/**
 * Full-text search on one table, pinned to the tenant. `narrow` adds the role
 * filters. Falls back to ILIKE when the search_tsv column is not there yet.
 */
async function ftsRows(table: string, cols: string, textCols: string[], repId: string, terms: string[], narrow: (q: Query) => Query, order: string): Promise<Row[]> {
  const base = () => narrow((supabase.from(table) as unknown as Query).select(cols).eq('rep_id', repId))
  const res = await base().textSearch('search_tsv', tsQuery(terms), { type: 'websearch', config: 'english' }).order(order, { ascending: false }).limit(CANDIDATES)
  if (!res.error) return (res.data ?? []) as Row[]
  const missing = res.error.code === '42703' || /search_tsv/i.test(res.error.message ?? '')
  if (!missing) throw new Error(`${table}: ${res.error.message ?? 'search failed'}`)
  const ors = textCols.flatMap((c) => terms.slice(0, 4).map((t) => `${c}.ilike.%${t}%`)).join(',')
  const like = await base().or(ors).order(order, { ascending: false }).limit(CANDIDATES)
  if (like.error) throw new Error(`${table}: ${like.error.message ?? 'search failed'}`)
  return (like.data ?? []) as Row[]
}

/** The caller's visibility facts, from the database, keyed by their session. */
export async function buildScope(c: SearchCaller): Promise<SearchScope> {
  const scope: SearchScope = { repId: c.repId, memberId: c.memberId, email: c.email, displayName: c.displayName, isExec: c.isExec, boardIds: new Set(), sharedNoteIds: new Set() }
  if (c.isExec) return scope
  const [held, own, shared] = await Promise.all([
    supabase.from('cxo_board_card_assignees').select('board_id').eq('rep_id', c.repId).eq('member_id', c.memberId).limit(1000),
    supabase.from('cxo_boards').select('id').eq('rep_id', c.repId).eq('created_by', c.memberId).limit(200),
    supabase.from('cxo_todos').select('note_id').eq('rep_id', c.repId).eq('member_id', c.memberId).not('note_id', 'is', null).limit(1000),
  ])
  for (const r of (held.data ?? []) as Row[]) if (r.board_id) scope.boardIds.add(s(r.board_id))
  for (const r of (own.data ?? []) as Row[]) if (r.id) scope.boardIds.add(s(r.id))
  for (const r of (shared.data ?? []) as Row[]) if (r.note_id) scope.sharedNoteIds.add(s(r.note_id))
  return scope
}

// ── Sources ─────────────────────────────────────────────────────────────────

async function searchMeetings(scope: SearchScope, terms: string[]): Promise<RawHit[]> {
  // Phase 1: ids + visibility facts only (cheap), gate on our side.
  const facts = await ftsRows('plaud_notes', 'id, rep_id, title, occurred_at, owner_member_id, attendees, triage_class', ['title', 'summary', 'transcript'], scope.repId, terms, (q) => q, 'occurred_at')
  const visible = facts.filter((r) => canSeeHit({ source: 'meeting', id: s(r.id), rep_id: s(r.rep_id), title: '', body: '', when: null, owner_member_id: (r.owner_member_id as string | null) ?? null, attendees: r.attendees, triage_class: (r.triage_class as string | null) ?? null }, scope))
  if (!visible.length) return []
  // Phase 2: the text, only for meetings the caller may see.
  const ids = visible.slice(0, 30).map((r) => s(r.id))
  const { data, error } = await supabase.from('plaud_notes').select('id, rep_id, title, summary, transcript, occurred_at, owner_member_id, attendees, triage_class').eq('rep_id', scope.repId).in('id', ids)
  if (error) throw new Error(`plaud_notes: ${error.message}`)
  return ((data ?? []) as Row[]).map((r) => ({
    source: 'meeting' as const,
    id: s(r.id),
    rep_id: s(r.rep_id),
    title: s(r.title) || 'Meeting',
    body: [s(r.summary), s(r.transcript).slice(0, 60_000)].filter(Boolean).join('\n'),
    when: (r.occurred_at as string | null) ?? null,
    owner_member_id: (r.owner_member_id as string | null) ?? null,
    attendees: r.attendees,
    triage_class: (r.triage_class as string | null) ?? null,
  }))
}

async function searchCards(scope: SearchScope, terms: string[]): Promise<RawHit[]> {
  if (!scope.isExec && scope.boardIds.size === 0) return []
  const rows = await ftsRows('cxo_board_cards', 'id, rep_id, board_id, title, notes, updated_at, done_at, cxo_boards(name)', ['title', 'notes'], scope.repId, terms, (q) => (scope.isExec ? q : q.in('board_id', [...scope.boardIds])), 'updated_at')
  return rows.map((r) => ({
    source: 'card' as const,
    id: s(r.id),
    rep_id: s(r.rep_id),
    board_id: (r.board_id as string | null) ?? null,
    title: s(r.title) || 'Card',
    body: s(r.notes),
    when: (r.updated_at as string | null) ?? null,
    context: [(r.cxo_boards as { name?: string } | null)?.name ? `board ${(r.cxo_boards as { name: string }).name}` : null, r.done_at ? 'done' : null].filter(Boolean).join(', ') || null,
  }))
}

async function searchTodos(scope: SearchScope, terms: string[]): Promise<RawHit[]> {
  const rows = await ftsRows('cxo_todos', 'id, rep_id, member_id, body, meeting_title, partner_name, created_at, done_at', ['body', 'meeting_title'], scope.repId, terms, (q) => {
    const live = q.is('deleted_at', null)
    return scope.isExec ? live : live.eq('member_id', scope.memberId)
  }, 'created_at')
  return rows.map((r) => ({
    source: 'todo' as const,
    id: s(r.id),
    rep_id: s(r.rep_id),
    member_id: (r.member_id as string | null) ?? null,
    title: s(r.body).slice(0, 120) || 'To-do',
    body: [s(r.body), r.meeting_title ? `From meeting: ${s(r.meeting_title)}` : '', r.partner_name ? `Partner: ${s(r.partner_name)}` : ''].filter(Boolean).join('\n'),
    when: (r.created_at as string | null) ?? null,
    context: r.done_at ? 'done' : null,
  }))
}

async function searchMessages(scope: SearchScope, terms: string[]): Promise<RawHit[]> {
  const me = scope.memberId
  const rows = await ftsRows('member_messages', 'id, rep_id, from_member_id, to_member_id, body, kind, deliver_at, created_at', ['body'], scope.repId, terms, (q) => q.or(`from_member_id.eq.${me},to_member_id.eq.${me}`), 'created_at')
  const now = Date.now()
  return rows
    // A scheduled message is not the recipient's until it is delivered.
    .filter((r) => !(r.to_member_id === me && r.from_member_id !== me && Date.parse(s(r.deliver_at)) > now))
    .map((r) => ({
      source: 'message' as const,
      id: s(r.id),
      rep_id: s(r.rep_id),
      from_member_id: (r.from_member_id as string | null) ?? null,
      to_member_id: (r.to_member_id as string | null) ?? null,
      title: `${r.from_member_id === me ? 'You sent' : 'Sent to you'}: ${s(r.body).slice(0, 80)}`,
      body: s(r.body),
      when: (r.deliver_at as string | null) ?? (r.created_at as string | null) ?? null,
      context: s(r.kind) && r.kind !== 'message' ? s(r.kind) : null,
    }))
}

async function searchBrain(scope: SearchScope, terms: string[]): Promise<RawHit[]> {
  const rows = await ftsRows('brain_items', 'id, rep_id, owner_member_id, item_type, content, status, created_at', ['content'], scope.repId, terms, (q) => {
    const live = q.is('deleted_at', null)
    return scope.isExec ? live : live.eq('owner_member_id', scope.memberId)
  }, 'created_at')
  return rows.map((r) => ({
    source: 'brain' as const,
    id: s(r.id),
    rep_id: s(r.rep_id),
    owner_member_id: (r.owner_member_id as string | null) ?? null,
    title: s(r.content).slice(0, 100) || 'Note',
    body: s(r.content),
    when: (r.created_at as string | null) ?? null,
    context: s(r.item_type) || null,
  }))
}

/** The caller's own connected Google account, or null. Never a coworker's, never someone else's shared box. */
async function ownGoogleAccount(scope: SearchScope) {
  const { choices } = await pickSenderAccount(scope.repId, scope.memberId, null)
  const own = choices.filter((a) => a.memberId === scope.memberId && !a.isShared)
  if (own.length) return own[0]
  // An executive's own workspace (tenant-level) account; the picker already
  // confirmed they own it. Employees never get the workspace account.
  if (scope.isExec) return choices.find((a) => a.memberId === null && a.isShared) ?? null
  return null
}

async function searchEmail(scope: SearchScope, query: string): Promise<RawHit[]> {
  const account = await ownGoogleAccount(scope)
  if (!account) throw new Error('not_connected')
  const list = await listGmailThreads(scope.repId, account.memberId, { q: query.slice(0, 200), maxResults: 6, accountId: account.accountId })
  if (!list.ok) throw new Error(list.error ?? 'gmail_error')
  const metas = await Promise.all(
    (list.threads ?? []).slice(0, 6).map(async (t) => {
      const m = await getGmailThreadMetadata(scope.repId, account.memberId, t.id, { accountId: account.accountId }).catch(() => ({ ok: false as const, meta: undefined }))
      return { id: t.id, meta: m.ok ? m.meta : undefined }
    }),
  )
  const authuser = encodeURIComponent(account.email ?? '0')
  return metas.map(({ id, meta }) => ({
    source: 'email' as const,
    id,
    rep_id: scope.repId,
    account_member_id: account.memberId,
    title: meta?.subject || '(no subject)',
    body: meta?.snippet ?? '',
    preMatched: true,
    when: meta?.lastMessageAt ?? null,
    context: meta?.fromName || meta?.fromAddress ? `from ${meta?.fromName || meta?.fromAddress}` : null,
    link: `https://mail.google.com/mail/u/?authuser=${authuser}#all/${encodeURIComponent(id)}`,
  }))
}

async function searchCalendar(scope: SearchScope, query: string): Promise<RawHit[]> {
  const account = await ownGoogleAccount(scope)
  if (!account) throw new Error('not_connected')
  const now = Date.now()
  const events = await findCalendarEventsByQuery(scope.repId, query.slice(0, 200), {
    memberId: account.memberId,
    accountId: account.accountId,
    fromIso: new Date(now - 120 * 86_400_000).toISOString(),
    toIso: new Date(now + 60 * 86_400_000).toISOString(),
    maxResults: 6,
  })
  if (events === null) throw new Error('not_connected')
  return events.map((e) => ({
    source: 'calendar' as const,
    id: e.id,
    rep_id: scope.repId,
    account_member_id: account.memberId,
    title: e.summary,
    body: `${e.summary}\nWith: ${(e.attendees ?? []).map((a) => a.displayName || a.email).join(', ')}`,
    preMatched: true,
    when: e.start || null,
    link: e.htmlLink || null,
  }))
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function searchCompany(caller: SearchCaller, query: string, opts: { sources?: SearchSource[]; limit?: number } = {}): Promise<CompanySearchOutcome> {
  const q = query.trim().slice(0, 300)
  const terms = queryTerms(q)
  const sources = (opts.sources?.length ? opts.sources.filter((x) => ALL_SOURCES.includes(x)) : ALL_SOURCES)
  const limit = Math.min(Math.max(Math.round(opts.limit ?? 10), 1), 20)
  if (!terms.length) return { query: q, results: [], searched: [], unavailable: [] }

  const scope = await buildScope(caller)
  const runners: Record<SearchSource, () => Promise<RawHit[]>> = {
    meeting: () => searchMeetings(scope, terms),
    card: () => searchCards(scope, terms),
    todo: () => searchTodos(scope, terms),
    message: () => searchMessages(scope, terms),
    brain: () => searchBrain(scope, terms),
    email: () => searchEmail(scope, terms.join(' ')),
    calendar: () => searchCalendar(scope, terms.join(' ')),
  }
  const settled = await Promise.allSettled(sources.map((src) => withTimeout(runners[src](), PER_SOURCE_MS, src)))
  const raw: RawHit[] = []
  const unavailable: CompanySearchOutcome['unavailable'] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') raw.push(...r.value)
    else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      unavailable.push({ source: sources[i], reason: /not_connected|scope_missing/.test(msg) ? 'Google not connected' : /timeout/.test(msg) ? 'too slow, skipped' : 'unavailable' })
      if (!/not_connected/.test(msg)) console.error('[search_company]', sources[i], msg.slice(0, 200))
    }
  })
  const results = finalizeHits(raw, scope, terms, { limit, timezone: caller.timezone })
  return { query: q, results, searched: sources, unavailable }
}
