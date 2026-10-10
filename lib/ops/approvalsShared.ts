/**
 * Approvals queue and audit log, the pure part (no DB). Used by the agent's
 * tool executor, the approvals page and the tests.
 *
 * A Mira action needs an executive's OK when it
 *   - sends outside the company: an email to a partner, a reply sent from
 *     Gmail to an outside address, a calendar invite to an outsider, a call
 *     booked with a partner; or
 *   - changes someone else's work: HR writes (quota, employee record, time off).
 * and the person asking is not themselves an approver. Approvers are the
 * executives: owner, admin and manager logins (never employees, never
 * assistants). An executive's own ask in chat is their approval; it runs
 * and is logged as approved.
 */
import { isEmployeeOnlyMember } from '@/lib/employees/access'

export type ApprovalReason = 'outside_send' | 'others_work'
export type Classification = { reason: ApprovalReason; summary: string }
export type OrgDirectory = { emails: Set<string>; domains: Set<string> }

const PUBLIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'msn.com'])

/** Members' emails, plus their company domains (not gmail.com and the like). */
export function orgDirectory(members: Array<{ email: string | null; is_active?: boolean }>): OrgDirectory {
  const emails = new Set<string>()
  const domains = new Set<string>()
  for (const m of members) {
    const e = (m.email ?? '').trim().toLowerCase()
    if (!e.includes('@')) continue
    emails.add(e)
    const d = e.split('@')[1]
    if (d && !PUBLIC_DOMAINS.has(d)) domains.add(d)
  }
  return { emails, domains }
}

/** Inside the company: a member's address or an address on a company domain. A name (not an email) is a partner: outside. */
export function isInternalAddress(raw: string, org: OrgDirectory): boolean {
  const e = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false
  return org.emails.has(e) || org.domains.has(e.split('@')[1])
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : typeof v === 'string' && v.trim() ? [v] : [])
const s = (v: unknown, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

const OTHERS_WORK_TOOLS: Record<string, string> = {
  set_employee_quota: "Change an employee's quota",
  update_employee: "Change an employee's record",
  log_time_off: 'Log time off for an employee',
}

/** Null when the action stays inside the company and touches only the caller's own work. */
export function classifyAction(name: string, args: Record<string, unknown>, org: OrgDirectory): Classification | null {
  switch (name) {
    case 'send_partner_message':
      return { reason: 'outside_send', summary: `Email ${s(args.partner) || s(args.to) || 'a partner'}${s(args.subject) ? `: "${s(args.subject)}"` : ''}` }
    case 'reply_to_thread': {
      if (String(args.mode ?? '').toLowerCase() !== 'send') return null
      const to = s(args.to, 200)
      if (to && isInternalAddress(to, org)) return null
      return { reason: 'outside_send', summary: `Send an email reply${to ? ` to ${to}` : ''}` }
    }
    case 'create_calendar_event': {
      const outside = list(args.attendees).filter((a) => !isInternalAddress(a, org))
      if (!outside.length) return null
      return { reason: 'outside_send', summary: `Invite ${outside.join(', ')} to "${s(args.title) || 'a meeting'}"` }
    }
    case 'update_calendar_event': {
      const outside = list(args.add_attendees).filter((a) => !isInternalAddress(a, org))
      if (!outside.length) return null
      return { reason: 'outside_send', summary: `Add ${outside.join(', ')} to a meeting` }
    }
    case 'cancel_calendar_event': {
      const outside = list(args.partners).filter((a) => !isInternalAddress(a, org))
      if (!outside.length) return null
      return { reason: 'outside_send', summary: `Cancel a meeting with ${outside.join(', ')} (they are notified)` }
    }
    case 'schedule_call_with_partner':
      if (!s(args.start) && args.pick_first !== true) return null // only offers times; nothing is sent
      return { reason: 'outside_send', summary: `Book a call with ${s(args.partner) || 'a partner'} and send the invite` }
    default:
      if (OTHERS_WORK_TOOLS[name]) return { reason: 'others_work', summary: `${OTHERS_WORK_TOOLS[name]}${s(args.employee) || s(args.name) ? `: ${s(args.employee) || s(args.name)}` : ''}` }
      return null
  }
}

type MemberLike = { role?: string | null }
type TenantLike = { id: string; brand?: string | null }

/** Executives approve: owner, admin, manager. Employees and assistants never do. */
export function isApprover(member: MemberLike | null | undefined, tenant: TenantLike, env?: Record<string, string | undefined>): boolean {
  if (!member) return false
  const role = String(member.role ?? '')
  if (!['owner', 'admin', 'manager'].includes(role)) return false
  return !isEmployeeOnlyMember(member, tenant, env)
}

/** Queue it when it needs an OK and the caller cannot give one. */
export function needsApproval(cls: Classification | null, caller: MemberLike, tenant: TenantLike, env?: Record<string, string | undefined>): boolean {
  return !!cls && !isApprover(caller, tenant, env)
}

/** Who may see which audit rows: executives see the company, everyone else only their own. */
export function auditScope(member: MemberLike & { id: string }, tenant: TenantLike, env?: Record<string, string | undefined>): { company: true } | { memberId: string } {
  return isApprover(member, tenant, env) ? { company: true } : { memberId: member.id }
}

/** Apply the scope to rows (the DB query does the same; this is the rule in one place). */
export function visibleAuditRows<T extends { rep_id: string; member_id: string | null }>(rows: T[], viewer: MemberLike & { id: string; rep_id: string }, tenant: TenantLike, env?: Record<string, string | undefined>): T[] {
  const scope = auditScope(viewer, tenant, env)
  return rows.filter((r) => r.rep_id === viewer.rep_id && ('company' in scope || r.member_id === viewer.id))
}

const LONG_TEXT = new Set(['body', 'html', 'text', 'description', 'content', 'message', 'note', 'notes'])

/** What the audit keeps of the arguments: short fields as-is (clipped), long text as a length only. */
export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args ?? {}).slice(0, 20)) {
    if (typeof v === 'string') out[k] = LONG_TEXT.has(k) ? `[${v.length} chars]` : v.slice(0, 120)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => (typeof x === 'string' ? x.slice(0, 80) : typeof x))
    else out[k] = '[object]'
  }
  return out
}

export type AuditResult = 'ok' | 'not_done' | 'error' | 'refused' | 'queued'

/** Result class from a tool's JSON text. */
export function auditResultOf(text: string): AuditResult {
  try {
    const p = JSON.parse(text) as { ok?: unknown; refused?: unknown; queued?: unknown; error?: unknown }
    if (p && typeof p === 'object') {
      if (p.refused === true) return 'refused'
      if (p.queued === true) return 'queued'
      if (p.ok === false) return p.error ? 'error' : 'not_done'
    }
  } catch {
    /* plain text result */
  }
  return 'ok'
}
