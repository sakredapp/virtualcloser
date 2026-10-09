/**
 * Sales Plan — pure math and parsing, shared by the page, the API, Mira's
 * tools and the tests. No server imports.
 *
 * Words used on screen: "plan" = the target the team set, "actual" = what the
 * book of business shows (Pinnacle rollups, synced from Airtable), "pace" =
 * actual so far against the plan so far.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
export const PRODUCT_LINE_NAMES = ['Health', 'Life', 'Annuity'] as const

export type PlanTarget = {
  id?: string
  year: number
  month: number // 1..12
  product: string
  carrier: string
  premium: number
  policies: number | null
}

export type UnitEcon = {
  id?: string
  year: number
  product: string
  carrier: string
  commission_pct: number | null
  avg_premium: number | null
  override_pct: number | null
  acquisition_cost: number | null
}

export type AllowanceTier = {
  id?: string
  year: number
  carrier: string
  period: 'month' | 'quarter'
  threshold: number
  unlocks: string
}

/** One row of actuals for a label (carrier / product / product line). */
export type LabelActual = { label: string; premium: number; policies: number }

export type PlanActuals = {
  /** Actual premium per month (index 0 = Jan) for the plan year, through today. */
  monthly: number[]
  monthlyPolicies: number[]
  /** Year to date (through today) by carrier, product and product line. */
  byCarrier: LabelActual[]
  byProduct: LabelActual[]
  byLine: LabelActual[]
  /** Current period (month and quarter) by carrier, for the allowance meters. */
  carrierThisMonth: LabelActual[]
  carrierThisQuarter: LabelActual[]
  /** YYYY-MM-DD the actuals run through (today in the book's zone), or null for a future year. */
  through: string | null
  connected: boolean
}

export const EMPTY_ACTUALS: PlanActuals = {
  monthly: new Array(12).fill(0),
  monthlyPolicies: new Array(12).fill(0),
  byCarrier: [],
  byProduct: [],
  byLine: [],
  carrierThisMonth: [],
  carrierThisQuarter: [],
  through: null,
  connected: false,
}

// ── Numbers ──────────────────────────────────────────────────────────────

/** "$1,250,000", "1.25M", "$1.2m", "(500)", "12%" → number. Blank / junk → null. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$,\s%]/g, '')
  if (s.startsWith('-')) {
    neg = !neg
    s = s.slice(1)
  }
  const m = /^(\d*\.?\d+)([kmb])?$/i.exec(s)
  if (!m) return null
  let n = Number(m[1])
  const suf = (m[2] ?? '').toLowerCase()
  if (suf === 'k') n *= 1_000
  if (suf === 'm') n *= 1_000_000
  if (suf === 'b') n *= 1_000_000_000
  return neg ? -n : n
}

/** Jan / january / 1 / 01 / 2027-01 → 1..12, else null. */
export function parseMonth(raw: unknown): number | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  const iso = /^\d{4}-(\d{1,2})$/.exec(s)
  if (iso) {
    const n = Number(iso[1])
    return n >= 1 && n <= 12 ? n : null
  }
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    return n >= 1 && n <= 12 ? n : null
  }
  const i = MONTHS.findIndex((m) => s.startsWith(m.toLowerCase()))
  return i >= 0 ? i + 1 : null
}

/** Lower-case, letters/digits only, single spaces: for matching plan names to book labels. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

// ── Importing a plan (CSV file or pasted Google Sheets rows) ─────────────

/** Minimal RFC 4180 reader for one separator (quotes, separators and newlines inside quotes). */
export function readDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))
}

/** Tab when the text has tabs (pasted from Sheets/Excel), else comma. */
export function readTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  return readDelimited(clean, clean.includes('\t') ? '\t' : ',')
}

export function planByMonth(targets: PlanTarget[], field: 'premium' | 'policies' = 'premium'): number[] {
  const out = new Array(12).fill(0)
  for (const t of targets) {
    if (t.month < 1 || t.month > 12) continue
    out[t.month - 1] += field === 'premium' ? t.premium || 0 : t.policies || 0
  }
  return out
}

export function sum(a: number[]): number {
  return a.reduce((s, v) => s + (v || 0), 0)
}

/**
 * Where we are in the plan year, as a fraction of each month elapsed.
 * Past year → every month done; future year → nothing done.
 */
export function monthWeights(year: number, today: string): number[] {
  const [ty, tm, td] = today.split('-').map(Number)
  if (year < ty) return new Array(12).fill(1)
  if (year > ty) return new Array(12).fill(0)
  const dim = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  return MONTHS.map((_, i) => (i + 1 < tm ? 1 : i + 1 === tm ? td / dim : 0))
}

export type Pacing = {
  planTotal: number
  /** Plan expected by today: whole months done plus the elapsed share of this month. */
  planToDate: number
  actualToDate: number
  /** Actual so far ÷ plan so far. Null before the year starts or with no plan. */
  pctOfPlanToDate: number | null
  /** Actual so far ÷ the whole year's plan. */
  pctOfYear: number | null
  /** Straight-line year-end at today's pace. 0 before the year starts. */
  projected: number
  /** Projected year-end ÷ plan. */
  projectedPct: number | null
  gap: number
  /** Share of the year elapsed, 0..1. */
  elapsed: number
  status: 'not_started' | 'ahead' | 'on_track' | 'behind' | 'no_plan'
}

/** Plan vs actual for a year. `actualMonthly` is actual premium by month (Jan = 0). */
export function pacing(planMonthly: number[], actualMonthly: number[], year: number, today: string): Pacing {
  const w = monthWeights(year, today)
  const planTotal = sum(planMonthly)
  const planToDate = planMonthly.reduce((s, v, i) => s + (v || 0) * w[i], 0)
  const actualToDate = actualMonthly.reduce((s, v, i) => s + (w[i] > 0 ? v || 0 : 0), 0)
  const elapsed = sum(w) / 12
  const projected = elapsed > 0 ? actualToDate / elapsed : 0
  const pctOfPlanToDate = planToDate > 0 ? actualToDate / planToDate : null
  const pctOfYear = planTotal > 0 ? actualToDate / planTotal : null
  const projectedPct = planTotal > 0 && elapsed > 0 ? projected / planTotal : null
  let status: Pacing['status'] = 'no_plan'
  if (planTotal > 0) {
    if (elapsed === 0) status = 'not_started'
    else if (pctOfPlanToDate == null) status = 'on_track'
    else if (pctOfPlanToDate >= 1.05) status = 'ahead'
    else if (pctOfPlanToDate >= 0.95) status = 'on_track'
    else status = 'behind'
  }
  return { planTotal, planToDate, actualToDate, pctOfPlanToDate, pctOfYear, projected, projectedPct, gap: actualToDate - planToDate, elapsed, status }
}

export const STATUS_WORDS: Record<Pacing['status'], string> = {
  not_started: 'Not started yet',
  ahead: 'Ahead of plan',
  on_track: 'On plan',
  behind: 'Behind plan',
  no_plan: 'No plan loaded',
}

/**
 * Actual for a plan name against the book's labels: exact (normalised) match
 * first; otherwise every label that contains the plan name as whole words
 * ("IUL" → "IUL EXPRESS"). Returns the matched labels too, so the page can say
 * what it counted.
 */
export function matchActual(name: string, rows: LabelActual[]): { premium: number; policies: number; labels: string[] } {
  const n = norm(name)
  if (!n) return { premium: 0, policies: 0, labels: [] }
  const exact = rows.filter((r) => norm(r.label) === n)
  const hits = exact.length ? exact : rows.filter((r) => ` ${norm(r.label)} `.includes(` ${n} `))
  return {
    premium: hits.reduce((s, r) => s + r.premium, 0),
    policies: hits.reduce((s, r) => s + r.policies, 0),
    labels: hits.map((r) => r.label),
  }
}

export type BreakdownLine = {
  name: string
  planToDate: number
  planYear: number
  actual: number
  pct: number | null
  matched: string[]
}

/**
 * Plan to date vs actual YTD for each carrier (or product) in the plan.
 * Products named as a whole line (Health / Life / Annuity) read the line totals.
 */
export function breakdownVsPlan(
  targets: PlanTarget[],
  dim: 'carrier' | 'product',
  actuals: { rows: LabelActual[]; lines?: LabelActual[] },
  year: number,
  today: string,
): BreakdownLine[] {
  const w = monthWeights(year, today)
  const by = new Map<string, { toDate: number; year: number }>()
  for (const t of targets) {
    const name = (dim === 'carrier' ? t.carrier : t.product).trim() || '(none)'
    const cur = by.get(name) ?? { toDate: 0, year: 0 }
    cur.toDate += (t.premium || 0) * (w[t.month - 1] ?? 0)
    cur.year += t.premium || 0
    by.set(name, cur)
  }
  const out: BreakdownLine[] = []
  for (const [name, p] of by) {
    const isLine = dim === 'product' && actuals.lines && PRODUCT_LINE_NAMES.some((l) => norm(l) === norm(name))
    const m = name === '(none)' ? { premium: 0, policies: 0, labels: [] } : matchActual(name, isLine ? actuals.lines! : actuals.rows)
    out.push({ name, planToDate: p.toDate, planYear: p.year, actual: m.premium, pct: p.toDate > 0 ? m.premium / p.toDate : null, matched: m.labels })
  }
  return out.sort((a, b) => b.planYear - a.planYear)
}

// ── Unit economics ───────────────────────────────────────────────────────

export type EconLine = UnitEcon & {
  /** Commission earned per policy: avg premium × commission %. */
  revenuePerPolicy: number | null
  /** What Pinnacle keeps per policy: avg premium × override % − acquisition cost. */
  marginPerPolicy: number | null
  planPremium: number
  planPolicies: number | null
  /** Projected margin on the plan: plan policies × margin per policy. */
  projectedMargin: number | null
}

export function econLine(e: UnitEcon, targets: PlanTarget[]): EconLine {
  const mine = targets.filter((t) => norm(t.product) === norm(e.product) && norm(t.carrier) === norm(e.carrier))
  const planPremium = mine.reduce((s, t) => s + (t.premium || 0), 0)
  const enteredPolicies = mine.some((t) => t.policies != null) ? mine.reduce((s, t) => s + (t.policies || 0), 0) : null
  const avg = e.avg_premium && e.avg_premium > 0 ? e.avg_premium : null
  const planPolicies = enteredPolicies ?? (avg ? planPremium / avg : null)
  const revenuePerPolicy = avg != null && e.commission_pct != null ? (avg * e.commission_pct) / 100 : null
  const marginPerPolicy = avg != null && e.override_pct != null ? (avg * e.override_pct) / 100 - (e.acquisition_cost || 0) : null
  const projectedMargin = marginPerPolicy != null && planPolicies != null ? marginPerPolicy * planPolicies : null
  return { ...e, revenuePerPolicy, marginPerPolicy, planPremium, planPolicies, projectedMargin }
}

/** Every product × carrier pair in the plan, with its unit economics row if one was entered. */
export function econTable(targets: PlanTarget[], econ: UnitEcon[], year: number): EconLine[] {
  const pairs = new Map<string, UnitEcon>()
  for (const e of econ) pairs.set(`${norm(e.product)}\u0000${norm(e.carrier)}`, e)
  for (const t of targets) {
    const k = `${norm(t.product)}\u0000${norm(t.carrier)}`
    if (!pairs.has(k)) pairs.set(k, { year, product: t.product, carrier: t.carrier, commission_pct: null, avg_premium: null, override_pct: null, acquisition_cost: null })
  }
  return Array.from(pairs.values())
    .map((e) => econLine(e, targets))
    .sort((a, b) => b.planPremium - a.planPremium || a.product.localeCompare(b.product))
}

// ── Marketing allowance ──────────────────────────────────────────────────

export type AllowanceStatus = {
  carrier: string
  period: 'month' | 'quarter'
  periodLabel: string
  actual: number
  tiers: AllowanceTier[]
  /** Highest tier already reached, if any. */
  reached: AllowanceTier | null
  next: AllowanceTier | null
  /** Dollars still needed for the next tier. */
  toNext: number
  /** 0..1 toward the next tier (1 when every tier is reached). */
  progress: number
  /** Straight-line period-end at the current pace, and the tier that would reach. */
  projected: number
  projectedTier: AllowanceTier | null
}

export function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1
}

/** Share of the current month/quarter elapsed, from today's date. */
export function periodElapsed(period: 'month' | 'quarter', today: string): number {
  const [y, m, d] = today.split('-').map(Number)
  if (period === 'month') return d / new Date(Date.UTC(y, m, 0)).getUTCDate()
  const q = quarterOf(m)
  const start = Date.UTC(y, (q - 1) * 3, 1)
  const end = Date.UTC(y, q * 3, 1)
  return Math.min(1, (Date.UTC(y, m - 1, d) - start + 86_400_000) / (end - start))
}

export function allowanceStatus(
  carrier: string,
  period: 'month' | 'quarter',
  tiers: AllowanceTier[],
  actual: number,
  elapsed: number,
  periodLabel: string,
): AllowanceStatus {
  const sorted = tiers.filter((t) => norm(t.carrier) === norm(carrier) && t.period === period).sort((a, b) => a.threshold - b.threshold)
  const reached = [...sorted].reverse().find((t) => actual >= t.threshold) ?? null
  const next = sorted.find((t) => actual < t.threshold) ?? null
  const prevThreshold = 0
  const toNext = next ? Math.max(0, next.threshold - actual) : 0
  const progress = next ? Math.min(1, Math.max(0, (actual - prevThreshold) / Math.max(1, next.threshold - prevThreshold))) : sorted.length ? 1 : 0
  const projected = elapsed > 0 ? actual / elapsed : actual
  const projectedTier = [...sorted].reverse().find((t) => projected >= t.threshold) ?? null
  return { carrier, period, periodLabel, actual, tiers: sorted, reached, next, toNext, progress, projected, projectedTier }
}

// ── Money words ──────────────────────────────────────────────────────────

/** $1.2M / $340K / $980 */
export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

export function pct(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return '—'
  if (p >= 10) return '999%+'
  return `${(p * 100).toFixed(digits)}%`
}

/** The day plan-to-date is measured at: the last day the book has data for in the current year, else today. */
export function asOfDay(year: number, today: string, through: string | null): string {
  if (year !== Number(today.slice(0, 4)) || !through) return today
  return through < today ? through : today
}
