import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))

import {
  AGENCY_DROP_PCT,
  COMPANY_PACE_DROP_PCT,
  MAX_SLIP_ITEMS,
  MIN_BOOK_SHARE_PCT,
  MIN_DAYS_COMPARED,
  MIN_PLACEMENT_APPS,
  PLACEMENT_DROP_PTS,
  detectSlipping,
  newSlips,
  slippingMonthKeyPattern,
  slippingNoticeKey,
  slippingNoticeText,
  syncDoneToday,
  type SlipInput,
} from '@/lib/pinnacle/slipping'
import { alreadyCheckedToday, markCheckedToday, SLIP_ALERT_ROLES } from '@/lib/pinnacle/slippingTick'
import { noticeKindsOr } from '@/lib/followups/notices'

// Invented companies and agencies only.
function input(over: Partial<SlipInput> = {}): SlipInput {
  return {
    monthKey: '2026-10',
    daysCompared: 12,
    company: { now: 100_000, lastMonth: 100_000, lastYear: null },
    agencies: [
      { name: 'Northwind Agency', now: 40_000, prior: 40_000 },
      { name: 'Bluefin Partners', now: 30_000, prior: 30_000 },
      { name: 'Tiny Shop Agency', now: 0, prior: 1_000 },
    ],
    carriers: [{ name: 'Acme Life', now: 50_000, prior: 50_000 }],
    placement: { label: 'September', priorLabel: 'August', nowPct: 70, priorPct: 72, nowApps: 100 },
    ...over,
  }
}

describe('thresholds', () => {
  it('are the agreed numbers', () => {
    expect([COMPANY_PACE_DROP_PCT, AGENCY_DROP_PCT, MIN_BOOK_SHARE_PCT, PLACEMENT_DROP_PTS, MAX_SLIP_ITEMS]).toEqual([15, 25, 5, 10, 3])
  })
})

describe('detectSlipping', () => {
  it('nothing slipping → empty list', () => {
    expect(detectSlipping(input())).toEqual([])
  })

  it('company pace: 15% fires, 14% does not', () => {
    expect(detectSlipping(input({ company: { now: 86_000, lastMonth: 100_000, lastYear: null } }))).toEqual([])
    const [c] = detectSlipping(input({ company: { now: 85_000, lastMonth: 100_000, lastYear: 80_000 } }))
    expect(c.kind).toBe('company')
    expect(c.drop_pct).toBe(15)
    expect(c.signature).toBe('company:2026-10')
    expect(c.line).toContain('down 15%')
    expect(c.line).toContain('up 6% vs the same days last year')
  })

  it('agency: 25% fires, 24% does not; carriers use the same rule', () => {
    const at = (now: number) => input({ agencies: [{ name: 'Northwind Agency', now, prior: 40_000 }, { name: 'Bluefin Partners', now: 30_000, prior: 30_000 }] })
    expect(detectSlipping(at(30_400))).toEqual([])
    const [a] = detectSlipping(at(30_000))
    expect(a).toMatchObject({ kind: 'agency', name: 'Northwind Agency', drop_pct: 25, signature: 'agency:northwind agency:2026-10' })
    const [c] = detectSlipping(input({ carriers: [{ name: 'Acme Life', now: 20_000, prior: 50_000 }] }))
    expect(c).toMatchObject({ kind: 'carrier', name: 'Acme Life' })
    expect(c.line.startsWith('Carrier Acme Life')).toBe(true)
  })

  it('ignores books under 5% of the company', () => {
    // Tiny Shop Agency fell 100% but is ~1.4% of the book.
    expect(detectSlipping(input()).some((i) => i.name === 'Tiny Shop Agency')).toBe(false)
  })

  it('placement: 10 points fires, needs enough apps', () => {
    const p = (nowPct: number, nowApps = 100) => input({ placement: { label: 'September', priorLabel: 'August', nowPct, priorPct: 72, nowApps } })
    expect(detectSlipping(p(63))).toEqual([])
    const [x] = detectSlipping(p(62))
    expect(x).toMatchObject({ kind: 'placement', drop_pts: 10 })
    expect(x.line).toBe('Placement fell 10 points: September 62% vs August 72%.')
    expect(detectSlipping(p(40, MIN_PLACEMENT_APPS - 1))).toEqual([])
  })

  it('too early in the month: no pace items, placement still judged', () => {
    const out = detectSlipping(input({
      daysCompared: MIN_DAYS_COMPARED - 1,
      company: { now: 10, lastMonth: 100_000, lastYear: null },
      placement: { label: 'September', priorLabel: 'August', nowPct: 50, priorPct: 72, nowApps: 100 },
    }))
    expect(out.map((i) => i.kind)).toEqual(['placement'])
  })

  it('at most 3, worst first', () => {
    const out = detectSlipping(input({
      company: { now: 80_000, lastMonth: 100_000, lastYear: null }, // 20% / 15 = 1.33
      agencies: [
        { name: 'Northwind Agency', now: 0, prior: 40_000 }, // 100% / 25 = 4
        { name: 'Bluefin Partners', now: 15_000, prior: 30_000 }, // 50% / 25 = 2
        { name: 'Harbor Lane Group', now: 21_000, prior: 30_000 }, // 30% / 25 = 1.2
      ],
      placement: { label: 'September', priorLabel: 'August', nowPct: 57, priorPct: 72, nowApps: 100 }, // 15 / 10 = 1.5
    }))
    expect(out).toHaveLength(3)
    expect(out.map((i) => i.name ?? i.kind)).toEqual(['Northwind Agency', 'Bluefin Partners', 'placement'])
  })
})

describe('the daily notice', () => {
  const items = detectSlipping(input({ agencies: [{ name: 'Northwind Agency', now: 0, prior: 40_000 }, { name: 'Bluefin Partners', now: 15_000, prior: 30_000 }] }))

  it('one key per member per day; month pattern matches it', () => {
    const key = slippingNoticeKey('2026-10-16', 'mem-1')
    expect(key).toBe('slipping-2026-10-16-mem-1')
    expect(slippingMonthKeyPattern('2026-10-16')).toBe('slipping-2026-10-%')
    expect(key.startsWith(slippingMonthKeyPattern('2026-10-16').replace('%', ''))).toBe(true)
  })

  it('a slip already alerted this month is not alerted again', () => {
    expect(newSlips(items, ['agency:northwind agency:2026-10']).map((i) => i.name)).toEqual(['Bluefin Partners'])
    expect(newSlips(items, [...items.map((i) => i.signature)])).toEqual([])
  })

  it('title and body in plain words', () => {
    const t = slippingNoticeText(items)
    expect(t.title).toBe('Slipping: Northwind Agency is down 100% vs last month, and 1 more')
    expect(t.body.split('\n')).toHaveLength(2)
    expect(t.body.startsWith('- Northwind Agency is down 100%')).toBe(true)
  })

  it('goes to owners and admins only', () => {
    expect([...SLIP_ALERT_ROLES]).toEqual(['owner', 'admin'])
  })

  it('checked-today memo is per tenant per day', () => {
    const memo = new Map<string, string>()
    expect(alreadyCheckedToday('org-a', '2026-10-16', memo)).toBe(false)
    markCheckedToday('org-a', '2026-10-16', memo)
    expect(alreadyCheckedToday('org-a', '2026-10-16', memo)).toBe(true)
    expect(alreadyCheckedToday('org-a', '2026-10-17', memo)).toBe(false)
    expect(alreadyCheckedToday('org-b', '2026-10-16', memo)).toBe(false)
  })

  it('the rail shows slipping notices even with the ops switch off', () => {
    expect(noticeKindsOr(['praise']).startsWith('kind.in.(praise),key.like.slipping-*')).toBe(true)
  })
})

describe('syncDoneToday', () => {
  const tz = 'America/New_York'
  const now = new Date('2026-10-16T15:00:00Z')
  it('needs a sync finished today in the tenant zone', () => {
    expect(syncDoneToday({ today: '2026-10-16', finishedAt: null, sweptAt: null, tz, now })).toBe(false)
    // 02:00 UTC on the 16th is still the 15th in New York.
    expect(syncDoneToday({ today: '2026-10-16', finishedAt: '2026-10-16T02:00:00Z', sweptAt: '2026-10-16T03:00:00Z', tz, now })).toBe(false)
  })
  it('waits for the rollup sweep after the sync', () => {
    const fin = '2026-10-16T13:00:00Z'
    expect(syncDoneToday({ today: '2026-10-16', finishedAt: fin, sweptAt: '2026-10-16T12:00:00Z', tz, now })).toBe(false)
    expect(syncDoneToday({ today: '2026-10-16', finishedAt: fin, sweptAt: '2026-10-16T13:05:00Z', tz, now })).toBe(true)
  })
  it('no sweep stamp: 40 minutes after the finish', () => {
    expect(syncDoneToday({ today: '2026-10-16', finishedAt: '2026-10-16T14:30:00Z', sweptAt: null, tz, now })).toBe(false)
    expect(syncDoneToday({ today: '2026-10-16', finishedAt: '2026-10-16T14:20:00Z', sweptAt: null, tz, now })).toBe(true)
  })
})
