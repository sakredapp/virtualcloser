import { describe, expect, it } from 'vitest'
import { bookCxoSlot, cxoCallIcs, easternLabel, filterBusinessHours } from '@/lib/cxoBooking'

// 2026-10-26 is a Monday; Eastern is UTC-4 then.
const at = (iso: string, mins = 30) => ({ start: iso, end: new Date(new Date(iso).getTime() + mins * 60_000).toISOString(), offer_ref: 'r' })

describe('filterBusinessHours', () => {
  it('keeps weekday 9-5 Eastern and drops early, late, weekend and overrunning slots', () => {
    const out = filterBusinessHours([
      at('2026-10-26T12:30:00.000Z'), // 8:30 ET: too early
      at('2026-10-26T13:00:00.000Z'), // 9:00 ET: keep
      at('2026-10-26T20:30:00.000Z'), // 4:30 ET, ends 5:00: keep
      at('2026-10-26T20:45:00.000Z'), // 4:45 ET, ends 5:15: drop
      at('2026-10-24T14:00:00.000Z'), // Saturday: drop
    ])
    expect(out.map((s) => s.timeLabel)).toEqual(['9:00 AM', '4:30 PM'])
    expect(out[0]).toMatchObject({ dayKey: '2026-10-26', dayLabel: 'Mon, Oct 26', start: '2026-10-26T13:00:00.000Z', offer_ref: 'r' })
  })
  it('rounds stray seconds, de-dupes and caps the number of days', () => {
    const out = filterBusinessHours([at('2026-10-26T14:29:59.000Z'), at('2026-10-26T14:30:00.000Z')])
    expect(out).toHaveLength(1)
    expect(out[0].timeLabel).toBe('10:30 AM')
    const days = ['26', '27', '28', '29', '30'].map((d) => at(`2026-10-${d}T14:00:00.000Z`))
    expect(new Set(filterBusinessHours(days, 3).map((s) => s.dayKey)).size).toBe(3)
  })
  it('skips junk', () => {
    expect(filterBusinessHours([{ start: 'nope' }, { start: 5 }, {}])).toEqual([])
  })
})

describe('cxoCallIcs', () => {
  it('is a Suite CXO-only calendar entry with the booked times', () => {
    const ics = cxoCallIcs({ start: '2026-10-26T14:30:00.000Z', end: null, uid: 'lead-1', now: new Date('2026-10-23T12:00:00Z') })
    expect(ics).toContain('DTSTART:20261026T143000Z\r\n')
    expect(ics).toContain('DTEND:20261026T150000Z\r\n')
    expect(ics).toContain('UID:lead-1@suitecxo.com')
    expect(ics).toContain('SUMMARY:Suite CXO intro call')
    expect(ics).toContain('mailto:support@suitecxo.com')
    expect(ics).not.toMatch(/coverage|insurance|virtual closer|sakred/i)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})

describe('bookCxoSlot', () => {
  it('tells the booking API not to invite the prospect', async () => {
    const seen: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      seen.push(String(init?.body))
      return new Response(JSON.stringify({ ok: true, start: '2026-10-26T14:30:00.000Z', event_created: true }), { status: 200 })
    }) as typeof fetch
    try {
      const r = await bookCxoSlot({ start: '2026-10-26T14:30:00.000Z', offerRef: 'r', name: 'Jane', email: 'j@x.co' })
      expect(r.ok).toBe(true)
      expect(JSON.parse(seen[0])).toMatchObject({ invite_lead: false, offer_ref: 'r' })
    } finally {
      globalThis.fetch = orig
    }
  })
})

describe('easternLabel', () => {
  it('reads as a long Eastern time', () => {
    expect(easternLabel('2026-10-26T14:30:19.000Z')).toBe('Monday, October 26 at 10:30 AM ET')
  })
})
