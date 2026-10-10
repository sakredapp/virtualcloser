/**
 * Mira's follow-up tools (Suite CXO employee ops, owner 10-10). Offered only
 * when the tenant's reps.settings.cxo_employee_ops is on; each handler checks
 * the switch again.
 *
 *   list_followups          "what am I waiting on" / "who owes me what" /
 *                           (execs) "what's open across the company"
 *   set_recurring_report    "every Monday send me open requests by person"
 *   list_recurring_reports, cancel_recurring_report
 *   pause_my_nudges         stop Mira's follow-up notices to me for a while
 *
 * Employees: always about themselves (their own items, their own reports,
 * their own nudges). Company-wide views and reports are executive-only and
 * are refused for an employee, whatever the model passes.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { supabase } from '@/lib/supabase'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { openItemsFor, groupByPerson, nameOf, type FollowView } from '@/lib/followups/shared'
import { EMPLOYEE_REPORT_KINDS, REPORT_LABEL, asReportKind, parseWeekday, timingWords } from '@/lib/ops/reportsShared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const OFF = j({ ok: false, error: 'not_enabled', say: 'Follow-ups are not switched on for your company yet.' })
const SELF_ONLY = 'As an employee I can only show and set this up for your own work.'

const handle_list_followups: Handler = async (ctx, args) => {
  if (!cxoEmployeeOps(ctx.tenant)) return OFF
  const raw = str(args.view, 20)
  const view: FollowView = raw === 'company' || raw === 'overdue' || raw === 'owed_by_me' ? raw : 'waiting_on'
  if ((view === 'company' || view === 'overdue') && ctx.selfOnly) return j({ ok: false, refused: true, say: SELF_ONLY })
  const { loadMembers, loadFollowItems } = await import('@/lib/followups/engine')
  const [members, items] = await Promise.all([loadMembers(ctx.tenant.id), loadFollowItems(ctx.tenant.id, new Date())])
  let personId: string | null = null
  const person = str(args.person, 120).toLowerCase()
  if (person && !ctx.selfOnly) {
    const hit = members.filter((m) => m.is_active && nameOf(m).toLowerCase().includes(person))
    if (hit.length === 0) return j({ ok: false, say: `I don't see "${args.person}" on the team.` })
    if (hit.length > 1) return j({ ok: false, ask: `Which one: ${hit.map((m) => nameOf(m)).join(', ')}?` })
    personId = hit[0].id
  }
  const rows = openItemsFor({ items, members, memberId: ctx.caller.id, view, personId, now: new Date(), tz: ctx.timezone })
  const shaped = rows.slice(0, 60).map((r) => ({ what: r.title, kind: r.kind, owes: r.owes, asked_by: r.asker, due: r.due, overdue: r.overdue }))
  if (view === 'company' || view === 'overdue') {
    return j({ total: rows.length, by_person: groupByPerson(rows).map((g) => ({ person: g.person, open: g.rows.length, overdue: g.rows.filter((r) => r.overdue).length })), items: shaped })
  }
  return j({ total: rows.length, items: shaped })
}

const handle_set_recurring_report: Handler = async (ctx, args) => {
  if (!cxoEmployeeOps(ctx.tenant)) return OFF
  const kind = asReportKind(args.kind)
  if (!kind) return j({ ok: false, error: 'kind must be one of open_by_person, overdue, waiting_on, my_open' })
  if (ctx.selfOnly && !EMPLOYEE_REPORT_KINDS.has(kind)) return j({ ok: false, refused: true, say: `${SELF_ONLY} I can send you "what you are waiting on" or "what you owe".` })
  const cadence = str(args.cadence, 10) === 'daily' ? 'daily' : 'weekly'
  const weekday = cadence === 'weekly' ? parseWeekday(args.weekday) ?? 1 : null
  const hourRaw = Number(args.hour)
  const hour = Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : 8
  const { createReportJob } = await import('@/lib/ops/reports')
  try {
    // Always for the caller: a report goes to the person who set it up, nobody else.
    const job = await createReportJob({ repId: ctx.tenant.id, memberId: ctx.caller.id, kind, cadence, weekday, hour, tz: ctx.timezone })
    const when = timingWords({ cadence, weekday, hour })
    return j({ ok: true, id: job.id, next_run_at: job.next_run_at, say: `Set. "${REPORT_LABEL[kind]}" ${when}, in the app and by email. I skip it when there's nothing in it.` })
  } catch (err) {
    return j({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

const handle_list_recurring_reports: Handler = async (ctx) => {
  if (!cxoEmployeeOps(ctx.tenant)) return OFF
  const { listReportJobs } = await import('@/lib/ops/reports')
  const jobs = await listReportJobs(ctx.tenant.id, ctx.caller.id)
  return j({ total: jobs.length, items: jobs.map((r) => ({ id: r.id, report: REPORT_LABEL[r.kind], when: timingWords(r), paused: r.paused, next_run_at: r.next_run_at })) })
}

const handle_cancel_recurring_report: Handler = async (ctx, args) => {
  if (!cxoEmployeeOps(ctx.tenant)) return OFF
  const id = str(args.id, 60)
  if (!id) return j({ ok: false, error: 'id required (from list_recurring_reports)' })
  const { cancelReportJob } = await import('@/lib/ops/reports')
  const ok = await cancelReportJob(ctx.tenant.id, ctx.caller.id, id)
  return j(ok ? { ok: true, say: 'Cancelled.' } : { ok: false, say: 'I could not find that report among yours.' })
}

const handle_pause_my_nudges: Handler = async (ctx, args) => {
  if (!cxoEmployeeOps(ctx.tenant)) return OFF
  const resume = args.resume === true
  const days = Math.min(Math.max(Number(args.days) || 1, 1), 30)
  const until = resume ? null : new Date(Date.now() + days * 86_400_000).toISOString()
  // Only the caller's own row.
  const { data, error } = await supabase.from('members').select('settings').eq('rep_id', ctx.tenant.id).eq('id', ctx.caller.id).maybeSingle()
  if (error) return j({ ok: false, error: error.message })
  const settings = { ...((data?.settings as Record<string, unknown> | null) ?? {}) }
  if (until) settings.followups_paused_until = until
  else delete settings.followups_paused_until
  const { error: uErr } = await supabase.from('members').update({ settings }).eq('rep_id', ctx.tenant.id).eq('id', ctx.caller.id)
  if (uErr) return j({ ok: false, error: uErr.message })
  return j({ ok: true, paused_until: until, say: until ? `Paused. No follow-up nudges from me for ${days} day${days === 1 ? '' : 's'}.` : 'Nudges are back on.' })
}

export const OPS_TOOL_HANDLERS: Record<string, Handler> = {
  list_followups: handle_list_followups,
  set_recurring_report: handle_set_recurring_report,
  list_recurring_reports: handle_list_recurring_reports,
  cancel_recurring_report: handle_cancel_recurring_report,
  pause_my_nudges: handle_pause_my_nudges,
}

/** Member-scoped (employees may call them; company-wide options are refused inside). */
export const OPS_SELF_TOOLS = Object.keys(OPS_TOOL_HANDLERS)

export const OPS_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'list_followups',
    description:
      'Open commitments Mira is chasing (requests sent in the app, board cards with a due date, meeting action items). view=waiting_on: what the caller asked others for that is still open ("what am I waiting on", "who owes me what"). view=owed_by_me: what the caller owes. view=company or overdue (executives only): everything open or overdue across the company, grouped by person; person narrows it to one teammate.',
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['waiting_on', 'owed_by_me', 'company', 'overdue'] },
        person: { type: 'string', description: 'Executives only: a teammate name to narrow company/overdue.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_recurring_report',
    description:
      'Set up a recurring report for the caller, delivered in the app and by email to them only, skipped when empty. kind: open_by_person / overdue (executives only), waiting_on, my_open. cadence weekly (weekday) or daily (weekdays). hour is local 0-23.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['open_by_person', 'overdue', 'waiting_on', 'my_open'] },
        cadence: { type: 'string', enum: ['weekly', 'daily'] },
        weekday: { type: 'string', description: 'For weekly: monday..sunday. Default monday.' },
        hour: { type: 'integer', description: 'Local hour 0-23. Default 8.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_recurring_reports',
    description: "The caller's recurring reports (id, what, when).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_recurring_report',
    description: 'Cancel one of the caller\'s recurring reports by id (from list_recurring_reports).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'pause_my_nudges',
    description: "Pause Mira's follow-up nudges to the caller for some days (1-30), or resume=true to turn them back on. Only ever the caller's own.",
    input_schema: { type: 'object', properties: { days: { type: 'integer' }, resume: { type: 'boolean' } }, additionalProperties: false },
  },
]
