/**
 * Team page "Who is writing · last 60 days": the split into writing more,
 * steady and slipping from two agent breakdowns. Synthetic rows only.
 */
import { describe, expect, it } from 'vitest'
import { classifyWriting, shiftIso, writingBand } from '@/lib/pinnacle/writing'
import type { BreakdownRow } from '@/lib/pinnacle/rollup'

const row = (label: string, policies: number, team: string | null = 'Team X', premium = policies * 1000): BreakdownRow => ({
  label,
  premium,
  policies,
  paid: 0,
  declined: 0,
  lapsed: 0,
  team,
})

describe('writingBand', () => {
  it('needs both a step of 2 and 25% to count as a move', () => {
    expect(writingBand(2, 1)).toBe('steady') // +1 only
    expect(writingBand(12, 10)).toBe('steady') // +2 but 20%
    expect(writingBand(13, 10)).toBe('more')
    expect(writingBand(2, 0)).toBe('more')
    expect(writingBand(7, 10)).toBe('slipping')
    expect(writingBand(0, 2)).toBe('slipping')
    expect(writingBand(0, 1)).toBe('steady')
  })
})

describe('classifyWriting', () => {
  it('joins the two windows by name and ranks slipping first, biggest drop first', () => {
    const out = classifyWriting(
      [row('Agent One', 10), row('Agent Two', 1), row('Agent Three', 5)],
      [row('agent one', 3), row('Agent Two', 6), row('Agent Four', 9), row('Agent Three', 5)],
    )
    expect(out.map((r) => [r.name, r.band])).toEqual([
      ['Agent Four', 'slipping'],
      ['Agent Two', 'slipping'],
      ['Agent One', 'more'],
      ['Agent Three', 'steady'],
    ])
    const one = out.find((r) => r.name === 'Agent One')!
    expect(one.recent).toBe(10)
    expect(one.prior).toBe(3)
    expect(one.recentPremium).toBe(10000)
  })

  it('skips blank labels and agents with nothing in either window', () => {
    expect(classifyWriting([row('', 4), row('Zero', 0)], [row('Zero', 0)])).toEqual([])
  })
})

describe('shiftIso', () => {
  it('shifts across month and year ends', () => {
    expect(shiftIso('2026-10-09', -59)).toBe('2026-08-11')
    expect(shiftIso('2026-01-01', -1)).toBe('2025-12-31')
  })
})
