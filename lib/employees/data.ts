/**
 * Employees — server reads and writes, scoped by rep_id (the signed-in org).
 * Tables are service-role only (supabase/cxo_plan_employees.sql). Salary and
 * bonus figures are stripped here unless the caller may see comp, so no page
 * or tool can leak them by forgetting to.
 *
 * member_id on cxo_employees links a future employee login to their own row;
 * `employeeForMember` is the one read that login will use.
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
} from './shared'

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
  }
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
}

export async function loadEmployees(repId: string, comp: boolean): Promise<EmployeesData> {
  const [e, k, a, t, r, l] = await Promise.all([
    supabase.from('cxo_employees').select('*').eq('rep_id', repId).eq('active', true).order('name').limit(2000),
    supabase.from('cxo_employee_kpis').select('*').eq('rep_id', repId).order('sort').limit(5000),
    supabase.from('cxo_kpi_actuals').select('kpi_id, employee_id, period_key, actual').eq('rep_id', repId).order('period_key', { ascending: false }).limit(20000),
    comp ? supabase.from('cxo_comp_tiers').select('*').eq('rep_id', repId).order('attain_pct').limit(5000) : Promise.resolve({ data: [], error: null }),
    supabase.from('cxo_reviews').select('*').eq('rep_id', repId).order('created_at', { ascending: false }).limit(5000),
    comp ? supabase.from('cxo_payout_periods').select('period_key, approved_at, approved_by_name, total, lines').eq('rep_id', repId).order('period_key', { ascending: false }).limit(48) : Promise.resolve({ data: [], error: null }),
  ])
  for (const [what, res] of [['employees', e], ['kpis', k], ['actuals', a], ['tiers', t], ['reviews', r], ['payouts', l]] as const) {
    if (res.error) throw new Error(`${what}: ${res.error.message}`)
  }
  return {
    employees: (e.data ?? []).map((x) => rowToEmployee(x, comp)),
    kpis: (k.data ?? []).map((x) => ({ id: x.id, employee_id: x.employee_id, name: x.name, unit: x.unit, target: num(x.target), period: x.period, weight: num(x.weight) || 1, lower_is_better: !!x.lower_is_better, sort: num(x.sort) })),
    actuals: (a.data ?? []).map((x) => ({ kpi_id: x.kpi_id, employee_id: x.employee_id, period_key: x.period_key, actual: num(x.actual) })),
    tiers: (t.data ?? []).map((x: Record<string, unknown>) => ({ id: String(x.id), employee_id: String(x.employee_id), kpi_id: (x.kpi_id as string) ?? null, period: x.period as Period, attain_pct: num(x.attain_pct), bonus: num(x.bonus) })),
    reviews: (r.data ?? []).map((x) => ({ id: x.id, employee_id: x.employee_id, period_type: x.period_type, period_key: x.period_key, overall: x.overall == null ? null : num(x.overall), kpi_ratings: (x.kpi_ratings ?? {}) as Record<string, number>, notes: x.notes ?? null, reviewer_name: x.reviewer_name ?? null, created_at: x.created_at })),
    locks: (l.data ?? []).map((x: Record<string, unknown>) => ({ period_key: String(x.period_key), approved_at: String(x.approved_at), approved_by_name: (x.approved_by_name as string) ?? null, total: num(x.total), lines: (x.lines ?? []) as PayoutLine[] })),
  }
}

/** For the future employee login: only their own record, never anyone else's. */
export async function employeeForMember(repId: string, memberId: string): Promise<Employee | null> {
  const { data } = await supabase.from('cxo_employees').select('*').eq('rep_id', repId).eq('member_id', memberId).maybeSingle()
  return data ? rowToEmployee(data, true) : null
}

export type EmployeeInput = Partial<Omit<Employee, 'id' | 'active'>> & { name?: string }

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
  for (const t of ['cxo_kpi_actuals', 'cxo_comp_tiers', 'cxo_reviews'] as const) {
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
    period: k.period === 'quarter' ? 'quarter' : 'month',
    weight: num(k.weight) || 1,
    lower_is_better: !!k.lower_is_better,
    sort: num(k.sort),
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

export async function saveActual(repId: string, kpiId: string, periodKey: string, actual: number | null): Promise<void> {
  if (await isLocked(repId, periodKey)) throw new Error('This period is approved and locked for payroll.')
  const { data: kpi } = await supabase.from('cxo_employee_kpis').select('id, employee_id').eq('rep_id', repId).eq('id', kpiId).maybeSingle()
  if (!kpi) throw new Error('KPI not found.')
  if (actual == null) {
    await supabase.from('cxo_kpi_actuals').delete().eq('rep_id', repId).eq('kpi_id', kpiId).eq('period_key', periodKey)
    return
  }
  const { error } = await supabase
    .from('cxo_kpi_actuals')
    .upsert({ rep_id: repId, kpi_id: kpiId, employee_id: kpi.employee_id, period_key: periodKey, actual, source: 'entered', updated_at: new Date().toISOString() }, { onConflict: 'kpi_id,period_key' })
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
