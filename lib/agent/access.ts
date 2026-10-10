/**
 * Who may call which Mira tool (owner 10-10: every employee can use Mira).
 *
 * Every tool has an access level:
 *   - 'self'  — scoped to the caller: their own to-dos, requests, meetings,
 *               boards cards, calendar and Gmail, in-app messages to
 *               coworkers, their own memory. Employees and execs.
 *   - 'exec'  — company data: revenue, finance, payroll and pay, QuickBooks,
 *               the book (Airtable/Pinnacle), leads and pipeline, partners,
 *               plan and comp, HR writes, admin, usage, the org memory, and
 *               the write proxy (delegate_intents). Executives only.
 *
 * A tool that is not listed is 'exec' (deny by default), so a new tool never
 * reaches an employee until someone decides it should.
 *
 * Enforcement is on the server, in the agent's tool executor
 * (authorizeToolCall in runAgent), not only by hiding tool definitions: a
 * forged or hallucinated call to an exec tool from an employee gets a
 * refusal and the handler never runs. Execs and owners are unchanged.
 */
import type * as AI from '@/lib/aiTypes'
import type { Member } from '@/types'
import { isEmployeeOnlyMember } from '@/lib/employees/access'

export type ToolAccess = 'self' | 'exec'

/** Tools an employee login may use. Everything else is executive-only. */
export const EMPLOYEE_TOOLS: ReadonlySet<string> = new Set([
  // Who they are, thinking help, choices
  'who_am_i',
  'web_search',
  'propose_choice',
  // Their own work (member-scoped readers)
  'list_brain_items',
  'list_deferred_items',
  'list_calendar_events',
  'list_my_todos',
  'add_my_todo',
  'complete_my_todo',
  'list_my_cards',
  'list_my_meeting_notes',
  // Their own memory (agent_member_memory when the caller is an employee)
  'remember',
  'forget',
  'list_learned',
  // In-app messages to coworkers (scoped to the caller by lib/memberMessages)
  'send_member_message',
  'reply_member_message',
  'list_member_messages',
  // Their own Gmail (pickSenderAccount returns only the caller's own mailboxes)
  'list_inbox',
  'read_thread',
  'reply_to_thread',
  // Their own Google calendar (ownOnly scope in lib/cxoCalendar)
  'list_calendars',
  'find_open_slots',
  'create_calendar_event',
  'update_calendar_event',
  'cancel_calendar_event',
])

export function toolAccess(name: string): ToolAccess {
  return EMPLOYEE_TOOLS.has(name) ? 'self' : 'exec'
}

type TenantLike = { id: string; brand?: string | null }

/** True for an employee login (role rep/observer on an executive tenant). */
export function isEmployeeCaller(caller: Pick<Member, 'role'> | { role?: string | null }, tenant: TenantLike, env?: Record<string, string | undefined>): boolean {
  return isEmployeeOnlyMember(caller, tenant, env)
}

export function canCallTool(name: string, employee: boolean): boolean {
  if (!employee) return true
  return toolAccess(name) === 'self'
}

/** Tool definitions the model is offered for this caller. */
export function filterToolDefs<T extends Pick<AI.Tool, 'name'>>(defs: T[], employee: boolean): T[] {
  return employee ? defs.filter((d) => canCallTool(d.name, true)) : defs
}

export const EMPLOYEE_REFUSAL =
  'That is only available to the executive team. As an employee I can help with your own to-dos, your meetings, your calendar and email, your board cards, and messages to coworkers.'

/**
 * The executor's gate. Null = allowed. Otherwise the refusal payload that
 * goes back to the model in place of the tool result.
 */
export function authorizeToolCall(name: string, ctx: { selfOnly?: boolean }): { text: string } | null {
  if (canCallTool(name, Boolean(ctx.selfOnly))) return null
  return { text: JSON.stringify({ ok: false, refused: true, error: 'not_allowed_for_role', tool: name, say: EMPLOYEE_REFUSAL }) }
}
