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
import { asBookLine, bookStatus, fetchProducers } from '@/lib/book/data'
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

const VIEWS = ['rank', 'detail', 'slipping', 'new'] as const
type View = (typeof VIEWS)[number]

const NOTE = 'Use only these figures. AP = annual premium. Say the period and data_through. Never invent a producer, a number or a goal that is not here.'

const handle_producer_production: Handler = async (ctx, args) => {
  if (ctx.selfOnly) return j({ ok: false, say: 'Producer production is only available to the executive team.' })
  if (!canSeeBook(ctx.caller, ctx.tenant)) return j({ ok: false, say: 'Producer production is only available to the executive team, not to assistants.' })

  const status = await bookStatus(ctx.tenant.id)
  if (!status.connected) return j({ ok: true, has_data: false, not_set_up: true, say: NOT_SET_UP })

  const view: View = (VIEWS as readonly string[]).includes(String(args.view)) ? (args.view as View) : args.producer ? 'detail' : 'rank'
  const period = resolvePeriod(asPeriodKey(args.period ?? (view === 'new' ? 'last_90' : 'mtd')), ctx.todayIso, { start: args.start, end: args.end })
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

  // rank
  const metric = asMetric(args.metric)
  const order = args.order === 'bottom' ? 'bottom' : 'top'
  const minApps = Math.max(0, Number(args.min_applications) || 0)
  const rows = filterTeam(await fetchProducers(ctx.tenant.id, period, { line }), team).filter((r) => r.policies >= minApps)
  const { ranked, skipped_small, considered } = rankProducers(rows, metric, { order, limit })
  return j({
    ...base,
    metric: METRIC_LABEL[metric],
    order,
    totals: totals(rows),
    producers_considered: considered,
    ranked,
    ...(skipped_small ? { skipped_too_few_policies: skipped_small, rate_minimum: MIN_RATE_POLICIES } : {}),
    ...(order === 'bottom' ? { caution: 'Bottom of the list among producers who wrote something in the window; producers with no business are not listed (use view slipping for drops).' } : {}),
  })
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
    'new ("new agents", "who started writing this quarter", recruiting). ' +
    'Metrics: submitted AP, issued AP, applications, issued policies, placement rate, persistency. Filter by period, product line and agency/team. ' +
    'Executive team only. Use only its figures. If it says not set up, say so plainly and do not guess. ' +
    'Office employees, their quotas and bonuses are top_performers / employee_quota, not this.',
  input_schema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: [...VIEWS], description: 'rank (default), detail (needs producer), slipping (vs the prior period), new (new producers).' },
      period: { type: 'string', enum: [...PERIODS], description: 'Default mtd (new defaults to last_90). To-date periods compare with the same span of the prior period. custom needs start and end.' },
      start: { type: 'string', description: 'custom period start, YYYY-MM-DD.' },
      end: { type: 'string', description: 'custom period end, YYYY-MM-DD.' },
      metric: { type: 'string', enum: [...METRICS], description: 'rank only. Default submitted_ap. placement = issued / applications; persistency = issued not lapsed.' },
      order: { type: 'string', enum: ['top', 'bottom'], description: 'rank only. bottom = lowest first.' },
      line: { type: 'string', enum: ['All', 'Health', 'Life', 'Annuity'], description: 'Product line. Default All.' },
      team: { type: 'string', description: 'Agency / team name (partial match).' },
      producer: { type: 'string', description: 'detail only: the producer name (partial ok).' },
      min_applications: { type: 'number', description: 'rank only: skip producers with fewer applications.' },
      limit: { type: 'number', description: 'How many to list, default 10, max 50. Use 50 for a full list or a sheet export.' },
    },
    additionalProperties: false,
  },
}
