/**
 * Read side of the Suite CXO MCP server.
 *
 * Everything here answers an IMO executive's questions from the synced books
 * of business: issued premium, placement, product mix, carriers, agencies,
 * producers, states. Numbers come from the same RPCs the dashboard uses
 * (lib/pinnacle/rollup.ts) so the AI and the screen always reconcile.
 *
 * Every function returns plain JSON with rounded numbers and a one-line
 * `summary` an assistant can read out as-is.
 */

import {
  BREAKDOWN_DIMS,
  PINNACLE_BASE_ID,
  PRODUCT_LINES,
  bookLabel,
  fetchBreakdown,
  fetchPremiumSeries,
  fetchStatusSeries,
  groupByBook,
  type BreakdownDim,
  type BreakdownRow,
  type DailyRow,
  type StatusRow,
} from '@/lib/pinnacle/rollup'
import { listUpcomingMeetingsForRep } from '@/lib/meetings'
import { getPinnacleOverview } from '@/lib/pinnacle/cache'
import type { Tenant } from '@/lib/tenant'

// ── Access ──────────────────────────────────────────────────────────────────

/** Same rule as app/api/pinnacle/*: env unset → everyone, else the listed accounts. */
export function pinnacleAllowed(tenantId: string): boolean {
  const raw = (process.env.PINNACLE_VIEWER_REP_IDS ?? '').trim()
  if (!raw) return true
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(tenantId)
}

export const NOT_CONNECTED = {
  error: 'No book of business is connected to this account yet, so there are no numbers to read.',
  summary: 'No book of business is connected to this account yet.',
}

// ── Dates (all YYYY-MM-DD strings, compared lexically) ──────────────────────

export function todayIn(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function toUtc(d: string): Date {
  return new Date(`${d}T00:00:00Z`)
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function addDays(d: string, n: number): string {
  const x = toUtc(d)
  x.setUTCDate(x.getUTCDate() + n)
  return fmt(x)
}
export function addMonths(d: string, n: number): string {
  const x = toUtc(d)
  const day = x.getUTCDate()
  x.setUTCDate(1)
  x.setUTCMonth(x.getUTCMonth() + n)
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
  x.setUTCDate(Math.min(day, last))
  return fmt(x)
}
function addYears(d: string, n: number): string {
  return addMonths(d, 12 * n)
}
function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400_000)
}

export const WINDOW_KEYS = ['mtd', 'qtd', 'ytd', '3m', '6m', '12m', 'last_month', 'last_year', 'all'] as const
export type WindowKey = (typeof WINDOW_KEYS)[number]
export type WindowInput = WindowKey | { start: string; end: string }

export type Window = {
  start: string
  end: string
  label: string
  /** The period this one is compared against, and what to call it. */
  prior: { start: string; end: string; label: string } | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function resolveWindow(input: WindowInput | undefined, today: string, earliest?: string): Window {
  const y = today.slice(0, 4)
  const m = today.slice(5, 7)
  const q = Math.floor((Number(m) - 1) / 3)
  const key: WindowInput = input ?? 'ytd'

  if (typeof key === 'object') {
    const start = DATE_RE.test(key.start) ? key.start : `${y}-01-01`
    const end = DATE_RE.test(key.end) ? key.end : today
    const len = daysBetween(start, end) + 1
    return {
      start,
      end,
      label: `${start} to ${end}`,
      prior: { start: addDays(start, -len), end: addDays(start, -1), label: `the ${len} days before` },
    }
  }
  switch (key) {
    case 'mtd': {
      const start = `${y}-${m}-01`
      return { start, end: today, label: 'month to date', prior: { start: addYears(start, -1), end: addYears(today, -1), label: 'same period last year' } }
    }
    case 'qtd': {
      const start = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
      return { start, end: today, label: 'quarter to date', prior: { start: addYears(start, -1), end: addYears(today, -1), label: 'same period last year' } }
    }
    case 'ytd': {
      const start = `${y}-01-01`
      return { start, end: today, label: 'year to date', prior: { start: addYears(start, -1), end: addYears(today, -1), label: 'same period last year' } }
    }
    case 'last_month': {
      const thisStart = `${y}-${m}-01`
      const start = addMonths(thisStart, -1)
      const end = addDays(thisStart, -1)
      return { start, end, label: 'last month', prior: { start: addMonths(start, -1), end: addDays(start, -1), label: 'the month before' } }
    }
    case 'last_year': {
      const start = `${Number(y) - 1}-01-01`
      const end = `${Number(y) - 1}-12-31`
      return { start, end, label: `calendar ${Number(y) - 1}`, prior: { start: `${Number(y) - 2}-01-01`, end: `${Number(y) - 2}-12-31`, label: `calendar ${Number(y) - 2}` } }
    }
    case 'all': {
      const start = earliest ?? '2000-01-01'
      return { start, end: today, label: 'all time', prior: null }
    }
    case '3m':
    case '6m':
    case '12m': {
      const n = Number(key.replace('m', ''))
      const start = addDays(addMonths(today, -n), 1)
      return {
        start,
        end: today,
        label: `trailing ${n} months`,
        prior: { start: addDays(addMonths(start, -n), 0), end: addDays(start, -1), label: `the ${n} months before` },
      }
    }
  }
}

// ── Per-request data loader (each RPC at most once per MCP call) ───────────

/**
 * One read per MCP call: the tenant's cached daily rollup (same row the
 * dashboard pages read), falling back to the live RPCs only when the
 * account is outside the viewer list the cache honours.
 */
export class Loader {
  private premium?: Promise<DailyRow[]>
  private status?: Promise<StatusRow[]>
  private cached?: Promise<Awaited<ReturnType<typeof getPinnacleOverview>> | null>
  constructor(public readonly tenant: Tenant) {}
  get today(): string {
    return todayIn(this.tenant.timezone)
  }
  private overview() {
    this.cached ??= getPinnacleOverview(this.tenant.id, { view: 'full', tz: this.tenant.timezone }).catch(() => null)
    return this.cached
  }
  series(): Promise<DailyRow[]> {
    this.premium ??= this.overview().then((o) => (o && o.configured ? o.books.flatMap((b) => b.rows) : fetchPremiumSeries()))
    return this.premium
  }
  statuses(): Promise<StatusRow[]> {
    this.status ??= this.overview().then((o) => (o && o.configured ? o.statusRows : fetchStatusSeries()))
    return this.status
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export type LineFilter = 'All' | 'Health' | 'Life' | 'Annuity'
export type BookFilter = 'pinnacle' | 'all' | string

function inBook(r: DailyRow, book: BookFilter): boolean {
  if (book === 'all') return true
  if (book === 'pinnacle') return r.base_id === PINNACLE_BASE_ID
  return r.base_id === book || bookLabel(r.base_id).toLowerCase() === book.toLowerCase()
}
function inLine(line: string, filter: LineFilter): boolean {
  return filter === 'All' || line === filter
}

export type Totals = { premium: number; policies: number; funded_premium: number; funded_policies: number }

export function sumRows(rows: DailyRow[], start: string, end: string, line: LineFilter = 'All', book: BookFilter = 'pinnacle'): Totals {
  const t: Totals = { premium: 0, policies: 0, funded_premium: 0, funded_policies: 0 }
  for (const r of rows) {
    if (r.d < start || r.d > end) continue
    if (!inBook(r, book) || !inLine(r.line, line)) continue
    t.premium += r.premium
    t.policies += r.policies
    t.funded_premium += r.funded_premium ?? 0
    t.funded_policies += r.funded_policies
  }
  return t
}

export function sumStatus(rows: StatusRow[], start: string, end: string, line: LineFilter = 'All') {
  const t = { submitted: 0, total: 0, paid: 0, declined: 0, lapsed: 0 }
  for (const r of rows) {
    if (r.d < start || r.d > end) continue
    if (!inLine(r.line, line)) continue
    t.submitted += r.submitted
    t.total += r.total
    t.paid += r.paid
    t.declined += r.declined
    t.lapsed += r.lapsed
  }
  return t
}

export const round0 = (n: number) => Math.round(n)
export const pct1 = (n: number) => Math.round(n * 10) / 10
export function deltaPct(now: number, before: number): number | null {
  if (!before) return null
  return pct1(((now - before) / before) * 100)
}
export function share(part: number, whole: number): number {
  return whole > 0 ? pct1((part / whole) * 100) : 0
}
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export function dir(delta: number | null): 'up' | 'down' | 'flat' | 'n/a' {
  if (delta == null) return 'n/a'
  if (delta > 2) return 'up'
  if (delta < -2) return 'down'
  return 'flat'
}

function earliestDate(rows: DailyRow[]): string | undefined {
  let min: string | undefined
  for (const r of rows) if (!min || r.d < min) min = r.d
  return min
}

export type PeriodStats = {
  window: { start: string; end: string; label: string }
  issued_premium: number
  policies_issued: number
  avg_premium_per_policy: number
  prior: { label: string; start: string; end: string; issued_premium: number; policies_issued: number } | null
  vs_prior: { premium_delta_pct: number | null; policies_delta_pct: number | null; direction: ReturnType<typeof dir> }
}

export function periodStats(rows: DailyRow[], w: Window, line: LineFilter = 'All', book: BookFilter = 'pinnacle'): PeriodStats {
  const now = sumRows(rows, w.start, w.end, line, book)
  const before = w.prior ? sumRows(rows, w.prior.start, w.prior.end, line, book) : null
  const pd = before ? deltaPct(now.premium, before.premium) : null
  return {
    window: { start: w.start, end: w.end, label: w.label },
    issued_premium: round0(now.premium),
    policies_issued: now.policies,
    avg_premium_per_policy: now.policies ? round0(now.premium / now.policies) : 0,
    prior: before && w.prior
      ? { label: w.prior.label, start: w.prior.start, end: w.prior.end, issued_premium: round0(before.premium), policies_issued: before.policies }
      : null,
    vs_prior: {
      premium_delta_pct: pd,
      policies_delta_pct: before ? deltaPct(now.policies, before.policies) : null,
      direction: dir(pd),
    },
  }
}

export function productMix(rows: DailyRow[], w: Window, book: BookFilter = 'pinnacle') {
  const total = sumRows(rows, w.start, w.end, 'All', book)
  return PRODUCT_LINES.map((line) => {
    const t = sumRows(rows, w.start, w.end, line, book)
    return { line, issued_premium: round0(t.premium), policies_issued: t.policies, share_pct: share(t.premium, total.premium) }
  })
}

export function funnel(status: StatusRow[], w: Window, line: LineFilter = 'All') {
  const s = sumStatus(status, w.start, w.end, line)
  const placement = s.total > 0 ? share(s.paid, s.total) : 0
  return {
    window: { start: w.start, end: w.end, label: w.label },
    line,
    submitted: s.submitted,
    applications: s.total,
    paid: s.paid,
    declined: s.declined,
    lapsed: s.lapsed,
    placement_pct: placement,
    decline_pct: share(s.declined, s.total),
    lapse_pct: share(s.lapsed, s.total),
    note: 'Placement = paid ÷ applications in the window. Lapsed counts policies whose status is now lapsed.',
  }
}

// ── Tools ───────────────────────────────────────────────────────────────────

export async function getOverview(L: Loader, opts: { line?: LineFilter; book?: BookFilter } = {}) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const line = opts.line ?? 'All'
  const book = opts.book ?? 'pinnacle'
  const [rows, status] = await Promise.all([L.series(), L.statuses()])
  const today = L.today
  const ytd = periodStats(rows, resolveWindow('ytd', today), line, book)
  const mtd = periodStats(rows, resolveWindow('mtd', today), line, book)
  const t3 = periodStats(rows, resolveWindow('3m', today), line, book)
  const t6 = periodStats(rows, resolveWindow('6m', today), line, book)
  const t12 = periodStats(rows, resolveWindow('12m', today), line, book)
  const mix = productMix(rows, resolveWindow('ytd', today), book)
  const fun = funnel(status, resolveWindow('ytd', today), line)

  const day = Number(today.slice(8, 10)) || 1
  const dim = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
  const projected = round0((mtd.issued_premium / day) * dim)

  const top = [...mix].sort((a, b) => b.issued_premium - a.issued_premium)[0]
  const summary =
    `${money(ytd.issued_premium)} issued premium year to date` +
    (ytd.vs_prior.premium_delta_pct != null ? ` (${ytd.vs_prior.premium_delta_pct > 0 ? '+' : ''}${ytd.vs_prior.premium_delta_pct}% vs same period last year)` : '') +
    `, trailing 12 months ${money(t12.issued_premium)} (${t12.vs_prior.direction}), placement ${fun.placement_pct}%` +
    (top ? `, ${top.line} is ${top.share_pct}% of the book.` : '.')

  return {
    as_of: today,
    book: book === 'pinnacle' ? bookLabel(PINNACLE_BASE_ID) : book,
    line,
    ytd,
    mtd: { ...mtd, projected_month_end: projected },
    trailing_3m: t3,
    trailing_6m: t6,
    trailing_12m: t12,
    product_mix_ytd: mix,
    funnel_ytd: fun,
    note: 'Premium = annual issued premium bucketed by policy effective date.',
    summary,
  }
}

export type Grain = 'day' | 'week' | 'month'

function bucketKey(d: string, grain: Grain): string {
  if (grain === 'month') return d.slice(0, 7)
  if (grain === 'day') return d
  const x = toUtc(d)
  const dow = (x.getUTCDay() + 6) % 7 // Monday = 0
  x.setUTCDate(x.getUTCDate() - dow)
  return fmt(x)
}

export async function getTrend(L: Loader, opts: { window?: WindowInput; grain?: Grain; line?: LineFilter; book?: BookFilter } = {}) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const rows = await L.series()
  const grain = opts.grain ?? 'month'
  const line = opts.line ?? 'All'
  const book = opts.book ?? 'pinnacle'
  const w = resolveWindow(opts.window ?? '12m', L.today, earliestDate(rows))
  const buckets = new Map<string, { premium: number; policies: number }>()
  for (const r of rows) {
    if (r.d < w.start || r.d > w.end) continue
    if (!inBook(r, book) || !inLine(r.line, line)) continue
    const k = bucketKey(r.d, grain)
    const b = buckets.get(k) ?? { premium: 0, policies: 0 }
    b.premium += r.premium
    b.policies += r.policies
    buckets.set(k, b)
  }
  const points = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, v]) => ({ period, issued_premium: round0(v.premium), policies_issued: v.policies }))
  const total = points.reduce((s, p) => s + p.issued_premium, 0)
  const half = Math.floor(points.length / 2)
  const firstHalf = points.slice(0, half).reduce((s, p) => s + p.issued_premium, 0)
  const secondHalf = points.slice(half).reduce((s, p) => s + p.issued_premium, 0)
  const trendPct = half > 0 ? deltaPct(secondHalf, firstHalf) : null
  const best = points.reduce<typeof points[number] | null>((b, p) => (!b || p.issued_premium > b.issued_premium ? p : b), null)
  return {
    window: { start: w.start, end: w.end, label: w.label },
    grain,
    line,
    points,
    total_issued_premium: round0(total),
    trend: { second_half_vs_first_half_pct: trendPct, direction: dir(trendPct) },
    best_period: best,
    summary: `${money(total)} issued premium over ${w.label} across ${points.length} ${grain}s; the second half ran ${trendPct == null ? 'n/a' : (trendPct > 0 ? '+' : '') + trendPct + '%'} vs the first` + (best ? `; best ${grain} was ${best.period} at ${money(best.issued_premium)}.` : '.'),
  }
}

const DIM_WORDS: Record<BreakdownDim, string> = {
  team: 'agency',
  agent: 'producer',
  carrier: 'carrier',
  state: 'state',
  product: 'product',
}

function shapeBreakdown(rows: BreakdownRow[]) {
  const total = rows.reduce((s, r) => s + r.premium, 0)
  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.label,
    issued_premium: round0(r.premium),
    policies: r.policies,
    share_pct: share(r.premium, total),
    paid: r.paid,
    declined: r.declined,
    lapsed: r.lapsed,
    placement_pct: r.policies > 0 ? share(r.paid, r.policies) : 0,
  }))
}

export async function getBreakdown(L: Loader, opts: { dim: BreakdownDim; window?: WindowInput; line?: LineFilter; limit?: number }) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const dim = BREAKDOWN_DIMS.includes(opts.dim) ? opts.dim : 'team'
  const line = opts.line ?? 'All'
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 100)
  const w = resolveWindow(opts.window ?? 'ytd', L.today)
  const rows = shapeBreakdown(await fetchBreakdown(dim, line, w.start, w.end, limit))
  const lead = rows[0]
  return {
    dimension: dim,
    dimension_label: DIM_WORDS[dim],
    window: { start: w.start, end: w.end, label: w.label },
    line,
    rows,
    summary: lead
      ? `Top ${DIM_WORDS[dim]} ${w.label}: ${lead.name} with ${money(lead.issued_premium)} (${lead.share_pct}% of the top ${rows.length}).`
      : `No ${DIM_WORDS[dim]} data ${w.label}.`,
  }
}

export async function getStatusFunnel(L: Loader, opts: { window?: WindowInput; line?: LineFilter } = {}) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const status = await L.statuses()
  const w = resolveWindow(opts.window ?? 'ytd', L.today)
  const f = funnel(status, w, opts.line ?? 'All')
  const prior = w.prior ? funnel(status, { ...w.prior, prior: null }, opts.line ?? 'All') : null
  return {
    ...f,
    prior: prior ? { label: w.prior!.label, applications: prior.applications, paid: prior.paid, placement_pct: prior.placement_pct } : null,
    placement_change_pts: prior ? pct1(f.placement_pct - prior.placement_pct) : null,
    summary: `${f.applications.toLocaleString('en-US')} applications ${w.label}, ${f.paid.toLocaleString('en-US')} paid (${f.placement_pct}% placement), ${f.declined.toLocaleString('en-US')} declined, ${f.lapsed.toLocaleString('en-US')} lapsed` + (prior ? `; placement ${prior.placement_pct}% ${w.prior!.label}.` : '.'),
  }
}

export async function getAgencyBooks(L: Loader, opts: { window?: WindowInput } = {}) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const rows = await L.series()
  const w = resolveWindow(opts.window ?? 'ytd', L.today, earliestDate(rows))
  const books = groupByBook(rows).map((b) => {
    const st = periodStats(b.rows, w, 'All', 'all')
    const mix = productMix(b.rows, w, 'all')
    return {
      book_id: b.baseId,
      name: b.label,
      is_master_book: b.isPinnacle,
      issued_premium: st.issued_premium,
      policies_issued: st.policies_issued,
      avg_premium_per_policy: st.avg_premium_per_policy,
      vs_prior: st.vs_prior,
      product_mix: mix,
    }
  })
  const total = books.reduce((s, b) => s + b.issued_premium, 0)
  return {
    window: { start: w.start, end: w.end, label: w.label },
    books,
    combined_issued_premium: round0(total),
    summary: `${books.length} books of business, ${money(total)} combined issued premium ${w.label}: ` + books.map((b) => `${b.name} ${money(b.issued_premium)}`).join(', ') + '.',
  }
}

export async function listMeetings(L: Loader, opts: { days?: number } = {}) {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 60)
  const tz = L.tenant.timezone || 'America/New_York'
  const rows = await listUpcomingMeetingsForRep(L.tenant.id, {
    toIso: new Date(Date.now() + days * 86400_000).toISOString(),
    limit: 50,
  })
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const meetings = rows.map((m) => ({
    id: m.id,
    when: m.scheduled_at,
    when_local: f.format(new Date(m.scheduled_at)),
    title: m.title,
    with: m.attendee_name,
    duration_min: m.duration_min,
    status: m.status,
    meeting_url: m.meeting_url,
    source: m.source,
  }))
  return {
    days,
    timezone: tz,
    meetings,
    summary: meetings.length ? `${meetings.length} meeting${meetings.length === 1 ? '' : 's'} in the next ${days} days; next is ${meetings[0].when_local}${meetings[0].title ? ` — ${meetings[0].title}` : ''}.` : `No meetings on the calendar for the next ${days} days.`,
  }
}

export async function comparePeriods(L: Loader, opts: { a: WindowInput; b: WindowInput; line?: LineFilter; book?: BookFilter }) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const [rows, status] = await Promise.all([L.series(), L.statuses()])
  const line = opts.line ?? 'All'
  const book = opts.book ?? 'pinnacle'
  const earliest = earliestDate(rows)
  const wa = resolveWindow(opts.a, L.today, earliest)
  const wb = resolveWindow(opts.b, L.today, earliest)
  const side = (w: Window) => {
    const t = sumRows(rows, w.start, w.end, line, book)
    const f = sumStatus(status, w.start, w.end, line)
    return {
      window: { start: w.start, end: w.end, label: w.label },
      issued_premium: round0(t.premium),
      policies_issued: t.policies,
      avg_premium_per_policy: t.policies ? round0(t.premium / t.policies) : 0,
      applications: f.total,
      paid: f.paid,
      placement_pct: f.total > 0 ? share(f.paid, f.total) : 0,
      product_mix: productMix(rows, w, book),
    }
  }
  const A = side(wa)
  const B = side(wb)
  const d = deltaPct(A.issued_premium, B.issued_premium)
  return {
    a: A,
    b: B,
    delta_a_vs_b: {
      issued_premium: round0(A.issued_premium - B.issued_premium),
      issued_premium_pct: d,
      policies_issued: A.policies_issued - B.policies_issued,
      policies_pct: deltaPct(A.policies_issued, B.policies_issued),
      placement_pts: pct1(A.placement_pct - B.placement_pct),
      direction: dir(d),
    },
    summary: `${wa.label}: ${money(A.issued_premium)} vs ${wb.label}: ${money(B.issued_premium)} (${d == null ? 'n/a' : (d > 0 ? '+' : '') + d + '%'}); placement ${A.placement_pct}% vs ${B.placement_pct}%.`,
  }
}

async function fullBreakdown(dim: BreakdownDim, line: LineFilter, w: Window): Promise<BreakdownRow[]> {
  return fetchBreakdown(dim, line, w.start, w.end, 500)
}

function matchName(rows: BreakdownRow[], name: string): { row: BreakdownRow; rank: number } | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  let i = rows.findIndex((r) => r.label.toLowerCase() === q)
  if (i < 0) i = rows.findIndex((r) => r.label.toLowerCase().includes(q))
  if (i < 0) {
    const parts = q.split(/\s+/)
    i = rows.findIndex((r) => parts.every((p) => r.label.toLowerCase().includes(p)))
  }
  return i >= 0 ? { row: rows[i], rank: i + 1 } : null
}

export async function getEntity(L: Loader, opts: { dim: 'agent' | 'carrier' | 'team' | 'state'; name: string; window?: WindowInput }) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const w = resolveWindow(opts.window ?? 'ytd', L.today)
  const word = DIM_WORDS[opts.dim]
  const [all, health, life, annuity, prior] = await Promise.all([
    fullBreakdown(opts.dim, 'All', w),
    fullBreakdown(opts.dim, 'Health', w),
    fullBreakdown(opts.dim, 'Life', w),
    fullBreakdown(opts.dim, 'Annuity', w),
    w.prior ? fullBreakdown(opts.dim, 'All', { ...w.prior, prior: null }) : Promise.resolve([] as BreakdownRow[]),
  ])
  const hit = matchName(all, opts.name)
  if (!hit) {
    const near = all.filter((r) => r.label.toLowerCase().includes(opts.name.trim().toLowerCase().slice(0, 3))).slice(0, 5).map((r) => r.label)
    return {
      found: false,
      dimension: opts.dim,
      query: opts.name,
      suggestions: near,
      summary: `No ${word} matching "${opts.name}" ${w.label}.` + (near.length ? ` Did you mean: ${near.join(', ')}?` : ''),
    }
  }
  const r = hit.row
  const total = all.reduce((s, x) => s + x.premium, 0)
  const byLine = (rows: BreakdownRow[]) => {
    const m = rows.find((x) => x.label === r.label)
    return m ? { issued_premium: round0(m.premium), policies: m.policies, placement_pct: m.policies > 0 ? share(m.paid, m.policies) : 0 } : { issued_premium: 0, policies: 0, placement_pct: 0 }
  }
  const before = prior.find((x) => x.label === r.label)
  const d = before ? deltaPct(r.premium, before.premium) : null
  return {
    found: true,
    dimension: opts.dim,
    name: r.label,
    window: { start: w.start, end: w.end, label: w.label },
    rank: hit.rank,
    of: all.length,
    issued_premium: round0(r.premium),
    share_of_book_pct: share(r.premium, total),
    policies: r.policies,
    avg_premium_per_policy: r.policies ? round0(r.premium / r.policies) : 0,
    paid: r.paid,
    declined: r.declined,
    lapsed: r.lapsed,
    placement_pct: r.policies > 0 ? share(r.paid, r.policies) : 0,
    by_line: { Health: byLine(health), Life: byLine(life), Annuity: byLine(annuity) },
    prior: before && w.prior ? { label: w.prior.label, issued_premium: round0(before.premium), policies: before.policies } : null,
    vs_prior_pct: d,
    direction: dir(d),
    summary: `${r.label}: #${hit.rank} ${word} of ${all.length} ${w.label}, ${money(r.premium)} issued premium (${share(r.premium, total)}% of the book), ${r.policies} policies, ${r.policies > 0 ? share(r.paid, r.policies) : 0}% placement` + (d != null ? `, ${d > 0 ? '+' : ''}${d}% vs ${w.prior!.label}.` : '.'),
  }
}

export async function search(L: Loader, opts: { query: string; window?: WindowInput; limit?: number }) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const q = opts.query.trim().toLowerCase()
  const w = resolveWindow(opts.window ?? '12m', L.today)
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50)
  const dims: BreakdownDim[] = ['agent', 'carrier', 'team', 'state']
  const lists = await Promise.all(dims.map((d) => fullBreakdown(d, 'All', w)))
  const matches: { type: string; name: string; rank: number; issued_premium: number; policies: number }[] = []
  dims.forEach((d, i) => {
    lists[i].forEach((r, idx) => {
      if (q && r.label.toLowerCase().includes(q)) {
        matches.push({ type: DIM_WORDS[d], name: r.label, rank: idx + 1, issued_premium: round0(r.premium), policies: r.policies })
      }
    })
  })
  matches.sort((a, b) => b.issued_premium - a.issued_premium)
  const out = matches.slice(0, limit)
  return {
    query: opts.query,
    window: { start: w.start, end: w.end, label: w.label },
    matches: out,
    summary: out.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'} for "${opts.query}"; largest is ${out[0].name} (${out[0].type}) at ${money(out[0].issued_premium)} ${w.label}.` : `Nothing matching "${opts.query}" among producers, carriers, agencies or states ${w.label}.`,
  }
}

export async function getCompanySnapshot(L: Loader) {
  if (!pinnacleAllowed(L.tenant.id)) return NOT_CONNECTED
  const today = L.today
  const ytdW = resolveWindow('ytd', today)
  const [overview, trend, agents, carriers, states, teams] = await Promise.all([
    getOverview(L),
    getTrend(L, { window: '12m', grain: 'month' }),
    fetchBreakdown('agent', 'All', ytdW.start, ytdW.end, 5),
    fetchBreakdown('carrier', 'All', ytdW.start, ytdW.end, 5),
    fetchBreakdown('state', 'All', ytdW.start, ytdW.end, 5),
    fetchBreakdown('team', 'All', ytdW.start, ytdW.end, 5),
  ])
  if ('error' in overview || 'error' in trend) return NOT_CONNECTED
  const o = overview
  const t = trend
  const top = (rows: BreakdownRow[], word: string) => {
    const shaped = shapeBreakdown(rows)
    return {
      rows: shaped,
      summary: shaped.length ? `Top ${word}: ${shaped.slice(0, 3).map((r) => `${r.name} ${money(r.issued_premium)}`).join(', ')}.` : `No ${word} data year to date.`,
    }
  }
  const worries: string[] = []
  if (o.ytd.vs_prior.direction === 'down') worries.push(`Year-to-date issued premium is ${o.ytd.vs_prior.premium_delta_pct}% behind last year.`)
  if (t.trend.direction === 'down') worries.push(`The trailing-12-month trend is falling (${t.trend.second_half_vs_first_half_pct}% second half vs first).`)
  if (o.funnel_ytd.placement_pct && o.funnel_ytd.placement_pct < 60) worries.push(`Placement is ${o.funnel_ytd.placement_pct}%, under 60%.`)
  if (o.funnel_ytd.lapse_pct > 10) worries.push(`Lapse rate is ${o.funnel_ytd.lapse_pct}% of applications.`)
  const topCarrier = carriers[0]
  if (topCarrier && share(topCarrier.premium, carriers.reduce((s, r) => s + r.premium, 0)) > 50) worries.push(`${topCarrier.label} carries over half of the top-5 carrier premium — concentration risk.`)

  return {
    as_of: today,
    headline: o.summary,
    year_to_date: { ...o.ytd, summary: `${money(o.ytd.issued_premium)} issued year to date, ${o.ytd.vs_prior.premium_delta_pct == null ? 'no prior-year comparison' : `${o.ytd.vs_prior.premium_delta_pct > 0 ? '+' : ''}${o.ytd.vs_prior.premium_delta_pct}% vs the same period last year`}.` },
    month_to_date: { ...o.mtd, summary: `${money(o.mtd.issued_premium)} so far this month, pacing to ${money(o.mtd.projected_month_end)}.` },
    trailing: {
      three_months: o.trailing_3m,
      six_months: o.trailing_6m,
      twelve_months: o.trailing_12m,
      monthly_points: t.points,
      direction: t.trend.direction,
      summary: `Trailing 3/6/12 months: ${money(o.trailing_3m.issued_premium)} / ${money(o.trailing_6m.issued_premium)} / ${money(o.trailing_12m.issued_premium)}; the 12-month trend is ${t.trend.direction}.`,
    },
    placement: { ...o.funnel_ytd, summary: `${o.funnel_ytd.applications.toLocaleString('en-US')} applications year to date, ${o.funnel_ytd.paid.toLocaleString('en-US')} paid: ${o.funnel_ytd.placement_pct}% placement, ${o.funnel_ytd.decline_pct}% declined, ${o.funnel_ytd.lapse_pct}% lapsed.` },
    product_mix: { rows: o.product_mix_ytd, summary: o.product_mix_ytd.map((m) => `${m.line} ${m.share_pct}%`).join(', ') + ' of year-to-date issued premium.' },
    top_producers: top(agents, 'producers'),
    top_carriers: top(carriers, 'carriers'),
    top_states: top(states, 'states'),
    top_agencies: top(teams, 'agencies'),
    watch_list: worries,
    summary: o.summary + (worries.length ? ` Watch: ${worries[0]}` : ' Nothing on the watch list.'),
  }
}
