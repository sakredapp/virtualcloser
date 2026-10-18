/**
 * Producer retention and placement by carrier: the pure math behind the
 * producer_production tool's retention and placement views.
 *
 * Retention uses the agent page's definitions (supabase/pinnacle_people_stats.sql,
 * the Team page's Retention panel), computed per window in SQL by
 * cxo_producer_retention (supabase/cxo_producer_retention.sql):
 *   writing   a non-declined policy in the 90 days up to a date
 *   stopped   no policy for 90 days (dated last sale + 90), or marked as
 *             leaving (Inactive Agent, Terminated, release) inside that gap
 *   headcount writing in the last 90 days and not yet stopped
 * Retention for a window = of the agents active the day before it starts,
 * the share still active at its end.
 *
 * Placement = issued / applications (same as the dashboard funnel); issue
 * rate also counts policies that issued and later lapsed.
 *
 * Kept pure (no I/O) so every number is unit tested.
 */
import type { Window } from './production'

export const INACTIVE_AFTER_DAYS = 90
/** Pending share under which an age bucket counts as settled. */
export const SETTLED_PENDING_PCT = 5
/** Age buckets with fewer apps than this are too small to judge. */
export const MIN_CURVE_APPS = 20
/** Carriers/products need this many applications before they are ranked on a rate. */
export const MIN_BREAKDOWN_APPS = 20
/** Windows longer than this never get a lag note (executives know fresh apps are not issued yet). */
export const LAG_NOTE_MAX_WINDOW_DAYS = 92

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)
const num = (v: unknown) => Number(v) || 0

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
export const addDays = (s: string, n: number) => {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000)

// ---------------------------------------------------------------------------
// Retention.

export type RetentionWindow = {
  start: string
  end: string
  active_start: number
  retained: number
  stopped: number
  active_end: number
  writing: number
  new_writers: number
  joined: number
  reactivated: number
}
export type QuietAgent = {
  name: string
  team: string | null
  last_sale: string | null
  stopped_on: string | null
  why: string
  policies_last_90_days_before: number | null
  ap_last_90_days_before: number | null
}
export type ReactivatedAgent = { name: string; team: string | null; came_back_on: string | null; gap_days: number }
export type DriftingAgent = { name: string; team: string | null; last_sale: string | null; days_since: number; ap_last_90_days_before: number | null }
export type RetentionRaw = {
  inactive_after_days: number
  data_through: string | null
  now: RetentionWindow | null
  prior: RetentionWindow | null
  went_quiet_count: number
  went_quiet: QuietAgent[]
  reactivated_agents: ReactivatedAgent[]
  drifting: { days_30_59: number; days_60_89: number; top: DriftingAgent[] }
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : null)

function toWindow(v: unknown): RetentionWindow | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  return {
    start: day(r.start) ?? '',
    end: day(r.end) ?? '',
    active_start: num(r.active_start),
    retained: num(r.retained),
    stopped: num(r.stopped),
    active_end: num(r.active_end),
    writing: num(r.writing),
    new_writers: num(r.new_writers),
    joined: num(r.joined),
    reactivated: num(r.reactivated),
  }
}
const nn = (v: unknown) => (v == null ? null : num(v))

/** Normalise the cxo_producer_retention jsonb (numbers may arrive as strings). */
export function toRetentionRaw(v: unknown): RetentionRaw {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const d = (r.drifting && typeof r.drifting === 'object' ? r.drifting : {}) as Record<string, unknown>
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : [])
  return {
    inactive_after_days: num(r.inactive_after_days) || INACTIVE_AFTER_DAYS,
    data_through: day(r.data_through),
    now: toWindow(r.now),
    prior: toWindow(r.prior),
    went_quiet_count: num(r.went_quiet_count),
    went_quiet: arr(r.went_quiet).map((q) => ({
      name: s(q.name) ?? 'Unnamed agent',
      team: s(q.team),
      last_sale: day(q.last_sale),
      stopped_on: day(q.stopped_on),
      why: s(q.why) ?? 'no policy in 90 days',
      policies_last_90_days_before: nn(q.policies_last_90_days_before),
      ap_last_90_days_before: nn(q.ap_last_90_days_before),
    })),
    reactivated_agents: arr(r.reactivated_agents).map((x) => ({ name: s(x.name) ?? 'Unnamed agent', team: s(x.team), came_back_on: day(x.came_back_on), gap_days: num(x.gap_days) })),
    drifting: {
      days_30_59: num(d.days_30_59),
      days_60_89: num(d.days_60_89),
      top: arr(d.top).map((x) => ({
        name: s(x.name) ?? 'Unnamed agent',
        team: s(x.team),
        last_sale: day(x.last_sale),
        days_since: num(x.days_since),
        ap_last_90_days_before: nn(x.ap_last_90_days_before),
      })),
    },
  }
}

export function retentionPct(w: Pick<RetentionWindow, 'retained' | 'active_start'>): number | null {
  return pct(w.retained, w.active_start)
}

export type RetentionFigures = RetentionWindow & { retention_pct: number | null; net_change: number }

function withRates(w: RetentionWindow): RetentionFigures {
  return { ...w, retention_pct: retentionPct(w), net_change: w.active_end - w.active_start }
}

/** Headline retention for a window vs the prior one. */
export function retentionSummary(raw: RetentionRaw) {
  const now = raw.now ? withRates(raw.now) : null
  const prior = raw.prior ? withRates(raw.prior) : null
  const change = now?.retention_pct != null && prior?.retention_pct != null ? Math.round((now.retention_pct - prior.retention_pct) * 10) / 10 : null
  return {
    inactive_after_days: raw.inactive_after_days,
    now,
    prior,
    retention_change_points: change,
    went_quiet_count: raw.went_quiet_count,
    drifting_30_59_days: raw.drifting.days_30_59,
    drifting_60_89_days: raw.drifting.days_60_89,
  }
}

// ---------------------------------------------------------------------------
// Placement by carrier / product.

export type BreakdownRow = {
  label: string
  team: string | null
  premium: number
  funded: number
  policies: number
  paid: number
  declined: number
  lapsed: number
  pending: number
}

/** One breakdown row from either RPC; pending is derived when the RPC does not return it. */
export function toBreakdownRow(r: Record<string, unknown>): BreakdownRow {
  const policies = num(r.policies)
  const paid = num(r.paid)
  const declined = num(r.declined)
  const lapsed = num(r.lapsed)
  return {
    label: s(r.label) ?? 'Not recorded',
    team: s(r.team),
    premium: num(r.premium),
    funded: num(r.funded),
    policies,
    paid,
    declined,
    lapsed,
    pending: r.pending == null ? Math.max(0, policies - paid - declined - lapsed) : num(r.pending),
  }
}

export type PlacementFigures = {
  name: string
  applications: number
  issued: number
  lapsed: number
  declined: number
  pending: number
  placement_pct: number | null
  issue_pct: number | null
  decline_pct: number | null
  submitted_ap: number
  issued_ap: number
}

export function placementFigures(r: BreakdownRow): PlacementFigures {
  return {
    name: r.label,
    applications: r.policies,
    issued: r.paid,
    lapsed: r.lapsed,
    declined: r.declined,
    pending: r.pending,
    placement_pct: pct(r.paid, r.policies),
    issue_pct: pct(r.paid + r.lapsed, r.policies),
    decline_pct: pct(r.declined, r.policies),
    submitted_ap: Math.round(r.premium),
    issued_ap: Math.round(r.funded),
  }
}

/** Merge rows that share a label (Pinnacle's breakdown can split one carrier across teams). */
export function mergeByLabel(rows: BreakdownRow[]): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>()
  for (const r of rows) {
    const k = r.label.trim().toLowerCase()
    const cur = map.get(k)
    if (!cur) map.set(k, { ...r, team: null })
    else {
      cur.premium += r.premium
      cur.funded += r.funded
      cur.policies += r.policies
      cur.paid += r.paid
      cur.declined += r.declined
      cur.lapsed += r.lapsed
      cur.pending += r.pending
    }
  }
  return [...map.values()]
}

export function breakdownTotals(rows: BreakdownRow[]) {
  const t = rows.reduce(
    (a, r) => ({ policies: a.policies + r.policies, paid: a.paid + r.paid, declined: a.declined + r.declined, lapsed: a.lapsed + r.lapsed, pending: a.pending + r.pending, premium: a.premium + r.premium, funded: a.funded + r.funded }),
    { policies: 0, paid: 0, declined: 0, lapsed: 0, pending: 0, premium: 0, funded: 0 },
  )
  const f = placementFigures({ label: 'All', team: null, ...t })
  const { name: _n, ...rest } = f
  return rest
}

/**
 * Placement rows. order 'volume' (default) lists the biggest first; 'top' /
 * 'bottom' rank on placement among rows with at least minApps applications.
 */
export function placementTable(rows: BreakdownRow[], opts: { order?: 'volume' | 'top' | 'bottom'; limit?: number; minApps?: number } = {}) {
  const minApps = opts.minApps ?? MIN_BREAKDOWN_APPS
  const limit = Math.max(1, Math.min(opts.limit ?? 15, 50))
  const all = mergeByLabel(rows).filter((r) => r.policies > 0)
  const big = all.filter((r) => r.policies >= minApps)
  const byPlacement = [...big].sort((a, b) => b.paid / b.policies - a.paid / a.policies || b.policies - a.policies)
  const order = opts.order ?? 'volume'
  const list = order === 'volume' ? [...all].sort((a, b) => b.policies - a.policies || a.label.localeCompare(b.label)) : order === 'top' ? byPlacement : [...byPlacement].reverse()
  return {
    rows: list.slice(0, limit).map(placementFigures),
    count: all.length,
    highest_placement: byPlacement[0] ? placementFigures(byPlacement[0]) : null,
    lowest_placement: byPlacement.length > 1 ? placementFigures(byPlacement[byPlacement.length - 1]) : null,
    ranked_on_rate_min_applications: minApps,
    too_small_to_rank: all.length - big.length,
  }
}

// ---------------------------------------------------------------------------
// Pending lag: when does a recent window's placement mislead.

export type CurvePoint = { week: number; apps: number; pending: number }
export type Maturity = { basis: 'effective_date' | 'submitted_on'; curve: CurvePoint[]; median_issue_days: number | null; p90_issue_days: number | null; issued_sample: number }

export function toMaturity(v: unknown): Maturity {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const curve = (Array.isArray(r.curve) ? (r.curve as Record<string, unknown>[]) : []).map((c) => ({ week: num(c.week), apps: num(c.apps), pending: num(c.pending) }))
  const med = r.median_issue_days == null ? null : Math.round(num(r.median_issue_days))
  const p90 = r.p90_issue_days == null ? null : Math.round(num(r.p90_issue_days))
  return { basis: r.basis === 'submitted_on' ? 'submitted_on' : 'effective_date', curve, median_issue_days: med, p90_issue_days: p90, issued_sample: num(r.issued_sample) }
}

/**
 * Days after which apps have mostly settled: the first age (in whole weeks)
 * whose bucket is under SETTLED_PENDING_PCT pending and from which all older
 * apps together are too (so one noisy old bucket cannot stretch the lag).
 * Buckets with too few apps are skipped. 0 when even this week's apps are settled.
 */
export function settleDays(curve: CurvePoint[], threshold = SETTLED_PENDING_PCT, minApps = MIN_CURVE_APPS): number {
  const sorted = [...curve].sort((a, b) => a.week - b.week)
  if (!sorted.some((c) => c.apps >= minApps)) return 0
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    if (c.apps < minApps || (c.pending / c.apps) * 100 >= threshold) continue
    const tail = sorted.slice(i).reduce((a, x) => ({ apps: a.apps + x.apps, pending: a.pending + x.pending }), { apps: 0, pending: 0 })
    if ((tail.pending / tail.apps) * 100 < threshold) return c.week * 7
  }
  return (sorted[sorted.length - 1].week + 1) * 7
}

/**
 * The lag that decides whether a window is too fresh: the settle age from
 * the pending curve. The real median submit-to-issue days rides along when
 * the book records issue dates (tenant books; Pinnacle has no issue date).
 */
export function lagDays(m: Maturity): { days: number; median_issue_days: number | null } {
  return { days: settleDays(m.curve), median_issue_days: m.median_issue_days != null && m.issued_sample >= MIN_CURVE_APPS ? m.median_issue_days : null }
}

/**
 * The same question asked of apps old enough to have settled: the window
 * cut at today minus the settle lag, or (when that leaves under a week) a
 * window of the same length ending there.
 */
export function matureWindow(win: Window, todayIso: string, settle: number): Window {
  const cutoff = addDays(todayIso, -settle)
  if (win.end <= cutoff) return win
  if (daysBetween(win.start, cutoff) >= 6) return { start: win.start, end: cutoff }
  return { start: addDays(cutoff, -daysBetween(win.start, win.end)), end: cutoff }
}

/**
 * A lag note only when it matters: a window of a quarter or less that
 * reaches into the last `settle` days, with enough of its apps still pending
 * to move the rate. Longer or settled windows get nothing (executives know same-day apps are not issued).
 */
export function lagNote(o: { window: Window; todayIso: string; settle: number; pending: number; applications: number }): string | null {
  if (o.settle <= 0 || o.applications <= 0) return null
  if (o.window.end < addDays(o.todayIso, -o.settle)) return null
  // Long windows (more than a quarter) are not "recent": no note.
  if (daysBetween(o.window.start, o.window.end) + 1 > Math.max(LAG_NOTE_MAX_WINDOW_DAYS, 3 * o.settle)) return null
  const share = (o.pending / o.applications) * 100
  if (share < SETTLED_PENDING_PCT) return null
  return `${o.pending.toLocaleString('en-US')} of ${o.applications.toLocaleString('en-US')} applications (${Math.round(share)}%) are still pending; apps here usually settle within about ${o.settle} days, so placement for this window will rise.`
}
