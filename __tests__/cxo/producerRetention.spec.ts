/**
 * Producer retention and placement by carrier for Ciao (2026-10-18):
 *   - the pure math: retention rate vs prior, placement / issue rate per
 *     carrier, the pending settle age, the mature window and when a lag note
 *     is (and is not) worth saying;
 *   - the tool's retention and placement views read the right RPC for each
 *     book, scoped to the tenant, and only add the lag note to fresh windows.
 * Everything is mocked: no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const touched: string[] = []
const calls: Record<string, Row[]> = {}
const answers: { rpc: Record<string, (args: Row) => unknown>; lastDay: string | null; pinnacleLastDay: string | null; people: unknown } = {
  rpc: {},
  lastDay: null,
  pinnacleLastDay: null,
  people: null,
}
function query(table: string) {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => void) => {
            if (table === 'cxo_book_producers') return res({ data: null, count: 5, error: null })
            if (table === 'cxo_book_policies') return res({ data: answers.lastDay ? [{ submitted_on: answers.lastDay }] : [], error: null })
            if (table === 'pinnacle_dim_rollup') return res({ data: answers.pinnacleLastDay ? [{ d: answers.pinnacleLastDay }] : [], error: null })
            if (table === 'pinnacle_people_rollup') return res({ data: answers.people, error: null })
            return res({ data: [], error: null })
          }
        }
        return () => self
      },
    },
  )
  return self
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => {
      touched.push(`from:${t}`)
      return query(t)
    },
    rpc: async (fn: string, args: Row) => {
      touched.push(`rpc:${fn}`)
      ;(calls[fn] ??= []).push(args)
      const f = answers.rpc[fn]
      return { data: f ? f(args) : [], error: null }
    },
  },
}))

import {
  addDays,
  breakdownTotals,
  lagDays,
  lagNote,
  matureWindow,
  placementFigures,
  placementTable,
  retentionPct,
  retentionSummary,
  settleDays,
  toBreakdownRow,
  toMaturity,
  toRetentionRaw,
  type BreakdownRow,
} from '@/lib/book/retention'
import { resolvePeriod } from '@/lib/book/production'
import { CXO_PRODUCER_TOOL_HANDLERS } from '@/lib/agent/cxoProducerTool'

const ENV = process.env.PINNACLE_VIEWER_REP_IDS
beforeEach(() => {
  touched.length = 0
  for (const k of Object.keys(calls)) delete calls[k]
  answers.rpc = {}
  answers.lastDay = '2026-10-18'
  answers.pinnacleLastDay = null
  answers.people = null
  delete process.env.PINNACLE_VIEWER_REP_IDS
})
afterEach(() => {
  if (ENV === undefined) delete process.env.PINNACLE_VIEWER_REP_IDS
  else process.env.PINNACLE_VIEWER_REP_IDS = ENV
})

const b = (label: string, o: Partial<BreakdownRow> = {}): BreakdownRow => ({ label, team: null, premium: 0, funded: 0, policies: 0, paid: 0, declined: 0, lapsed: 0, pending: 0, ...o })

describe('retention math', () => {
  it('retention = retained / active at the start, with the change vs prior in points', () => {
    expect(retentionPct({ retained: 998, active_start: 1401 })).toBe(71.2)
    expect(retentionPct({ retained: 0, active_start: 0 })).toBeNull()
    const raw = toRetentionRaw({
      inactive_after_days: 90,
      data_through: '2026-10-17',
      now: { start: '2026-07-20', end: '2026-10-17', active_start: '1401', retained: 998, stopped: 408, active_end: 1521, writing: 1538, new_writers: 493, joined: 400, reactivated: 79 },
      prior: { start: '2026-04-21', end: '2026-07-19', active_start: 1215, retained: 907, stopped: 300, active_end: 1401, writing: 1450, new_writers: 450, joined: 380, reactivated: 60 },
      went_quiet_count: 408,
      went_quiet: [{ name: 'Agent A', team: '', last_sale: '2026-05-01', stopped_on: '2026-07-30', why: 'no policy in 90 days', policies_last_90_days_before: 4, ap_last_90_days_before: '5200' }],
      drifting: { days_30_59: 327, days_60_89: 165, top: [] },
    })
    const s = retentionSummary(raw)
    expect(s.now?.retention_pct).toBe(71.2)
    expect(s.prior?.retention_pct).toBe(74.7)
    expect(s.retention_change_points).toBe(-3.5)
    expect(s.now?.net_change).toBe(120)
    expect(s.drifting_30_59_days).toBe(327)
    expect(raw.went_quiet[0]).toMatchObject({ team: null, ap_last_90_days_before: 5200 })
  })
  it('tolerates an empty answer', () => {
    const s = retentionSummary(toRetentionRaw(null))
    expect(s).toMatchObject({ now: null, prior: null, retention_change_points: null, inactive_after_days: 90 })
  })
})

describe('placement by carrier', () => {
  it('placement = issued / apps; issue rate also counts issued-then-lapsed; pending derived when missing', () => {
    const r = toBreakdownRow({ label: 'Carrier X', policies: '100', paid: 60, declined: 15, lapsed: 10 })
    expect(r.pending).toBe(15)
    expect(placementFigures(r)).toMatchObject({ placement_pct: 60, issue_pct: 70, decline_pct: 15, pending: 15 })
  })
  it('merges a carrier split across teams and ranks on rate only with enough apps', () => {
    const rows = [
      b('Big Co', { team: 'T1', policies: 60, paid: 30 }),
      b('Big Co', { team: 'T2', policies: 40, paid: 30 }),
      b('Good Co', { policies: 50, paid: 45 }),
      b('Tiny Co', { policies: 3, paid: 3 }),
    ]
    const vol = placementTable(rows)
    expect(vol.rows.map((r) => r.name)).toEqual(['Big Co', 'Good Co', 'Tiny Co'])
    expect(vol.rows[0]).toMatchObject({ applications: 100, issued: 60, placement_pct: 60 })
    expect(vol.highest_placement?.name).toBe('Good Co')
    expect(vol.lowest_placement?.name).toBe('Big Co')
    expect(vol.too_small_to_rank).toBe(1)
    expect(placementTable(rows, { order: 'bottom' }).rows.map((r) => r.name)).toEqual(['Big Co', 'Good Co'])
    expect(breakdownTotals(rows)).toMatchObject({ applications: 153, issued: 108, placement_pct: 70.6 })
  })
})

describe('pending lag', () => {
  // The Pinnacle Life curve shape (2026-10-17): 39%, 24%, 7%, 6%, then under 5%.
  const life = [
    { week: 0, apps: 1000, pending: 394 },
    { week: 1, apps: 1000, pending: 235 },
    { week: 2, apps: 1000, pending: 69 },
    { week: 3, apps: 1000, pending: 59 },
    { week: 4, apps: 1000, pending: 35 },
    { week: 5, apps: 1000, pending: 34 },
    { week: 6, apps: 1000, pending: 16 },
  ]
  it('settle age = first week under 5% pending with every older app under 5% too', () => {
    expect(settleDays(life)).toBe(28)
    expect(settleDays([{ week: 0, apps: 500, pending: 7 }, { week: 1, apps: 500, pending: 0 }])).toBe(0)
    // One noisy old bucket does not stretch the lag.
    expect(settleDays([{ week: 0, apps: 50, pending: 40 }, { week: 1, apps: 50, pending: 1 }, { week: 2, apps: 50, pending: 0 }, { week: 3, apps: 40, pending: 3 }, { week: 4, apps: 50, pending: 0 }])).toBe(7)
    // Tiny buckets are not judged.
    expect(settleDays([{ week: 0, apps: 5, pending: 5 }])).toBe(0)
    expect(settleDays([])).toBe(0)
  })
  it('the median issue lag rides along only with enough issued apps', () => {
    expect(lagDays(toMaturity({ basis: 'submitted_on', curve: life, median_issue_days: 11.4, issued_sample: 1500 }))).toEqual({ days: 28, median_issue_days: 11 })
    expect(lagDays(toMaturity({ basis: 'effective_date', curve: life, median_issue_days: null, issued_sample: 0 }))).toEqual({ days: 28, median_issue_days: null })
  })
  it('mature window cuts the window at today minus the lag, or slides a same-length window back', () => {
    expect(matureWindow({ start: '2026-07-21', end: '2026-10-18' }, '2026-10-18', 28)).toEqual({ start: '2026-07-21', end: '2026-09-20' })
    expect(matureWindow({ start: '2026-10-01', end: '2026-10-18' }, '2026-10-18', 28)).toEqual({ start: '2026-09-03', end: '2026-09-20' })
    expect(matureWindow({ start: '2026-01-01', end: '2026-06-30' }, '2026-10-18', 28)).toEqual({ start: '2026-01-01', end: '2026-06-30' })
  })
  it('a lag note only for a fresh window with material pending', () => {
    const today = '2026-10-18'
    expect(lagNote({ window: { start: '2026-10-01', end: today }, todayIso: today, settle: 28, pending: 300, applications: 1000 })).toMatch(/300 of 1,000 applications \(30%\) are still pending.*about 28 days/)
    // Settled long window: nothing.
    expect(lagNote({ window: { start: '2025-10-19', end: '2026-06-30' }, todayIso: today, settle: 28, pending: 300, applications: 1000 })).toBeNull()
    // A six-month window ending today is not "recent": nothing.
    expect(lagNote({ window: { start: '2026-04-19', end: today }, todayIso: today, settle: 28, pending: 300, applications: 1000 })).toBeNull()
    // Fresh window but pending immaterial: nothing.
    expect(lagNote({ window: { start: '2026-10-01', end: today }, todayIso: today, settle: 28, pending: 20, applications: 1000 })).toBeNull()
    // A book whose apps settle in the first week: nothing.
    expect(lagNote({ window: { start: '2026-10-01', end: today }, todayIso: today, settle: 0, pending: 300, applications: 1000 })).toBeNull()
    expect(addDays(today, -28)).toBe('2026-09-20')
  })
  it('last_6m compares with the six months before', () => {
    const p = resolvePeriod('last_6m', '2026-10-18')
    expect(p).toMatchObject({ start: '2026-04-19', end: '2026-10-18', prior: { start: '2025-10-19', end: '2026-04-18' } })
  })
})

// ── The tool views ──────────────────────────────────────────────────────────
const handler = CXO_PRODUCER_TOOL_HANDLERS.producer_production
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    tenant: { id: 'rep_store_review_pinnacle', brand: 'cxo', timezone: 'America/New_York' },
    caller: { id: 'm1', role: 'owner' },
    timezone: 'America/New_York',
    todayIso: '2026-10-18',
    ownerMemberId: 'm1',
    ...over,
  }) as never
const parse = async (p: Promise<{ text: string }>) => JSON.parse((await p).text)

const curve = [
  { week: 0, apps: 60, pending: 55 },
  { week: 1, apps: 40, pending: 27 },
  { week: 2, apps: 48, pending: 17 },
  { week: 3, apps: 47, pending: 10 },
  { week: 4, apps: 33, pending: 0 },
  { week: 5, apps: 51, pending: 1 },
]

describe('producer_production retention and placement views', () => {
  it('retention reads cxo_producer_retention for the tenant book over last_90 vs the 90 days before', async () => {
    answers.rpc.cxo_producer_retention = () => ({
      inactive_after_days: 90,
      data_through: '2026-10-18',
      now: { start: '2026-07-21', end: '2026-10-18', active_start: 31, retained: 28, stopped: 3, active_end: 34, writing: 34, new_writers: 4, joined: 4, reactivated: 2 },
      prior: { start: '2026-04-22', end: '2026-07-20', active_start: 33, retained: 33, stopped: 0, active_end: 31, writing: 31, new_writers: 0, joined: 0, reactivated: 0 },
      went_quiet_count: 1,
      went_quiet: [{ name: 'Zion Mockridge', team: 'Demo Harbor', last_sale: '2026-05-15', stopped_on: '2026-08-13', why: 'no policy in 90 days', policies_last_90_days_before: 14, ap_last_90_days_before: 39220 }],
      reactivated_agents: [{ name: 'Elliot Proxley', team: 'Demo Northstar', came_back_on: '2026-08-25', gap_days: 126 }],
      drifting: { days_30_59: 3, days_60_89: 1, top: [] },
    })
    const out = await parse(handler(ctx(), { view: 'retention' }))
    expect(out.reactivated_agents[0]).toMatchObject({ name: 'Elliot Proxley', gap_days: 126 })
    expect(calls.cxo_producer_retention[0]).toMatchObject({
      p_source: 'tenant',
      p_rep_id: 'rep_store_review_pinnacle',
      p_start: '2026-07-21',
      p_end: '2026-10-18',
      p_prior_start: '2026-04-22',
      p_prior_end: '2026-07-20',
      p_today: '2026-10-18',
      p_line: 'All',
    })
    expect(out.now.retention_pct).toBe(90.3)
    expect(out.prior.retention_pct).toBe(100)
    expect(out.retention_change_points).toBe(-9.7)
    expect(out.went_quiet[0].name).toBe('Zion Mockridge')
    expect(out.definition).toMatch(/90 days/)
    expect(out.team_page).toBeUndefined()
    expect(touched.filter((t) => t.includes('pinnacle_'))).toEqual([])
  })

  it('a Pinnacle tenant reads the Pinnacle source and carries the Team page headline', async () => {
    process.env.PINNACLE_VIEWER_REP_IDS = 'rep_imo'
    answers.pinnacleLastDay = '2026-10-17'
    answers.people = { data: { today: '2026-10-17', writing30: 1032, writing90: 1538, retention: { milestones: { m10: { n: 200, writing: 90 } }, turnover: { from: '2025-10', to: '2026-09', left: 1600, avg_headcount: 1450, months: 12 } } }, computed_at: '2026-10-17T10:00:00Z' }
    answers.rpc.cxo_producer_retention = () => ({ now: { active_start: 10, retained: 7 }, prior: null, drifting: {} })
    const out = await parse(handler(ctx({ tenant: { id: 'rep_imo', brand: 'cxo' } }), { view: 'retention' }))
    expect(calls.cxo_producer_retention[0]).toMatchObject({ p_source: 'pinnacle', p_rep_id: 'rep_imo' })
    expect(out.team_page).toMatchObject({ writing_last_90_days: 1538, still_writing_at_10_months_pct: 45, turnover: { left: 1600 } })
  })

  it('placement by carrier on a fresh window adds the lag note and the mature-cohort rate', async () => {
    answers.rpc.cxo_placement_maturity = () => ({ basis: 'submitted_on', curve, median_issue_days: 11, p90_issue_days: 24, issued_sample: 1578 })
    answers.rpc.cxo_book_breakdown = (a) =>
      a.p_end === '2026-10-18'
        ? [
            { label: 'Mockup Guaranty', policies: 96, paid: 77, declined: 8, lapsed: 0, pending: 11 },
            { label: 'Placeholder National', policies: 93, paid: 33, declined: 22, lapsed: 0, pending: 38 },
          ]
        : [
            { label: 'Mockup Guaranty', policies: 70, paid: 62, declined: 7, lapsed: 0, pending: 1 },
            { label: 'Placeholder National', policies: 60, paid: 33, declined: 25, lapsed: 0, pending: 2 },
          ]
    const out = await parse(handler(ctx(), { view: 'placement' }))
    expect(calls.cxo_book_breakdown[0]).toMatchObject({ p_rep_id: 'rep_store_review_pinnacle', p_dim: 'carrier', p_start: '2026-07-21', p_end: '2026-10-18' })
    expect(out.carriers.map((c: { name: string }) => c.name)).toEqual(['Mockup Guaranty', 'Placeholder National'])
    expect(out.highest_placement.name).toBe('Mockup Guaranty')
    expect(out.lowest_placement.name).toBe('Placeholder National')
    expect(out.lag_days).toBe(28)
    expect(out.median_issue_days).toBe(11)
    expect(out.lag_note).toMatch(/49 of 189 applications/)
    expect(out.mature_cohort).toMatchObject({ window: { start: '2026-07-21', end: '2026-09-20' }, applications: 130, placement_pct: 73.1 })
    expect(out.scope_note).toBeUndefined()
  })

  it('no lag note on a settled window, and mature: true reads only settled apps', async () => {
    answers.rpc.cxo_placement_maturity = () => ({ basis: 'submitted_on', curve, median_issue_days: 11, issued_sample: 1578 })
    answers.rpc.cxo_book_breakdown = () => [{ label: 'Sample Mutual', policies: 100, paid: 70, declined: 20, lapsed: 5, pending: 5 }]
    const settled = await parse(handler(ctx(), { view: 'placement', period: 'custom', start: '2026-04-01', end: '2026-06-30', by: 'product' }))
    expect(settled.lag_note).toBeUndefined()
    expect(settled.products[0]).toMatchObject({ name: 'Sample Mutual', placement_pct: 70, issue_pct: 75 })
    expect(calls.cxo_book_breakdown[0]).toMatchObject({ p_dim: 'product' })

    const mature = await parse(handler(ctx(), { view: 'placement', period: 'mtd', mature: true }))
    expect(mature.mature_cohort).toBe(true)
    expect(mature.window).toEqual({ start: '2026-09-03', end: '2026-09-20' })
    expect(mature.lag_note).toBeUndefined()
  })

  it('Pinnacle placement reads the carrier rollup and notes undated Life apps', async () => {
    process.env.PINNACLE_VIEWER_REP_IDS = 'rep_imo'
    answers.pinnacleLastDay = '2026-10-17'
    answers.rpc.cxo_placement_maturity = () => ({ basis: 'effective_date', curve: [{ week: 0, apps: 900, pending: 120 }, { week: 1, apps: 900, pending: 119 }, { week: 2, apps: 900, pending: 28 }, { week: 3, apps: 900, pending: 20 }], median_issue_days: null, issued_sample: 0 })
    answers.rpc.pinnacle_breakdown_v2 = () => [{ label: 'Carrier One', team: null, premium: 1000, funded: 800, policies: 500, paid: 400, declined: 50, lapsed: 10 }]
    const out = await parse(handler(ctx({ tenant: { id: 'rep_imo', brand: 'cxo' } }), { view: 'placement', period: 'last_12m' }))
    expect(calls.pinnacle_breakdown_v2[0]).toMatchObject({ p_dim: 'carrier', p_line: 'All' })
    expect(out.carriers[0]).toMatchObject({ name: 'Carrier One', pending: 40, placement_pct: 80, issue_pct: 82 })
    expect(out.scope_note).toMatch(/no effective date/)
    expect(touched).not.toContain('rpc:cxo_book_breakdown')
  })

  it('rank by placement carries the lag note only for a fresh window', async () => {
    answers.rpc.cxo_placement_maturity = () => ({ basis: 'submitted_on', curve, median_issue_days: 11, issued_sample: 1578 })
    answers.rpc.cxo_book_producer_production = () => [{ label: 'Avery Sampleton', team: 'Demo', premium: 9000, funded: 4000, policies: 10, paid: 5, declined: 1, lapsed: 0, pending: 4 }]
    const fresh = await parse(handler(ctx(), { view: 'rank', metric: 'placement' }))
    expect(fresh.lag_note).toMatch(/4 of 10 applications/)
    expect(fresh.mature_window).toEqual({ start: '2026-09-03', end: '2026-09-20' })
    const old = await parse(handler(ctx(), { view: 'rank', metric: 'placement', period: 'custom', start: '2026-04-01', end: '2026-06-30' }))
    expect(old.lag_note).toBeUndefined()
    const ap = await parse(handler(ctx(), { view: 'rank', metric: 'submitted_ap' }))
    expect(ap.lag_note).toBeUndefined()
  })
})
