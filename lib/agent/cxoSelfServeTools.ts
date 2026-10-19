/**
 * Ciao tools from the 2026-10-18 QA run (Suite CXO):
 *
 *  - my_quota          "how am I doing against my quota", "am I on track for my bonus"
 *                      The CALLER's own quotas and bonus status, nothing else (gap 3).
 *                      Takes no person argument, so it cannot be pointed at a coworker;
 *                      reads through loadSelfView, which only ever returns the row linked
 *                      to this login. On the employee allow-list (lib/agent/access).
 *  - list_approvals    "what needs my yes", "any approvals waiting on me" (gap 4)
 *  - decide_approval   approve or decline one of them, after the executive says so.
 *                      Approvers only (owner, admin, manager): never on the employee
 *                      allow-list, and checked again inside the handler and in
 *                      decideApproval itself. Reuses cxo_mira_approvals and the audit
 *                      log exactly as the Approvals page does.
 *
 * No bonus or pay dollars reach the AI (owner 10-09): % to goal, tiers as %, status words.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { loadSelfView } from '@/lib/employees/data'
import {
  PAYOUT_STATUS_WORDS,
  SNAPSHOT_STATUS_WORDS,
  employeeSnapshot,
  fmtKpiValue,
  monthKey,
  payoutsForAll,
  periodLabel,
  quarterKey,
} from '@/lib/employees/shared'
import { isApprover } from '@/lib/ops/approvalsShared'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { saveAbout } from '@/lib/onboarding/aboutYou'
import { EMPLOYEE_ROLES, EXEC_ROLES, GENERAL_FOCUS, INSURANCE_FOCUS, roleLabel, type AboutPatch } from '@/lib/onboarding/aboutYouShared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const pct = (a: number | null | undefined) => (a == null ? null : Math.round(a * 100))

// ── my_quota ────────────────────────────────────────────────────────────────

const handle_my_quota: Handler = async (ctx) => {
  const view = await loadSelfView(ctx.tenant.id, ctx.caller.id, ctx.todayIso)
  if (!view) {
    return j({
      ok: true,
      linked: false,
      not_set_up: true,
      say: 'Your login is not linked to an employee record yet, so there is no quota or bonus plan to show. Say that plainly (it is not zero). An executive links you on the Employees page.',
    })
  }
  const data = { kpis: view.kpis, actuals: view.actuals, tiers: view.tiers }
  const snap = employeeSnapshot(view.employee, data, ctx.todayIso)
  if (!view.kpis.length) {
    return j({ ok: true, linked: true, not_set_up: true, name: view.employee.name, say: 'No quota is set for you yet. Say that plainly (it is not zero, and not behind). Your manager sets quotas on the Employees page.' })
  }
  const payoutLine = (key: string) => payoutsForAll({ employees: [view.employee], ...data }, key, ctx.todayIso)[0] ?? null
  const bonus = [monthKey(ctx.todayIso), quarterKey(ctx.todayIso)]
    .map((key) => ({ key, line: payoutLine(key) }))
    .filter((b) => b.line && b.line.status !== 'no_plan')
    .map(({ key, line }) => ({
      period: periodLabel(key),
      status: PAYOUT_STATUS_WORDS[line!.status],
      overall_to_goal_pct: pct(line!.overallAtt),
      tier_reached_pct: line!.overallTier ? line!.overallTier.attain_pct : null,
    }))
  return j({
    ok: true,
    as_of: ctx.todayIso,
    name: view.employee.name,
    status: SNAPSHOT_STATUS_WORDS[snap.status],
    to_quota_pct: pct(snap.att),
    quotas: snap.quotas.map((q) => ({
      name: q.kpi.name,
      period: periodLabel(q.periodKey),
      target: fmtKpiValue(q.kpi.unit, q.kpi.target),
      actual: fmtKpiValue(q.kpi.unit, q.actual),
      pct: pct(q.att),
      projected_pct: pct(q.projectedAtt),
      pace: q.pace,
      tier_reached_pct: q.tier ? q.tier.attain_pct : null,
      next_tier_at_pct: q.next ? q.next.attain_pct : null,
    })),
    bonus: bonus.length ? bonus : null,
    bonus_plan: bonus.length ? 'set' : 'none',
    manager: view.manager,
    say: 'These are only your own numbers. Lead with where you stand vs quota, then bonus status as given. Bonus dollars are on your page, not here.',
  })
}

// ── Approvals ───────────────────────────────────────────────────────────────

const NOT_APPROVER = { ok: false, say: 'Approvals are for the executives who approve (owner, admin, manager). Say that in one line.' }

const handle_list_approvals: Handler = async (ctx) => {
  if (!isApprover(ctx.caller, ctx.tenant)) return j(NOT_APPROVER)
  const { listApprovals, listPlaudPending } = await import('@/lib/ops/approvals')
  const { listMembers } = await import('@/lib/members')
  const [rows, plaud, members] = await Promise.all([
    listApprovals(ctx.tenant.id, 'pending', 50),
    listPlaudPending(ctx.tenant.id, 25).catch(() => []),
    listMembers(ctx.tenant.id).catch(() => []),
  ])
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? 'someone on the team'
  const items = rows.map((r) => ({
    id: r.id,
    what: r.summary,
    asked_by: nameOf(r.requested_by),
    why: r.reason === 'outside_send' ? 'goes outside the company' : 'changes someone else\'s records',
    tool: r.tool,
    asked_at: r.created_at,
  }))
  const meetingNotes = plaud.map((p) => ({
    kind: p.kind === 'send_email' ? 'meeting follow-up email' : 'meeting invite',
    to: p.target_email,
    subject: typeof p.payload?.subject === 'string' ? p.payload.subject : typeof p.payload?.summary === 'string' ? p.payload.summary : null,
    created_at: p.created_at,
  }))
  if (!items.length && !meetingNotes.length) {
    return j({ ok: true, count: 0, items: [], say: 'Nothing is waiting for your approval right now.' })
  }
  return j({
    ok: true,
    count: items.length,
    items,
    meeting_note_actions: meetingNotes,
    say: 'List each item as one line: what, who asked. Approve or decline only when they say so for a specific item, then call decide_approval with its id and confirmed: true. Meeting-note emails and invites are approved on the Approvals page.',
  })
}

const handle_decide_approval: Handler = async (ctx, args) => {
  if (!isApprover(ctx.caller, ctx.tenant)) return j(NOT_APPROVER)
  const id = str(args.id, 80)
  const decision = str(args.decision, 20).toLowerCase()
  if (!id) return j({ ok: false, error: 'id required: call list_approvals first and use the item id.' })
  if (decision !== 'approve' && decision !== 'decline') return j({ ok: false, error: "decision must be 'approve' or 'decline'." })
  if (args.confirmed !== true) {
    return j({ ok: false, needs_confirmation: true, say: `Nothing decided yet. Ask them to confirm: ${decision} this request? Call again with confirmed: true only after they say yes.` })
  }
  const { decideApproval, ApprovalError } = await import('@/lib/ops/approvals')
  try {
    const row = await decideApproval({ tenant: ctx.tenant, approver: ctx.caller, id, approve: decision === 'approve' })
    const say =
      row.status === 'executed' ? `Approved and done: ${row.summary}.`
        : row.status === 'failed' ? `Approved, but it did not go through: ${row.summary}. Say so plainly.`
          : row.status === 'declined' ? `Declined: ${row.summary}. The person who asked has been told.`
            : `Recorded (${row.status}): ${row.summary}.`
    return j({ ok: row.status !== 'failed', status: row.status, id: row.id, say })
  } catch (e) {
    if (e instanceof ApprovalError) return j({ ok: false, say: e.message })
    throw e
  }
}

// ── set_my_focus ────────────────────────────────────────────────────────────
// The caller's OWN role and what they keep an eye on (lib/onboarding/aboutYou):
// "I'm the CFO", "I care more about recruiting now". Their own members row only;
// an assistant working an executive's seat never answers for them.

const ids = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : undefined)

const handle_set_my_focus: Handler = async (ctx, args) => {
  if ((ctx.caller as { acting_assistant?: unknown }).acting_assistant || ctx.caller.role === 'assistant') {
    return j({ ok: false, say: 'Only the person whose seat it is can change their role or focus. Say so in one line.' })
  }
  const patch: AboutPatch = {}
  if (typeof args.role === 'string' && args.role.trim()) patch.role = args.role.trim()
  if (typeof args.role_other === 'string') patch.roleOther = str(args.role_other, 60)
  const focus = ids(args.focus)
  const add = ids(args.focus_add)
  const remove = ids(args.focus_remove)
  if (focus) patch.focus = focus
  if (add?.length) patch.focusAdd = add
  if (remove?.length) patch.focusRemove = remove
  const r = await saveAbout({ id: ctx.tenant.id, brand: (ctx.tenant as { brand?: string | null }).brand ?? null }, ctx.caller, patch)
  if (!r.ok) {
    return j({ ok: false, error: r.error, roles: EXEC_ROLES.concat(EMPLOYEE_ROLES).map((o) => o.id), say: 'Nothing was saved. Use ids from the lists in the tool description.' })
  }
  const v = r.view
  const unknown = [...(focus ?? []), ...(add ?? [])].filter((id) => !v.focusOptions.some((o) => o.id === id))
  const focusNow = v.focus.map((id) => v.focusOptions.find((o) => o.id === id)?.label ?? id)
  return j({
    ok: true,
    role: roleLabel(v),
    focus: focusNow,
    ...(unknown.length ? { not_offered_here: unknown, options: v.focusOptions.map((o) => o.id) } : {}),
    say: `Saved on their profile (they can change it in Settings, About you). Confirm in one line${focusNow.length ? `, e.g. "Got it, I'll lead with ${focusNow.slice(0, 3).join(', ')}."` : '.'}`,
  })
}

export const SET_MY_FOCUS_TOOL: AI.Tool = {
  name: 'set_my_focus',
  description:
    `Save the CALLER's own role and what they want to keep an eye on, when they tell you ("I'm the CFO", "I care more about recruiting now", "stop leading with carriers"). Only ever the person asking. Then confirm in one line. ` +
    `Executive roles: ${EXEC_ROLES.map((o) => o.id).join(', ')}. Employee roles: ${EMPLOYEE_ROLES.map((o) => o.id).join(', ')} (other needs role_other text). ` +
    `Focus ids, insurance books: ${INSURANCE_FOCUS.map((o) => o.id).join(', ')}. Other companies: ${GENERAL_FOCUS.map((o) => o.id).join(', ')}. ` +
    'focus replaces the whole list; focus_add puts items first; focus_remove drops them. Up to 6.',
  input_schema: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'Role id.' },
      role_other: { type: 'string', description: 'Their own words for the role, when role is other.' },
      focus: { type: 'array', items: { type: 'string' }, description: 'Replace their whole list, most important first.' },
      focus_add: { type: 'array', items: { type: 'string' }, description: 'Add these, first in line.' },
      focus_remove: { type: 'array', items: { type: 'string' }, description: 'Drop these.' },
    },
    additionalProperties: false,
  },
}

export const CXO_SELF_SERVE_TOOL_HANDLERS: Record<string, Handler> = {
  set_my_focus: handle_set_my_focus,
  my_quota: handle_my_quota,
  list_approvals: handle_list_approvals,
  decide_approval: handle_decide_approval,
}

export const MY_QUOTA_TOOL: AI.Tool = {
  name: 'my_quota',
  description:
    'The caller\'s OWN quota and bonus status (read only): "how am I doing against my quota", "am I on track for my bonus", "what is my target this month". Returns each of their quotas (target, actual, % and pace) and bonus status as % of goal. Only ever the person asking; it cannot look up anyone else. No bonus dollars. not_set_up means no quota or no linked record: say so, never zero.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

export const APPROVAL_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'list_approvals',
    description:
      `What is waiting for this executive's OK (read only): "what needs my yes", "any approvals waiting on me". Lists pending requests a teammate asked ${ASSISTANT_NAME} to do that need an approver (outside emails, changes to someone else\'s records), with who asked, plus pending meeting-note emails and invites. Approvers only.`,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'decide_approval',
    description:
      'Approve or decline ONE pending request from list_approvals, only after the executive says so for that item. Approving runs it as the person who asked; declining tells them. Needs the item id and confirmed: true (their explicit yes in their latest message).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The item id from list_approvals.' },
        decision: { type: 'string', enum: ['approve', 'decline'] },
        confirmed: { type: 'boolean', description: 'true only when they said to approve or decline this item in their latest message.' },
      },
      required: ['id', 'decision'],
      additionalProperties: false,
    },
  },
]
