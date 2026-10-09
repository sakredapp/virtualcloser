/**
 * Owner 10-09: "make sure we're not leaking all of their financial records
 * into AI". Every Mira tool fixed for that runs on fake rows that carry a
 * client name and a salary; neither may appear in what goes back to Claude.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  const chain = () => q
  for (const k of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order', 'limit', 'ilike', 'insert', 'update', 'upsert', 'delete']) q[k] = chain
  q.maybeSingle = async () => ({ data: null, error: null })
  q.single = async () => ({ data: null, error: null })
  q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null })
  return { supabase: { from: () => q, rpc: async () => ({ data: [], error: null }) } }
})

const CLIENT = 'Margaret Q. Policyholder'
const SALARY = 87654
const HOURLY = 43.21

const commissions = [
  { id: 'c1', rep_id: 't1', agent_name: 'Agent Alpha', client_name: CLIENT, carrier: 'Americo', product: 'IUL', premium: 2400, commission_amount: 1800, commission_rate: 0.75, status: 'expected', deposit_id: null, sale_date: '2026-10-01', paid_on: null, notes: `call ${CLIENT}`, created_at: '2026-10-01' },
  { id: 'c2', rep_id: 't1', agent_name: 'Agent Beta', client_name: 'Other Client Name', carrier: 'Mutual', product: 'FE', premium: 1200, commission_amount: 900, commission_rate: 0.75, status: 'paid', deposit_id: null, sale_date: '2026-09-01', paid_on: '2026-09-20', notes: null, created_at: '2026-09-01' },
]
const deposits = [{ id: 'd1', rep_id: 't1', carrier: 'Americo', amount: 1800, deposited_on: '2026-10-05', matched: false, notes: `for ${CLIENT}`, created_at: '2026-10-05' }]

vi.mock('@/lib/payroll/data', async (orig) => {
  const real = await orig<typeof import('@/lib/payroll/data')>()
  return { ...real, listCommissions: vi.fn(async () => commissions), listDeposits: vi.fn(async () => deposits) }
})

const emp = {
  id: 'e1', name: 'Joe Sample', title: 'Contracting', department: 'Ops', manager_id: null, start_date: '2025-01-01', email: 'joe@example.com',
  base_salary: SALARY, pay_frequency: 'biweekly', member_id: null, active: true, hourly_rate: HOURLY, hours_per_week: 40,
  pto_allowed_days: 15, pto_balance_days: 10, book_match: null, book_dim: null, qbo_employee_id: null,
}
const kpi = { id: 'k1', employee_id: 'e1', name: 'Policies', unit: 'count', target: 40, period: 'month', weight: 1, lower_is_better: false, sort: 0, quota_type: 'policies', actual_source: 'manual' }
const employeesData = () => ({
  employees: [emp],
  kpis: [kpi],
  actuals: [{ kpi_id: 'k1', employee_id: 'e1', period_key: '2026-10', actual: 30 }],
  tiers: [
    { employee_id: 'e1', kpi_id: 'k1', period: 'month', attain_pct: 50, bonus: 7777 },
    { employee_id: 'e1', kpi_id: 'k1', period: 'month', attain_pct: 100, bonus: 9999 },
  ],
  reviews: [],
  locks: [],
  timeOff: [],
  qbo: { e1: { hourly_rate: HOURLY, base_salary: SALARY } },
  bookLinked: false,
})
const upsertEmployee = vi.fn(async () => 'e1')
vi.mock('@/lib/employees/data', () => ({
  loadEmployees: vi.fn(async () => employeesData()),
  upsertEmployee: (...a: unknown[]) => upsertEmployee(...(a as [])),
  addTimeOff: vi.fn(async () => undefined),
  isLocked: vi.fn(async () => false),
  saveActual: vi.fn(async () => undefined),
  saveKpi: vi.fn(async () => 'k1'),
}))

vi.mock('@/lib/qbo/data', () => ({
  getQboStatus: vi.fn(async () => ({ configured: true, connected: true, needsReconnect: false, companyName: 'Co', environment: 'production', lastSyncAt: null })),
  loadQboMonths: vi.fn(async () => []),
  loadExpenseCategories: vi.fn(async () => []),
  loadBreakdown: vi.fn(async () => [
    { name: 'Big Customer LLC', amount: 5000, invoice_lines: [`${CLIENT} premium`], memo: `salary ${SALARY}` },
  ]),
}))

const ctx = {
  tenant: { id: 't1', brand: 'cxo' },
  caller: { id: 'm1', role: 'owner', display_name: 'Exec', settings: {} },
  timezone: 'America/New_York',
  todayIso: '2026-10-15',
  ownerMemberId: 'm1',
} as never

const leaks = (out: string) => {
  expect(out).not.toContain(CLIENT)
  expect(out).not.toContain('Other Client Name')
  expect(out).not.toContain(String(SALARY))
  expect(out).not.toContain('87,654')
  expect(out).not.toContain(String(HOURLY))
}

describe('no client names or pay in Mira tool output', () => {
  beforeEach(() => upsertEmployee.mockClear())

  it('payroll tool: every view', async () => {
    const { TOOL_HANDLERS } = await import('@/lib/agent/tools')
    for (const view of ['summary', 'by_agent', 'unpaid', 'deposits', 'all']) {
      const r = await TOOL_HANDLERS.payroll(ctx, { view })
      leaks(r.text)
      if (view === 'unpaid' || view === 'all') {
        const j = JSON.parse(r.text)
        expect(j.unpaid[0]).toEqual({ agent: 'Agent Alpha', carrier: 'Americo', commission: 1800, status: 'expected' })
        expect(j.unpaid_total).toBe(1800)
      }
    }
  })

  it('payroll assistant context', async () => {
    const { payrollContextLines } = await import('@/lib/payroll/aiView')
    const text = payrollContextLines(commissions as never, deposits as never).join('\n')
    leaks(text)
    expect(text).toContain('Agent Alpha / Americo')
  })

  it('employee tools: quota status, update_employee, set quota, time off', async () => {
    const { CXO_EMPLOYEE_TOOL_HANDLERS: h } = await import('@/lib/agent/cxoEmployeeTools')
    const status = await h.employee_quota_status(ctx, {})
    leaks(status.text)
    expect(status.text).not.toContain('7777')
    expect(status.text).not.toContain('9999')
    expect(JSON.parse(status.text).people[0].quotas[0]).toMatchObject({ pct: 75, tier_reached_pct: 50 })

    const upd = await h.update_employee(ctx, { employee: 'Joe', base_salary: SALARY, hourly_rate: HOURLY, title: 'Lead' })
    leaks(upd.text)
    expect(JSON.parse(upd.text).say).toBe('Updated Joe Sample: title. Salary saved.')
    expect(upsertEmployee).toHaveBeenCalledWith('t1', 'e1', expect.objectContaining({ base_salary: SALARY, hourly_rate: HOURLY }), true)

    const onlyPay = await h.update_employee(ctx, { employee: 'Joe', base_salary: SALARY })
    expect(JSON.parse(onlyPay.text).say).toBe("Joe Sample's salary saved.")

    leaks((await h.set_employee_quota(ctx, { employee: 'Joe', type: 'policies', target: 40 })).text)
    leaks((await h.log_time_off(ctx, { employee: 'Joe', start_date: '2026-10-20' })).text)
  })

  it('plan tools: bonus_on_track and top_performers', async () => {
    const { CXO_PLAN_TOOL_HANDLERS: h } = await import('@/lib/agent/cxoPlanTools')
    for (const name of ['bonus_on_track', 'top_performers']) {
      const r = await h[name](ctx, {})
      leaks(r.text)
      expect(r.text).not.toContain('7,777')
      expect(r.text).not.toContain('9,999')
      expect(r.text).not.toContain('7777')
    }
  })

  it('quickbooks customers: name and total only', async () => {
    const { CXO_QBO_TOOL_HANDLERS: h } = await import('@/lib/agent/cxoQboTools')
    const r = await h.quickbooks_financials(ctx, { breakdown: 'customers' })
    leaks(r.text)
    expect(JSON.parse(r.text).top_customers).toEqual([{ name: 'Big Customer LLC', total: 5000 }])
  })
})

describe('Give it to Mira: pay columns stay on our server', () => {
  it('blanks pay columns in a CSV, keeps the header, fills values back by row', async () => {
    const { redactCsvText, fillPayBack, isPayHeader } = await import('@/lib/employees/payRedact')
    expect(isPayHeader('Base salary')).toBe(true)
    expect(isPayHeader('Hourly rate')).toBe(true)
    expect(isPayHeader('Bonus amount')).toBe(true)
    expect(isPayHeader('Pay frequency')).toBe(false)
    expect(isPayHeader('Commission rate')).toBe(false)
    expect(isPayHeader('Bonus %')).toBe(false)
    const csv = `Name,Title,Base salary,Hourly rate,Pay frequency\nJoe Sample,Contracting,"$${SALARY.toLocaleString('en-US')}",,biweekly\nDana Two,Ops,,${HOURLY},weekly\n`
    const r = redactCsvText(csv)
    leaks(r.text)
    expect(r.text).toContain('Base salary')
    expect(r.text).toContain('Hourly rate')
    expect(r.text).toContain('biweekly')
    expect(r.text.split('\n')[0]).toBe('row_id,Name,Title,Base salary,Hourly rate,Pay frequency')
    expect(r.hidden.columns).toEqual(['Base salary', 'Hourly rate'])
    const people = fillPayBack(
      [
        { name: 'Joe Sample', source_rows: ['r1'] },
        { name: 'Dana Two', source_rows: ['r2'] },
      ],
      r.hidden,
    )
    expect(people[0]).toMatchObject({ name: 'Joe Sample', base_salary: SALARY })
    expect(people[1]).toMatchObject({ name: 'Dana Two', hourly_rate: HOURLY })
    expect('source_rows' in people[0]).toBe(false)
  })

  it('blanks pay in an XLSX and fills a tier bonus from its column', async () => {
    const XLSX = await import('xlsx')
    const { redactWorkbook, fillPayBack } = await import('@/lib/employees/payRedact')
    const ws = XLSX.utils.aoa_to_sheet([
      ['Staff roster 2026'],
      ['Name', 'Salary', 'Quota', 'Bonus amount'],
      ['Joe Sample', SALARY, 40, 1500],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'People')
    const r = redactWorkbook(wb)
    leaks(r.text)
    expect(r.text).not.toContain('1500')
    expect(r.text).toContain('s1r1,Joe Sample,,40,')
    const [p] = fillPayBack([{ name: 'Joe Sample', source_rows: ['s1r1'], quotas: [{ type: 'policies', target: 40, period: 'month', tiers: [{ attain_pct: 100, bonus_column: 'Bonus amount' }] }] }], r.hidden)
    expect(p.base_salary).toBe(SALARY)
    expect(p.quotas?.[0].tiers?.[0]).toEqual({ attain_pct: 100, bonus: 1500 })
  })

  it('a sheet with no pay columns goes through unchanged', async () => {
    const { redactCsvText } = await import('@/lib/employees/payRedact')
    const csv = 'Name,Title\nJoe,Ops'
    expect(redactCsvText(csv)).toEqual({ text: csv, hidden: { columns: [], rows: {} } })
  })
})
