import { describe, expect, it, vi } from 'vitest'

const fromSpy = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => (fromSpy(t), { select: () => { throw new Error('no db in tests') } }) } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))

import {
  boardUpdateOn,
  canSeeBoardUpdate,
  changePct,
  cleanBody,
  composeSections,
  composeText,
  coveredMonth,
  firstBusinessDay,
  hasContent,
  isDraftTime,
  monthBounds,
  monthLabel,
  nextBody,
  noticeKey,
  noticeText,
  ofPlanPct,
  shiftMonth,
  type BoardFacts,
} from '@/lib/boardUpdate/shared'
import { ALWAYS_SHOWN_PREFIXES, BOARD_UPDATE_NOTICE_PREFIX } from '@/lib/followups/noticeActionsShared'
import { runBoardUpdateTick } from '@/lib/boardUpdate/data'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import { CXO_TOOL_DEFS, CXO_TOOL_HANDLERS } from '@/lib/agent/cxoTools'
import { CAPABILITIES } from '@/lib/agent/cxoCatalog'
import type { AgentContext } from '@/lib/agent/tools'

const NY = 'America/New_York'

const empty = (over: Partial<BoardFacts> = {}): BoardFacts => ({
  month: '2026-09',
  company: 'Acme Co',
  book: null,
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

describe('board update timing', () => {
  it('finds the first business day, skipping weekends and New Year', () => {
    expect(firstBusinessDay(2026, 11)).toBe(2) // Nov 1 2026 is a Sunday
    expect(firstBusinessDay(2026, 8)).toBe(3) // Aug 1 2026 is a Saturday
    expect(firstBusinessDay(2026, 10)).toBe(1) // Thursday
    expect(firstBusinessDay(2027, 1)).toBe(4) // Jan 1 2027 is a Friday (holiday), then the weekend
  })
  it('drafts from 8am local on the first business day, with catch-up, never at month end', () => {
    // Mon 2026-11-02 07:59 NY = 12:59Z (EST); 08:00 = 13:00Z
    expect(isDraftTime(new Date('2026-11-02T12:59:00Z'), NY)).toBe(false)
    expect(isDraftTime(new Date('2026-11-02T13:00:00Z'), NY)).toBe(true)
    expect(isDraftTime(new Date('2026-11-01T15:00:00Z'), NY)).toBe(false) // Sunday Nov 1
    expect(isDraftTime(new Date('2026-11-06T15:00:00Z'), NY)).toBe(true) // catch-up
    expect(isDraftTime(new Date('2026-11-11T15:00:00Z'), NY)).toBe(false)
    expect(isDraftTime(new Date('2026-10-30T15:00:00Z'), NY)).toBe(false)
  })
  it('covers the month that just closed, in the company zone', () => {
    expect(coveredMonth(new Date('2026-11-02T13:00:00Z'), NY)).toBe('2026-10')
    // 2026-11-01 02:00Z is still Oct 31 in New York.
    expect(coveredMonth(new Date('2026-11-01T02:00:00Z'), NY)).toBe('2026-09')
    expect(coveredMonth(new Date('2027-01-04T15:00:00Z'), NY)).toBe('2026-12')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-09', -12)).toBe('2025-09')
    expect(monthLabel('2026-09')).toBe('September 2026')
  })
  it('bounds the month at local midnight', () => {
    const b = monthBounds('2026-10', NY)
    expect(b.startDate).toBe('2026-10-01')
    expect(b.endDate).toBe('2026-10-31')
    expect(b.startIso).toBe('2026-10-01T04:00:00.000Z') // EDT
    expect(b.endIso).toBe('2026-11-01T04:00:00.000Z') // still EDT at midnight Nov 1
    expect(monthBounds('2026-12', NY).startIso).toBe('2026-12-01T05:00:00.000Z') // EST
  })
})

describe('board update access', () => {
  it('owners and admins with money access only', () => {
    expect(canSeeBoardUpdate({ role: 'owner' })).toBe(true)
    expect(canSeeBoardUpdate({ role: 'admin', settings: {} })).toBe(true)
    expect(canSeeBoardUpdate({ role: 'admin', settings: { can_view_comp: false } })).toBe(false)
    expect(canSeeBoardUpdate({ role: 'member', settings: { can_view_comp: true } })).toBe(false)
    expect(canSeeBoardUpdate({ role: 'manager' })).toBe(false)
    expect(canSeeBoardUpdate({ role: 'assistant' })).toBe(false)
    expect(canSeeBoardUpdate(null)).toBe(false)
  })
  it('the kill switch is env only and on by default', () => {
    expect(boardUpdateOn({})).toBe(true)
    expect(boardUpdateOn({ CXO_BOARD_UPDATE: 'on' })).toBe(true)
    expect(boardUpdateOn({ CXO_BOARD_UPDATE: ' OFF ' })).toBe(false)
  })
  it('the notice prefix always shows and keys are per month and person', () => {
    expect(ALWAYS_SHOWN_PREFIXES).toContain(BOARD_UPDATE_NOTICE_PREFIX)
    expect(noticeKey('2026-09', 'm1')).toBe('board-update-2026-09-m1')
  })
})

describe('board update figures', () => {
  it('compares against plan and last year with exact numbers', () => {
    expect(ofPlanPct(120, 100)).toBe(120)
    expect(ofPlanPct(120, 0)).toBeNull()
    expect(changePct(110, 100)).toBe(10)
    expect(changePct(90, 100)).toBe(-10)
    expect(changePct(5, 0)).toBeNull()
    expect(changePct(-50, -100)).toBe(50)
  })

  it('builds the book, plan and QuickBooks lines and wins and misses from them', () => {
    const s = composeSections(
      empty({
        book: { month: { premium: 120000, policies: 40 }, monthLastYear: { premium: 100000, policies: 30 }, ytd: { premium: 800000, policies: 300 }, ytdLastYear: null, through: '2026-09-30' },
        plan: { month: 100000, ytd: 900000 },
        qbo: { month: { income: 50000, net_income: -2000 }, monthLastYear: { income: 60000, net_income: 5000 }, ytd: { income: 400000, net_income: 30000 }, ytdLastYear: null },
      }),
    )
    const texts = s.headline.map((h) => h.text)
    expect(texts[0]).toBe('Premium written in Sep: $120,000, plan $100,000 (120% of plan), last year $100,000 (up 20%)')
    expect(texts[1]).toBe('Premium year to date: $800,000, plan $900,000 (89% of plan), no book for last year to compare')
    expect(texts[2]).toBe('Policies in Sep: 40, last year 30 (up 33.3%)')
    expect(texts).toContain('Revenue in Sep: $50,000, last year $60,000 (down 16.7%)')
    expect(texts).toContain('Net income in Sep: -$2,000, last year $5,000 (down 140%), margin -4%')
    expect(s.wins).toContain('Premium beat the Sep plan: $120,000 against $100,000 (120%).')
    expect(s.wins).toContain('Premium is up 20% on Sep last year.')
    expect(s.misses).toContain('Year to date premium is behind plan: $800,000 against $900,000 (89%).')
    expect(s.misses).toContain('Sep ran at a loss of $2,000 in QuickBooks.')
    expect(s.misses).toContain('Revenue is down 16.7% on Sep last year.')
    expect(s.sources).toEqual(['the book', 'the sales plan', 'QuickBooks'])
    expect(s.through).toBe('2026-09-30')
    for (const h of s.headline) expect(h.text).not.toMatch(/Pinnacle/i)
  })

  it('every figure in the text is one the rollup passed in', () => {
    const s = composeSections(empty({ book: { month: { premium: 4321, policies: 7 }, monthLastYear: null, ytd: { premium: 9876, policies: 12 }, ytdLastYear: null, through: '2026-09-29' } }))
    const text = composeText(s)
    const dollars = text.match(/\$\d[\d,]*\d/g) ?? []
    expect(new Set(dollars)).toEqual(new Set(['$4,321', '$9,876']))
  })

  it('a plan with no book shows the plan only, no fake actuals', () => {
    const s = composeSections(empty({ plan: { month: 50000, ytd: 400000 } }))
    expect(s.headline.map((h) => h.text)).toEqual(['Planned premium for Sep: $50,000', 'Planned premium year to date: $400,000'])
    expect(s.wins).toEqual([])
    expect(s.misses).toEqual([])
  })

  it('goals, KPIs, board cards and decisions', () => {
    const s = composeSections(
      empty({
        goalsDone: ['Hire a VP Sales'],
        goalsMissed: ['Launch the referral program'],
        kpis: { hit: 3, missed: 1 },
        cardsDone: { count: 12, titles: ['New CRM live', 'Q3 audit'] },
        cardsMissed: { count: 1, titles: ['Price sheet'] },
        decisions: [{ text: 'Move the pricing pilot to Texas', meeting_title: 'Leadership weekly', decided_at: '2026-09-14T15:00:00Z' }],
      }),
    )
    expect(s.wins).toEqual(['Goals reached: Hire a VP Sales.', '3 of 4 monthly KPIs hit their target.', '12 board cards done, including New CRM live; Q3 audit.'])
    expect(s.misses).toEqual(['Goals that passed their due date: Launch the referral program.', '1 of 4 monthly KPIs missed their target.', '1 board card was due in Sep and not done: Price sheet.'])
    expect(s.decisions).toEqual(['Move the pricing pilot to Texas (Leadership weekly, Sep 14)'])
    expect(hasContent(s)).toBe(true)
  })

  it('nothing to say means no notice', () => {
    expect(hasContent(composeSections(empty()))).toBe(false)
  })

  it('the text has every section, an empty asks, and no em dashes', () => {
    const text = composeText(composeSections(empty({ goalsDone: ['Ship v2'] })))
    expect(text.startsWith('Board update: September 2026\nAcme Co')).toBe(true)
    for (const h of ['Headline numbers', 'Wins', 'Misses', 'Decisions', 'Asks']) expect(text).toContain(`\n\n${h}\n`)
    expect(text).toContain('- Add what you need from the board.')
    expect(text).toContain('Ciao drafted this. Check it before you send it.')
    expect(text).not.toContain('—')
    const n = noticeText(composeSections(empty({ goalsDone: ['Ship v2'] })))
    expect(n.title).toBe('Your board update for September 2026 is drafted')
    expect(n.body).toContain('Ciao never sends it.')
    expect(n.body).not.toContain('—')
  })

  it('regenerating keeps the exec edits unless they ask for a fresh copy', () => {
    expect(nextBody(null, 'fresh')).toEqual({ body: 'fresh', edited: false })
    expect(nextBody({ body: 'mine', edited: true }, 'fresh')).toEqual({ body: 'mine', edited: true })
    expect(nextBody({ body: 'mine', edited: true }, 'fresh', false)).toEqual({ body: 'fresh', edited: false })
    expect(nextBody({ body: 'old', edited: false }, 'fresh')).toEqual({ body: 'fresh', edited: false })
    expect(cleanBody('a\r\nb')).toBe('a\nb')
    expect(cleanBody('x'.repeat(30000)).length).toBe(20000)
  })
})

describe('board update wiring', () => {
  it('Ciao has the tool, exec only', () => {
    expect(typeof CXO_TOOL_HANDLERS.board_update).toBe('function')
    expect(CXO_TOOL_DEFS.some((d) => d.name === 'board_update')).toBe(true)
    expect(EMPLOYEE_TOOLS.has('board_update')).toBe(false)
    expect(CAPABILITIES.some((c) => c.tools?.includes('board_update'))).toBe(true)
  })

  it('the tool refuses employees and non-money admins before touching the database', async () => {
    fromSpy.mockClear()
    const base = { tenant: { id: 'rep_x', timezone: NY }, timezone: NY, todayIso: '2026-10-17', ownerMemberId: 'o' }
    for (const caller of [{ id: 'e', role: 'member' }, { id: 'a', role: 'admin', settings: { can_view_comp: false } }]) {
      const res = await CXO_TOOL_HANDLERS.board_update({ ...base, caller } as unknown as AgentContext, {})
      expect(JSON.parse(res.text).ok).toBe(false)
    }
    const res = await CXO_TOOL_HANDLERS.board_update({ ...base, caller: { id: 'o', role: 'owner' }, selfOnly: true } as unknown as AgentContext, {})
    expect(JSON.parse(res.text).ok).toBe(false)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('the tick does nothing with the kill switch off', async () => {
    fromSpy.mockClear()
    const prev = process.env.CXO_BOARD_UPDATE
    process.env.CXO_BOARD_UPDATE = 'off'
    try {
      expect(await runBoardUpdateTick(new Date('2026-11-02T14:00:00Z'))).toEqual({ tenants: 0, drafted: 0, notices: 0, errors: 0 })
      expect(fromSpy).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.CXO_BOARD_UPDATE
      else process.env.CXO_BOARD_UPDATE = prev
    }
  })
})
