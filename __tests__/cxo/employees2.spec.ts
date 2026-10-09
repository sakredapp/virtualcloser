import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))

import { signSession, verifySession } from '@/lib/client-auth'
import { EMPLOYEE_HOME, employeePathAllowed, isEmployeeOnlyMember, isExecTenant } from '@/lib/employees/access'
import { buildReview, claudeCostUsd, cleanPerson, toIso, toNum } from '@/lib/employees/ingestShared'
import {
  employeeSnapshot,
  matchEmployee,
  moreWords,
  parsePeriod,
  parseQuotaType,
  periodKeyFor,
  periodLabel,
  periodRange,
  ptoSummary,
  quotaLine,
  weekdaysBetween,
  type CompTier,
  type Employee,
  type Kpi,
  type KpiActual,
  type TimeOff,
} from '@/lib/employees/shared'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-for-employees-spec'
})

const TODAY = '2026-10-15'

const kpi = (over: Partial<Kpi> = {}): Kpi => ({
  id: 'k1',
  employee_id: 'e1',
  name: 'Policies',
  unit: 'count',
  target: 40,
  period: 'quarter',
  weight: 1,
  lower_is_better: false,
  sort: 0,
  quota_type: 'policies',
  actual_source: 'manual',
  ...over,
})
const tiers = (kpiId: string | null, rows: Array<[number, number]>, period: Kpi['period'] = 'quarter'): CompTier[] =>
  rows.map(([a, b]) => ({ employee_id: 'e1', kpi_id: kpiId, period, attain_pct: a, bonus: b }))

describe('employee login: access', () => {
  it('allows only the self-view paths', () => {
    expect(employeePathAllowed(EMPLOYEE_HOME)).toBe(true)
    expect(employeePathAllowed('/api/employees/me')).toBe(true)
    expect(employeePathAllowed('/logout')).toBe(true)
    expect(employeePathAllowed('/_next/static/chunk.js')).toBe(true)
    expect(employeePathAllowed('/dashboard')).toBe(false)
    expect(employeePathAllowed('/dashboard/employees')).toBe(false)
    expect(employeePathAllowed('/dashboard/meetings')).toBe(false)
    expect(employeePathAllowed('/api/employees')).toBe(false)
    expect(employeePathAllowed('/api/employees/ingest')).toBe(false)
    expect(employeePathAllowed('/api/mira/chat')).toBe(false)
    expect(employeePathAllowed('/api/data.json')).toBe(false)
    expect(employeePathAllowed('dashboard/me')).toBe(false)
  })

  it('is an employee only as rep/observer on an exec tenant', () => {
    const cxo = { id: 't1', brand: 'cxo' }
    expect(isExecTenant(cxo)).toBe(true)
    expect(isEmployeeOnlyMember({ role: 'rep' }, cxo)).toBe(true)
    expect(isEmployeeOnlyMember({ role: 'observer' }, cxo)).toBe(true)
    expect(isEmployeeOnlyMember({ role: 'owner' }, cxo)).toBe(false)
    expect(isEmployeeOnlyMember({ role: 'admin' }, cxo)).toBe(false)
    expect(isEmployeeOnlyMember({ role: 'manager' }, cxo)).toBe(false)
    // A rep on a normal CRM tenant is a sales rep, not an employee login.
    expect(isEmployeeOnlyMember({ role: 'rep' }, { id: 't2', brand: 'virtualcloser' })).toBe(false)
    expect(isEmployeeOnlyMember({ role: 'rep' }, { id: 't3', brand: 'virtualcloser' }, { PINNACLE_VIEWER_REP_IDS: 'x, t3' })).toBe(true)
  })

  it('round-trips the employee scope in the session', async () => {
    const p = await verifySession(await signSession('spence', { memberId: 'm1', hosts: ['spence'], scope: 'employee' }))
    expect(p).toMatchObject({ slug: 'spence', memberId: 'm1', scope: 'employee' })
    const q = await verifySession(await signSession('spence', { memberId: 'm1', hosts: ['spence'] }))
    expect(q?.scope).toBeNull()
  })
})

describe('periods', () => {
  it('has year periods', () => {
    expect(periodKeyFor('year', TODAY)).toBe('2026')
    expect(periodKeyFor('quarter', TODAY)).toBe('2026-Q4')
    expect(periodRange('2026')).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(periodRange('2026-Q1')).toEqual({ start: '2026-01-01', end: '2026-03-31' })
    expect(periodLabel('2026')).toContain('2026')
    expect(parsePeriod('annual')).toBe('year')
    expect(parsePeriod('per quarter')).toBe('quarter')
    expect(parsePeriod('monthly')).toBe('month')
  })

  it('reads quota types from loose words', () => {
    expect(parseQuotaType('Annualized premium')).toBe('premium')
    expect(parseQuotaType('apps submitted')).toBe('policies')
    expect(parseQuotaType('New agents recruited')).toBe('recruits')
    expect(parseQuotaType('appointments booked')).toBe('appointments')
    expect(parseQuotaType('Revenue')).toBe('revenue')
    expect(parseQuotaType('Contracts processed')).toBe('custom')
  })
})

describe('quota snapshot', () => {
  const actuals: KpiActual[] = [{ kpi_id: 'k1', employee_id: 'e1', period_key: '2026-Q4', actual: 34 }]

  it('works out attainment, the tier and what the next tier needs', () => {
    const line = quotaLine(kpi(), actuals, tiers('k1', [[80, 300], [100, 600], [120, 1000]]), TODAY)
    expect(line.att).toBeCloseTo(0.85)
    expect(line.tier?.attain_pct).toBe(80)
    expect(line.bonus).toBe(300)
    expect(line.next?.attain_pct).toBe(100)
    expect(line.moreToNext).toBeCloseTo(6)
    expect(line.bonusMax).toBe(1000)
    expect(moreWords(line)).toBe('6 more policies')
    expect(line.pace).toBe('on_pace')
  })

  it('says one policy, and dollars for $ quotas', () => {
    expect(moreWords({ moreToNext: 1, kpi: kpi() })).toBe('1 more policy')
    expect(moreWords({ moreToNext: 1200.4, kpi: kpi({ unit: 'usd', quota_type: 'premium' }) })).toBe('$1,201 more')
  })

  it('rolls up status and bonus per employee', () => {
    const data = { kpis: [kpi(), kpi({ id: 'k2', name: 'Recruits', quota_type: 'recruits', target: 10 })], actuals: [...actuals, { kpi_id: 'k2', employee_id: 'e1', period_key: '2026-Q4', actual: 1 }], tiers: tiers('k1', [[100, 600]]) }
    const s = employeeSnapshot({ id: 'e1' }, data, TODAY)
    expect(s.quotas).toHaveLength(2)
    expect(s.status).toBe('behind')
    expect(s.bonusEarned).toBe(0)
    expect(s.bonusPossible).toBe(600)
    expect(employeeSnapshot({ id: 'nobody' }, data, TODAY).status).toBe('no_quota')
  })
})

describe('time off', () => {
  it('counts weekdays and sums by kind', () => {
    expect(weekdaysBetween('2026-10-12', '2026-10-18')).toBe(5)
    const log: TimeOff[] = [
      { id: 'a', employee_id: 'e1', start_date: '2026-03-02', end_date: '2026-03-06', days: 5, kind: 'vacation', note: null },
      { id: 'b', employee_id: 'e1', start_date: '2026-05-01', end_date: '2026-05-01', days: 1, kind: 'sick', note: null },
      { id: 'c', employee_id: 'e1', start_date: '2025-12-29', end_date: '2025-12-30', days: 2, kind: 'vacation', note: null },
    ]
    const s = ptoSummary(log, '2026', 15, null)
    expect(s.used).toBe(6)
    expect(s.byKind.vacation).toBe(5)
    expect(s.left).toBe(9)
    expect(ptoSummary(log, '2026', 15, 4).left).toBe(4)
  })
})

describe('matching names', () => {
  const people = [
    { id: '1', name: 'Sample Joe Tester', email: 'joe@example.test' },
    { id: '2', name: 'Sample Dana Tester', email: null },
    { id: '3', name: 'Sample Dan Other', email: null },
  ]
  it('matches by email first, then name, and reports ambiguity', () => {
    expect(matchEmployee(people, 'whoever', 'JOE@example.test').match?.id).toBe('1')
    expect(matchEmployee(people, 'sample dana tester').match?.id).toBe('2')
    expect(matchEmployee(people, 'Joe').match?.id).toBe('1')
    const amb = matchEmployee(people, 'Sample')
    expect(amb.match).toBeNull()
    expect(amb.candidates.length).toBe(3)
    expect(matchEmployee(people, 'Nobody').match).toBeNull()
  })
})

describe('Give it to Mira: cleaning and review', () => {
  it('reads numbers and dates as people type them', () => {
    expect(toNum('$1,250.50')).toBe(1250.5)
    expect(toNum('120%')).toBe(120)
    expect(toNum('45k')).toBe(45000)
    expect(toNum('1.2m')).toBe(1200000)
    expect(toNum('n/a')).toBeNull()
    expect(toIso('2026-10-09')).toBe('2026-10-09')
    expect(toIso('10/9/2026')).toBe('2026-10-09')
    expect(toIso('not a date')).toBeNull()
  })

  it('drops pay and tiers for viewers without comp', () => {
    const raw = { name: 'Sample Joe Tester', base_salary: '$50,000', quotas: [{ type: 'policies', target: '40', period: 'quarter', tiers: [{ attain_pct: '100%', bonus: '$500' }] }] }
    const withComp = cleanPerson(raw, TODAY, true).person!
    expect(withComp.base_salary).toBe(50000)
    expect(withComp.quotas[0]).toMatchObject({ quota_type: 'policies', target: 40, period: 'quarter', period_key: '2026-Q4' })
    expect(withComp.quotas[0].tiers).toEqual([{ attain_pct: 100, bonus: 500 }])
    const noComp = cleanPerson(raw, TODAY, false)
    expect(noComp.person!.base_salary).toBeNull()
    expect(noComp.person!.quotas[0].tiers).toEqual([])
  })

  it('leaves out quotas without a target and rows without a name', () => {
    const r = cleanPerson({ name: 'Sample Dana Tester', quotas: [{ type: 'premium', target: '' }] }, TODAY, true)
    expect(r.person!.quotas).toHaveLength(0)
    expect(r.problems.join(' ')).toMatch(/no target/)
    expect(cleanPerson({ name: '  ' }, TODAY, true).person).toBeNull()
  })

  it('marks matched, new, ambiguous and duplicate rows', () => {
    const existing = [
      { id: '1', name: 'Sample Joe Tester', email: null },
      { id: '2', name: 'Sample Dana Tester', email: null },
      { id: '3', name: 'Sample Dana Other', email: null },
    ] as unknown as Employee[]
    const items = buildReview(
      [{ name: 'Sample Joe Tester', quotas: [{ type: 'policies', target: 40, period: 'quarter' }] }, { name: 'Sample New Person' }, { name: 'Sample Dana' }, { name: 'Sample Joe Tester' }, { name: '' }],
      existing,
      [],
      TODAY,
      true,
    )
    const by = (n: string) => items.filter((i) => i.person?.name === n)
    expect(by('Sample Joe Tester')[0].status).toBe('matched')
    expect(by('Sample Joe Tester')[0].match?.id).toBe('1')
    expect(by('Sample Joe Tester')[0].changes.join(' ')).toMatch(/40/)
    expect(by('Sample New Person')[0].status).toBe('new')
    expect(by('Sample Dana')[0].status).toBe('ambiguous')
    expect(by('Sample Dana')[0].candidates.length).toBe(2)
    expect(by('Sample Joe Tester')[1].status).toBe('problem')
  })

  it('prices a parse at Sonnet rates', () => {
    expect(claudeCostUsd({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(3)
    expect(claudeCostUsd({ input_tokens: 10_000, output_tokens: 2_000 })).toBeCloseTo(0.06)
    expect(claudeCostUsd(null)).toBe(0)
  })
})
