/**
 * Producer (agent) production: the pure math behind Ciao's
 * producer_production tool and the recurring production report.
 *
 * Rows come from either book (lib/book/data): Pinnacle's agent rollup or a
 * tenant's own cxo_book_* tables. Same shape either way:
 *   premium  submitted annual premium (AP) in the window
 *   funded   issued AP in the window
 *   policies applications written, paid = issued, declined, lapsed, pending
 * Placement = issued / written (same as the dashboard funnel). Lapse rate =
 * lapsed / (issued + lapsed); persistency is 100 minus that.
 *
 * Kept pure (no I/O) so every number is unit tested.
 */

export type ProducerRow = {
  name: string
  team: string | null
  premium: number
  funded: number
  policies: number
  paid: number
  declined: number
  lapsed: number
  pending: number
  /** First application anywhere in the book (ISO date), not just this window. */
  firstPolicy: string | null
  contractedAt: string | null
  status: string | null
}

export type Metric = 'submitted_ap' | 'issued_ap' | 'policies' | 'issued' | 'placement' | 'persistency'
export const METRICS: readonly Metric[] = ['submitted_ap', 'issued_ap', 'policies', 'issued', 'placement', 'persistency']
export const METRIC_LABEL: Record<Metric, string> = {
  submitted_ap: 'submitted AP',
  issued_ap: 'issued AP',
  policies: 'applications',
  issued: 'issued policies',
  placement: 'placement rate',
  persistency: 'persistency',
}

export type PeriodKey = 'mtd' | 'last_month' | 'qtd' | 'last_quarter' | 'ytd' | 'last_30' | 'last_90' | 'last_6m' | 'last_12m' | 'custom'
export const PERIODS: readonly PeriodKey[] = ['mtd', 'last_month', 'qtd', 'last_quarter', 'ytd', 'last_30', 'last_90', 'last_6m', 'last_12m', 'custom']

export type Window = { start: string; end: string }
export type Period = Window & { key: PeriodKey; label: string; prior: Window; priorLabel: string }

/** Rates need this many applications (or issued policies) before a producer is ranked on them. */
export const MIN_RATE_POLICIES = 5
/** Slipping: down at least this share of submitted AP vs the prior period... */
export const SLIP_DROP_PCT = 25
/** ...from a prior period worth at least this much (ignore tiny books). */
export const SLIP_MIN_PRIOR_AP = 5000
/** Or down at least this many applications and this share. */
export const SLIP_MIN_POLICY_STEP = 3

// ---------------------------------------------------------------------------
// Dates (UTC calendar arithmetic on ISO 'YYYY-MM-DD').

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const addDays = (s: string, n: number) => {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const monthStart = (y: number, m0: number) => iso(new Date(Date.UTC(y, m0, 1)))
const monthEnd = (y: number, m0: number) => iso(new Date(Date.UTC(y, m0 + 1, 0)))
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000)
/** Same day-of-month in a month `back` months earlier, clamped to that month's end. */
const sameDayMonthsBack = (s: string, back: number) => {
  const d = parse(s)
  const y = d.getUTCFullYear()
  const m0 = d.getUTCMonth() - back
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
  return iso(new Date(Date.UTC(y, m0, Math.min(d.getUTCDate(), last))))
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (s: string) => {
  const d = parse(s)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime())

export function asPeriodKey(v: unknown): PeriodKey {
  return typeof v === 'string' && (PERIODS as readonly string[]).includes(v) ? (v as PeriodKey) : 'mtd'
}
export function asMetric(v: unknown): Metric {
  return typeof v === 'string' && (METRICS as readonly string[]).includes(v) ? (v as Metric) : 'submitted_ap'
}

/**
 * The window for a period and the prior window it is compared against.
 * To-date periods compare with the same span of the period before (month to
 * date vs the same days last month), so a partial month is never judged
 * against a full one.
 */
export function resolvePeriod(key: PeriodKey, todayIso: string, custom?: { start?: unknown; end?: unknown }): Period {
  const t = parse(todayIso)
  const y = t.getUTCFullYear()
  const m0 = t.getUTCMonth()
  const q0 = Math.floor(m0 / 3) * 3
  const range = (start: string, end: string) => `${fmtDay(start)} to ${fmtDay(end)}`
  switch (key) {
    case 'last_month': {
      const start = monthStart(y, m0 - 1)
      const end = monthEnd(y, m0 - 1)
      const ps = monthStart(y, m0 - 2)
      const pe = monthEnd(y, m0 - 2)
      return { key, start, end, label: `${MONTHS[parse(start).getUTCMonth()]} ${parse(start).getUTCFullYear()}`, prior: { start: ps, end: pe }, priorLabel: `${MONTHS[parse(ps).getUTCMonth()]} ${parse(ps).getUTCFullYear()}` }
    }
    case 'qtd': {
      const start = monthStart(y, q0)
      const ps = monthStart(y, q0 - 3)
      const pe = addDays(ps, daysBetween(start, todayIso))
      return { key, start, end: todayIso, label: `quarter to date (${range(start, todayIso)})`, prior: { start: ps, end: pe }, priorLabel: `the same days last quarter (${range(ps, pe)})` }
    }
    case 'last_quarter': {
      const start = monthStart(y, q0 - 3)
      const end = monthEnd(y, q0 - 1)
      const ps = monthStart(y, q0 - 6)
      const pe = monthEnd(y, q0 - 4)
      return { key, start, end, label: `last quarter (${range(start, end)})`, prior: { start: ps, end: pe }, priorLabel: `the quarter before (${range(ps, pe)})` }
    }
    case 'ytd': {
      const start = monthStart(y, 0)
      const ps = monthStart(y - 1, 0)
      const pe = sameDayMonthsBack(todayIso, 12)
      return { key, start, end: todayIso, label: `year to date (${range(start, todayIso)})`, prior: { start: ps, end: pe }, priorLabel: `the same span last year (${range(ps, pe)})` }
    }
    case 'last_30':
    case 'last_90': {
      const n = key === 'last_30' ? 30 : 90
      const start = addDays(todayIso, -(n - 1))
      const pe = addDays(start, -1)
      const ps = addDays(pe, -(n - 1))
      return { key, start, end: todayIso, label: `the last ${n} days (${range(start, todayIso)})`, prior: { start: ps, end: pe }, priorLabel: `the ${n} days before (${range(ps, pe)})` }
    }
    case 'last_6m': {
      const start = addDays(sameDayMonthsBack(todayIso, 6), 1)
      const pe = addDays(start, -1)
      const ps = addDays(sameDayMonthsBack(pe, 6), 1)
      return { key, start, end: todayIso, label: `the last 6 months (${range(start, todayIso)})`, prior: { start: ps, end: pe }, priorLabel: `the 6 months before (${range(ps, pe)})` }
    }
    case 'last_12m': {
      const start = addDays(sameDayMonthsBack(todayIso, 12), 1)
      const pe = addDays(start, -1)
      const ps = addDays(sameDayMonthsBack(pe, 12), 1)
      return { key, start, end: todayIso, label: `the last 12 months (${range(start, todayIso)})`, prior: { start: ps, end: pe }, priorLabel: `the 12 months before (${range(ps, pe)})` }
    }
    case 'custom': {
      if (isIsoDate(custom?.start) && isIsoDate(custom?.end) && custom.start <= custom.end) {
        const start = custom.start
        const end = custom.end
        const len = daysBetween(start, end)
        const pe = addDays(start, -1)
        const ps = addDays(pe, -len)
        return { key, start, end, label: range(start, end), prior: { start: ps, end: pe }, priorLabel: `the ${len + 1} days before (${range(ps, pe)})` }
      }
      return resolvePeriod('mtd', todayIso)
    }
    case 'mtd':
    default: {
      const start = monthStart(y, m0)
      const ps = monthStart(y, m0 - 1)
      const pe = sameDayMonthsBack(todayIso, 1)
      return { key: 'mtd', start, end: todayIso, label: `month to date (${range(start, todayIso)})`, prior: { start: ps, end: pe }, priorLabel: `the same days last month (${range(ps, pe)})` }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-producer figures.

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

export function placementPct(r: Pick<ProducerRow, 'paid' | 'policies'>): number | null {
  return pct(r.paid, r.policies)
}
export function persistencyPct(r: Pick<ProducerRow, 'paid' | 'lapsed'>): number | null {
  const base = r.paid + r.lapsed
  return base > 0 ? Math.round((100 - (r.lapsed / base) * 100) * 10) / 10 : null
}

export function metricValue(r: ProducerRow, m: Metric): number | null {
  switch (m) {
    case 'submitted_ap':
      return r.premium
    case 'issued_ap':
      return r.funded
    case 'policies':
      return r.policies
    case 'issued':
      return r.paid
    case 'placement':
      return r.policies >= MIN_RATE_POLICIES ? placementPct(r) : null
    case 'persistency':
      return r.paid + r.lapsed >= MIN_RATE_POLICIES ? persistencyPct(r) : null
  }
}

export type ProducerFigures = {
  name: string
  team: string | null
  submitted_ap: number
  issued_ap: number
  applications: number
  issued: number
  declined: number
  lapsed: number
  pending: number
  placement_pct: number | null
  persistency_pct: number | null
  first_policy: string | null
  contracted_at?: string | null
  status?: string | null
}

export function figures(r: ProducerRow): ProducerFigures {
  return {
    name: r.name,
    team: r.team,
    submitted_ap: Math.round(r.premium),
    issued_ap: Math.round(r.funded),
    applications: r.policies,
    issued: r.paid,
    declined: r.declined,
    lapsed: r.lapsed,
    pending: r.pending,
    placement_pct: placementPct(r),
    persistency_pct: persistencyPct(r),
    first_policy: r.firstPolicy,
    ...(r.contractedAt ? { contracted_at: r.contractedAt } : {}),
    ...(r.status ? { status: r.status } : {}),
  }
}

export function totals(rows: ProducerRow[]) {
  const t = rows.reduce(
    (a, r) => ({
      submitted_ap: a.submitted_ap + r.premium,
      issued_ap: a.issued_ap + r.funded,
      applications: a.applications + r.policies,
      issued: a.issued + r.paid,
      declined: a.declined + r.declined,
      lapsed: a.lapsed + r.lapsed,
    }),
    { submitted_ap: 0, issued_ap: 0, applications: 0, issued: 0, declined: 0, lapsed: 0 },
  )
  return {
    producers_writing: rows.filter((r) => r.policies > 0).length,
    ...t,
    submitted_ap: Math.round(t.submitted_ap),
    issued_ap: Math.round(t.issued_ap),
    placement_pct: pct(t.issued, t.applications),
    persistency_pct: persistencyPct({ paid: t.issued, lapsed: t.lapsed }),
  }
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Team filter: case-insensitive substring on the agency/team name. */
/**
 * Pure: a to-date window (mtd, qtd, ytd) projected to its full length at the
 * current daily rate. Null for closed windows. Lets "are we on pace" and
 * "vs last month" be answered from figures, not mental arithmetic.
 */
export function paceProjection(key: PeriodKey, win: Window, t: { submitted_ap: number; applications: number }): { days_elapsed: number; days_in_period: number; projected_submitted_ap: number; projected_applications: number; period_end: string } | null {
  if (key !== 'mtd' && key !== 'qtd' && key !== 'ytd') return null
  const s = parse(win.start)
  const e = parse(win.end)
  const full = key === 'mtd'
    ? new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0))
    : key === 'qtd'
      ? new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, 0))
      : new Date(Date.UTC(s.getUTCFullYear(), 11, 31))
  const day = 86_400_000
  const elapsed = Math.round((e.getTime() - s.getTime()) / day) + 1
  const total = Math.round((full.getTime() - s.getTime()) / day) + 1
  if (elapsed <= 0 || total <= 0) return null
  const f = total / elapsed
  return {
    days_elapsed: elapsed,
    days_in_period: total,
    projected_submitted_ap: Math.round(t.submitted_ap * f),
    projected_applications: Math.round(t.applications * f),
    period_end: full.toISOString().slice(0, 10),
  }
}

/** Pure: percent change, one decimal; null when the base is zero. */
export function changePct(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null
}

export type AgencyTotal = { rank: number; agency: string; submitted_ap: number; issued_ap: number; applications: number; producers_writing: number; share_of_ap_pct: number }

/**
 * Pure: the book rolled up by agency (team), biggest submitted AP first, with
 * each agency's share. "Rank the agencies" is answered from this, never by
 * adding producer rows up in the reply.
 */
export function agencyTotals(rows: ProducerRow[], limit = 15): AgencyTotal[] {
  const by = new Map<string, ProducerRow[]>()
  for (const r of rows) {
    const k = (r.team ?? '').trim() || 'No agency'
    const list = by.get(k)
    if (list) list.push(r)
    else by.set(k, [r])
  }
  const all = rows.reduce((s, r) => s + r.premium, 0)
  return [...by.entries()]
    .map(([agency, list]) => {
      const t = totals(list)
      return { agency, submitted_ap: Math.round(t.submitted_ap), issued_ap: Math.round(t.issued_ap), applications: t.applications, producers_writing: t.producers_writing }
    })
    .filter((a) => a.applications > 0 || a.submitted_ap > 0)
    .sort((a, b) => b.submitted_ap - a.submitted_ap || b.applications - a.applications || a.agency.localeCompare(b.agency))
    .slice(0, Math.max(1, limit))
    .map((a, i) => ({ rank: i + 1, ...a, share_of_ap_pct: all > 0 ? Math.round((a.submitted_ap / all) * 1000) / 10 : 0 }))
}

export function filterTeam(rows: ProducerRow[], team: string | null | undefined): ProducerRow[] {
  const t = norm(team)
  return t ? rows.filter((r) => norm(r.team).includes(t)) : rows
}

// ---------------------------------------------------------------------------
// Views.

export type Ranked = ProducerFigures & { rank: number; value: number }

/**
 * Producers ranked by one metric, best first (or worst first with
 * order 'bottom'). Rates skip producers with too few applications to judge.
 */
export function rankProducers(
  rows: ProducerRow[],
  metric: Metric,
  opts: { order?: 'top' | 'bottom'; limit?: number } = {},
): { ranked: Ranked[]; skipped_small: number; considered: number; too_new_to_judge: TooNew | null } {
  const writing = rows.filter((r) => r.policies > 0 || r.premium > 0)
  // A rate over apps that are mostly still pending is not a placement rate:
  // an agent whose apps are all pending shows 0% and would top a "worst" list.
  const rated = metric === 'placement'
  const unsettled = rated ? writing.filter(isUnsettled) : []
  const pool = rated ? writing.filter((r) => !isUnsettled(r)) : writing
  const scored = pool.map((r) => ({ r, v: metricValue(r, metric) })).filter((x): x is { r: ProducerRow; v: number } => x.v != null)
  const dir = opts.order === 'bottom' ? 1 : -1
  scored.sort((a, b) => dir * (a.v - b.v) || b.r.premium - a.r.premium || a.r.name.localeCompare(b.r.name))
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
  return {
    ranked: scored.slice(0, limit).map((x, i) => ({ ...figures(x.r), rank: i + 1, value: x.v })),
    skipped_small: pool.length - scored.length,
    considered: writing.length,
    too_new_to_judge: unsettled.length
      ? {
          count: unsettled.length,
          rule: `More than ${Math.round(UNSETTLED_PENDING_SHARE * 100)}% of their applications in the window are still pending, so their rate is not settled. Not ranked; never call them worst or best.`,
          examples: [...unsettled]
            .sort((a, b) => b.policies - a.policies || a.name.localeCompare(b.name))
            .slice(0, 5)
            .map((r) => ({ name: r.name, applications: r.policies, pending: r.pending })),
        }
      : null,
  }
}

export type TooNew = { count: number; rule: string; examples: { name: string; applications: number; pending: number }[] }

/** Share of a producer's window applications still pending above which a placement rate is not ranked. */
export const UNSETTLED_PENDING_SHARE = 0.5

export function isUnsettled(r: Pick<ProducerRow, 'policies' | 'pending'>): boolean {
  return r.policies > 0 && r.pending / r.policies > UNSETTLED_PENDING_SHARE
}

/**
 * Pure: agencies from the book's team rollup (one row per team label), in the
 * same shape as agencyTotals. Used for Pinnacle so the figures are the
 * dashboard card's own. share_of_ap_pct is over the company total when given.
 */
export function agencyTotalsFromDim(
  rows: { label: string; premium: number; funded: number; policies: number }[],
  opts: { limit?: number; companyAp?: number } = {},
): Omit<AgencyTotal, 'producers_writing'>[] {
  const all = opts.companyAp ?? rows.reduce((s, r) => s + r.premium, 0)
  return rows
    .filter((r) => r.label && (r.policies > 0 || r.premium > 0))
    .map((r) => ({ agency: r.label, submitted_ap: Math.round(r.premium), issued_ap: Math.round(r.funded), applications: r.policies }))
    .sort((a, b) => b.submitted_ap - a.submitted_ap || b.applications - a.applications || a.agency.localeCompare(b.agency))
    .slice(0, Math.max(1, opts.limit ?? 15))
    .map((a, i) => ({ rank: i + 1, ...a, share_of_ap_pct: all > 0 ? Math.round((a.submitted_ap / all) * 1000) / 10 : 0 }))
}

export type Change = {
  name: string
  team: string | null
  now_submitted_ap: number
  prior_submitted_ap: number
  ap_change_pct: number | null
  now_applications: number
  prior_applications: number
  now_placement_pct: number | null
  prior_placement_pct: number | null
}

function pairByName(now: ProducerRow[], prior: ProducerRow[]) {
  const map = new Map<string, { name: string; team: string | null; now: ProducerRow | null; prior: ProducerRow | null }>()
  for (const r of now) map.set(norm(r.name), { name: r.name, team: r.team, now: r, prior: null })
  for (const r of prior) {
    const k = norm(r.name)
    const cur = map.get(k)
    if (cur) {
      cur.prior = r
      cur.team ??= r.team
    } else map.set(k, { name: r.name, team: r.team, now: null, prior: r })
  }
  return [...map.values()]
}

function change(p: { name: string; team: string | null; now: ProducerRow | null; prior: ProducerRow | null }): Change {
  const nowAp = Math.round(p.now?.premium ?? 0)
  const priorAp = Math.round(p.prior?.premium ?? 0)
  return {
    name: p.name,
    team: p.team,
    now_submitted_ap: nowAp,
    prior_submitted_ap: priorAp,
    ap_change_pct: priorAp > 0 ? Math.round(((nowAp - priorAp) / priorAp) * 1000) / 10 : null,
    now_applications: p.now?.policies ?? 0,
    prior_applications: p.prior?.policies ?? 0,
    now_placement_pct: p.now ? placementPct(p.now) : null,
    prior_placement_pct: p.prior ? placementPct(p.prior) : null,
  }
}

/**
 * Who is slipping vs the prior period: submitted AP down SLIP_DROP_PCT%+
 * from a prior period of at least SLIP_MIN_PRIOR_AP, or applications down
 * SLIP_MIN_POLICY_STEP+ and SLIP_DROP_PCT%+. Biggest dollar drop first.
 * Also returns who went quiet (business last period, none now).
 */
export function slippingProducers(now: ProducerRow[], prior: ProducerRow[], limit = 10): { slipping: Change[]; went_quiet: number } {
  const pairs = pairByName(now, prior)
  const out: Change[] = []
  let quiet = 0
  for (const p of pairs) {
    const c = change(p)
    const apDrop = c.prior_submitted_ap >= SLIP_MIN_PRIOR_AP && c.prior_submitted_ap > 0 && ((c.prior_submitted_ap - c.now_submitted_ap) / c.prior_submitted_ap) * 100 >= SLIP_DROP_PCT
    const step = c.prior_applications - c.now_applications
    const appDrop = step >= SLIP_MIN_POLICY_STEP && c.prior_applications > 0 && (step / c.prior_applications) * 100 >= SLIP_DROP_PCT
    if (apDrop || appDrop) {
      out.push(c)
      if (c.now_applications === 0) quiet++
    }
  }
  out.sort((a, b) => b.prior_submitted_ap - b.now_submitted_ap - (a.prior_submitted_ap - a.now_submitted_ap) || a.name.localeCompare(b.name))
  return { slipping: out.slice(0, Math.max(1, Math.min(limit, 50))), went_quiet: quiet }
}

/** Biggest gainers vs the prior period (for a balanced report). */
export function risingProducers(now: ProducerRow[], prior: ProducerRow[], limit = 5): Change[] {
  return pairByName(now, prior)
    .map(change)
    .filter((c) => c.now_submitted_ap > c.prior_submitted_ap && c.now_applications >= SLIP_MIN_POLICY_STEP)
    .sort((a, b) => b.now_submitted_ap - b.prior_submitted_ap - (a.now_submitted_ap - a.prior_submitted_ap) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(limit, 50)))
}

/**
 * New producers in the window: contracted in it (when the book records
 * contracting dates), or whose first application anywhere in the book falls
 * in it. Newest first.
 */
export function newProducers(rows: ProducerRow[], win: Window): (ProducerFigures & { new_because: 'contracted' | 'first_business' })[] {
  const inWin = (d: string | null) => !!d && d >= win.start && d <= win.end
  return rows
    .filter((r) => inWin(r.contractedAt) || inWin(r.firstPolicy))
    .map((r) => ({ ...figures(r), new_because: (inWin(r.contractedAt) ? 'contracted' : 'first_business') as 'contracted' | 'first_business' }))
    .sort((a, b) => (b.contracted_at ?? b.first_policy ?? '').localeCompare(a.contracted_at ?? a.first_policy ?? '') || a.name.localeCompare(b.name))
}

/** One producer by name: exact (case-insensitive) match wins, else substring matches. */
export function findProducer(rows: ProducerRow[], name: string): { match: ProducerRow | null; candidates: string[] } {
  const q = norm(name)
  if (!q) return { match: null, candidates: [] }
  const exact = rows.filter((r) => norm(r.name) === q)
  if (exact.length === 1) return { match: exact[0], candidates: [] }
  const partial = rows.filter((r) => norm(r.name).includes(q))
  if (partial.length === 1) return { match: partial[0], candidates: [] }
  const tokens = q.split(/\s+/).filter(Boolean)
  const byTokens = partial.length ? partial : rows.filter((r) => tokens.every((t) => norm(r.name).includes(t)))
  if (byTokens.length === 1) return { match: byTokens[0], candidates: [] }
  return { match: null, candidates: byTokens.slice(0, 8).map((r) => r.name) }
}

/** Where a producer stands in the book on submitted AP (1 = top). */
export function rankOf(rows: ProducerRow[], name: string): { rank: number; of: number } | null {
  const writing = rows.filter((r) => r.premium > 0).sort((a, b) => b.premium - a.premium)
  const i = writing.findIndex((r) => norm(r.name) === norm(name))
  return i < 0 ? null : { rank: i + 1, of: writing.length }
}

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
