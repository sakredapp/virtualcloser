/**
 * Mira tool for adoption (Suite CXO), read only.
 *
 *  - team_adoption   "who hasn't logged in this week", "how is adoption"
 *
 * Reads the same daily usage counts as Settings › Adoption. Owner and admins
 * only, the caller's own org only. Names, role words and counts: no emails,
 * no pay, no client names, nothing anyone typed.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { canSeeAdoption, orgAdoption } from '@/lib/cxoAdoption'
import { adoptionForAi } from '@/lib/cxoAdoptionShared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

const handle_team_adoption: Handler = async (ctx) => {
  if (!canSeeAdoption(ctx.caller)) {
    return j({ ok: false, say: 'Adoption is for the workspace owner and admins only.' })
  }
  try {
    const tz = ctx.caller.timezone || ctx.tenant.timezone || 'America/New_York'
    return j({ ok: true, source: 'Suite usage counts (Settings, Adoption)', ...adoptionForAi(await orgAdoption(ctx.tenant.id, tz), tz) })
  } catch (err) {
    console.error('[agent] team_adoption', err)
    return j({ ok: false, say: 'Adoption could not load just now. Try again in a minute.' })
  }
}

export const CXO_ADOPTION_TOOL_HANDLERS: Record<string, Handler> = {
  team_adoption: handle_team_adoption,
}

export const CXO_ADOPTION_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'team_adoption',
    description:
      'Who is using the suite (read only): "who hasn\'t logged in this week", "how is adoption", "who is slipping", "who uses Mira the most". Returns people count, active this week and adoption %, the weekly trend, most used pages, and per person: status (Active / Slipping / Not started), last seen, days active in the last 7 and 30, Mira questions and most used page, plus who was not seen this week. Workspace owner and admins only. Use only the returned figures and state the rule when asked what a status means. Not quotas or performance (employee_quota_status).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
]
