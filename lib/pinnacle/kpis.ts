/**
 * Pinnacle KPI model — pure functions, no server imports, so the same math
 * runs in the signed-in Overview / Performance pages, the public demo, and
 * any future API. Everything derives from the rollup payloads
 * (DailyRow / StatusRow / BreakdownRow); nothing here invents a number.
 */
import type { DailyRow, StatusRow } from './rollup'

export const DAY = 86_400_000

export function todayUTC(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}
export function toISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}
export function parseDay(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** $1.2M / $340K / $980 — rounded, never a long number. */
export function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}
export function fmtCount(n: number): string {
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return Math.round(n).toLocaleString('en-US')
}
export function fmtPct(p: number | null, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return '—'
  return `${(p * 100).toFixed(digits)}%`
}

export type Delta = { pct: number | null; dir: 'up' | 'down' | 'flat' }
export function delta(cur: number, prev: number): Delta {
  // No prior figure: no direction. Never "new this period" (owner, 10-08).
  if (!prev) return { pct: null, dir: 'flat' }
  const pct = (cur - prev) / prev
  return { pct, dir: pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat' }
}
/** "up 12%" / "down 4%" / "flat" — the plain-English half of a tile. */
export function deltaWords(d: Delta): string {
  if (d.pct == null) return 'no prior data'
  if (d.dir === 'flat') return 'flat'
  return `${d.dir} ${Math.abs(Math.round(d.pct * 100))}%`
}

export type MonthPoint = {
  key: string // YYYY-MM
  label: string // "Jan"
  longLabel: string // "Jan 2026"
  start: number
  premium: number
  policies: number
  funded: number
  fundedPolicies: number
  byLine: Record<string, { premium: number; policies: number }>
  /** Status-rollup counts for the month (Pinnacle base). */
  written: number
  issued: number
  declined: number
  lapsed: number
  pending: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * Calendar months ending with the current month, `count` long, oldest first.
 * Empty months exist as zero points so waves never skip a month.
 */
export function monthlySeries(
  rows: DailyRow[],
  statusRows: StatusRow[],
  count: number,
  now: Date = new Date(),
  line?: string,
): MonthPoint[] {
  const y0 = now.getUTCFullYear()
  const m0 = now.getUTCMonth()
  const points: MonthPoint[] = []
  const byKey = new Map<string, MonthPoint>()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y0, m0 - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const p: MonthPoint = {
      key,
      label: MONTHS[d.getUTCMonth()],
      longLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      start: d.getTime(),
      premium: 0,
      policies: 0,
      funded: 0,
      fundedPolicies: 0,
      byLine: {},
      written: 0,
      issued: 0,
      declined: 0,
      lapsed: 0,
      pending: 0,
    }
    points.push(p)
    byKey.set(key, p)
  }
  for (const r of rows) {
    if (line && r.line !== line) continue
    const p = byKey.get(monthKeyOf(r.d))
    if (!p) continue
    p.premium += r.premium || 0
    p.policies += r.policies || 0
    p.funded += r.funded_premium || 0
    p.fundedPolicies += r.funded_policies || 0
    const bl = (p.byLine[r.line] ??= { premium: 0, policies: 0 })
    bl.premium += r.premium || 0
    bl.policies += r.policies || 0
  }
  for (const s of statusRows) {
    if (line && s.line !== line) continue
    const p = byKey.get(monthKeyOf(s.d))
    if (!p) continue
    p.written += s.total || 0
    p.issued += s.paid || 0
    p.declined += s.declined || 0
    p.lapsed += s.lapsed || 0
    p.pending += s.submitted || 0
  }
  return points
}

export type TrendTile = {
  key: '3m' | '6m' | '12m'
  label: string
  months: number
  current: number
  previous: number
  delta: Delta
  spark: number[]
  words: string
}

/** Trailing N months (incl. current) vs the N months before them. */
export function trendTiles(series24: MonthPoint[], pick: (p: MonthPoint) => number): TrendTile[] {
  const defs: Array<{ key: TrendTile['key']; label: string; months: number }> = [
    { key: '3m', label: '3-month trend', months: 3 },
    { key: '6m', label: '6-month trend', months: 6 },
    { key: '12m', label: '12-month trend', months: 12 },
  ]
  return defs.map(({ key, label, months }) => {
    const cur = series24.slice(-months)
    const prev = series24.slice(-months * 2, -months)
    const current = cur.reduce((s, p) => s + pick(p), 0)
    const previous = prev.reduce((s, p) => s + pick(p), 0)
    const d = delta(current, previous)
    return {
      key,
      label,
      months,
      current,
      previous,
      delta: d,
      spark: cur.map(pick),
      words: `${deltaWords(d)} on the previous ${months} months`,
    }
  })
}

export type Pace = {
  ytd: number
  lastYtd: number
  lastYearTotal: number
  projected: number
  elapsed: number // 0..1 of the year
  vsLastYear: Delta
}

/** Year-to-date vs the same span last year, and a straight-line run-rate. */
export function yearPace(rows: DailyRow[], now: Date = new Date(), line?: string): Pace {
  const y = now.getUTCFullYear()
  const today = todayUTC(now)
  const start = Date.UTC(y, 0, 1)
  const lastStart = Date.UTC(y - 1, 0, 1)
  const lastSame = Date.UTC(y - 1, now.getUTCMonth(), now.getUTCDate())
  const lastEnd = Date.UTC(y - 1, 11, 31)
  let ytd = 0
  let lastYtd = 0
  let lastYearTotal = 0
  for (const r of rows) {
    if (line && r.line !== line) continue
    const t = parseDay(r.d)
    if (t >= start && t <= today) ytd += r.premium || 0
    else if (t >= lastStart && t <= lastEnd) {
      lastYearTotal += r.premium || 0
      if (t <= lastSame) lastYtd += r.premium || 0
    }
  }
  const daysInYear = (Date.UTC(y + 1, 0, 1) - start) / DAY
  const elapsed = Math.min(1, Math.max(1 / daysInYear, (today - start) / DAY / daysInYear))
  const projected = elapsed > 0 ? ytd / elapsed : 0
  return { ytd, lastYtd, lastYearTotal, projected, elapsed, vsLastYear: delta(ytd, lastYtd) }
}

export type Funnel = { written: number; issued: number; pending: number; declined: number; lapsed: number; placement: number | null }

export function funnelFor(points: MonthPoint[]): Funnel {
  const f = points.reduce(
    (a, p) => ({
      written: a.written + p.written,
      issued: a.issued + p.issued,
      pending: a.pending + p.pending,
      declined: a.declined + p.declined,
      lapsed: a.lapsed + p.lapsed,
    }),
    { written: 0, issued: 0, pending: 0, declined: 0, lapsed: 0 },
  )
  return { ...f, placement: f.written > 0 ? f.issued / f.written : null }
}

/** Which product line moved the most (abs. % change) over the window. */
export function mostMovedLine(cur: MonthPoint[], prev: MonthPoint[], lines: string[]): string | null {
  let best: string | null = null
  let bestAbs = -1
  for (const l of lines) {
    const c = cur.reduce((s, p) => s + (p.byLine[l]?.premium ?? 0), 0)
    const p = prev.reduce((s, q) => s + (q.byLine[l]?.premium ?? 0), 0)
    if (!c && !p) continue
    const d = p ? Math.abs((c - p) / p) : 1
    if (d > bestAbs) {
      bestAbs = d
      best = l
    }
  }
  return best
}

export type Timeframe = 'mtd' | '3m' | '6m' | '12m' | 'ytd'
export const TIMEFRAMES: Array<{ key: Timeframe; label: string }> = [
  { key: 'mtd', label: 'This month' },
  { key: '3m', label: 'Last 3 months' },
  { key: '6m', label: 'Last 6 months' },
  { key: 'ytd', label: 'YTD' },
  { key: '12m', label: '12 months' },
]
export function timeframeMonths(tf: Timeframe, now: Date = new Date()): number {
  if (tf === 'ytd') return now.getUTCMonth() + 1
  if (tf === 'mtd') return 1
  return tf === '3m' ? 3 : tf === '6m' ? 6 : 12
}
/** ISO [start, end] for a timeframe — the breakdown API's window. */
export function timeframeWindow(tf: Timeframe, now: Date = new Date()): { start: string; end: string } {
  const months = timeframeMonths(tf, now)
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1)
  return { start: toISO(start), end: toISO(todayUTC(now)) }
}

/** ISO [start, end] for an explicit month span (custom timeframe). */
export function monthSpanWindow(startKey: string, endKey: string, now: Date = new Date()): { start: string; end: string } {
  const [sy, sm] = startKey.split('-').map(Number)
  const [ey, em] = endKey.split('-').map(Number)
  const start = Date.UTC(sy, sm - 1, 1)
  const endOfMonth = Date.UTC(ey, em, 0)
  return { start: toISO(start), end: toISO(Math.min(endOfMonth, todayUTC(now))) }
}

/**
 * The last day the book has anything on: the date every card means by
 * "Data through". Null when the rows are empty.
 */
export function dataThroughOf(rows: DailyRow[]): string | null {
  let last: string | null = null
  for (const r of rows) {
    if ((r.premium || 0) <= 0 && (r.policies || 0) <= 0) continue
    if (!last || r.d > last) last = r.d
  }
  return last
}

/** Does the book hold anything dated in `year`? Gates every year-over-year comparison. */
export function yearHasData(rows: DailyRow[], year: number): boolean {
  const y = String(year)
  return rows.some((r) => r.d.startsWith(y) && ((r.premium || 0) > 0 || (r.policies || 0) > 0))
}

/** Daily points for one calendar month (1..daysInMonth), submitted and issued premium. */
export function dailyForMonth(rows: DailyRow[], year: number, month0: number): Array<{ day: number; premium: number; funded: number; policies: number }> {
  const dim = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const key = `${year}-${String(month0 + 1).padStart(2, '0')}-`
  const out = Array.from({ length: dim }, (_, i) => ({ day: i + 1, premium: 0, funded: 0, policies: 0 }))
  for (const r of rows) {
    if (!r.d.startsWith(key)) continue
    const d = Number(r.d.slice(8, 10))
    const p = out[d - 1]
    if (!p) continue
    p.premium += r.premium || 0
    p.funded += r.funded_premium || 0
    p.policies += r.policies || 0
  }
  return out
}

/** Sum over a day range inside one month (same-days comparisons for the month card). */
export function sumDays(rows: DailyRow[], year: number, month0: number, throughDay: number): { premium: number; funded: number; policies: number } {
  const pts = dailyForMonth(rows, year, month0).slice(0, throughDay)
  return pts.reduce((a, p) => ({ premium: a.premium + p.premium, funded: a.funded + p.funded, policies: a.policies + p.policies }), { premium: 0, funded: 0, policies: 0 })
}

/** Cumulative running total of a series (for pace waves). */
export function cumulative(values: number[]): number[] {
  let s = 0
  return values.map((v) => (s += v))
}
