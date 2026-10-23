import { describe, expect, it } from 'vitest'
import { easternLabel, filterBusinessHours } from '@/lib/cxoBooking'

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

describe('easternLabel', () => {
  it('reads as a long Eastern time', () => {
    expect(easternLabel('2026-10-26T14:30:19.000Z')).toBe('Monday, October 26 at 10:30 AM ET')
  })
})
