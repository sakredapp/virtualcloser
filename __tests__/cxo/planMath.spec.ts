import { describe, expect, it } from 'vitest'
import {
  allowanceStatus,
  asOfDay,
  pct,
  econLine,
  matchActual,
  monthWeights,
  pacing,
  parseAmount,
  planByMonth,
  type AllowanceTier,
  type PlanTarget,
} from '@/lib/plan/shared'

const flat = (v: number) => new Array(12).fill(v)

describe('monthWeights', () => {
  it('counts every month for a past year and none for a future one', () => {
    expect(monthWeights(2025, '2026-10-09')).toEqual(flat(1))
    expect(monthWeights(2027, '2026-10-09')).toEqual(flat(0))
  })
  it('counts the elapsed share of the current month', () => {
    const w = monthWeights(2026, '2026-04-15')
    expect(w.slice(0, 3)).toEqual([1, 1, 1])
    expect(w[3]).toBeCloseTo(15 / 30)
    expect(w.slice(4)).toEqual(flat(0).slice(4))
  })
})

describe('pacing', () => {
  it('is on plan when actual matches plan to date', () => {
    // Plan $100/month; mid-April = 3.5 months of plan = $350.
    const p = pacing(flat(100), [100, 100, 100, 50, 0, 0, 0, 0, 0, 0, 0, 0], 2026, '2026-04-15')
    expect(p.planTotal).toBe(1200)
    expect(p.planToDate).toBeCloseTo(350)
    expect(p.actualToDate).toBe(350)
    expect(p.pctOfPlanToDate).toBeCloseTo(1)
    expect(p.status).toBe('on_track')
    expect(p.gap).toBeCloseTo(0)
  })
  it('flags behind under 95% and ahead at 105%+', () => {
    const behind = pacing(flat(100), [80, 80, 80, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2026, '2026-03-31')
    expect(behind.pctOfPlanToDate).toBeCloseTo(0.8)
    expect(behind.status).toBe('behind')
    expect(behind.gap).toBeCloseTo(-60)
    const ahead = pacing(flat(100), [120, 120, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2026, '2026-03-31')
    expect(ahead.status).toBe('ahead')
  })
  it('projects year end straight-line', () => {
    const p = pacing(flat(100), [150, 150, 150, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2026, '2026-03-31')
    expect(p.elapsed).toBeCloseTo(0.25)
    expect(p.projected).toBeCloseTo(1800)
    expect(p.projectedPct).toBeCloseTo(1.5)
  })
  it('a future plan year has not started; no plan says so', () => {
    expect(pacing(flat(100), flat(0), 2027, '2026-10-09').status).toBe('not_started')
    expect(pacing(flat(0), flat(50), 2026, '2026-10-09').status).toBe('no_plan')
  })
  it('ignores actuals in months not yet reached', () => {
    const p = pacing(flat(100), [100, 100, 999, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2026, '2026-02-28')
    expect(p.actualToDate).toBe(200)
  })
})

describe('matchActual', () => {
  const rows = [
    { label: 'Mutual of Omaha', premium: 500, policies: 5 },
    { label: 'IUL EXPRESS', premium: 200, policies: 2 },
    { label: 'IUL Accumulator', premium: 300, policies: 3 },
    { label: 'Aetna', premium: 50, policies: 1 },
  ]
  it('prefers an exact case-insensitive match', () => {
    expect(matchActual('mutual of omaha', rows)).toEqual({ premium: 500, policies: 5, labels: ['Mutual of Omaha'] })
  })
  it('falls back to whole-word contains', () => {
    const m = matchActual('IUL', rows)
    expect(m.premium).toBe(500)
    expect(m.labels.sort()).toEqual(['IUL Accumulator', 'IUL EXPRESS'])
  })
  it('does not match part of a word', () => {
    expect(matchActual('Aet', rows).premium).toBe(0)
  })
})

describe('parseAmount', () => {
  it('reads dollars, commas, k/m and accounting negatives', () => {
    expect(parseAmount('$1,250')).toBe(1250)
    expect(parseAmount('12.5k')).toBe(12500)
    expect(parseAmount('1.2M')).toBe(1_200_000)
    expect(parseAmount('(300)')).toBe(-300)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
})

describe('econLine', () => {
  const targets: PlanTarget[] = [
    { year: 2027, month: 1, product: 'Life', carrier: 'Aetna', premium: 6000, policies: null },
    { year: 2027, month: 2, product: 'Life', carrier: 'Aetna', premium: 6000, policies: null },
  ]
  it('computes revenue and margin per policy and projected margin', () => {
    const l = econLine({ year: 2027, product: 'Life', carrier: 'Aetna', commission_pct: 100, avg_premium: 1200, override_pct: 20, acquisition_cost: 90 }, targets)
    expect(l.planPremium).toBe(12000)
    expect(l.planPolicies).toBe(10)
    expect(l.revenuePerPolicy).toBe(1200)
    expect(l.marginPerPolicy).toBe(150) // 1200 × 20% − 90
    expect(l.projectedMargin).toBe(1500)
  })
  it('leaves margin blank until the inputs are entered', () => {
    const l = econLine({ year: 2027, product: 'Life', carrier: 'Aetna', commission_pct: null, avg_premium: null, override_pct: null, acquisition_cost: null }, targets)
    expect(l.marginPerPolicy).toBeNull()
    expect(l.projectedMargin).toBeNull()
    expect(l.planPolicies).toBeNull()
  })
})

describe('allowanceStatus', () => {
  const tiers: AllowanceTier[] = [
    { year: 2026, carrier: 'Aetna', period: 'quarter', threshold: 100_000, unlocks: '$2,500 co-op' },
    { year: 2026, carrier: 'Aetna', period: 'quarter', threshold: 250_000, unlocks: '$7,500 co-op' },
    { year: 2026, carrier: 'Other', period: 'quarter', threshold: 10, unlocks: 'x' },
  ]
  it('says how much more unlocks the next tier', () => {
    const s = allowanceStatus('aetna', 'quarter', tiers, 140_000, 0.5, 'Q4 2026')
    expect(s.reached?.threshold).toBe(100_000)
    expect(s.next?.threshold).toBe(250_000)
    expect(s.toNext).toBe(110_000)
    expect(s.projected).toBe(280_000)
    expect(s.projectedTier?.threshold).toBe(250_000)
  })
  it('is full when every tier is reached', () => {
    const s = allowanceStatus('Aetna', 'quarter', tiers, 300_000, 1, 'Q4 2026')
    expect(s.next).toBeNull()
    expect(s.toNext).toBe(0)
    expect(s.progress).toBe(1)
  })
  it('only reads tiers for that carrier and period', () => {
    expect(allowanceStatus('Aetna', 'month', tiers, 1, 1, 'Oct').tiers).toEqual([])
  })
})

describe('asOfDay', () => {
  it('measures plan to date at the last day the book has data for', () => {
    expect(asOfDay(2026, '2026-10-09', '2026-06-09')).toBe('2026-06-09')
    expect(asOfDay(2026, '2026-10-09', null)).toBe('2026-10-09')
    expect(asOfDay(2027, '2026-10-09', null)).toBe('2026-10-09')
  })
  it('caps runaway percentages', () => {
    expect(pct(25)).toBe('999%+')
    expect(pct(0.954)).toBe('95%')
  })
})
