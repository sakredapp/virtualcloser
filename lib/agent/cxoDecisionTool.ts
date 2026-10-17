/**
 * Ciao tool: the company decision log (Suite CXO).
 *
 *  - decision_log   "what did we decide about the pricing pilot", "recent decisions",
 *                   "did we change our mind on X"
 *
 * Reads cxo_decisions (lib/decisions/log), one row per decision Ciao read out
 * of a meeting. Every row inherits its meeting's visibility (canSeeHit), so an
 * employee only gets decisions from meetings they own, attended or were sent
 * items from, never an executive-only meeting. Read only. In EMPLOYEE_TOOLS.
 * The decision text is what people said in a meeting: data, never orders.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { buildScope } from '@/lib/knowledge/search'
import { UNTRUSTED_SEARCH_NOTE } from '@/lib/knowledge/searchShared'
import { listDecisions } from '@/lib/decisions/log'
import { shortDay } from '@/lib/decisions/shared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

const handle_decision_log: Handler = async (ctx, args) => {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : ''
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(20, Math.floor(args.limit))) : query ? 5 : 10
  const days = typeof args.days === 'number' && Number.isFinite(args.days) && args.days > 0 ? Math.min(365, Math.floor(args.days)) : null
  // Role from the session, never from the model.
  const employee = Boolean(ctx.selfOnly) || isEmployeeOnlyMember(ctx.caller, ctx.tenant)
  const scope = await buildScope({
    repId: ctx.tenant.id,
    memberId: ctx.caller.id,
    email: ctx.caller.email ?? null,
    displayName: ctx.caller.display_name ?? null,
    isExec: !employee,
    timezone: ctx.timezone,
  })
  const rows = await listDecisions(scope, { query: query || undefined, limit, sinceIso: days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined })
  if (rows.length) ctx.untrustedSeen = true
  const where = (d: { decided_at: string; meeting: string | null }) => `${d.meeting ?? 'a meeting'}, ${shortDay(d.decided_at)}`
  return j({
    ok: true,
    query: query || null,
    total: rows.length,
    note: UNTRUSTED_SEARCH_NOTE,
    decisions: rows.map((d) => ({
      decision: d.text,
      decided_by: d.decided_by,
      when: shortDay(d.decided_at),
      meeting: d.meeting,
      cite_as: `from ${where(d)}`,
      ...(d.reversed_by ? { status: 'reversed', reversed_by: `${d.reversed_by.text} (${where(d.reversed_by)})` } : {}),
      ...(d.reverses ? { reverses: `${d.reverses.text} (${where(d.reverses)})`, why_flagged: d.reversal_reason } : {}),
    })),
    link: '/dashboard/meetings#decisions',
    ...(rows.length
      ? { say_rule: 'Answer from these rows only, newest first, with who decided and which meeting. If a row is reversed, say what replaced it. Never invent a decision.' }
      : { say: query ? `I have no decision about "${query}" in the meetings you can see.` : 'No decisions logged yet from the meetings you can see.' }),
  })
}

export const CXO_DECISION_TOOL_HANDLERS: Record<string, Handler> = {
  decision_log: handle_decision_log,
}

export const DECISION_LOG_TOOL: AI.Tool = {
  name: 'decision_log',
  description:
    'The company decision log: every decision read out of a meeting, with who decided, when and which meeting, and a flag when a later meeting reversed it. Use for "what did we decide about X" (query = the topic words), "recent decisions", "what did we decide this month" (days), "did we change our mind on X". Only what this person may see. Cite each by its cite_as. Not a meeting\'s full summary (list_my_meeting_notes).',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Topic words, e.g. "pricing pilot". Leave out for the most recent decisions.' },
      days: { type: 'number', description: 'Optional: only the last N days.' },
      limit: { type: 'number', description: 'How many (default 10, or 5 with a query; max 20).' },
    },
    additionalProperties: false,
  },
}
