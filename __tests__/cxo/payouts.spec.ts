import { describe, expect, it } from 'vitest'
import {
  attainment,
  canViewComp,
  elapsedShare,
  orgByDepartment,
  parseEmployeeRows,
  payoutCsv,
  payoutFor,
  payoutsForAll,
  periodLabel,
  rankEmployees,
  tierFor,
  type CompTier,
  type Employee,
  type Kpi,
  type KpiActual,
} from '@/lib/employees/shared'

const emp = { id: 'e1', name: 'Test Person', department: 'Contracting' }
const kpi = (over: Partial<Kpi> = {}): Kpi => ({ id: 'k1', employee_id: 'e1', name: 'Contracts processed', unit: 'count', target: 100, period: 'month', weight: 1, lower_is_better: false, sort: 0, ...over })
const tier = (attain_pct: number, bonus: number, kpi_id: string | null = 'k1', period: 'month' | 'quarter' = 'month'): CompTier => ({ employee_id: 'e1', kpi_id, period, attain_pct, bonus })
const act = (actual: number, kpi_id = 'k1', period_key = '2026-10'): KpiActual => ({ kpi_id, employee_id: 'e1', period_key, actual })

describe('attainment', () => {
  it('is actual over target', () => {
    expect(attainment({ target: 100, lower_is_better: false }, 80)).toBe(0.8)
  })
  it('inverts when lower is better', () => {
    expect(attainment({ target: 3, lower_is_better: true }, 2)).toBe(1.5)
    expect(attainment({ target: 3, lower_is_better: true }, 6)).toBe(0.5)
  })
  it('is blank without an actual or a target', () => {
    expect(attainment({ target: 100, lower_is_better: false }, null)).toBeNull()
    expect(attainment({ target: 0, lower_is_better: false }, 5)).toBeNull()
  })
})

describe('tierFor', () => {
  const tiers = [tier(90, 250), tier(100, 500), tier(120, 1000)]
  it('pays the highest tier reached, never the sum', () => {
    expect(tierFor(tiers, 1.05)?.bonus).toBe(500)
    expect(tierFor(tiers, 1.2)?.bonus).toBe(1000)
    expect(tierFor(tiers, 0.89)).toBeNull()
  })
  it('counts exactly 100% as reaching the 100% tier', () => {
    expect(tierFor(tiers, 1)?.bonus).toBe(500)
  })
})

describe('payoutFor', () => {
  it('earned: a KPI tier is reached', () => {
    const p = payoutFor(emp, [kpi()], [act(110)], [tier(100, 500)], '2026-10', 0.5)
    expect(p.total).toBe(500)
    expect(p.status).toBe('earned')
    expect(p.kpis[0].att).toBeCloseTo(1.1)
  })
  it('on track: not there yet but the pace reaches the first tier', () => {
    // 60 of 100 with 50% of the month gone → on pace for 120%.
    const p = payoutFor(emp, [kpi()], [act(60)], [tier(100, 500)], '2026-10', 0.5)
    expect(p.total).toBe(0)
    expect(p.kpis[0].projectedAtt).toBeCloseTo(1.2)
    expect(p.status).toBe('on_track')
  })
  it('behind: the pace does not reach the first tier', () => {
    const p = payoutFor(emp, [kpi()], [act(30)], [tier(100, 500)], '2026-10', 0.5)
    expect(p.status).toBe('behind')
  })
  it('no plan without any tiers', () => {
    expect(payoutFor(emp, [kpi()], [act(500)], [], '2026-10', 1).status).toBe('no_plan')
  })
  it('does not project a lower-is-better KPI', () => {
    const k = kpi({ id: 'k2', name: 'Days to contract', unit: 'days', target: 3, lower_is_better: true })
    const p = payoutFor(emp, [k], [act(4, 'k2')], [tier(100, 300, 'k2')], '2026-10', 0.25)
    expect(p.kpis[0].att).toBeCloseTo(0.75)
    expect(p.kpis[0].projectedAtt).toBeCloseTo(0.75)
    expect(p.status).toBe('behind')
  })
  it('adds an overall-score tier on the weighted average', () => {
    const kpis = [kpi({ weight: 3 }), kpi({ id: 'k2', name: 'Calls', weight: 1, sort: 1 })]
    const actuals = [act(100), act(60, 'k2')] // 100% and 60% → (3×1 + 1×0.6)/4 = 0.9
    const p = payoutFor(emp, kpis, actuals, [tier(100, 400), tier(90, 200, null)], '2026-10', 1)
    expect(p.overallAtt).toBeCloseTo(0.9)
    expect(p.overallBonus).toBe(200)
    expect(p.total).toBe(600)
  })
  it('only reads that period type and that period key', () => {
    const kpis = [kpi(), kpi({ id: 'kq', period: 'quarter' })]
    const actuals = [act(200, 'k1', '2026-09'), act(200, 'kq', '2026-Q4')]
    const p = payoutFor(emp, kpis, actuals, [tier(100, 500), tier(100, 900, 'kq', 'quarter')], '2026-10', 1)
    expect(p.kpis.map((k) => k.kpi_id)).toEqual(['k1'])
    expect(p.total).toBe(0)
    const q = payoutFor(emp, kpis, actuals, [tier(100, 500), tier(100, 900, 'kq', 'quarter')], '2026-Q4', 1)
    expect(q.total).toBe(900)
  })
})

describe('payoutsForAll and elapsedShare', () => {
  it('uses the share of the period that has passed', () => {
    expect(elapsedShare('2026-10', '2026-10-15')).toBeCloseTo(15 / 31)
    expect(elapsedShare('2026-09', '2026-10-15')).toBe(1)
    expect(elapsedShare('2026-11', '2026-10-15')).toBe(0)
    expect(elapsedShare('2026-Q4', '2026-10-01')).toBeCloseTo(1 / 92)
    const lines = payoutsForAll({ employees: [emp], kpis: [kpi()], actuals: [act(50)], tiers: [tier(100, 500)] }, '2026-10', '2026-10-15')
    expect(lines[0].status).toBe('on_track') // 50 by day 15 of 31 → ~103%
  })
  it('labels periods in plain words', () => {
    expect(periodLabel('2026-10')).toMatch(/Oct/)
    expect(periodLabel('2026-Q4')).toMatch(/Q4 2026/)
  })
})

describe('payoutCsv', () => {
  it('writes a payroll file with the total and escapes commas', () => {
    const p = payoutFor({ ...emp, name: 'Person, Test' }, [kpi()], [act(110)], [tier(100, 500)], '2026-10', 1)
    const csv = payoutCsv([p], '2026-10', { at: '2026-11-01T00:00:00Z', by: 'Exec' })
    expect(csv).toContain('"Person, Test"')
    expect(csv).toContain('500')
    expect(csv.split('\n').length).toBeGreaterThan(1)
  })
})

describe('canViewComp', () => {
  it('owners and admins see comp; others only when granted', () => {
    expect(canViewComp({ role: 'owner' })).toBe(true)
    expect(canViewComp({ role: 'admin' })).toBe(true)
    expect(canViewComp({ role: 'rep' })).toBe(false)
    expect(canViewComp({ role: 'rep', settings: { can_view_comp: true } })).toBe(true)
    expect(canViewComp({ role: 'owner', settings: { can_view_comp: false } })).toBe(false)
    expect(canViewComp(null)).toBe(false)
  })
})

describe('org, ranking and import', () => {
  const e = (id: string, name: string, department: string, manager_id: string | null = null): Employee => ({ id, name, title: null, department, manager_id, start_date: null, email: null, base_salary: null, pay_frequency: 'biweekly', member_id: null, active: true })
  it('groups by department with managers over their reports', () => {
    const org = orgByDepartment([e('a', 'Ann', 'Contracting'), e('b', 'Bob', 'Contracting', 'a'), e('c', 'Cy', 'Marketing')])
    const c = org.find((d) => d.department === 'Contracting')!
    expect(c.count).toBe(2)
    expect(c.roots.map((r) => r.emp.name)).toEqual(['Ann'])
    expect(c.roots[0].reports.map((r) => r.emp.name)).toEqual(['Bob'])
  })
  it('ranks by attainment with blanks last', () => {
    const r = rankEmployees(
      [
        { employee_id: 'a', name: 'A', department: 'X', title: null, att: 0.8, rating: 5, bonus: 0 },
        { employee_id: 'b', name: 'B', department: 'X', title: null, att: null, rating: 3, bonus: 0 },
        { employee_id: 'c', name: 'C', department: 'X', title: null, att: 1.1, rating: 2, bonus: 0 },
      ],
      'attainment',
    )
    expect(r.map((x) => x.name)).toEqual(['C', 'A', 'B'])
  })
  it('reads the employee template columns', () => {
    const r = parseEmployeeRows([
      ['Name', 'Title', 'Department', 'Manager', 'Start date', 'Email', 'Base salary', 'Pay frequency'],
      ['Ann Lee', 'Lead', 'Contracting', '', '2024-01-02', 'ann@example.com', '$65,000', 'Biweekly'],
      ['', '', '', '', '', '', '', ''],
    ])
    expect(r.employees).toHaveLength(1)
    expect(r.employees[0]).toMatchObject({ name: 'Ann Lee', department: 'Contracting', base_salary: 65000, pay_frequency: 'biweekly' })
  })
})
