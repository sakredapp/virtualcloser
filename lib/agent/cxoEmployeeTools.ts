/**
 * Mira's employee + quota tools (Suite CXO), owner 10-09.
 *
 *  - employee_quota_status  "who's behind on quota", "how is Joe doing"   (read)
 *  - set_employee_quota     "set Joe's Q1 quota to 40 policies"          (write)
 *  - update_employee        title, department, hours, PTO, pay (pay: comp viewers only)
 *  - log_time_off           "Joe is out on vacation Friday"
 *
 * Executives only: an employee login (rep/observer on an exec tenant) is told
 * it is not available. Pay and bonus dollars are returned only to members who
 * may see comp (canViewComp), the same rule as the Employees page.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { addTimeOff, isLocked, loadEmployees, saveActual, saveKpi, upsertEmployee, type EmployeesData } from '@/lib/employees/data'
import { toIso, toNum } from '@/lib/employees/ingestShared'
import {
  PERIOD_KEY_RE,
  QUOTA_TYPES,
  SNAPSHOT_STATUS_WORDS,
  TIME_OFF_KINDS,
  canViewComp,
  employeeSnapshot,
  fmtKpiValue,
  matchEmployee,
  moreWords,
  parsePeriod,
  parseQuotaType,
  periodKeyFor,
  periodLabel,
  periodOfKey,
  type Employee,
  type Period,
  type QuotaType,
  type TimeOffKind,
} from '@/lib/employees/shared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const pct = (a: number | null) => (a == null ? null : Math.round(a * 100))

function guard(ctx: AgentContext): ToolHandlerResult | null {
  if (isEmployeeOnlyMember(ctx.caller, ctx.tenant as { id: string; brand?: string | null })) return j({ ok: false, say: 'Employee quotas are for the executive team.' })
  return null
}

function resolve(data: EmployeesData, who: string): { emp: Employee } | { result: ToolHandlerResult } {
  const { match, candidates } = matchEmployee(data.employees, who, who.includes('@') ? who : null)
  if (match) return { emp: match }
  if (candidates.length > 1) return { result: j({ ok: false, ambiguous: true, say: `More than one person matches "${who}". Which one?`, candidates: candidates.slice(0, 8).map((c) => ({ name: c.name, title: c.title, department: c.department })) }) }
  return { result: j({ ok: false, say: `No employee called "${who}". Add them on the Employees page or give Mira the roster.` }) }
}

/** Period key from words: "Q1" / "Q1 2027" / "2026-10" / "this quarter" / "year". */
function keyFrom(raw: string, period: Period, today: string): string {
  const s = raw.trim()
  if (PERIOD_KEY_RE.test(s)) return s
  const q = /\bq([1-4])\b(?:\D*(\d{4}))?/i.exec(s)
  if (q) {
    const year = q[2] ?? today.slice(0, 4)
    const cand = `${year}-Q${q[1]}`
    // "Q1" said in Q4 means next year's Q1.
    if (!q[2] && cand < periodKeyFor('quarter', today)) return `${Number(year) + 1}-Q${q[1]}`
    return cand
  }
  return periodKeyFor(period, today)
}

const handle_employee_quota_status: Handler = async (ctx, args) => {
  const g = guard(ctx)
  if (g) return g
  const comp = canViewComp(ctx.caller)
  const data = await loadEmployees(ctx.tenant.id, comp, ctx.todayIso)
  if (data.employees.length === 0) return j({ ok: true, say: 'No employees are set up yet. Give Mira the roster on the Employees page.', people: [] })
  let people = data.employees
  const who = str(args.employee)
  if (who) {
    const r = resolve(data, who)
    if ('result' in r) return r.result
    people = [r.emp]
  }
  const dept = str(args.department).toLowerCase()
  if (dept) people = people.filter((e) => e.department.toLowerCase().includes(dept))
  const filter = str(args.filter) || 'all'
  const rows = people
    .map((e) => {
      const s = employeeSnapshot(e, data, ctx.todayIso)
      return {
        name: e.name,
        title: e.title,
        department: e.department || null,
        status: SNAPSHOT_STATUS_WORDS[s.status],
        status_key: s.status,
        to_quota_pct: pct(s.att),
        quotas: s.quotas.map((q) => ({
          name: q.kpi.name,
          period: periodLabel(q.periodKey),
          target: fmtKpiValue(q.kpi.unit, q.kpi.target),
          actual: fmtKpiValue(q.kpi.unit, q.actual),
          pct: pct(q.att),
          projected_pct: pct(q.projectedAtt),
          pace: q.pace,
          source: q.kpi.actual_source === 'book' ? 'book' : 'entered/imported',
          ...(comp ? { bonus_earned: q.bonus, next_tier: q.next ? { at_pct: q.next.attain_pct, bonus: q.next.bonus, needs: moreWords(q) } : null } : {}),
        })),
        ...(comp ? { bonus_earned: s.bonusEarned, bonus_possible: s.bonusPossible } : {}),
      }
    })
    .filter((r) => (filter === 'behind' ? r.status_key === 'behind' : filter === 'on_track' ? r.status_key === 'met' || r.status_key === 'on_pace' : filter === 'no_quota' ? r.status_key === 'no_quota' : true))
    .sort((a, b) => (a.to_quota_pct ?? 999) - (b.to_quota_pct ?? 999))
  return j({ ok: true, as_of: ctx.todayIso, filter, count: rows.length, people: rows.slice(0, 60), bonus_visible: comp })
}

const handle_set_employee_quota: Handler = async (ctx, args) => {
  const g = guard(ctx)
  if (g) return g
  const comp = canViewComp(ctx.caller)
  const data = await loadEmployees(ctx.tenant.id, comp, ctx.todayIso)
  const r = resolve(data, str(args.employee))
  if ('result' in r) return r.result
  const emp = r.emp
  const type: QuotaType = QUOTA_TYPES.some((t) => t.type === args.type) ? (args.type as QuotaType) : parseQuotaType(`${str(args.type)} ${str(args.name)}`)
  const info = QUOTA_TYPES.find((t) => t.type === type)!
  const target = toNum(args.target)
  if (target == null || target <= 0) return j({ ok: false, say: 'What should the target be?' })
  const periodWords = str(args.period, 40)
  let period: Period = periodWords ? parsePeriod(periodWords) : 'month'
  const key = keyFrom(periodWords, period, ctx.todayIso)
  if (PERIOD_KEY_RE.test(periodWords)) period = periodOfKey(periodWords)
  else if (/\bq[1-4]\b/i.test(periodWords)) period = 'quarter'
  const name = type === 'custom' ? str(args.name, 120) : str(args.name, 120) || info.label.replace(/ \$$/, '')
  if (!name) return j({ ok: false, say: 'What is this quota called?' })
  const existing = data.kpis.find((k) => k.employee_id === emp.id && k.quota_type === type && k.period === period && (type !== 'custom' || k.name.toLowerCase() === name.toLowerCase()))
  const fromBook = info.bookable && data.bookLinked && args.from_book !== false && (args.from_book === true || !!emp.book_match)
  const id = await saveKpi(ctx.tenant.id, {
    id: existing?.id,
    employee_id: emp.id,
    name: existing && type !== 'custom' && !str(args.name) ? existing.name : name,
    unit: info.unit,
    target,
    period,
    quota_type: type,
    actual_source: fromBook ? 'book' : existing?.actual_source ?? 'manual',
    weight: existing?.weight ?? 1,
    sort: existing?.sort ?? data.kpis.filter((k) => k.employee_id === emp.id).length,
  })
  let progress = ''
  const actual = toNum(args.actual)
  if (actual != null && !fromBook) {
    if (await isLocked(ctx.tenant.id, key)) progress = ` ${periodLabel(key)} is approved for payroll, so progress was not changed.`
    else {
      await saveActual(ctx.tenant.id, id, key, actual, 'mira')
      progress = ` Progress so far: ${fmtKpiValue(info.unit, actual)}.`
    }
  }
  const note = key !== periodKeyFor(period, ctx.todayIso) ? ` Quotas repeat every ${period}; ${periodLabel(key)} uses this target too.` : ''
  return j({
    ok: true,
    say: `${existing ? 'Updated' : 'Set'} ${emp.name}'s ${period}ly ${name} quota to ${fmtKpiValue(info.unit, target)}${fromBook ? ', filled from the book' : ''}.${progress}${note}`,
    employee: emp.name,
    quota: { name, type, target, period, period_key: key, from_book: fromBook },
  })
}

const handle_update_employee: Handler = async (ctx, args) => {
  const g = guard(ctx)
  if (g) return g
  const comp = canViewComp(ctx.caller)
  const data = await loadEmployees(ctx.tenant.id, comp, ctx.todayIso)
  const r = resolve(data, str(args.employee))
  if ('result' in r) return r.result
  const emp = r.emp
  const touchesPay = args.base_salary !== undefined || args.hourly_rate !== undefined
  if (touchesPay && !comp) return j({ ok: false, say: 'Pay is for the executives who can see comp. Ask an owner.' })
  const input: Record<string, unknown> = {}
  const changed: string[] = []
  for (const k of ['title', 'department', 'email'] as const) {
    if (args[k] !== undefined) {
      input[k] = str(args[k], 200) || (k === 'department' ? '' : null)
      changed.push(k)
    }
  }
  if (args.manager !== undefined) {
    const m = str(args.manager)
    if (!m) input.manager_id = null
    else {
      const mr = resolve(data, m)
      if ('result' in mr) return mr.result
      input.manager_id = mr.emp.id
    }
    changed.push('manager')
  }
  if (args.start_date !== undefined) {
    input.start_date = toIso(args.start_date)
    changed.push('start date')
  }
  for (const [k, w] of [['hours_per_week', 'hours a week'], ['pto_allowed_days', 'PTO allowed'], ['pto_balance_days', 'PTO left'], ['base_salary', 'salary'], ['hourly_rate', 'pay rate']] as const) {
    if (args[k] !== undefined) {
      input[k] = toNum(args[k])
      changed.push(w)
    }
  }
  if (args.book_name !== undefined) {
    input.book_match = str(args.book_name, 120) || null
    input.book_dim = input.book_match ? (args.book_is_team === true ? 'team' : 'agent') : null
    changed.push('name in the book')
  }
  if (changed.length === 0) return j({ ok: false, say: 'What should change?' })
  await upsertEmployee(ctx.tenant.id, emp.id, input, comp)
  return j({ ok: true, say: `Updated ${emp.name}: ${changed.join(', ')}.` })
}

const handle_log_time_off: Handler = async (ctx, args) => {
  const g = guard(ctx)
  if (g) return g
  const data = await loadEmployees(ctx.tenant.id, false)
  const r = resolve(data, str(args.employee))
  if ('result' in r) return r.result
  const start = toIso(args.start_date)
  if (!start) return j({ ok: false, say: 'Which day does the time off start?' })
  const end = toIso(args.end_date) ?? start
  const kind: TimeOffKind = TIME_OFF_KINDS.includes(args.kind as TimeOffKind) ? (args.kind as TimeOffKind) : 'vacation'
  await addTimeOff(ctx.tenant.id, { employee_id: r.emp.id, start_date: start, end_date: end, days: toNum(args.days), kind, note: str(args.note, 300) || null, source: 'mira' })
  return j({ ok: true, say: `Logged ${kind} for ${r.emp.name}, ${start === end ? start : `${start} to ${end}`}.` })
}

export const CXO_EMPLOYEE_TOOL_HANDLERS: Record<string, Handler> = {
  employee_quota_status: handle_employee_quota_status,
  set_employee_quota: handle_set_employee_quota,
  update_employee: handle_update_employee,
  log_time_off: handle_log_time_off,
}

const employeeProp = { type: 'string', description: 'The employee as the executive said it: first name, full name or email. Ambiguous → the tool returns candidates; ask which.' } as const

export const CXO_EMPLOYEE_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'employee_quota_status',
    description:
      'Employees (staff, not agents) and their quotas this period: % to quota, pace, status, and for comp viewers bonus earned and what the next tier needs. Answers "who\'s behind on quota", "how is Joe tracking", "who is on pace in Contracting". filter: behind | on_track | no_quota | all (default). Use only its figures.',
    input_schema: {
      type: 'object',
      properties: {
        employee: employeeProp,
        department: { type: 'string' },
        filter: { type: 'string', enum: ['all', 'behind', 'on_track', 'no_quota'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_employee_quota',
    description:
      'Create or change one employee quota: "set Joe\'s Q1 quota to 40 policies", "Dana\'s monthly premium target is $120k". type: revenue | premium | policies | recruits | appointments | custom (custom needs name). period: month | quarter | year, or a key like 2027-Q1 / 2026-10 (quotas repeat every period). actual = progress so far this period, only when the executive gave a number. from_book: fill progress from the book (premium/policies only). Repeat the tool\'s say line.',
    input_schema: {
      type: 'object',
      properties: {
        employee: employeeProp,
        type: { type: 'string', enum: QUOTA_TYPES.map((t) => t.type) },
        name: { type: 'string', description: 'Only for custom quotas, or to rename.' },
        target: { type: 'number' },
        period: { type: 'string' },
        actual: { type: 'number' },
        from_book: { type: 'boolean' },
      },
      required: ['employee', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_employee',
    description:
      'Change an employee\'s basics: title, department, manager, start_date, email, hours_per_week, pto_allowed_days, pto_balance_days, book_name (their name in the book, for premium/policies quotas). base_salary and hourly_rate only for executives who can see comp. Pass only what changes. Repeat the say line.',
    input_schema: {
      type: 'object',
      properties: {
        employee: employeeProp,
        title: { type: 'string' },
        department: { type: 'string' },
        manager: { type: 'string', description: 'Their manager, by name; empty string for none.' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        email: { type: 'string' },
        hours_per_week: { type: 'number' },
        pto_allowed_days: { type: 'number' },
        pto_balance_days: { type: 'number' },
        base_salary: { type: 'number' },
        hourly_rate: { type: 'number' },
        book_name: { type: 'string' },
        book_is_team: { type: 'boolean' },
      },
      required: ['employee'],
      additionalProperties: false,
    },
  },
  {
    name: 'log_time_off',
    description: 'Log time off for an employee: "Joe is out sick today", "Dana on vacation Oct 20 to 24". kind: vacation | sick | personal | other. Dates YYYY-MM-DD; days defaults to weekdays in the range. Repeat the say line.',
    input_schema: {
      type: 'object',
      properties: {
        employee: employeeProp,
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        kind: { type: 'string', enum: [...TIME_OFF_KINDS] },
        days: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['employee', 'start_date'],
      additionalProperties: false,
    },
  },
]
