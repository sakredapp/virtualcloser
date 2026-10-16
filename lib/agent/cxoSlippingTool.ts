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
import { loadSlipInput } from '@/lib/pinnacle/slippingData'
import {
  AGENCY_DROP_PCT,
  COMPANY_PACE_DROP_PCT,
  MIN_BOOK_SHARE_PCT,
  PLACEMENT_DROP_PTS,
  detectSlipping,
} from '@/lib/pinnacle/slipping'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

export const SLIP_RULES =
  `Company premium month to date down ${COMPANY_PACE_DROP_PCT}%+ vs the same days last month; ` +
  `an agency or carrier down ${AGENCY_DROP_PCT}%+ (only books at least ${MIN_BOOK_SHARE_PCT}% of the company); ` +
  `placement down ${PLACEMENT_DROP_PTS}+ points, last full month vs the month before.`

const handle_whats_slipping: Handler = async (ctx) => {
  if (ctx.selfOnly) return j({ ok: false, say: 'That is only available to the executive team.' })
  if (!pinnacleAllowed(ctx.tenant.id)) return j({ ok: false, say: 'No book of business is connected to this account yet.' })
  const L = new Loader(ctx.tenant)
  const [input, fresh] = await Promise.all([loadSlipInput(L), L.freshness().catch(() => null)])
  if (!input) return j({ ok: true, ...fresh, items: [], rules: SLIP_RULES, summary: 'No book numbers to compare yet this month.' })
  const items = detectSlipping(input)
  return j({
    ok: true,
    ...fresh,
    days_compared: input.daysCompared,
    rules: SLIP_RULES,
    items: items.map(({ kind, name, drop_pct, drop_pts, now, prior, line }) => ({ kind, name, drop_pct, drop_pts, now, prior, line })),
    summary: items.length ? items.map((i) => i.line).join(' ') : `Nothing is slipping by these rules: ${SLIP_RULES}`,
    note: 'Read the items as given, worst first. Never add a number that is not here. Say the as-of time.',
  })
}

export const CXO_SLIPPING_TOOL_HANDLERS: Record<string, Handler> = {
  whats_slipping: handle_whats_slipping,
}

export const WHATS_SLIPPING_TOOL: AI.Tool = {
  name: 'whats_slipping',
  description:
    'What is slipping in the book right now: "which agency is slipping", "is anything dropping", "what should I worry about this month", "any carrier falling off". Checks company pace (month to date vs the same days last month), every agency and carrier with a meaningful book, and placement; returns at most 3 items, worst first, each with a ready line. Same check as the daily alert. Executive team only. Use only its figures. Not who is using the app (team_adoption) and not plan vs actual (plan_pacing).',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}
