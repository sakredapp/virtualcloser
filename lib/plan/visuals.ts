/**
 * Sales Plan visuals: the numbers behind the charts, progress bars and empty
 * states on /dashboard/plan. Pure and client-safe (no server imports), so the
 * page and the tests share one source.
 *
 * Honesty rules (owner 2026-10-20, after the month-end projection was pulled
 * in PR #52 for overshooting):
 * - Pace is measured on COMPLETE months only. A month in progress is shown on
 *   its own, never prorated by day, because 13-28% of a month's premium is
 *   dated the 1st and a by-day share overstates early-month pace.
 * - The year-end forecast is shown only after FORECAST_MIN_MONTHS complete
 *   months with plan behind them, and is labelled with how it is worked out:
 *   actual so far in those months, plus the rest of the plan at the same % of
 *   plan those months hit. Otherwise it is null with the reason.
 * - Every ratio is null (not 0, NaN or Infinity) when its base is 0; every bar
 *   width is clamped to 0..1.
 */
import { MONTHS, sum, type PlanActuals, type PlanTarget, planByMonth } from './shared'

/** Complete months needed before a year-end forecast is shown. */
export const FORECAST_MIN_MONTHS = 3

/** a ÷ b, or null when b is 0 / either side is not a finite number. */
export function ratio(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  const r = a / b
  return Number.isFinite(r) ? r : null
}

/** Bar width 0..1 from a ratio (null / NaN / negative → 0, over 100% → 1). */
export function barWidth(r: number | null | undefined): number {
  if (r == null || !Number.isFinite(r) || r <= 0) return 0
  return Math.min(1, r)
}

/** "64%"; over 999% shows "999%+"; null → "—". */
export function pctLabel(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—'
  if (r >= 9.995) return '999%+'
  return `${Math.round(r * 100)}%`
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Share of the calendar year elapsed by `today` (end of that day), 0..1. */
export function yearElapsed(year: number, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number)
  if (!ty || year < ty) return 1
  if (year > ty) return 0
  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year + 1, 0, 1)
  return Math.min(1, Math.max(0, (Date.UTC(ty, tm - 1, td) + 86_400_000 - start) / (end - start)))
}

/**
 * Complete months of the plan year as of `asOf` (the last day the book has).
 * A month counts as complete once its last day is in. Past year → 12, future → 0.
 */
export function completeMonths(year: number, asOf: string): number {
  const [ay, am, ad] = asOf.split('-').map(Number)
  if (!ay || year < ay) return 12
  if (year > ay) return 0
  return am - 1 + (ad >= daysIn(ay, am) ? 1 : 0)
}

export type MonthState = 'done' | 'partial' | 'future'

export type MonthCell = {
  month: number // 1..12
  label: string
  plan: number
  actual: number
  state: MonthState
  /** Actual ÷ plan for done and partial months; null for future months or a month with no plan. */
  pct: number | null
  /** 0..1 for the progress bar. */
  bar: number
  /** Plain words for the cell: "112%", "No plan", "No sales", "Not yet". */
  words: string
}

export type PlanView =
  /** No targets for this year. */
  | 'no_plan'
  /** Plan loaded, the year has not started. */
  | 'future'
  /** Plan loaded, the book of business is not connected. */
  | 'not_connected'
  /** Plan loaded, connected, but nothing written yet this year. */
  | 'no_actuals'
  | 'live'

export type PaceStatus = 'ahead' | 'on_track' | 'behind' | 'early' | 'not_started' | 'no_plan'

export const PACE_WORDS: Record<PaceStatus, string> = {
  ahead: 'Ahead of plan',
  on_track: 'On plan',
  behind: 'Behind plan',
  early: 'First month in progress',
  not_started: 'Not started yet',
  no_plan: 'No plan loaded',
}

export type Forecast =
  | { value: number; pctOfPlan: number | null; basis: string }
  | { value: null; reason: string }

export type PlanVisuals = {
  view: PlanView
  year: number
  planTotal: number
  /** Actual premium written this year to date (complete months + the month in progress). */
  actualYtd: number
  /** Actual YTD ÷ the whole year's plan. */
  pctOfYearPlan: number | null
  /** Share of the calendar year gone, 0..1. */
  yearElapsed: number
  /** Share of the year's plan due by the end of the last complete month, 0..1. */
  planDueShare: number | null
  complete: number
  /** "Jan–Sep" for the complete months, or null. */
  completeLabel: string | null
  planComplete: number
  actualComplete: number
  /** Actual ÷ plan over the complete months: the honest pace. */
  pace: number | null
  status: PaceStatus
  months: MonthCell[]
  /** The month in progress (current year only), or null. */
  current: (MonthCell & { day: number; daysInMonth: number }) | null
  /** Running totals for the pacing chart. Actual runs only through the months with data. */
  cumPlan: number[]
  cumActual: number[]
  forecast: Forecast
  /** True when there is no plan but the book shows premium this year (show actuals alone). */
  actualsOnly: boolean
}

export function monthRange(from: number, to: number): string {
  if (to < from) return ''
  return from === to ? MONTHS[from - 1] : `${MONTHS[from - 1]}–${MONTHS[to - 1]}`
}

/**
 * Everything the Sales Plan page draws, from the plan targets and the book's
 * actuals. `today` is the book's today; `asOf` is the last day of data (see
 * asOfDay in shared.ts).
 */
export function planVisuals(input: { year: number; today: string; asOf: string; targets: PlanTarget[]; actuals: Pick<PlanActuals, 'monthly' | 'connected'> }): PlanVisuals {
  const { year, today, asOf, targets, actuals } = input
  const thisYear = Number(today.slice(0, 4))
  const plan = planByMonth(targets)
  const actual = MONTHS.map((_, i) => {
    const v = Number(actuals.monthly?.[i] ?? 0)
    return Number.isFinite(v) ? v : 0
  })
  const planTotal = sum(plan)
  const hasPlan = targets.length > 0 && planTotal > 0
  const isFuture = year > thisYear
  const complete = isFuture ? 0 : completeMonths(year, asOf)
  const isCurrent = year === thisYear
  const partialIdx = isCurrent && complete < 12 ? complete : -1

  const months: MonthCell[] = MONTHS.map((label, i) => {
    const state: MonthState = i < complete ? 'done' : i === partialIdx ? 'partial' : 'future'
    const p = plan[i]
    const a = state === 'future' ? 0 : actual[i]
    const pct = state === 'future' ? null : ratio(a, p)
    let words = 'Not yet'
    if (state !== 'future') {
      if (p <= 0) words = a > 0 ? 'No plan' : '—'
      else if (a <= 0) words = state === 'partial' ? 'None yet' : 'No sales'
      else words = pctLabel(pct)
    }
    return { month: i + 1, label, plan: p, actual: a, state, pct, bar: barWidth(pct), words }
  })

  const planComplete = sum(plan.slice(0, complete))
  const actualComplete = sum(actual.slice(0, complete))
  const actualYtd = isFuture ? 0 : sum(months.map((m) => m.actual))
  const pace = ratio(actualComplete, planComplete)

  let status: PaceStatus = 'no_plan'
  if (hasPlan) {
    if (isFuture) status = 'not_started'
    else if (complete === 0) status = 'early'
    else if (pace == null) status = 'not_started' // the plan's first month is still ahead
    else if (pace >= 1.05) status = 'ahead'
    else if (pace >= 0.95) status = 'on_track'
    else status = 'behind'
  }

  let view: PlanView = 'live'
  if (!hasPlan) view = 'no_plan'
  else if (isFuture) view = 'future'
  else if (!actuals.connected) view = 'not_connected'
  else if (actualYtd <= 0) view = 'no_actuals'

  const completeLabel = complete > 0 ? monthRange(1, complete) : null

  let forecast: Forecast
  if (!hasPlan) forecast = { value: null, reason: 'No plan to forecast against.' }
  else if (isFuture) forecast = { value: null, reason: `Starts once ${year} has ${FORECAST_MIN_MONTHS} full months of sales.` }
  else if (!actuals.connected) forecast = { value: null, reason: 'Needs the book of business connected.' }
  else if (complete >= 12) forecast = { value: null, reason: 'The year is closed; the actual is final.' }
  else if (complete < FORECAST_MIN_MONTHS) forecast = { value: null, reason: `Shown after ${FORECAST_MIN_MONTHS} full months (${monthRange(1, FORECAST_MIN_MONTHS)}); ${complete} so far.` }
  else if (pace == null) forecast = { value: null, reason: `No plan in ${completeLabel} to measure pace against.` }
  else {
    const value = actualComplete + pace * (planTotal - planComplete)
    forecast = {
      value,
      pctOfPlan: ratio(value, planTotal),
      basis: `${completeLabel} actual, plus the rest of the plan at ${pctLabel(pace)} (the ${completeLabel} pace). The month in progress is left out: premium lands early in a month.`,
    }
  }

  const cumPlan: number[] = []
  plan.reduce((s, v, i) => ((cumPlan[i] = s + v), s + v), 0)
  const shown = isFuture ? 0 : partialIdx >= 0 ? partialIdx + 1 : complete
  const cumActual: number[] = []
  actual.slice(0, shown).reduce((s, v, i) => ((cumActual[i] = s + v), s + v), 0)

  const current =
    partialIdx >= 0
      ? (() => {
          const [ay, am, ad] = asOf.split('-').map(Number)
          const sameMonth = ay === year && am === partialIdx + 1
          return { ...months[partialIdx], day: sameMonth ? ad : 0, daysInMonth: daysIn(year, partialIdx + 1) }
        })()
      : null

  return {
    view,
    year,
    planTotal,
    actualYtd,
    pctOfYearPlan: ratio(actualYtd, planTotal),
    yearElapsed: yearElapsed(year, today),
    planDueShare: hasPlan ? barWidth(ratio(planComplete, planTotal)) : null,
    complete,
    completeLabel,
    planComplete,
    actualComplete,
    pace,
    status,
    months,
    current,
    cumPlan,
    cumActual,
    forecast,
    actualsOnly: !hasPlan && actualYtd > 0,
  }
}

// ── Allowance tiers ──────────────────────────────────────────────────────

export type TierRail = {
  /** Fill 0..1 of the rail. */
  fill: number
  ticks: Array<{ at: number; threshold: number; hit: boolean }>
  /** Actual ÷ the next tier's threshold; null when every tier is reached or there are none. */
  pctOfNext: number | null
}

/** A rail with a tick per tier (Airtasker-style): the scale runs a little past the top tier. */
export function tierRail(actual: number, thresholds: number[]): TierRail {
  const a = Number.isFinite(actual) && actual > 0 ? actual : 0
  const ts = thresholds.filter((t) => Number.isFinite(t) && t > 0).sort((x, y) => x - y)
  if (ts.length === 0) return { fill: 0, ticks: [], pctOfNext: null }
  const scale = Math.max(ts[ts.length - 1], a) * 1.08
  const next = ts.find((t) => a < t)
  return {
    fill: barWidth(a / scale),
    ticks: ts.map((t) => ({ at: t / scale, threshold: t, hit: a >= t })),
    pctOfNext: next == null ? null : ratio(a, next),
  }
}

// ── Which year to open ───────────────────────────────────────────────────

/**
 * The year the page opens on: the asked year if offered; else this year when
 * it has a plan; else next year when that has one; else this year (so the
 * book's actuals still show while there is no plan).
 */
export function pickPlanYear(years: number[], planYears: number[], thisYear: number, asked?: number | null): number {
  if (asked != null && years.includes(asked)) return asked
  if (planYears.includes(thisYear) && years.includes(thisYear)) return thisYear
  if (planYears.includes(thisYear + 1) && years.includes(thisYear + 1)) return thisYear + 1
  return years.includes(thisYear) ? thisYear : years[0] ?? thisYear
}
