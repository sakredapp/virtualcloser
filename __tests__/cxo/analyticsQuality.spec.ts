/**
 * Ciao analytics-answer quality (2026-10-18, Pinnacle QA):
 *   1. producer reads return every row past PostgREST's 1,000-row cap (one jsonb value) so totals match the card;
 *      agencies come from the team rollup (the card's own query);
 *   2. agents with mostly pending apps are not ranked on placement;
 *   3. implausible 100% carrier rates are flagged and kept out of rankings;
 *   4. the board update computes misses, wins and risks from the book and
 *      labels a month-to-date preview;
 *   5. an empty follow-up list surfaces business items, never as tasks;
 *   6. slipping attribution says how much of the drop is explained.
 * Pure functions only; no database. Invented names.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))

import { fromCompactRows, toProducerRow } from '@/lib/book/data'
import { agencyTotalsFromDim, isUnsettled, rankProducers, type ProducerRow } from '@/lib/book/production'
import { isImplausibleRate, placementTable, type BreakdownRow } from '@/lib/book/retention'
import { DRIVER_EXPLAINS_PCT, detectSlipping, slipAttribution, type SlipInput } from '@/lib/pinnacle/slipping'
import { composeSections, composeText, type BoardFacts } from '@/lib/boardUpdate/shared'
import { prorate, quarterSpan, sameDay } from '@/lib/boardUpdate/data'
import { ATTENTION_NOTE, shapeAttention } from '@/lib/agent/businessAttention'
import { routingHintsFor } from '@/lib/agent/cxoCatalog'

const prod = (name: string, o: Partial<ProducerRow> = {}): ProducerRow => ({
  name,
  team: 'Demo Agency',
  premium: 0,
  funded: 0,
  policies: 0,
  paid: 0,
  declined: 0,
  lapsed: 0,
  pending: 0,
  firstPolicy: '2025-01-05',
  contractedAt: null,
  status: null,
  ...o,
})
const br = (label: string, o: Partial<BreakdownRow> = {}): BreakdownRow => ({ label, team: null, premium: 0, funded: 0, policies: 0, paid: 0, declined: 0, lapsed: 0, pending: 0, ...o })

describe('1. every producer row past the 1,000-row cap', () => {
  it('reads a whole window from one compact value, in order, cents kept', () => {
    const total = 2_345
    const data = Array.from({ length: total }, (_, i) => [`Agent ${i}`, 'T', 100.25 + i, 0, 1, 0, 0, 0, 1, '2025-01-01', null, null])
    const out = fromCompactRows(data).map(toProducerRow)
    expect(out.length).toBe(total)
    expect(out[0]).toMatchObject({ name: 'Agent 0', team: 'T', premium: 100.25, policies: 1, pending: 1, firstPolicy: '2025-01-01' })
    expect(out[total - 1].name).toBe(`Agent ${total - 1}`)
    expect(out.reduce((s, r) => s + r.premium, 0)).toBeCloseTo(total * 100.25 + (total * (total - 1)) / 2, 2)
  })
  it('passes object rows through and treats anything else as empty', () => {
    expect(fromCompactRows([{ label: 'A', premium: 5 }]).map(toProducerRow)[0]).toMatchObject({ name: 'A', premium: 5 })
    expect(fromCompactRows(null)).toEqual([])
  })
  it('agencies from the team rollup keep the card figures and share of the company', () => {
    const rows = agencyTotalsFromDim(
      [
        { label: 'Northwind Agency', premium: 419_270, funded: 300_000, policies: 276 },
        { label: 'Bluefin Partners', premium: 580_730, funded: 400_000, policies: 300 },
        { label: '', premium: 5, funded: 0, policies: 1 },
      ],
      { companyAp: 1_000_000 },
    )
    expect(rows.map((r) => r.agency)).toEqual(['Bluefin Partners', 'Northwind Agency'])
    expect(rows[1]).toMatchObject({ submitted_ap: 419_270, applications: 276, share_of_ap_pct: 41.9 })
  })
})

describe('2. placement ranking skips unsettled agents', () => {
  it('an all-pending agent is not the worst; it is listed as too new to judge', () => {
    const rows = [
      prod('Pending Pat', { policies: 7, pending: 7, premium: 9_000 }),
      prod('Settled Sam', { policies: 20, paid: 10, declined: 10, premium: 20_000 }),
      prod('Good Gail', { policies: 20, paid: 18, declined: 2, premium: 25_000 }),
    ]
    expect(isUnsettled(rows[0])).toBe(true)
    const r = rankProducers(rows, 'placement', { order: 'bottom' })
    expect(r.ranked.map((x) => x.name)).toEqual(['Settled Sam', 'Good Gail'])
    expect(r.too_new_to_judge).toMatchObject({ count: 1, examples: [{ name: 'Pending Pat', applications: 7, pending: 7 }] })
  })
  it('other metrics still rank everyone', () => {
    const rows = [prod('Pending Pat', { policies: 7, pending: 7, premium: 9_000 }), prod('Settled Sam', { policies: 20, paid: 10, premium: 20_000 })]
    const r = rankProducers(rows, 'submitted_ap')
    expect(r.ranked.length).toBe(2)
    expect(r.too_new_to_judge).toBeNull()
  })
})

describe('3. implausible carrier rates', () => {
  it('flags 50+ apps with no decline and no lapse at ~100%', () => {
    expect(isImplausibleRate(br('Feed Life', { policies: 509, paid: 509 }))).toBe(true)
    expect(isImplausibleRate(br('Small Life', { policies: 20, paid: 20 }))).toBe(false)
    expect(isImplausibleRate(br('Real Life', { policies: 1_554, paid: 1_500, declined: 54 }))).toBe(false)
  })
  it('keeps flagged rows out of highest/lowest and lists them apart', () => {
    const t = placementTable([
      br('Feed Life', { policies: 509, paid: 509 }),
      br('Real Life', { policies: 1_554, paid: 1_400, declined: 100, lapsed: 54 }),
      br('Other Mutual', { policies: 300, paid: 200, declined: 100 }),
    ])
    expect(t.highest_placement?.name).toBe('Real Life')
    expect(t.lowest_placement?.name).toBe('Other Mutual')
    expect(t.implausible_rates?.rows.map((r) => r.name)).toEqual(['Feed Life'])
    expect(t.rows.find((r) => r.name === 'Feed Life')).toMatchObject({ flag: 'implausible_rate' })
  })
})

const facts = (over: Partial<BoardFacts> = {}): BoardFacts => ({
  month: '2026-09',
  company: 'Acme Co',
  book: { month: { premium: 900_000, policies: 900 }, monthLastYear: null, ytd: { premium: 9_000_000, policies: 9_000 }, ytdLastYear: null, through: '2026-09-30' },
  plan: null,
  qbo: null,
  goalsDone: [],
  goalsMissed: [],
  kpis: { hit: 0, missed: 0 },
  cardsDone: { count: 0, titles: [] },
  cardsMissed: { count: 0, titles: [] },
  decisions: [],
  ...over,
})

describe('4. board update misses and risks from the book', () => {
  it('retention down 5.3 points with 410 stopped is a miss; drifting agents are a risk', () => {
    const s = composeSections(
      facts({
        trends: {
          production: { now: { premium: 900_000, policies: 900 }, prior: { premium: 1_000_000, policies: 950 }, priorLabel: 'August' },
          retention: { label: 'Q3 2026', priorLabel: 'Q2 2026', nowPct: 60.2, priorPct: 65.5, stopped: 410, driftingAgents: 375 },
          placement: { label: 'September', priorLabel: 'August', nowPct: 70, priorPct: 75, pendingPct: 4, priorPendingPct: 2 },
        },
      }),
    )
    expect(s.misses).toContain('Premium written fell 10% vs August: $900,000 against $1,000,000.')
    expect(s.misses.some((m) => m.startsWith('In Q3 2026, agent retention fell 5.3 points') && m.includes('410 agents stopped writing'))).toBe(true)
    expect(s.misses.some((m) => m.startsWith('Placement fell 5 points'))).toBe(true)
    expect(s.risks?.[0]).toContain('375 active agents have not written in 30 to 89 days')
    const text = composeText(s, 'Ciao')
    expect(text).toContain('Risks to watch')
    expect(text).not.toContain('No misses found')
  })
  it('unsettled placement is a risk, not a miss', () => {
    const s = composeSections(facts({ trends: { production: null, retention: null, placement: { label: 'Oct 1 to 18', priorLabel: 'Sep 1 to 18', nowPct: 40, priorPct: 70, pendingPct: 45, priorPendingPct: 8 } } }))
    expect(s.misses).toEqual([])
    expect(s.risks?.[0]).toContain('still pending')
  })
  it('no misses found says what was checked; asks placeholder unchanged', () => {
    const text = composeText(composeSections(facts()), 'Ciao')
    expect(text).toContain('- No misses found in production, retention, placement, plan, goals or board.')
    expect(text).toContain('- Add what you need from the board.')
  })
  it('a month-to-date preview is labelled, with the plan prorated and same-days comparisons', () => {
    const s = composeSections(
      facts({
        month: '2026-10',
        toDate: { through: '2026-10-18' },
        plan: prorate({ month: 3_100_000, ytd: 30_000_000 }, '2026-10', '2026-10-18'),
        book: { month: { premium: 1_500_000, policies: 1_000 }, monthLastYear: { premium: 1_400_000, policies: 900 }, ytd: { premium: 20_000_000, policies: 20_000 }, ytdLastYear: null, through: '2026-10-18' },
      }),
    )
    expect(s.month_label).toBe('October 2026, month to date through Oct 18')
    expect(s.to_date).toBe(true)
    expect(s.headline[0].text).toContain('Premium written in Oct 1 to 18')
    expect(s.headline[0].text).toContain('plan prorated to Oct 18 $1,800,000')
    expect(s.headline[0].text).toContain('same days last year')
    expect(composeText(s, 'Ciao')).toContain('Month-to-date preview')
  })
  it('date helpers: prorate, same day, quarter spans', () => {
    expect(prorate({ month: 3_100_000, ytd: 30_000_000 }, '2026-10', '2026-10-18')).toEqual({ month: 1_800_000, ytd: 28_700_000 })
    expect(sameDay('2026-09', '2026-10-31')).toBe('2026-09-30')
    expect(quarterSpan('2026-09', '2026-09-30')).toMatchObject({ start: '2026-07-01', label: 'Q3 2026', prior: { start: '2026-04-01', end: '2026-06-30', label: 'Q2 2026' } })
    expect(quarterSpan('2026-11', '2026-11-18')).toMatchObject({ start: '2026-10-01', end: '2026-11-18', label: 'Q4 2026 through Nov 18', prior: { start: '2026-07-01', end: '2026-08-18' } })
  })
})

describe('5. follow-ups: business items when the list is empty', () => {
  it('shapes drifting, stopped and slipping, with the not-a-task note', () => {
    const a = shapeAttention({
      drifting: { days_30_59: 300, days_60_89: 75, top: [{ name: 'Agent One', team: 'Northwind Agency', days_since: 61 }] },
      wentQuiet: 40,
      slipping: ['Carrier Acme Life is down 30%.'],
    })
    expect(a).toMatchObject({ drifting_agents: { count: 375, top: [{ name: 'Agent One', agency: 'Northwind Agency', days_since_last_sale: 61 }] }, stopped_writing_last_30_days: 40, slipping: ['Carrier Acme Life is down 30%.'] })
    expect(a?.note).toBe(ATTENTION_NOTE)
    expect(ATTENTION_NOTE).toContain('not tasks')
  })
  it('nothing to say → null, so the answer stays "nothing open"', () => {
    expect(shapeAttention({ drifting: { days_30_59: 0, days_60_89: 0, top: [] }, wentQuiet: 0, slipping: [] })).toBeNull()
  })
  it('routing: "what do I need to follow up on" reads follow-ups and to-dos, never invents tasks', () => {
    const hint = routingHintsFor(new Set(['list_followups', 'list_my_todos'])).join('\n')
    expect(hint).toContain('What do I need to follow up on')
    expect(hint).toContain('Never invent a task')
  })
})

describe('6. slipping attribution', () => {
  const input = (over: Partial<SlipInput> = {}): SlipInput => ({
    monthKey: '2026-10',
    daysCompared: 18,
    company: { now: 800_000, lastMonth: 1_000_000, lastYear: null },
    agencies: [
      { name: 'Northwind Agency', now: 300_000, prior: 350_000 },
      { name: 'Bluefin Partners', now: 200_000, prior: 260_000 },
    ],
    carriers: [
      { name: 'Acme Life', now: 300_000, prior: 370_000 },
      { name: 'Beta Mutual', now: 100_000, prior: 144_000 },
      { name: 'Gamma Health', now: 400_000, prior: 386_000 },
    ],
    placement: null,
    ...over,
  })
  it('says the share of the drop the top carriers explain, and "drivers" only at 80%+', () => {
    const a = slipAttribution(input())!
    expect(a.company_drop).toBe(200_000)
    expect(a.top_carriers.map((c) => c.name)).toEqual(['Acme Life', 'Beta Mutual'])
    expect(a.top_carriers_explain_pct).toBe(57)
    expect(a.base_period).toContain('same 18 days last month')
    expect(a.note).toContain(`only when they explain ${DRIVER_EXPLAINS_PCT}%`)
    expect(a.note).toContain('never add one list to the other')
  })
  it('no attribution when the company is not down', () => {
    expect(slipAttribution(input({ company: { now: 1_000_000, lastMonth: 900_000, lastYear: null } }))).toBeNull()
  })
  it('item lines say the base is last month and the share of the company drop', () => {
    const items = detectSlipping(input({ carriers: [{ name: 'Acme Life', now: 200_000, prior: 370_000 }] }))
    const c = items.find((i) => i.kind === 'carrier')!
    expect(c.line).toContain("of last month's premium over those days")
    expect(c.share_of_company_drop_pct).toBe(85)
  })
})
