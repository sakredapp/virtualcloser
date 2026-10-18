/**
 * Ciao tool: "what's slipping" (book-of-business execs only).
 *
 *  - whats_slipping   "which agency is slipping", "anything dropping this month"
 *
 * Same detector as the daily in-app alert (lib/pinnacle/slipping), so the
 * answer on demand and the morning notice never disagree. Read only.
 * Executive-only: not in EMPLOYEE_TOOLS (lib/agent/access, deny by default),
 * and offered only to Pinnacle-viewer tenants (lib/agent/tools).
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { Loader } from '@/lib/mcp/data'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { loadSlipInput, slipWindows } from '@/lib/pinnacle/slippingData'
import {
  AGENCY_DROP_PCT,
  COMPANY_PACE_DROP_PCT,
  MIN_BOOK_SHARE_PCT,
  PLACEMENT_DROP_PTS,
  detectSlipping,
  slipAttribution,
} from '@/lib/pinnacle/slipping'
import { fetchProducers } from '@/lib/book/data'
import { slippingProducers, SLIP_DROP_PCT, SLIP_MIN_PRIOR_AP } from '@/lib/book/production'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

export const SLIP_RULES =
  `Company premium month to date down ${COMPANY_PACE_DROP_PCT}%+ vs the same days last month; ` +
  `an agency or carrier down ${AGENCY_DROP_PCT}%+ (only books at least ${MIN_BOOK_SHARE_PCT}% of the company); ` +
  `placement down ${PLACEMENT_DROP_PTS}+ points, last full month vs the month before.`

/** Agents writing less over the same days (the producer_production slipping rule), top few by dollar drop. */
async function slippingAgents(tenantId: string, today: string, through: number) {
  if (through <= 0) return null
  const w = slipWindows(today, through)
  const [now, prior] = await Promise.all([fetchProducers(tenantId, w.now), fetchProducers(tenantId, w.prior)])
  const { slipping, went_quiet } = slippingProducers(now, prior, 5)
  const all = slippingProducers(now, prior, 50)
  return {
    rule: `Submitted AP down ${SLIP_DROP_PCT}%+ from at least $${SLIP_MIN_PRIOR_AP.toLocaleString('en-US')} (or applications down sharply), same days.`,
    count_at_least: all.slipping.length,
    went_quiet,
    top: slipping.map((c) => ({ name: c.name, agency: c.team, now_submitted_ap: c.now_submitted_ap, prior_submitted_ap: c.prior_submitted_ap, ap_change_pct: c.ap_change_pct, now_applications: c.now_applications, prior_applications: c.prior_applications })),
  }
}

const handle_whats_slipping: Handler = async (ctx) => {
  if (ctx.selfOnly) return j({ ok: false, say: 'That is only available to the executive team.' })
  if (!pinnacleAllowed(ctx.tenant.id)) return j({ ok: false, say: 'No book of business is connected to this account yet.' })
  const L = new Loader(ctx.tenant)
  // Everything in one parallel go: series + breakdowns (inside loadSlipInput), freshness and the agent
  // reads, which assume data through today and are redone only if the book stops earlier.
  const guess = Number(L.today.slice(8, 10))
  const agentsEarly = slippingAgents(ctx.tenant.id, L.today, guess).catch(() => null)
  const [input, fresh] = await Promise.all([loadSlipInput(L), L.freshness().catch(() => null)])
  if (!input) return j({ ok: true, ...fresh, items: [], rules: SLIP_RULES, summary: 'No book numbers to compare yet this month.' })
  const items = detectSlipping(input)
  const agents = input.daysCompared === guess ? await agentsEarly : await slippingAgents(ctx.tenant.id, L.today, input.daysCompared).catch(() => null)
  const attribution = slipAttribution(input)
  const w = input.daysCompared > 0 ? slipWindows(L.today, input.daysCompared) : null
  return j({
    ok: true,
    ...fresh,
    days_compared: input.daysCompared,
    ...(w ? { compared: { this_month: w.now, same_days_last_month: w.prior } } : {}),
    base_period_note: 'Every share and percent here is against the same days last month (base period), not a full month. Say so when you give a share.',
    rules: SLIP_RULES,
    items: items.map(({ kind, name, drop_pct, drop_pts, now, prior, line, share_of_base_pct, share_of_company_drop_pct }) => ({ kind, name, drop_pct, drop_pts, now, prior, share_of_base_pct, share_of_company_drop_pct, line })),
    ...(attribution ? { attribution } : {}),
    ...(agents && agents.top.length ? { slipping_agents: agents } : {}),
    summary: items.length ? items.map((i) => i.line).join(' ') : `Nothing is slipping by these rules: ${SLIP_RULES}`,
    note: 'Read the items as given, worst first, then the top slipping agents by name. When you name carriers or agencies behind a drop, give the share of the drop they explain (attribution). Never add a number that is not here. Say the as-of time.',
  })
}

export const CXO_SLIPPING_TOOL_HANDLERS: Record<string, Handler> = {
  whats_slipping: handle_whats_slipping,
}

export const WHATS_SLIPPING_TOOL: AI.Tool = {
  name: 'whats_slipping',
  description:
    'What is slipping in the book right now: "which agency is slipping", "is anything dropping", "what should I worry about this month", "any carrier falling off". Checks company pace (month to date vs the same days last month), every agency and carrier with a meaningful book, and placement; returns at most 3 items, worst first, each with a ready line, plus how much of the company drop the biggest carriers and agencies explain (attribution) and the top slipping agents. Same check as the daily alert. Executive team only. Use only its figures. Not who is using the app (team_adoption) and not plan vs actual (plan_pacing).',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}
