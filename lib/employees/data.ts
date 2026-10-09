/**
 * Employees — server reads and writes, scoped by rep_id (the signed-in org).
 * Tables are service-role only (supabase/cxo_plan_employees.sql). Salary and
 * bonus figures are stripped here unless the caller may see comp, so no page
 * or tool can leak them by forgetting to.
 *
 * member_id on cxo_employees links an employee login (role rep/observer on an
 * exec tenant) to their own row; `loadSelfView` is the only read that login
 * gets, and it never returns anyone else's row.
 *
 * Quota actuals come from three places, in this order of trust:
 *   1. 'book' quotas (Premium $ / Policies) read live from the Pinnacle book
 *      for the employee's book_match (agent or team name), current periods only;
 *   2. imported or entered actuals (cxo_kpi_actuals);
 * QuickBooks people/time (cxo_qbo_employees / cxo_qbo_time_activity) is read
 * by `loadQboPeople` and matched by qbo_employee_id, then email, then name.
 */
import { supabase } from '@/lib/supabase'
import {
  payoutsForAll,
  periodKeyFor,
  type CompTier,
  type Employee,
  type EmployeeImportRow,
  type Kpi,
  type KpiActual,
  type PayoutLine,
  type PayoutLock,
  type Period,
  type Review,
  type TimeOff,
  type TimeOffKind,
  periodRange,
  PERIODS,
  weekdaysBetween,
} from './shared'
import { fetchBreakdown, isPinnacleViewer } from '@/lib/pinnacle/rollup'

const num = (v: unknown): number => Number(v) || 0
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

function rowToEmployee(r: Record<string, unknown>, comp: boolean): Employee {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    title: (r.title as string) ?? null,
    department: String(r.department ?? ''),
    manager_id: (r.manager_id as string) ?? null,
    start_date: (r.start_date as string) ?? null,
    email: (r.email as string) ?? null,
    base_salary: comp ? numOrNull(r.base_salary) : null,
    pay_frequency: (r.pay_frequency as Employee['pay_frequency']) ?? 'biweekly',
    member_id: (r.member_id as string) ?? null,
    active: r.active !== false,
    hourly_rate: comp ? numOrNull(r.hourly_rate) : null,
    hours_per_week: numOrNull(r.hours_per_week),
    pto_allowed_days: numOrNull(r.pto_allowed_days),
    pto_balance_days: numOrNull(r.pto_balance_days),
    book_match: (r.book_match as string) || null,
    book_dim: r.book_dim === 'agent' || r.book_dim === 'team' ? r.book_dim : null,
    qbo_employee_id: (r.qbo_employee_id as string) || null,
  }
}

function rowToKpi(x: Record<string, unknown>): Kpi {
  return {
    id: String(x.id),
    employee_id: String(x.employee_id),
    name: String(x.name ?? ''),
    unit: x.unit as Kpi['unit'],
    target: num(x.target),
    period: (PERIODS as string[]).includes(String(x.period)) ? (x.period as Period) : 'month',
    weight: num(x.weight) || 1,
    lower_is_better: !!x.lower_is_better,
    sort: num(x.sort),
    quota_type: (x.quota_type as Kpi['quota_type']) || 'custom',
    actual_source: x.actual_source === 'book' ? 'book' : 'manual',
  }
}

function rowToTimeOff(x: Record<string, unknown>): TimeOff {
  return { id: String(x.id), employee_id: String(x.employee_id), start_date: String(x.start_date), end_date: String(x.end_date), days: num(x.days), kind: (x.kind as TimeOffKind) ?? 'other', note: (x.note as string) ?? null }
}

// ── Book link (Premium $ / Policies from the Pinnacle book) ──────────────

/** The book is readable for this org (same gate as the Revenue/Team pages). */
export function bookReadable(repId: string): boolean {
  return isPinnacleViewer(repId)
}

/**
 * Live actuals for 'book' quotas in their current period: premium or policy
 * count credited to the employee's book_match. A name that is not in the
 * book reads as no actual (never a made-up zero).
 */
export async function bookActuals(repId: string, employees: Employee[], kpis: Kpi[], today: string): Promise<KpiActual[]> {
  const linked = kpis.filter((k) => k.actual_source === 'book' && (k.quota_type === 'premium' || k.quota_type === 'policies'))
  if (linked.length === 0 || !bookReadable(repId)) return []
  const byId = new Map(employees.map((e) => [e.id, e]))
  const cache = new Map<string, Promise<Awaited<ReturnType<typeof fetchBreakdown>>>>()
  const out: KpiActual[] = []
  for (const k of linked) {
    const emp = byId.get(k.employee_id)
    if (!emp?.book_match) continue
    const dim = emp.book_dim ?? 'agent'
    const key = periodKeyFor(k.period, today)
    const range = periodRange(key)
    if (!range) continue
    const end = range.end < today ? range.end : today
    const ck = `${dim}|${range.start}|${end}`
    if (!cache.has(ck)) cache.set(ck, fetchBreakdown(dim, 'All', range.start, end, 200).catch(() => []))
    const rows = await cache.get(ck)!
    const want = emp.book_match.trim().toLowerCase()
    const hits = rows.filter((r) => r.label.trim().toLowerCase() === want)
    if (hits.length === 0) continue
    const v = hits.reduce((s, r) => s + (k.quota_type === 'premium' ? r.premium : r.policies), 0)
    out.push({ kpi_id: k.id, employee_id: k.employee_id, period_key: key, actual: v })
  }
  return out
}

/** Book actuals replace stored ones for the same quota and period. */
function mergeActuals(stored: KpiActual[], live: KpiActual[]): KpiActual[] {
  if (live.length === 0) return stored
  const keys = new Set(live.map((a) => `${a.kpi_id}|${a.period_key}`))
  return [...live, ...stored.filter((a) => !keys.has(`${a.kpi_id}|${a.period_key}`))]
}

// ── QuickBooks seam (read only; synced by lib/qbo/data.ts) ──────────────

export type QboPerson = {
  qbo_id: string
  name: string
  active: boolean
  /** Hours from QuickBooks time activity, by month ('2026-10'), last 6 months. */
  hoursByMonth: Array<{ month: string; hours: number }>
  hoursThisMonth: number
  /** Hourly cost rate from QuickBooks (comp viewers only). */
  costRate: number | null
  matchedBy: 'link' | 'email' | 'name'
}

/** QuickBooks employees + hours matched to our employees. Empty when QuickBooks is not connected or synced. */
export async function loadQboPeople(repId: string, employees: Employee[], today: string, comp: boolean): Promise<Record<string, QboPerson>> {
  const out: Record<string, QboPerson> = {}
  if (employees.length === 0) return out
  const { data: qe, error } = await supabase.from('cxo_qbo_employees').select('qbo_id, display_name, email, active, cost_rate').eq('rep_id', repId).limit(5000)
  if (error || !qe || qe.length === 0) return out
  const months: string[] = []
  const [ty, tm] = today.split('-').map(Number)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1))
    months.push(d.toISOString().slice(0, 7))
  }
  const matched = new Map<string, { row: (typeof qe)[number]; by: QboPerson['matchedBy'] }>()
  for (const e of employees) {
    const low = (s: unknown) => String(s ?? '').trim().toLowerCase()
    let row = e.qbo_employee_id ? qe.find((q) => q.qbo_id === e.qbo_employee_id) : undefined
    let by: QboPerson['matchedBy'] = 'link'
    if (!row && e.email) {
      row = qe.find((q) => low(q.email) && low(q.email) === low(e.email))
      by = 'email'
    }
    if (!row) {
      const same = qe.filter((q) => low(q.display_name) === low(e.name))
      if (same.length === 1) row = same[0]
      by = 'name'
    }
    if (row) matched.set(e.id, { row, by })
  }
  if (matched.size === 0) return out
  const ids = [...new Set([...matched.values()].map((m) => String(m.row.qbo_id)))]
  const { data: ta } = await supabase
    .from('cxo_qbo_time_activity')
    .select('employee_qbo_id, txn_date, hours')
    .eq('rep_id', repId)
    .in('employee_qbo_id', ids)
    .gte('txn_date', `${months[0]}-01`)
    .limit(20000)
  const hours = new Map<string, Map<string, number>>()
  for (const t of ta ?? []) {
    const m = String(t.txn_date).slice(0, 7)
    const per = hours.get(String(t.employee_qbo_id)) ?? new Map<string, number>()
    per.set(m, (per.get(m) ?? 0) + (Number(t.hours) || 0))
    hours.set(String(t.employee_qbo_id), per)
  }
  for (const [empId, { row, by }] of matched) {
    const per = hours.get(String(row.qbo_id)) ?? new Map<string, number>()
    const hoursByMonth = months.map((month) => ({ month, hours: Math.round((per.get(month) ?? 0) * 10) / 10 }))
    out[empId] = {
      qbo_id: String(row.qbo_id),
      name: String(row.display_name ?? ''),
      active: row.active !== false,
      hoursByMonth,
      hoursThisMonth: hoursByMonth[hoursByMonth.length - 1]?.hours ?? 0,
      costRate: comp ? numOrNull(row.cost_rate) : null,
      matchedBy: by,
    }
  }
  return out
}

export type EmployeesData = {
  employees: Employee[]
  kpis: Kpi[]
  actuals: KpiActual[]
  /** Empty unless the viewer may see comp. */
  tiers: CompTier[]
  reviews: Review[]
  /** Payout locks for the current month and quarter (comp viewers only). */
  locks: PayoutLock[]
  timeOff: TimeOff[]
  /** QuickBooks people/hours by our employee id (empty until QuickBooks is synced). */
  qbo: Record<string, QboPerson>
  /** The book can feed Premium / Policies quotas for this org. */
  bookLinked: boolean
}

/** Everything on the Employees page. Pass `today` to merge live book actuals and QuickBooks hours. */
export async function loadEmployees(repId: string, comp: boolean, today?: string): Promise<EmployeesData> {
  const [e, k, a, t, r, l, o] = await Promise.all([
    supabase.from('cxo_employees').select('*').eq('rep_id', repId).eq('active', true).order('name').limit(2000),
    supabase.from('cxo_employee_kpis').select('*').eq('rep_id', repId).order('sort').limit(5000),
    supabase.from('cxo_kpi_actuals').select('kpi_id, employee_id, period_key, actual').eq('rep_id', repId).order('period_key', { ascending: false }).limit(20000),
    comp ? supabase.from('cxo_comp_tiers').select('*').eq('rep_id', repId).order('attain_pct').limit(5000) : Promise.resolve({ data: [], error: null }),
    supabase.from('cxo_reviews').select('*').eq('rep_id', repId).order('created_at', { ascending: false }).limit(5000),
    comp ? supabase.from('cxo_payout_periods').select('period_key, approved_at, approved_by_name, total, lines').eq('rep_id', repId).order('period_key', { ascending: false }).limit(48) : Promise.resolve({ data: [], error: null }),
    supabase.from('cxo_employee_time_off').select('*').eq('rep_id', repId).order('start_date', { ascending: false }).limit(5000),
  ])
  for (const [what, res] of [['employees', e], ['kpis', k], ['actuals', a], ['tiers', t], ['reviews', r], ['payouts', l], ['time off', o]] as const) {
    if (res.error) throw new Error(`${what}: ${res.error.message}`)
  }
  const employees = (e.data ?? []).map((x) => rowToEmployee(x, comp))
  const kpis = (k.data ?? []).map(rowToKpi)
  const stored = (a.data ?? []).map((x) => ({ kpi_id: x.kpi_id, employee_id: x.employee_id, period_key: x.period_key, actual: num(x.actual) }))
  const [live, qbo] = today
    ? await Promise.all([bookActuals(repId, employees, kpis, today).catch(() => [] as KpiActual[]), loadQboPeople(repId, employees, today, comp).catch(() => ({}))])
    : [[] as KpiActual[], {} as Record<string, QboPerson>]
  return {
    employees,
    kpis,
    actuals: mergeActuals(stored, live),
    timeOff: (o.data ?? []).map(rowToTimeOff),
    qbo,
    bookLinked: bookReadable(repId),
    tiers: (t.data ?? []).map((x: Record<string, unknown>) => ({ id: String(x.id), employee_id: String(x.employee_id), kpi_id: (x.kpi_id as string) ?? null, period: x.period as Period, attain_pct: num(x.attain_pct), bonus: num(x.bonus) })),
    reviews: (r.data ?? []).map((x) => ({ id: x.id, employee_id: x.employee_id, period_type: x.period_type, period_key: x.period_key, overall: x.overall == null ? null : num(x.overall), kpi_ratings: (x.kpi_ratings ?? {}) as Record<string, number>, notes: x.notes ?? null, reviewer_name: x.reviewer_name ?? null, created_at: x.created_at })),
    locks: (l.data ?? []).map((x: Record<string, unknown>) => ({ period_key: String(x.period_key), approved_at: String(x.approved_at), approved_by_name: (x.approved_by_name as string) ?? null, total: num(x.total), lines: (x.lines ?? []) as PayoutLine[] })),
  }
}

/** The employee row linked to a login (pay stripped). */
export async function employeeForMember(repId: string, memberId: string): Promise<Employee | null> {
  const { data } = await supabase.from('cxo_employees').select('*').eq('rep_id', repId).eq('member_id', memberId).eq('active', true).limit(1).maybeSingle()
  return data ? rowToEmployee(data, false) : null
}

export type SelfView = { employee: Employee; kpis: Kpi[]; actuals: KpiActual[]; tiers: CompTier[]; timeOff: TimeOff[]; hoursThisMonth: number | null; manager: string | null }

/**
 * Everything an employee login may see: their own quotas, actuals, their own
 * bonus tiers, time off and hours. Every query is filtered by their employee
 * id; no other employee, no pay, no company figures.
 */
export async function loadSelfView(repId: string, memberId: string, today: string): Promise<SelfView | null> {
  const employee = await employeeForMember(repId, memberId)
  if (!employee) return null
  const id = employee.id
  const [k, a, t, o, m] = await Promise.all([
    supabase.from('cxo_employee_kpis').select('*').eq('rep_id', repId).eq('employee_id', id).order('sort').limit(200),
    supabase.from('cxo_kpi_actuals').select('kpi_id, employee_id, period_key, actual').eq('rep_id', repId).eq('employee_id', id).order('period_key', { ascending: false }).limit(2000),
    supabase.from('cxo_comp_tiers').select('*').eq('rep_id', repId).eq('employee_id', id).order('attain_pct').limit(500),
    supabase.from('cxo_employee_time_off').select('*').eq('rep_id', repId).eq('employee_id', id).order('start_date', { ascending: false }).limit(500),
    employee.manager_id ? supabase.from('cxo_employees').select('name').eq('rep_id', repId).eq('id', employee.manager_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const kpis = (k.data ?? []).map(rowToKpi)
  const stored = (a.data ?? []).map((x) => ({ kpi_id: x.kpi_id, employee_id: x.employee_id, period_key: x.period_key, actual: num(x.actual) }))
  const live = await bookActuals(repId, [{ ...employee, book_match: employee.book_match, book_dim: employee.book_dim }], kpis, today).catch(() => [] as KpiActual[])
  const qbo = await loadQboPeople(repId, [employee], today, false).catch(() => ({}) as Record<string, QboPerson>)
  return {
    employee,
    kpis,
    actuals: mergeActuals(stored, live),
    tiers: (t.data ?? []).map((x: Record<string, unknown>) => ({ id: String(x.id), employee_id: String(x.employee_id), kpi_id: (x.kpi_id as string) ?? null, period: x.period as Period, attain_pct: num(x.attain_pct), bonus: num(x.bonus) })),
    timeOff: (o.data ?? []).map(rowToTimeOff),
    hoursThisMonth: qbo[id]?.hoursThisMonth ?? null,
    manager: (m.data as { name?: string } | null)?.name ?? null,
  }
}

export type EmployeeInput = Partial<Omit<Employee, 'id' | 'active' | 'member_id'>> & { name?: string }

export async function upsertEmployee(repId: string, id: string | null, input: EmployeeInput, comp: boolean): Promise<string> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) row.name = String(input.name).trim().slice(0, 120)
  if (input.title !== undefined) row.title = input.title ? String(input.title).trim().slice(0, 120) : null
  if (input.department !== undefined) row.department = String(input.department ?? '').trim().slice(0, 80)
  if (input.manager_id !== undefined) row.manager_id = input.manager_id && input.manager_id !== id ? input.manager_id : null
  if (input.start_date !== undefined) row.start_date = input.start_date || null
  if (input.email !== undefined) row.email = input.email ? String(input.email).trim().slice(0, 200) : null
  if (comp && input.base_salary !== undefined) row.base_salary = input.base_salary
  if (comp && input.pay_frequency !== undefined) row.pay_frequency = input.pay_frequency
  if (comp && input.hourly_rate !== undefined) row.hourly_rate = input.hourly_rate
  const nn = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v < 0 ? null : v)
  if (input.hours_per_week !== undefined) row.hours_per_week = nn(input.hours_per_week)
  if (input.pto_allowed_days !== undefined) row.pto_allowed_days = nn(input.pto_allowed_days)
  if (input.pto_balance_days !== undefined) row.pto_balance_days = input.pto_balance_days == null || !Number.isFinite(input.pto_balance_days) ? null : input.pto_balance_days
  if (input.book_match !== undefined) row.book_match = input.book_match ? String(input.book_match).trim().slice(0, 120) : null
  if (input.book_dim !== undefined) row.book_dim = input.book_dim === 'team' ? 'team' : input.book_dim === 'agent' ? 'agent' : null
  if (input.qbo_employee_id !== undefined) row.qbo_employee_id = input.qbo_employee_id ? String(input.qbo_employee_id).slice(0, 64) : null
  if (row.manager_id) {
    const { data } = await supabase.from('cxo_employees').select('id').eq('rep_id', repId).eq('id', row.manager_id as string).maybeSingle()
    if (!data) row.manager_id = null
  }
  if (id) {
    const { error } = await supabase.from('cxo_employees').update(row).eq('rep_id', repId).eq('id', id)
    if (error) throw new Error(`save employee: ${error.message}`)
    return id
  }
  if (!row.name) throw new Error('Add a name.')
  const { data, error } = await supabase.from('cxo_employees').insert({ ...row, rep_id: repId }).select('id').single()
  if (error) throw new Error(`add employee: ${error.message}`)
  return data.id as string
}

export async function removeEmployee(repId: string, id: string): Promise<void> {
  // Their KPIs, actuals, tiers and reviews go with them; reports lose this manager.
  for (const t of ['cxo_kpi_actuals', 'cxo_comp_tiers', 'cxo_reviews', 'cxo_employee_time_off'] as const) {
    await supabase.from(t).delete().eq('rep_id', repId).eq('employee_id', id)
  }
  const { error } = await supabase.from('cxo_employees').delete().eq('rep_id', repId).eq('id', id)
  if (error) throw new Error(`remove employee: ${error.message}`)
}

export async function importEmployees(repId: string, rows: EmployeeImportRow[], comp: boolean): Promise<{ added: number; updated: number }> {
  const { data: existing } = await supabase.from('cxo_employees').select('id, name').eq('rep_id', repId).limit(5000)
  const byName = new Map<string, string>((existing ?? []).map((r) => [String(r.name).toLowerCase().trim(), String(r.id)]))
  let added = 0
  let updated = 0
  for (const r of rows) {
    const id = byName.get(r.name.toLowerCase().trim()) ?? null
    const newId = await upsertEmployee(repId, id, { name: r.name, title: r.title, department: r.department, start_date: r.start_date, email: r.email, base_salary: r.base_salary, pay_frequency: r.pay_frequency }, comp)
    byName.set(r.name.toLowerCase().trim(), newId)
    if (id) updated++
    else added++
  }
  // Second pass: managers by name, now every row exists.
  for (const r of rows) {
    if (!r.manager) continue
    const id = byName.get(r.name.toLowerCase().trim())
    const mgr = byName.get(r.manager.toLowerCase().trim())
    if (id && mgr && id !== mgr) await supabase.from('cxo_employees').update({ manager_id: mgr }).eq('rep_id', repId).eq('id', id)
  }
  return { added, updated }
}

export async function saveKpi(repId: string, k: Partial<Kpi> & { employee_id: string }): Promise<string> {
  const row = {
    rep_id: repId,
    employee_id: k.employee_id,
    name: String(k.name ?? '').trim().slice(0, 120),
    unit: k.unit ?? 'count',
    target: num(k.target),
    period: k.period === 'quarter' ? 'quarter' : k.period === 'year' ? 'year' : 'month',
    weight: num(k.weight) || 1,
    lower_is_better: !!k.lower_is_better,
    sort: num(k.sort),
    quota_type: k.quota_type ?? 'custom',
    actual_source: k.actual_source === 'book' && (k.quota_type === 'premium' || k.quota_type === 'policies') ? 'book' : 'manual',
  }
  if (!row.name) throw new Error('Name the KPI.')
  const { data: emp } = await supabase.from('cxo_employees').select('id').eq('rep_id', repId).eq('id', k.employee_id).maybeSingle()
  if (!emp) throw new Error('Employee not found.')
  if (k.id) {
    const { error } = await supabase.from('cxo_employee_kpis').update(row).eq('rep_id', repId).eq('id', k.id)
    if (error) throw new Error(`save KPI: ${error.message}`)
    return k.id
  }
  const { data, error } = await supabase.from('cxo_employee_kpis').insert(row).select('id').single()
  if (error) throw new Error(`add KPI: ${error.message}`)
  return data.id as string
}

export async function removeKpi(repId: string, id: string): Promise<void> {
  await supabase.from('cxo_comp_tiers').delete().eq('rep_id', repId).eq('kpi_id', id)
  const { error } = await supabase.from('cxo_employee_kpis').delete().eq('rep_id', repId).eq('id', id)
  if (error) throw new Error(`remove KPI: ${error.message}`)
}

export async function isLocked(repId: string, periodKey: string): Promise<boolean> {
  const { data } = await supabase.from('cxo_payout_periods').select('id').eq('rep_id', repId).eq('period_key', periodKey).maybeSingle()
  return !!data
}

export async function saveActual(repId: string, kpiId: string, periodKey: string, actual: number | null, source: 'entered' | 'import' | 'mira' = 'entered'): Promise<void> {
  if (await isLocked(repId, periodKey)) throw new Error('This period is approved and locked for payroll.')
  const { data: kpi } = await supabase.from('cxo_employee_kpis').select('id, employee_id').eq('rep_id', repId).eq('id', kpiId).maybeSingle()
  if (!kpi) throw new Error('KPI not found.')
  if (actual == null) {
    await supabase.from('cxo_kpi_actuals').delete().eq('rep_id', repId).eq('kpi_id', kpiId).eq('period_key', periodKey)
    return
  }
  const { error } = await supabase
    .from('cxo_kpi_actuals')
    .upsert({ rep_id: repId, kpi_id: kpiId, employee_id: kpi.employee_id, period_key: periodKey, actual, source, updated_at: new Date().toISOString() }, { onConflict: 'kpi_id,period_key' })
  if (error) throw new Error(`save actual: ${error.message}`)
}

export async function saveTiers(repId: string, employeeId: string, period: Period, kpiId: string | null, tiers: Array<{ attain_pct: number; bonus: number }>): Promise<void> {
  let del = supabase.from('cxo_comp_tiers').delete().eq('rep_id', repId).eq('employee_id', employeeId).eq('period', period)
  del = kpiId ? del.eq('kpi_id', kpiId) : del.is('kpi_id', null)
  const { error: de } = await del
  if (de) throw new Error(`clear tiers: ${de.message}`)
  const rows = tiers
    .filter((t) => Number.isFinite(t.attain_pct) && t.attain_pct > 0 && Number.isFinite(t.bonus))
    .map((t) => ({ rep_id: repId, employee_id: employeeId, kpi_id: kpiId, period, attain_pct: t.attain_pct, bonus: t.bonus }))
  if (rows.length === 0) return
  const { error } = await supabase.from('cxo_comp_tiers').insert(rows)
  if (error) throw new Error(`save tiers: ${error.message}`)
}

export async function addReview(
  repId: string,
  r: { employee_id: string; period_type: Review['period_type']; period_key: string; overall: number | null; kpi_ratings: Record<string, number>; notes: string | null },
  reviewer: { id: string; name: string | null },
): Promise<void> {
  const clamp = (v: unknown) => (v == null ? null : Math.min(5, Math.max(1, Math.round(Number(v)))))
  const ratings: Record<string, number> = {}
  for (const [k, v] of Object.entries(r.kpi_ratings ?? {})) {
    const c = clamp(v)
    if (c != null) ratings[k] = c
  }
  const { data: emp } = await supabase.from('cxo_employees').select('id').eq('rep_id', repId).eq('id', r.employee_id).maybeSingle()
  if (!emp) throw new Error('Employee not found.')
  const { error } = await supabase.from('cxo_reviews').insert({
    rep_id: repId,
    employee_id: r.employee_id,
    period_type: r.period_type,
    period_key: r.period_key.slice(0, 16),
    overall: clamp(r.overall),
    kpi_ratings: ratings,
    notes: r.notes ? r.notes.slice(0, 4000) : null,
    reviewer_id: reviewer.id,
    reviewer_name: reviewer.name,
  })
  if (error) throw new Error(`save review: ${error.message}`)
}

export async function removeReview(repId: string, id: string): Promise<void> {
  await supabase.from('cxo_reviews').delete().eq('rep_id', repId).eq('id', id)
}

/** Every employee's payout for the period that contains `today`. */
export function payoutsFor(data: EmployeesData, period: Period, today: string, periodKey = periodKeyFor(period, today)): PayoutLine[] {
  return payoutsForAll(data, periodKey, today)
}

/** Approve a period: snapshot the payouts and lock actual edits for it. */
export async function approvePeriod(repId: string, periodKey: string, lines: PayoutLine[], by: { id: string; name: string | null }): Promise<void> {
  const total = lines.reduce((s, l) => s + l.total, 0)
  const { error } = await supabase.from('cxo_payout_periods').insert({
    rep_id: repId,
    period_key: periodKey,
    approved_at: new Date().toISOString(),
    approved_by: by.id,
    approved_by_name: by.name,
    total,
    lines,
  })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('This period is already approved.')
    throw new Error(`approve: ${error.message}`)
  }
}

export async function unlockPeriod(repId: string, periodKey: string): Promise<void> {
  await supabase.from('cxo_payout_periods').delete().eq('rep_id', repId).eq('period_key', periodKey)
}

// ── Time off ─────────────────────────────────────────────────────────────

export async function addTimeOff(repId: string, t: { employee_id: string; start_date: string; end_date?: string | null; days?: number | null; kind: TimeOffKind; note?: string | null; source?: string }): Promise<string> {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!iso.test(t.start_date)) throw new Error('Pick a start date.')
  const end = t.end_date && iso.test(t.end_date) && t.end_date >= t.start_date ? t.end_date : t.start_date
  const days = t.days != null && Number.isFinite(t.days) && t.days >= 0 ? t.days : Math.max(0.5, weekdaysBetween(t.start_date, end))
  const { data: emp } = await supabase.from('cxo_employees').select('id').eq('rep_id', repId).eq('id', t.employee_id).maybeSingle()
  if (!emp) throw new Error('Employee not found.')
  const { data, error } = await supabase
    .from('cxo_employee_time_off')
    .insert({ rep_id: repId, employee_id: t.employee_id, start_date: t.start_date, end_date: end, days, kind: t.kind, note: t.note ? t.note.slice(0, 300) : null, source: t.source ?? 'entered' })
    .select('id')
    .single()
  if (error) throw new Error(`time off: ${error.message}`)
  return data.id as string
}

export async function removeTimeOff(repId: string, id: string): Promise<void> {
  await supabase.from('cxo_employee_time_off').delete().eq('rep_id', repId).eq('id', id)
}

/** Link (or unlink) an employee row to a login. The member must be in the same org. */
export async function linkEmployeeMember(repId: string, employeeId: string, memberId: string | null): Promise<void> {
  if (memberId) await supabase.from('cxo_employees').update({ member_id: null }).eq('rep_id', repId).eq('member_id', memberId).neq('id', employeeId)
  const { error } = await supabase.from('cxo_employees').update({ member_id: memberId, updated_at: new Date().toISOString() }).eq('rep_id', repId).eq('id', employeeId)
  if (error) throw new Error(`link login: ${error.message}`)
}
