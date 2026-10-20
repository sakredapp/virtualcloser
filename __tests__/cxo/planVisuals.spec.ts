import { describe, expect, it } from 'vitest'
import {
  FORECAST_MIN_MONTHS,
  barWidth,
  completeMonths,
  pctLabel,
  pickPlanYear,
  planVisuals,
  ratio,
  tierRail,
  yearElapsed,
} from '@/lib/plan/visuals'
import type { PlanTarget } from '@/lib/plan/shared'

// Made-up numbers only: one product line, $100K plan a month.
const flatPlan = (year: number, perMonth = 100_000): PlanTarget[] =>
  Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, product: 'Life', carrier: 'Acme Life', premium: perMonth, policies: null }))
const months = (...v: number[]) => [...v, ...new Array(12 - v.length).fill(0)]

function allFinite(o: unknown): boolean {
  if (typeof o === 'number') return Number.isFinite(o)
  if (Array.isArray(o)) return o.every(allFinite)
  if (o && typeof o === 'object') return Object.values(o).every(allFinite)
  return true
}

describe('ratio / barWidth / pctLabel', () => {
  it('never returns NaN or Infinity', () => {
    expect(ratio(5, 0)).toBeNull()
    expect(ratio(0, 0)).toBeNull()
    expect(ratio(NaN, 10)).toBeNull()
    expect(ratio(10, Infinity)).toBeNull()
    expect(ratio(50, 200)).toBe(0.25)
  })
  it('clamps bar widths to 0..1', () => {
    expect(barWidth(null)).toBe(0)
    expect(barWidth(NaN)).toBe(0)
    expect(barWidth(-0.4)).toBe(0)
    expect(barWidth(0.42)).toBe(0.42)
    expect(barWidth(3.2)).toBe(1)
  })
  it('labels percentages plainly', () => {
    expect(pctLabel(null)).toBe('—')
    expect(pctLabel(0.6449)).toBe('64%')
    expect(pctLabel(1.12)).toBe('112%')
    expect(pctLabel(42)).toBe('999%+')
  })
})

describe('calendar helpers', () => {
  it('year elapsed is 0 before, 1 after, a share during', () => {
    expect(yearElapsed(2027, '2026-10-20')).toBe(0)
    expect(yearElapsed(2025, '2026-10-20')).toBe(1)
    expect(yearElapsed(2026, '2026-12-31')).toBeCloseTo(1)
    expect(yearElapsed(2026, '2026-07-02')).toBeCloseTo(183 / 365)
  })
  it('a month is complete only once its last day is in', () => {
    expect(completeMonths(2026, '2026-10-20')).toBe(9)
    expect(completeMonths(2026, '2026-09-30')).toBe(9)
    expect(completeMonths(2026, '2026-09-29')).toBe(8)
    expect(completeMonths(2026, '2026-01-05')).toBe(0)
    expect(completeMonths(2025, '2026-10-20')).toBe(12)
    expect(completeMonths(2027, '2026-10-20')).toBe(0)
  })
})

describe('planVisuals: empty states', () => {
  it('no plan, nothing connected', () => {
    const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: [], actuals: { monthly: months(), connected: false } })
    expect(v.view).toBe('no_plan')
    expect(v.status).toBe('no_plan')
    expect(v.actualsOnly).toBe(false)
    expect(v.pctOfYearPlan).toBeNull()
    expect(v.forecast.value).toBeNull()
    expect(allFinite(v)).toBe(true)
  })
  it('no plan but the book has premium: show the actuals alone', () => {
    const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: [], actuals: { monthly: months(50_000, 60_000), connected: true } })
    expect(v.view).toBe('no_plan')
    expect(v.actualsOnly).toBe(true)
    expect(v.actualYtd).toBe(110_000)
    expect(v.months[0].words).toBe('No plan')
  })
  it('a future year has a plan but no actuals, no pace, no forecast', () => {
    const v = planVisuals({ year: 2027, today: '2026-10-20', asOf: '2026-10-20', targets: flatPlan(2027), actuals: { monthly: months(), connected: true } })
    expect(v.view).toBe('future')
    expect(v.status).toBe('not_started')
    expect(v.complete).toBe(0)
    expect(v.cumActual).toEqual([])
    expect(v.cumPlan[11]).toBe(1_200_000)
    expect(v.months.every((m) => m.state === 'future' && m.words === 'Not yet')).toBe(true)
    expect(v.yearElapsed).toBe(0)
    expect(v.forecast.value).toBeNull()
  })
  it('plan loaded but the book is not connected', () => {
    const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: flatPlan(2026), actuals: { monthly: months(), connected: false } })
    expect(v.view).toBe('not_connected')
    expect(v.forecast).toMatchObject({ value: null, reason: expect.stringContaining('connected') })
  })
  it('connected with nothing written yet', () => {
    const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: flatPlan(2026), actuals: { monthly: months(), connected: true } })
    expect(v.view).toBe('no_actuals')
    expect(v.months[0].words).toBe('No sales')
    expect(v.months[9].words).toBe('None yet')
    expect(v.pace).toBe(0)
    expect(allFinite(v)).toBe(true)
  })
})

describe('planVisuals: live year', () => {
  const actual = months(90_000, 110_000, 100_000, 80_000, 120_000, 100_000, 95_000, 105_000, 100_000, 40_000)
  const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: flatPlan(2026), actuals: { monthly: actual, connected: true } })

  it('paces on complete months only', () => {
    expect(v.view).toBe('live')
    expect(v.complete).toBe(9)
    expect(v.completeLabel).toBe('Jan–Sep')
    expect(v.planComplete).toBe(900_000)
    expect(v.actualComplete).toBe(900_000)
    expect(v.pace).toBe(1)
    expect(v.status).toBe('on_track')
  })
  it('shows the month in progress on its own, not prorated', () => {
    expect(v.current).toMatchObject({ month: 10, state: 'partial', plan: 100_000, actual: 40_000, pct: 0.4, day: 20, daysInMonth: 31 })
    expect(v.months[10].state).toBe('future')
  })
  it('year progress: actual YTD over the year plan, beside the year elapsed', () => {
    expect(v.actualYtd).toBe(940_000)
    expect(v.pctOfYearPlan).toBeCloseTo(940_000 / 1_200_000)
    expect(v.planDueShare).toBeCloseTo(0.75)
    expect(v.yearElapsed).toBeGreaterThan(0.79)
    expect(v.yearElapsed).toBeLessThan(0.81)
  })
  it('forecast = complete-month actual + rest of plan at the same pace, and says so', () => {
    expect(v.forecast.value).toBe(900_000 + 1 * 300_000)
    if (v.forecast.value != null) {
      expect(v.forecast.pctOfPlan).toBe(1)
      expect(v.forecast.basis).toContain('Jan–Sep')
      expect(v.forecast.basis).toContain('100%')
    }
  })
  it('running totals stop at the month with data', () => {
    expect(v.cumActual).toHaveLength(10)
    expect(v.cumActual[9]).toBe(940_000)
    expect(v.cumPlan).toHaveLength(12)
  })
  it('marks ahead and behind from the complete-month pace', () => {
    const ahead = planVisuals({ year: 2026, today: '2026-05-10', asOf: '2026-05-10', targets: flatPlan(2026), actuals: { monthly: months(120_000, 120_000, 120_000, 120_000, 1_000), connected: true } })
    expect(ahead.status).toBe('ahead')
    const behind = planVisuals({ year: 2026, today: '2026-05-10', asOf: '2026-05-10', targets: flatPlan(2026), actuals: { monthly: months(50_000, 50_000, 50_000, 50_000, 500_000), connected: true } })
    // A big month in progress does not lift the pace.
    expect(behind.pace).toBe(0.5)
    expect(behind.status).toBe('behind')
  })
})

describe('planVisuals: forecast guard', () => {
  it(`no forecast before ${FORECAST_MIN_MONTHS} complete months`, () => {
    const v = planVisuals({ year: 2026, today: '2026-03-15', asOf: '2026-03-15', targets: flatPlan(2026), actuals: { monthly: months(100_000, 100_000, 50_000), connected: true } })
    expect(v.complete).toBe(2)
    expect(v.forecast.value).toBeNull()
    if (v.forecast.value == null) expect(v.forecast.reason).toContain('2 so far')
  })
  it('January: first month in progress, no pace', () => {
    const v = planVisuals({ year: 2026, today: '2026-01-09', asOf: '2026-01-09', targets: flatPlan(2026), actuals: { monthly: months(30_000), connected: true } })
    expect(v.status).toBe('early')
    expect(v.pace).toBeNull()
    expect(v.current?.pct).toBeCloseTo(0.3)
  })
  it('a closed year has the final actual, no forecast', () => {
    const v = planVisuals({ year: 2025, today: '2026-10-20', asOf: '2025-12-31', targets: flatPlan(2025), actuals: { monthly: new Array(12).fill(110_000), connected: true } })
    expect(v.complete).toBe(12)
    expect(v.current).toBeNull()
    expect(v.forecast.value).toBeNull()
    expect(v.pctOfYearPlan).toBeCloseTo(1.1)
  })
  it('plan that starts later in the year: no pace yet, no forecast', () => {
    const later: PlanTarget[] = [{ year: 2026, month: 11, product: 'Life', carrier: 'Acme Life', premium: 50_000, policies: null }]
    const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: later, actuals: { monthly: months(10_000), connected: true } })
    expect(v.pace).toBeNull()
    expect(v.status).toBe('not_started')
    expect(v.forecast.value).toBeNull()
    expect(v.months[0].words).toBe('No plan')
    expect(allFinite(v)).toBe(true)
  })
  it('junk numbers in the actuals do not leak NaN', () => {
    const v = planVisuals({ year: 2026, today: '2026-10-20', asOf: '2026-10-20', targets: flatPlan(2026), actuals: { monthly: [NaN, Infinity, 5], connected: true } })
    expect(allFinite(v)).toBe(true)
    expect(v.actualYtd).toBe(5)
  })
})

describe('tierRail', () => {
  it('no tiers → empty rail', () => {
    expect(tierRail(5_000, [])).toEqual({ fill: 0, ticks: [], pctOfNext: null })
  })
  it('places ticks and fill on one scale, past the top tier', () => {
    const r = tierRail(150_000, [250_000, 100_000])
    expect(r.ticks.map((t) => t.threshold)).toEqual([100_000, 250_000])
    expect(r.ticks.map((t) => t.hit)).toEqual([true, false])
    expect(r.ticks[1].at).toBeLessThan(1)
    expect(r.fill).toBeCloseTo(150_000 / (250_000 * 1.08))
    expect(r.pctOfNext).toBeCloseTo(0.6)
  })
  it('every tier reached → full-ish rail, no next', () => {
    const r = tierRail(400_000, [100_000, 250_000])
    expect(r.pctOfNext).toBeNull()
    expect(r.fill).toBeLessThanOrEqual(1)
    expect(r.ticks.every((t) => t.hit)).toBe(true)
  })
  it('bad input stays finite', () => {
    const r = tierRail(NaN, [0, -5, NaN, 10])
    expect(r.ticks).toHaveLength(1)
    expect(allFinite(r)).toBe(true)
  })
})

describe('pickPlanYear', () => {
  const years = [2026, 2027]
  it('honours the asked year', () => expect(pickPlanYear(years, [], 2026, 2027)).toBe(2027))
  it('ignores an asked year that is not offered', () => expect(pickPlanYear(years, [2026], 2026, 1999)).toBe(2026))
  it('opens this year when it has a plan', () => expect(pickPlanYear(years, [2026, 2027], 2026)).toBe(2026))
  it('opens next year when only that has a plan', () => expect(pickPlanYear(years, [2027], 2026)).toBe(2027))
  it('opens this year with no plan anywhere, so the book still shows', () => expect(pickPlanYear(years, [], 2026)).toBe(2026))
})
