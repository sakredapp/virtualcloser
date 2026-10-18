/**
 * Ciao tool: producer (agent) production (QA gap #1, 2026-10-18).
 *
 *  - producer_production  "top producers this month", "who's behind",
 *    "how is Dana Reyes doing", "who dropped vs last month", "new agents"
 *
 * Office-staff tools (top_performers, employee_quota) cover employees on the
 * payroll; this one covers the producers who write the book. Read only.
 * Executive-only: not in EMPLOYEE_TOOLS (lib/agent/access, deny by default),
 * and refused for assistants. Which book and who may read it: lib/book/access.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { canSeeBook } from '@/lib/book/access'
import { asBookLine, bookStatus, fetchBookBreakdown, fetchMaturity, fetchProducers, fetchRetention, type BookLine } from '@/lib/book/data'
import { loadPeopleStats } from '@/lib/pinnacle/people'
import {
  breakdownTotals,
  lagDays,
  lagNote,
  matureWindow,
  placementTable,
  retentionSummary,
  type Maturity,
} from '@/lib/book/retention'
import type { Window } from '@/lib/book/production'
import {
  METRIC_LABEL,
  MIN_RATE_POLICIES,
  PERIODS,
  METRICS,
  SLIP_DROP_PCT,
  SLIP_MIN_POLICY_STEP,
  SLIP_MIN_PRIOR_AP,
  asMetric,
  asPeriodKey,
  figures,
  filterTeam,
  findProducer,
  newProducers,
  rankOf,
  rankProducers,
  resolvePeriod,
  risingProducers,
  slippingProducers,
  totals,
} from '@/lib/book/production'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

export const NOT_SET_UP =
  'No producer book is connected to this account yet, so there are no agent production numbers to read. Once the book (agents and their policies) is connected, I can rank producers, flag who is slipping and list new agents.'

const VIEWS = ['rank', 'detail', 'slipping', 'new', 'retention', 'placement'] as const
type View = (typeof VIEWS)[number]

const NOTE = 'Use only these figures. AP = annual premium. Say the period and data_through. Never invent a producer, a number or a goal that is not here.'

const handle_producer_production: Handler = async (ctx, args) => {
  if (ctx.selfOnly) return j({ ok: false, say: 'Producer production is only available to the executive team.' })
  if (!canSeeBook(ctx.caller, ctx.tenant)) return j({ ok: false, say: 'Producer production is only available to the executive team, not to assistants.' })

  const status = await bookStatus(ctx.tenant.id)
  if (!status.connected) return j({ ok: true, has_data: false, not_set_up: true, say: NOT_SET_UP })

  const view: View = (VIEWS as readonly string[]).includes(String(args.view)) ? (args.view as View) : args.producer ? 'detail' : 'rank'
  const defaultPeriod = view === 'new' || view === 'retention' || view === 'placement' ? 'last_90' : 'mtd'
  const period = resolvePeriod(asPeriodKey(args.period ?? defaultPeriod), ctx.todayIso, { start: args.start, end: args.end })
  const line = asBookLine(args.line)
  const team = typeof args.team === 'string' ? args.team : null
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50))
  const base = { ok: true, has_data: true, view, period: period.label, window: { start: period.start, end: period.end }, line, ...(team ? { team } : {}), data_through: status.data_through, note: NOTE }

  if (view === 'detail') {
    const name = typeof args.producer === 'string' ? args.producer.trim() : ''
    if (!name) return j({ ok: false, say: 'Which producer? Give me a name.' })
    const [nowAll, priorAll] = await Promise.all([fetchProducers(ctx.tenant.id, period, { line }), fetchProducers(ctx.tenant.id, period.prior, { line })])
    let { match, candidates } = findProducer(nowAll, name)
    let inWindow = true
    if (!match) {
      // No business this window: look them up by name anywhere so "no production" is said plainly.
      const named = await fetchProducers(ctx.tenant.id, { start: '2000-01-01', end: ctx.todayIso }, { line, name })
      const hit = findProducer(named, name)
      if (hit.match) {
        match = { ...hit.match, premium: 0, funded: 0, policies: 0, paid: 0, declined: 0, lapsed: 0, pending: 0 }
        inWindow = false
      } else if (!candidates.length) candidates = hit.candidates
    }
    if (!match) {
      return j({ ...base, found: false, candidates, say: candidates.length ? `More than one producer matches "${name}": ${candidates.join(', ')}. Which one?` : `No producer named "${name}" is in the book.` })
    }
    const prior = findProducer(priorAll, match.name).match
    const r = rankOf(nowAll, match.name)
    return j({
      ...base,
      found: true,
      producer: figures(match),
      ...(inWindow ? {} : { no_business_in_period: true }),
      rank_on_submitted_ap: r ? { rank: r.rank, of_producers_writing: r.of } : null,
      prior_period: period.priorLabel,
      prior: prior ? figures(prior) : null,
      ap_change_pct: prior && prior.premium > 0 ? Math.round(((match.premium - prior.premium) / prior.premium) * 1000) / 10 : null,
    })
  }

  if (view === 'slipping') {
    const [now, prior] = await Promise.all([fetchProducers(ctx.tenant.id, period, { line }), fetchProducers(ctx.tenant.id, period.prior, { line })])
    const n = filterTeam(now, team)
    const p = filterTeam(prior, team)
    const { slipping, went_quiet } = slippingProducers(n, p, limit)
    return j({
      ...base,
      compared_with: period.priorLabel,
      rule: `Submitted AP down ${SLIP_DROP_PCT}%+ from at least $${SLIP_MIN_PRIOR_AP.toLocaleString('en-US')}, or applications down ${SLIP_MIN_POLICY_STEP}+ and ${SLIP_DROP_PCT}%+.`,
      totals_now: totals(n),
      totals_prior: totals(p),
      slipping,
      slipping_count: slipping.length,
      went_quiet,
      rising: risingProducers(n, p, 5),
      ...(period.key === 'mtd' || period.key === 'qtd' || period.key === 'ytd' ? { caution: 'A to-date window: recent applications may not be entered yet.' } : {}),
    })
  }

  if (view === 'new') {
    const rows = filterTeam(await fetchProducers(ctx.tenant.id, period, { line }), team)
    const fresh = newProducers(rows, period)
    return j({
      ...base,
      definition: status.source === 'tenant' ? 'Contracted in the window, or first application in the window.' : 'First application in the book falls in the window (the book has no contracting dates).',
      new_producers: fresh.slice(0, limit),
      new_count: fresh.length,
      new_submitted_ap: Math.round(fresh.reduce((s, r) => s + r.submitted_ap, 0)),
      writing_count: rows.filter((r) => r.policies > 0).length,
    })
  }

  if (view === 'retention') {
    const raw = await fetchRetention(ctx.tenant.id, period, period.prior, ctx.todayIso, { line, team, limit })
    const sum = retentionSummary(raw)
    const page = status.source === 'pinnacle' && !team && line === 'All' ? await teamPageHeadline() : null
    return j({
      ...base,
      data_through: raw.data_through ?? status.data_through,
      compared_with: period.priorLabel,
      definition: RETENTION_DEFINITION,
      ...sum,
      went_quiet: raw.went_quiet.slice(0, limit),
      reactivated_agents: raw.reactivated_agents.slice(0, limit),
      drifting_top: raw.drifting.top.slice(0, limit),
      ...(page ? { team_page: page } : {}),
    })
  }

  if (view === 'placement') {
    const by = args.by === 'product' ? 'product' : 'carrier'
    const order = args.order === 'top' || args.order === 'bottom' ? args.order : 'volume'
    const maturity = await fetchMaturity(ctx.tenant.id, ctx.todayIso, { line }).catch(() => null)
    const lag = maturity ? lagDays(maturity) : null
    const mature = args.mature === true && lag ? matureWindow(period, ctx.todayIso, lag.days) : null
    const win: Window = mature ?? period
    const rows = await fetchBookBreakdown(ctx.tenant.id, by, win, { line })
    const table = placementTable(rows, { order, limit })
    const tot = breakdownTotals(rows)
    const timing = mature ? null : await lagBlock(ctx.tenant.id, by, period, ctx.todayIso, line, maturity, tot)
    return j({
      ...base,
      ...(mature ? { period: `${period.label}, mature apps only (${mature.start} to ${mature.end})`, window: mature, mature_cohort: true, mature_note: lag!.days > 0 ? `Applications at least ${lag!.days} days old, so pending apps have mostly settled.` : 'Apps here settle within the first week, so this window is already mature.' } : {}),
      by,
      order,
      definition: PLACEMENT_DEFINITION,
      totals: tot,
      [by === 'carrier' ? 'carriers' : 'products']: table.rows,
      [by === 'carrier' ? 'carrier_count' : 'product_count']: table.count,
      highest_placement: table.highest_placement,
      lowest_placement: table.lowest_placement,
      ranked_on_rate_min_applications: table.ranked_on_rate_min_applications,
      ...(table.too_small_to_rank ? { too_small_to_rank: table.too_small_to_rank } : {}),
      ...(timing ?? {}),
      ...(status.source === 'pinnacle' && line !== 'Health' ? { scope_note: PINNACLE_UNDATED_NOTE } : {}),
    })
  }

  // rank
  const metric = asMetric(args.metric)
  const order = args.order === 'bottom' ? 'bottom' : 'top'
  const minApps = Math.max(0, Number(args.min_applications) || 0)
  const rows = filterTeam(await fetchProducers(ctx.tenant.id, period, { line }), team).filter((r) => r.policies >= minApps)
  const { ranked, skipped_small, considered } = rankProducers(rows, metric, { order, limit })
  const tot = totals(rows)
  let timing: Record<string, unknown> | null = null
  if (metric === 'placement') {
    const maturity = await fetchMaturity(ctx.tenant.id, ctx.todayIso, { line }).catch(() => null)
    const lag = maturity ? lagDays(maturity) : null
    const note = lag ? lagNote({ window: period, todayIso: ctx.todayIso, settle: lag.days, pending: rows.reduce((s, r) => s + r.pending, 0), applications: tot.applications }) : null
    if (note && lag) timing = { lag_note: note, lag_days: lag.days, ...(lag.median_issue_days != null ? { median_issue_days: lag.median_issue_days } : {}), mature_window: matureWindow(period, ctx.todayIso, lag.days) }
  }
  return j({
    ...base,
    metric: METRIC_LABEL[metric],
    order,
    totals: tot,
    producers_considered: considered,
    ranked,
    ...(skipped_small ? { skipped_too_few_policies: skipped_small, rate_minimum: MIN_RATE_POLICIES } : {}),
    ...(timing ?? {}),
    ...(order === 'bottom' ? { caution: 'Bottom of the list among producers who wrote something in the window; producers with no business are not listed (use view slipping for drops).' } : {}),
  })
}

const RETENTION_DEFINITION =
  'Same rules as the Team page: an agent is active while they have written a policy (not declined) in the last 90 days. They stop when 90 days pass with no policy (or earlier, if marked inactive, terminated or released in that gap). ' +
  'retention_pct = of the agents active the day before the window, the share still active at its end. reactivated = wrote again after a 90+ day gap. drifting = still active but no policy for 30 to 89 days.'
const PLACEMENT_DEFINITION =
  'placement_pct = issued / applications (the dashboard figure). issue_pct also counts policies that issued and later lapsed. decline_pct = declined / applications. Pending apps count in applications.'
const PINNACLE_UNDATED_NOTE = 'Life applications with no effective date yet (mostly pending or declined) are not in these counts.'

/** The Team page's own retention headline (Pinnacle), so Ciao and the page say the same thing. */
async function teamPageHeadline() {
  const ps = await loadPeopleStats().catch(() => null)
  const d = ps?.data
  if (!d) return null
  const m10 = d.retention?.milestones?.m10
  const t = d.retention?.turnover
  return {
    as_of: d.today,
    writing_last_30_days: d.writing30,
    writing_last_90_days: d.writing90,
    ...(m10 && m10.n > 0 ? { still_writing_at_10_months_pct: Math.round((m10.writing / m10.n) * 1000) / 10, ten_month_cohort: m10.n } : {}),
    ...(t ? { turnover: { from: t.from, to: t.to, left: t.left, avg_headcount: t.avg_headcount, months: t.months } } : {}),
  }
}

/** The lag note and the mature-cohort figure, only when pending apps materially skew this window. */
async function lagBlock(
  tenantId: string,
  by: 'carrier' | 'product',
  period: Window,
  todayIso: string,
  line: BookLine,
  maturity: Maturity | null,
  tot: ReturnType<typeof breakdownTotals>,
): Promise<Record<string, unknown> | null> {
  if (!maturity) return null
  const lag = lagDays(maturity)
  const note = lagNote({ window: period, todayIso, settle: lag.days, pending: tot.pending, applications: tot.applications })
  if (!note) return null
  const mw = matureWindow(period, todayIso, lag.days)
  const matureRows = await fetchBookBreakdown(tenantId, by, mw, { line })
  const mt = breakdownTotals(matureRows)
  return {
    lag_note: note,
    lag_days: lag.days,
    lag_basis: 'age after which under 5% of apps are still pending',
    ...(lag.median_issue_days != null ? { median_issue_days: lag.median_issue_days } : {}),
    mature_cohort: { window: mw, applications: mt.applications, placement_pct: mt.placement_pct, issue_pct: mt.issue_pct, pending: mt.pending },
  }
}

export const CXO_PRODUCER_TOOL_HANDLERS: Record<string, Handler> = {
  producer_production: handle_producer_production,
}

export const PRODUCER_PRODUCTION_TOOL: AI.Tool = {
  name: 'producer_production',
  description:
    'Producer (agent) production from the book of business: the agents who write policies, not office staff. ' +
    'Views: rank ("top producers this month", "who wrote the most AP", "lowest placement", "rank agents by issued premium"), ' +
    'detail ("how is <agent> doing", one producer vs the prior period and their rank), ' +
    'slipping ("which agents are behind", "who dropped vs last month", "who went quiet"), ' +
    'new ("new agents", "who started writing this quarter", recruiting), ' +
    'retention ("agent retention", "how many agents stopped selling", "who went quiet", "retention vs last quarter", "reactivated agents"; same rules as the Team page: active = a policy in the last 90 days), ' +
    'placement ("placement by carrier", "which carrier places best", "issue rate by product"; by carrier or product, mature: true for apps old enough to have settled). ' +
    'Metrics: submitted AP, issued AP, applications, issued policies, placement rate, persistency. Filter by period, product line and agency/team. ' +
    'Executive team only. Use only its figures. If it says not set up, say so plainly and do not guess. ' +
    'Office employees, their quotas and bonuses are top_performers / employee_quota, not this.',
  input_schema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: [...VIEWS], description: 'rank (default), detail (needs producer), slipping (vs the prior period), new (new producers), retention (agents active, stopped, retained vs the prior period, who went quiet), placement (placement and issue rate by carrier or product).' },
      period: { type: 'string', enum: [...PERIODS], description: 'Default mtd (new, retention and placement default to last_90). Always pass the period the user names: "this month" = mtd, "this quarter" = qtd, "last 6 months" = last_6m. To-date periods compare with the same span of the prior period. custom needs start and end.' },
      start: { type: 'string', description: 'custom period start, YYYY-MM-DD.' },
      end: { type: 'string', description: 'custom period end, YYYY-MM-DD.' },
      metric: { type: 'string', enum: [...METRICS], description: 'rank only. Default submitted_ap. placement = issued / applications; persistency = issued not lapsed.' },
      order: { type: 'string', enum: ['top', 'bottom'], description: 'rank: bottom = lowest first. placement: top/bottom ranks carriers on placement rate (default lists the biggest first).' },
      by: { type: 'string', enum: ['carrier', 'product'], description: 'placement only. Default carrier.' },
      mature: { type: 'boolean', description: 'placement only: use only applications old enough that pending apps have settled (the mature cohort).' },
      line: { type: 'string', enum: ['All', 'Health', 'Life', 'Annuity'], description: 'Product line. Default All.' },
      team: { type: 'string', description: 'Agency / team name (partial match).' },
      producer: { type: 'string', description: 'detail only: the producer name (partial ok).' },
      min_applications: { type: 'number', description: 'rank only: skip producers with fewer applications.' },
      limit: { type: 'number', description: 'How many to list, default 10, max 50. Use 50 for a full list or a sheet export.' },
    },
    required: ['view', 'period'],
    additionalProperties: false,
  },
}
