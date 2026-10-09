import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/today', () => ({ addTodo: vi.fn() }))

import { DeliveryTimeError, deliverAtFor } from '@/lib/memberMessages'

// 2026-10-09 10:00 in New York (EDT, UTC-4) = 14:00Z.
const NOW = new Date('2026-10-09T14:00:00Z')
const NY = 'America/New_York'
const at = (w: string, tz = NY) => deliverAtFor(w, tz, NOW).toISOString()

describe('deliverAtFor', () => {
  it('now-ish words deliver now', () => {
    for (const w of ['', 'now', 'ASAP', 'today', 'right now']) expect(at(w)).toBe(NOW.toISOString())
  })

  it('tomorrow defaults to 8am in the recipient zone', () => {
    expect(at('tomorrow')).toBe('2026-10-10T12:00:00.000Z')
    expect(at('tomorrow', 'America/Los_Angeles')).toBe('2026-10-10T15:00:00.000Z')
  })

  it('tomorrow / today with a clock time', () => {
    expect(at('tomorrow 2pm')).toBe('2026-10-10T18:00:00.000Z')
    expect(at('tomorrow at 9:30 am')).toBe('2026-10-10T13:30:00.000Z')
    expect(at('today 4:30pm')).toBe('2026-10-09T20:30:00.000Z')
    expect(at('tomorrow noon')).toBe('2026-10-10T16:00:00.000Z')
  })

  it('a bare time is the next time it comes round', () => {
    expect(at('2pm')).toBe('2026-10-09T18:00:00.000Z')
    expect(at('9am')).toBe('2026-10-10T13:00:00.000Z')
    expect(at('14:30')).toBe('2026-10-09T18:30:00.000Z')
  })

  it('dates and date-times are read in the recipient zone', () => {
    expect(at('2026-10-12')).toBe('2026-10-12T12:00:00.000Z')
    expect(at('2026-10-12 14:00')).toBe('2026-10-12T18:00:00.000Z')
    expect(at('2026-10-12T14:00')).toBe('2026-10-12T18:00:00.000Z')
    expect(at('2026-10-12 2pm')).toBe('2026-10-12T18:00:00.000Z')
    expect(at('2026-10-12T14:00:00Z')).toBe('2026-10-12T14:00:00.000Z')
  })

  it('a time already past delivers now', () => {
    expect(at('today 8am')).toBe(NOW.toISOString())
    expect(at('2026-10-01')).toBe(NOW.toISOString())
  })

  it('rejects input it cannot read instead of sending now', () => {
    for (const w of ['next week sometime', 'tomorrow 25:00', 'tomorrow 13pm', '7:75', '2026-13-01', '2026-02-30 9am', 'banana', 'today at 0am'])
      expect(() => deliverAtFor(w, NY, NOW), w).toThrow(DeliveryTimeError)
  })
})
