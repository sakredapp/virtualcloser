/**
 * Monthly board update (Suite CXO, Ciao): the database half. Runs on the
 * Hetzner worker (hetzner-worker/index.ts, CXO_BOARD_UPDATE_EVERY_N_TICKS)
 * and on demand through Ciao's `board_update` tool and /api/board-update.
 *
 *  - From 8am on the first business day of the month (company zone), Ciao
 *    drafts last month's investor / board update into cxo_board_updates and
 *    tells the owner and admins in one in-app notice.
 *  - Headline numbers vs plan and vs last year come from deterministic
 *    rollups: the book (only on tenants allowed to read it), the sales plan
 *    (cxo_plan_targets) and QuickBooks (cxo_qbo_pnl_monthly), whichever the
 *    tenant has. Wins and misses from goals, monthly KPIs and board cards;
 *    decisions from cxo_decisions. Model-free, cost 0.
 *  - Ciao never sends it. The exec edits it in the app, copies it and sends it.
 *
 * Rules kept here:
 *  - Every read and write carries rep_id. Owners and admins with money access
 *    only (canSeeBoardUpdate), never employees.
 *  - Once per company per month: (rep_id, month) is unique and each notice
 *    key is a lock (unique rep_id + key). No notice when there is nothing to say.
 *  - Kill switch CXO_BOARD_UPDATE=off. Until the table exists, a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices } from '@/lib/followups/engine'
import { assistantNameForIds } from '@/lib/assistantNameServer'
import { assistantNameWithCompany } from '@/lib/assistantNameFromRows'
import { isPaused } from '@/lib/followups/shared'
import { getPinnacleOverview } from '@/lib/pinnacle/cache'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { bookStatus, fetchBookBreakdown, fetchProducers, fetchRetention } from '@/lib/book/data'
import { breakdownTotals, retentionSummary } from '@/lib/book/retention'
import { listTargets } from '@/lib/plan/data'
import { planByMonth } from '@/lib/plan/shared'
import { loadQboMonths } from '@/lib/qbo/data'
import { attainment } from '@/lib/employees/shared'
import {
  BOARD_UPDATE_ANCHOR,
  BOARD_UPDATE_ROLES,
  boardUpdateOn,
  canSeeBoardUpdate,
  composeSections,
  composeText,
  coveredMonth,
  hasContent,
  isDraftTime,
  localDate,
  monthBounds,
  monthLabel,
  nextBody,
  noticeKey,
  noticeText,
  parseMonthKey,
  shiftMonth,
  type BoardFacts,
  type BoardSections,
  type BoardTrends,
  type Money2,
  type QboSlice,
} from './shared'

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

const T = 'cxo_board_updates'
const COLS = 'id, rep_id, month, sections, draft_text, body, status, edited, generated_at, edited_at, sent_at'

export type BoardUpdateRow = {
  id: string
  rep_id: string
  month: string
  sections: BoardSections
  draft_text: string
  body: string
  status: 'draft' | 'edited' | 'sent'
  edited: boolean
  generated_at: string
  edited_at: string | null
  sent_at: string | null
}

export type BoardTenant = { id: string; timezone?: string | null; company?: string | null; display_name?: string | null }

const n = (v: unknown) => Number(v) || 0
const safe = async <T>(p: Promise<T>, fallback: T, what: string): Promise<T> => {
  try {
    return await p
  } catch (err) {
    console.error('[board-update]', what, err instanceof Error ? err.message : err)
    return fallback
  }
}

// ── Gathering ──────────────────────────────────────────────────────────────

/**
 * A company's own producer book (cxo_book_*, e.g. a CSV import) — the same
 * figures producer_production reads. Premium = submitted AP, policies =
 * applications. Before this, a company with its own book got a board update
 * that said "no book connected".
 */
async function tenantBookFacts(tenant: BoardTenant, month: string, toDate: string | null = null): Promise<BookWithPrior> {
  const status = await safe(bookStatus(tenant.id), null, 'book status')
  if (!status || status.source === 'pinnacle' || !status.connected) return null
  const { year } = parseMonthKey(month)!
  const b = cutBounds(monthBounds(month, 'UTC'), toDate)
  const ly = cutBounds(monthBounds(shiftMonth(month, -12), 'UTC'), toDate && sameDay(shiftMonth(month, -12), toDate))
  const pm = cutBounds(monthBounds(shiftMonth(month, -1), 'UTC'), toDate && sameDay(shiftMonth(month, -1), toDate))
  const sum = async (start: string, end: string): Promise<Money2> => {
    const rows = await fetchProducers(tenant.id, { start, end })
    return rows.reduce((t, r) => ({ premium: t.premium + n(r.premium), policies: t.policies + n(r.policies) }), { premium: 0, policies: 0 })
  }
  const lyJan = monthBounds(`${year - 1}-01`, 'UTC')
  const [cur, curLy, ytd, ytdLy, janLy, prev] = await Promise.all([
    sum(b.startDate, b.endDate),
    sum(ly.startDate, ly.endDate),
    sum(`${year}-01-01`, b.endDate),
    sum(`${year - 1}-01-01`, ly.endDate),
    sum(lyJan.startDate, lyJan.endDate),
    sum(pm.startDate, pm.endDate),
  ]).catch((err) => {
    console.error('[board-update] tenant book', err instanceof Error ? err.message : err)
    return null
  }) ?? []
  if (!cur || !ytd) return null
  const through = status.data_through && status.data_through < b.endDate ? status.data_through : b.endDate
  return {
    month: cur,
    // A year-ago figure of zero means the book does not reach back that far, not a zero month.
    monthLastYear: curLy && curLy.policies > 0 ? curLy : null,
    ytd,
    // Last year's YTD only when the book reaches back to that January; a partial year is not a comparison.
    ytdLastYear: ytdLy && janLy && janLy.policies > 0 ? ytdLy : null,
    through,
    priorMonth: prev && prev.policies > 0 ? prev : null,
  }
}

/** Book facts plus the month before (same days on a month-to-date preview), for the production trend. */
type BookWithPrior = (NonNullable<BoardFacts['book']> & { priorMonth: Money2 | null }) | null

/** Month bounds cut at a to-date day (month to date). */
function cutBounds<B extends { startDate: string; endDate: string }>(b: B, toDate: string | null | false | undefined): B {
  return toDate && toDate < b.endDate ? { ...b, endDate: toDate } : b
}

/** The same day-of-month as `toDate` inside another month, capped at that month's last day. */
export function sameDay(month: string, toDate: string): string {
  const p = parseMonthKey(month)!
  const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
  const d = Math.min(Number(toDate.slice(8, 10)), last)
  return `${month}-${String(d).padStart(2, '0')}`
}

async function bookFacts(tenant: BoardTenant, month: string, toDate: string | null = null): Promise<BookWithPrior> {
  if (!pinnacleAllowed(tenant.id)) return tenantBookFacts(tenant, month, toDate)
  const overview = await safe(getPinnacleOverview(tenant.id, { view: 'overview', tz: tenant.timezone }), null, 'book')
  const rows = overview && overview.configured ? overview.pinnacleRows : []
  if (!rows.length) return null
  const { year } = parseMonthKey(month)!
  const b = cutBounds(monthBounds(month, 'UTC'), toDate)
  const ly = cutBounds(monthBounds(shiftMonth(month, -12), 'UTC'), toDate && sameDay(shiftMonth(month, -12), toDate))
  const pm = cutBounds(monthBounds(shiftMonth(month, -1), 'UTC'), toDate && sameDay(shiftMonth(month, -1), toDate))
  let earliest: string | null = null
  let through: string | null = null
  const sum = (start: string, end: string): Money2 => {
    const t = { premium: 0, policies: 0 }
    for (const r of rows) {
      if (r.d < start || r.d > end) continue
      t.premium += n(r.premium)
      t.policies += n(r.policies)
    }
    return t
  }
  for (const r of rows) {
    if (!earliest || r.d < earliest) earliest = r.d
    if (r.d <= b.endDate && (!through || r.d > through)) through = r.d
  }
  const hasLy = (start: string) => !!earliest && earliest <= start
  const lyYtdStart = `${year - 1}-01-01`
  return {
    month: sum(b.startDate, b.endDate),
    monthLastYear: hasLy(ly.startDate) ? sum(ly.startDate, ly.endDate) : null,
    ytd: sum(`${year}-01-01`, b.endDate),
    ytdLastYear: hasLy(lyYtdStart) ? sum(lyYtdStart, ly.endDate) : null,
    through,
    priorMonth: hasLy(pm.startDate) ? sum(pm.startDate, pm.endDate) : null,
  }
}

const SHORT_M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso: string) => `${SHORT_M[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`

/** The quarter the month sits in, from its first day through the month's end (or to-date day). */
export function quarterSpan(month: string, end: string): { start: string; end: string; label: string; prior: { start: string; end: string; label: string } } {
  const p = parseMonthKey(month)!
  const q = Math.floor((p.month - 1) / 3)
  const start = `${p.year}-${String(q * 3 + 1).padStart(2, '0')}-01`
  const quarterEnd = monthBounds(`${p.year}-${String(q * 3 + 3).padStart(2, '0')}`, 'UTC').endDate
  const qStartMonth = start.slice(0, 7)
  const priorStartMonth = shiftMonth(qStartMonth, -3)
  // Same span of the quarter before: same number of months in, same day.
  const monthsIn = (p.year * 12 + p.month) - (Number(qStartMonth.slice(0, 4)) * 12 + Number(qStartMonth.slice(5, 7)))
  const priorEndMonth = shiftMonth(priorStartMonth, monthsIn)
  const priorMonthEnd = monthBounds(priorEndMonth, 'UTC').endDate
  const full = end >= monthBounds(month, 'UTC').endDate
  const priorEnd = full ? priorMonthEnd : sameDay(priorEndMonth, end)
  const qn = `Q${q + 1} ${p.year}`
  const pq = parseMonthKey(priorStartMonth)!
  const pqn = `Q${Math.floor((pq.month - 1) / 3) + 1} ${pq.year}`
  const whole = full && end === quarterEnd
  return {
    start,
    end,
    label: whole ? qn : `${qn} through ${dayLabel(end)}`,
    prior: { start: `${priorStartMonth}-01`, end: priorEnd, label: whole ? pqn : `${pqn} through ${dayLabel(priorEnd)}` },
  }
}

/** Shortest span retention is judged on; a shorter quarter-to-date falls back to the last full quarter. */
const MIN_RETENTION_DAYS = 28

/**
 * Production, retention and placement changes behind the misses, wins and
 * risks. Rollups only. Retention is the agent page's own definition
 * (cxo_producer_retention): a quarter span vs the same span a quarter earlier.
 */
async function trendFacts(tenant: BoardTenant, month: string, book: BookWithPrior, toDate: string | null, todayIso: string): Promise<BoardTrends | null> {
  if (!book) return null
  const b = monthBounds(month, 'UTC')
  const end = toDate && toDate < b.endDate ? toDate : b.endDate
  const prevMonth = shiftMonth(month, -1)
  const prevEnd = toDate ? sameDay(prevMonth, end) : monthBounds(prevMonth, 'UTC').endDate
  const nowLabel = toDate ? `${dayLabel(b.startDate)} to ${Number(end.slice(8, 10))}` : monthLabel(month).split(' ')[0]
  const priorLabel = toDate ? `${dayLabel(`${prevMonth}-01`)} to ${Number(prevEnd.slice(8, 10))}` : monthLabel(prevMonth).split(' ')[0]

  let span = quarterSpan(month, end)
  const days = (Date.parse(span.end) - Date.parse(span.start)) / 86_400_000 + 1
  if (days < MIN_RETENTION_DAYS) {
    // Too few days into the quarter: judge the last full quarter instead.
    const lastQEndMonth = shiftMonth(span.start.slice(0, 7), -1)
    span = quarterSpan(lastQEndMonth, monthBounds(lastQEndMonth, 'UTC').endDate)
  }
  const [ret, place, placePrior] = await Promise.all([
    safe(fetchRetention(tenant.id, { start: span.start, end: span.end }, span.prior, todayIso, { limit: 5 }), null, 'retention'),
    safe(fetchBookBreakdown(tenant.id, 'carrier', { start: b.startDate, end }), null, 'placement'),
    safe(fetchBookBreakdown(tenant.id, 'carrier', { start: `${prevMonth}-01`, end: prevEnd }), null, 'placement prior'),
  ])
  const sum = ret ? retentionSummary(ret) : null
  const pend = (t: ReturnType<typeof breakdownTotals>) => (t.applications > 0 ? Math.round((t.pending / t.applications) * 1000) / 10 : null)
  const tNow = place?.length ? breakdownTotals(place) : null
  const tPrior = placePrior?.length ? breakdownTotals(placePrior) : null
  return {
    production: book.priorMonth ? { now: book.month, prior: book.priorMonth, priorLabel } : null,
    retention: sum?.now && sum.prior
      ? {
          label: span.label,
          priorLabel: span.prior.label,
          nowPct: sum.now.retention_pct,
          priorPct: sum.prior.retention_pct,
          stopped: sum.now.stopped,
          driftingAgents: (ret?.drifting.days_30_59 ?? 0) + (ret?.drifting.days_60_89 ?? 0),
        }
      : null,
    placement: tNow && tPrior
      ? { label: nowLabel, priorLabel, nowPct: tNow.placement_pct, priorPct: tPrior.placement_pct, pendingPct: pend(tNow), priorPendingPct: pend(tPrior) }
      : null,
  }
}

async function planFacts(repId: string, month: string): Promise<BoardFacts['plan']> {
  const { year, month: m } = parseMonthKey(month)!
  const targets = await safe(listTargets(repId, year), [], 'plan')
  if (!targets.length) return null
  const byMonth = planByMonth(targets)
  const ytd = byMonth.slice(0, m).reduce((s, v) => s + v, 0)
  if (ytd <= 0 && byMonth[m - 1] <= 0) return null
  return { month: byMonth[m - 1], ytd }
}

async function qboFacts(repId: string, month: string): Promise<BoardFacts['qbo']> {
  const { year } = parseMonthKey(month)!
  const rows = await safe(loadQboMonths(repId, `${year - 1}-01`, month), [], 'quickbooks')
  if (!rows.length) return null
  const slice = (r: { income: number; net_income: number }): QboSlice => ({ income: n(r.income), net_income: n(r.net_income) })
  const by = new Map(rows.map((r) => [String(r.month).slice(0, 7), r]))
  const lyMonth = shiftMonth(month, -12)
  const sumRange = (from: string, to: string): QboSlice | null => {
    let any = false
    const t = { income: 0, net_income: 0 }
    for (const [k, r] of by) {
      if (k < from || k > to) continue
      any = true
      t.income += n(r.income)
      t.net_income += n(r.net_income)
    }
    return any ? t : null
  }
  const ytd = sumRange(`${year}-01`, month)
  const cur = by.get(month)
  if (!ytd && !cur) return null
  return {
    month: cur ? slice(cur) : null,
    monthLastYear: by.get(lyMonth) ? slice(by.get(lyMonth)!) : null,
    ytd: ytd ?? { income: 0, net_income: 0 },
    ytdLastYear: sumRange(`${year - 1}-01`, lyMonth),
  }
}

async function workFacts(repId: string, month: string, tz: string | null | undefined): Promise<Pick<BoardFacts, 'goalsDone' | 'goalsMissed' | 'kpis' | 'cardsDone' | 'cardsMissed' | 'decisions'>> {
  const b = monthBounds(month, tz)
  const [gDone, gMissed, kpis, actuals, cDone, cDue, dec] = await Promise.all([
    supabase.from('cxo_goals').select('title').eq('rep_id', repId).eq('status', 'done').gte('updated_at', b.startIso).lt('updated_at', b.endIso).order('updated_at', { ascending: true }).limit(50),
    supabase.from('cxo_goals').select('title').eq('rep_id', repId).eq('status', 'active').gte('due_date', b.startDate).lte('due_date', b.endDate).limit(50),
    supabase.from('cxo_employee_kpis').select('id, target, lower_is_better').eq('rep_id', repId).eq('period', 'month').limit(2000),
    supabase.from('cxo_kpi_actuals').select('kpi_id, actual').eq('rep_id', repId).eq('period_key', month).limit(5000),
    supabase.from('cxo_board_cards').select('title', { count: 'exact' }).eq('rep_id', repId).gte('done_at', b.startIso).lt('done_at', b.endIso).order('done_at', { ascending: true }).limit(MAX_TITLES),
    supabase.from('cxo_board_cards').select('title, done_at').eq('rep_id', repId).gte('due_date', b.startDate).lte('due_date', b.endDate).limit(500),
    supabase.from('cxo_decisions').select('text, meeting_title, decided_at').eq('rep_id', repId).is('reversed_by_id', null).gte('decided_at', b.startIso).lt('decided_at', b.endIso).order('decided_at', { ascending: true }).limit(20),
  ])
  const titles = (r: { data: unknown }) => ((r.data ?? []) as Array<{ title: string | null }>).map((x) => String(x.title ?? '').trim()).filter(Boolean)

  const kpiById = new Map(((kpis.data ?? []) as Array<{ id: string; target: number | null; lower_is_better: boolean | null }>).map((k) => [k.id, k]))
  let hit = 0
  let missedK = 0
  for (const a of (actuals.data ?? []) as Array<{ kpi_id: string; actual: number | null }>) {
    const k = kpiById.get(a.kpi_id)
    if (!k) continue
    const att = attainment({ target: n(k.target), lower_is_better: !!k.lower_is_better }, a.actual == null ? null : Number(a.actual))
    if (att == null) continue
    if (att >= 1) hit++
    else missedK++
  }

  const dueRows = (cDue.data ?? []) as Array<{ title: string | null; done_at: string | null }>
  const lateOrOpen = dueRows.filter((c) => !c.done_at || c.done_at >= b.endIso)
  return {
    goalsDone: titles(gDone),
    goalsMissed: titles(gMissed),
    kpis: { hit, missed: missedK },
    cardsDone: { count: cDone.count ?? titles(cDone).length, titles: titles(cDone) },
    cardsMissed: { count: lateOrOpen.length, titles: lateOrOpen.map((c) => String(c.title ?? '').trim()).filter(Boolean).slice(0, MAX_TITLES) },
    decisions: ((dec.data ?? []) as Array<{ text: string; meeting_title: string | null; decided_at: string }>).filter((d) => String(d.text ?? '').trim()),
  }
}
const MAX_TITLES = 5

/**
 * Every fact the draft uses for one month, from rollups only. With `toDate`
 * it is a month-to-date preview: the book stops at that day and is compared
 * with the same days of last month and last year, and the month's plan is
 * prorated by days.
 */
export async function gatherFacts(tenant: BoardTenant, month: string, opts: { toDate?: string | null; todayIso?: string } = {}): Promise<BoardFacts> {
  const toDate = opts.toDate ?? null
  const todayIso = opts.todayIso ?? toDate ?? monthBounds(month, 'UTC').endDate
  const [book, plan, qbo, work] = await Promise.all([
    bookFacts(tenant, month, toDate),
    planFacts(tenant.id, month),
    toDate ? Promise.resolve(null) : qboFacts(tenant.id, month), // QuickBooks closes by month
    workFacts(tenant.id, month, tenant.timezone),
  ])
  const trends = await safe(trendFacts(tenant, month, book, toDate, todayIso), null, 'trends')
  const { priorMonth: _pm, ...bookOnly } = book ?? ({} as NonNullable<BookWithPrior>)
  return {
    month,
    company: tenant.company || tenant.display_name || null,
    book: book ? bookOnly : null,
    plan: plan && toDate ? prorate(plan, month, toDate) : plan,
    qbo,
    ...work,
    trends,
    ...(toDate ? { toDate: { through: toDate } } : {}),
  }
}

/** The month's plan cut to the days counted so far (straight-line by days). */
export function prorate(plan: NonNullable<BoardFacts['plan']>, month: string, toDate: string): NonNullable<BoardFacts['plan']> {
  const p = parseMonthKey(month)!
  const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
  const share = Math.min(1, Number(toDate.slice(8, 10)) / last)
  const cut = Math.round(plan.month * (1 - share))
  return { month: Math.round(plan.month * share), ytd: Math.max(0, plan.ytd - cut) }
}

// ── Rows ───────────────────────────────────────────────────────────────────

export async function getBoardUpdate(repId: string, month?: string | null): Promise<BoardUpdateRow | null> {
  let q = supabase.from(T).select(COLS).eq('rep_id', repId)
  if (month) q = q.eq('month', month)
  const { data, error } = await q.order('month', { ascending: false }).limit(1)
  if (missing(error)) return null
  if (error) throw new Error(`${T}: ${error.message}`)
  return ((data ?? []) as BoardUpdateRow[])[0] ?? null
}

export type DraftResult = { row: BoardUpdateRow | null; created: boolean; regenerated: boolean; tableMissing?: boolean }

const STALE_DRAFT_MS = 60 * 60 * 1000

/**
 * An untouched draft (nobody edited or sent it) whose numbers are over an
 * hour old. Asking for it again refreshes the numbers instead of handing
 * back figures from before the last sync. Edited and sent ones never change.
 */
export function isStaleUntouchedDraft(row: Pick<BoardUpdateRow, 'status' | 'edited' | 'generated_at'>, now: Date): boolean {
  if (row.status !== 'draft' || row.edited) return false
  const at = row.generated_at ? Date.parse(row.generated_at) : NaN
  return !Number.isFinite(at) || now.getTime() - at > STALE_DRAFT_MS
}

/**
 * Draft (or redraft) the update for one month. Without `regenerate` an
 * existing draft is returned as is. Regenerating refreshes the numbers and
 * keeps the exec's own edited text unless keepEdits is false.
 */
export async function draftBoardUpdate(
  tenant: BoardTenant,
  month: string,
  opts: { regenerate?: boolean; keepEdits?: boolean; by?: string | null; now?: Date; sections?: BoardSections } = {},
): Promise<DraftResult> {
  if (!parseMonthKey(month)) throw new Error(`bad month ${month}`)
  const now = opts.now ?? new Date()
  const { data: have, error: hErr } = await supabase.from(T).select(COLS).eq('rep_id', tenant.id).eq('month', month).limit(1)
  if (missing(hErr)) return { row: null, created: false, regenerated: false, tableMissing: true }
  if (hErr) throw new Error(`${T}: ${hErr.message}`)
  const current = ((have ?? []) as BoardUpdateRow[])[0] ?? null
  if (current && !opts.regenerate && !isStaleUntouchedDraft(current, now)) return { row: current, created: false, regenerated: false }

  const sections = opts.sections ?? composeSections(await gatherFacts(tenant, month))
  // A company document: the company's name for the assistant.
  const draftText = composeText(sections, await assistantNameForIds(tenant.id))
  if (!current) {
    const { data, error } = await supabase
      .from(T)
      .upsert([{ rep_id: tenant.id, month, sections, draft_text: draftText, body: draftText, status: 'draft', edited: false, generated_at: now.toISOString(), generated_by: opts.by ?? null, updated_at: now.toISOString() }], {
        onConflict: 'rep_id,month',
        ignoreDuplicates: true,
      })
      .select(COLS)
    if (missing(error)) return { row: null, created: false, regenerated: false, tableMissing: true }
    if (error) throw new Error(`${T}: ${error.message}`)
    const row = ((data ?? []) as BoardUpdateRow[])[0]
    if (row) return { row, created: true, regenerated: false }
    return { row: await getBoardUpdate(tenant.id, month), created: false, regenerated: false } // another check got there first
  }
  const body = nextBody(current, draftText, opts.keepEdits !== false)
  const { data, error } = await supabase
    .from(T)
    .update({
      sections,
      draft_text: draftText,
      body: body.body,
      edited: body.edited,
      status: current.status === 'sent' ? 'sent' : body.edited ? 'edited' : 'draft',
      generated_at: now.toISOString(),
      generated_by: opts.by ?? null,
      updated_at: now.toISOString(),
    })
    .eq('rep_id', tenant.id)
    .eq('id', current.id)
    .select(COLS)
  if (error) throw new Error(`${T}: ${error.message}`)
  return { row: ((data ?? []) as BoardUpdateRow[])[0] ?? null, created: false, regenerated: true }
}

export async function saveBoardUpdate(repId: string, memberId: string, id: string, body: string): Promise<BoardUpdateRow | null> {
  const now = new Date().toISOString()
  const { data: cur } = await supabase.from(T).select('status').eq('rep_id', repId).eq('id', id).limit(1)
  const wasSent = ((cur ?? []) as Array<{ status: string }>)[0]?.status === 'sent'
  const { data, error } = await supabase
    .from(T)
    .update({ body, edited: true, status: wasSent ? 'sent' : 'edited', edited_at: now, edited_by: memberId, updated_at: now })
    .eq('rep_id', repId)
    .eq('id', id)
    .select(COLS)
  if (missing(error)) return null
  if (error) throw new Error(`${T}: ${error.message}`)
  return ((data ?? []) as BoardUpdateRow[])[0] ?? null
}

/** The exec's own note that they sent it themselves. Ciao sends nothing. */
export async function markBoardUpdateSent(repId: string, id: string, sent = true): Promise<BoardUpdateRow | null> {
  const now = new Date().toISOString()
  const { data: cur } = await supabase.from(T).select('edited').eq('rep_id', repId).eq('id', id).limit(1)
  const edited = !!((cur ?? []) as Array<{ edited: boolean }>)[0]?.edited
  const { data, error } = await supabase
    .from(T)
    .update(sent ? { status: 'sent', sent_at: now, updated_at: now } : { status: edited ? 'edited' : 'draft', sent_at: null, updated_at: now })
    .eq('rep_id', repId)
    .eq('id', id)
    .select(COLS)
  if (missing(error)) return null
  if (error) throw new Error(`${T}: ${error.message}`)
  return ((data ?? []) as BoardUpdateRow[])[0] ?? null
}

// ── The tick ───────────────────────────────────────────────────────────────

type TenantRow = { id: string; brand: string | null; timezone: string | null; company: string | null; display_name: string | null }
type MemberRow = { id: string; role: string | null; settings: Record<string, unknown> | null }

/** Months already handled in this process, per tenant. */
const handled = new Set<string>()

async function notifyExecs(tenant: TenantRow, row: BoardUpdateRow, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from('members')
    .select('id, role, settings')
    .eq('rep_id', tenant.id)
    .eq('is_active', true)
    .in('role', [...BOARD_UPDATE_ROLES])
    .limit(200)
  if (error) throw new Error(error.message)
  const execs = ((data ?? []) as MemberRow[]).filter((m) => canSeeBoardUpdate(m) && !isPaused(m, now))
  if (!execs.length) return 0
  const company = await assistantNameForIds(tenant.id)
  const rows = await insertNotices(
    execs.map((m) => {
      const text = noticeText(row.sections, assistantNameWithCompany(company, m.settings))
      return {
        rep_id: tenant.id,
        member_id: m.id,
        key: noticeKey(row.month, m.id),
        kind: 'report',
        item_kind: 'report',
        item_id: row.id,
        title: text.title.slice(0, 300),
        body: text.body.slice(0, 8000),
        href: `/dashboard#${BOARD_UPDATE_ANCHOR}`,
        due_date: null,
      }
    }),
  )
  return rows.length
}

async function tenantTick(tenant: TenantRow, now: Date): Promise<{ drafted: number; notices: number }> {
  const tz = tenant.timezone || 'America/New_York'
  if (!isDraftTime(now, tz)) return { drafted: 0, notices: 0 }
  const month = coveredMonth(now, tz)
  const lock = `${tenant.id}:${month}`
  const emptyLock = `${lock}:empty:${localDate(now, tz)}`
  if (handled.has(lock) || handled.has(emptyLock)) return { drafted: 0, notices: 0 }
  const { data: have, error: hErr } = await supabase.from(T).select(COLS).eq('rep_id', tenant.id).eq('month', month).limit(1)
  if (hErr) {
    if (missing(hErr)) throw new TableMissing()
    throw new Error(hErr.message)
  }
  let row: BoardUpdateRow | null = ((have ?? []) as BoardUpdateRow[])[0] ?? null
  let drafted = 0
  if (!row) {
    // Nothing to say (no numbers, wins, misses or decisions): no draft, no notice.
    const sections = composeSections(await gatherFacts(tenant, month))
    if (!hasContent(sections)) {
      // Look again tomorrow (QuickBooks or the book may sync later), not every tick.
      handled.add(emptyLock)
      return { drafted: 0, notices: 0 }
    }
    const res = await draftBoardUpdate(tenant, month, { now, sections })
    if (res.tableMissing) throw new TableMissing()
    row = res.row
    if (res.created) drafted = 1
  }
  handled.add(lock)
  if (!row || !hasContent(row.sections)) return { drafted, notices: 0 }
  // Notice keys are locks: an exec who already got this month's notice gets no second one.
  return { drafted, notices: await notifyExecs(tenant, row, now) }
}

export type BoardUpdateTickResult = { tenants: number; drafted: number; notices: number; errors: number }

/** One check across every Suite CXO tenant. Never throws. */
export async function runBoardUpdateTick(now = new Date()): Promise<BoardUpdateTickResult> {
  const out: BoardUpdateTickResult = { tenants: 0, drafted: 0, notices: 0, errors: 0 }
  if (!boardUpdateOn()) return out
  const { data, error } = await supabase.from('reps').select('id, brand, timezone, company, display_name').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[board-update] tenants', error.message)
    out.errors++
    return out
  }
  for (const tenant of (data ?? []) as TenantRow[]) {
    try {
      out.tenants++
      const r = await tenantTick(tenant, now)
      out.drafted += r.drafted
      out.notices += r.notices
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[board-update] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** For Ciao's tool and the API: the month a fresh draft covers right now. */
export function currentBoardMonth(now: Date, tz: string | null | undefined): string {
  return coveredMonth(now, tz)
}

/**
 * "This month's board update" asked mid-month: a month-to-date preview of
 * the month in progress, through today. Never saved: cxo_board_updates holds
 * one update per closed month (rep_id, month), drafted on the first business
 * day after it closes, and a partial preview must not take that slot.
 */
export async function previewBoardUpdate(tenant: BoardTenant, now: Date = new Date()): Promise<{ month: string; through: string; sections: BoardSections; text: string }> {
  const today = localDate(now, tenant.timezone)
  const month = today.slice(0, 7)
  const sections = composeSections(await gatherFacts(tenant, month, { toDate: today, todayIso: today }))
  return { month, through: today, sections, text: composeText(sections, await assistantNameForIds(tenant.id)) }
}
