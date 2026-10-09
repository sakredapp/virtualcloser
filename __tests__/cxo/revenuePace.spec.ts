/**
 * Owner 10-09: Mira said revenue was "pacing flat" (a straight-line projection
 * vs last month's full total) while the Revenue card said "down 31% vs the
 * same 9 days last month". Mira's pace must be the card's comparison, from the
 * card's own function; a projection may only appear labelled as an estimate.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  const chain = () => q
  for (const k of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order', 'limit', 'ilike', 'insert', 'update', 'upsert', 'delete']) q[k] = chain
  q.maybeSingle = async () => ({ data: null, error: null })
  q.single = async () => ({ data: null, error: null })
  q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null })
  return { supabase: { from: () => q, rpc: async () => ({ data: [], error: null }) } }
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { DailyRow } from '@/lib/pinnacle/rollup'
import { deltaWords, monthToDate } from '@/lib/pinnacle/kpis'
import { revenuePaceFacts } from '@/lib/agent/tools'

const row = (d: string, premium: number): DailyRow => ({ d, base_id: 'b1', line: 'Life', premium, policies: 1, funded_premium: null, funded_policies: 0 })
const day = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// September: 100/day for days 1-9, 59/day for 10-30 (full month 2,139).
// October:   69/day for days 1-9 → down 31% vs the same 9 days, but the
// straight-line month end (69 x 31 = 2,139) equals September's full month:
// exactly the "flat" trap.
const rows: DailyRow[] = [
  ...Array.from({ length: 30 }, (_, i) => row(day(9, i + 1), i < 9 ? 100 : 59)),
  ...Array.from({ length: 9 }, (_, i) => row(day(10, i + 1), 69)),
]
const today = '2026-10-09'
const through = '2026-10-09'

describe('Mira revenue pace = the Revenue card', () => {
  it('returns the same comparison the card computes', () => {
    const card = monthToDate(rows, new Date(`${today}T12:00:00Z`), through)
    const mira = revenuePaceFacts(rows, today, through)
    expect(mira.days_compared).toBe(card.through)
    expect(mira.mtd_premium).toBe(Math.round(card.mtd.premium))
    expect(mira.same_days_last_month_premium).toBe(Math.round(card.lm.premium))
    expect(mira.vs_same_days_last_month).toBe(deltaWords(card.vsLastMonth))
    expect(mira.vs_same_days_last_month_pct).toBe(Math.round((card.vsLastMonth.pct as number) * 100))
    expect(mira.vs_same_days_last_month).toBe('down 31%')
  })

  it('headlines the card comparison, never the projection or "flat"', () => {
    const mira = revenuePaceFacts(rows, today, through)
    expect(mira.headline).toContain('down 31% vs the same 9 days last month')
    expect(mira.headline).not.toMatch(/flat|on pace|projected|estimate/i)
    expect(mira.headline).not.toContain('2,139')
    // The projection is still there, but only under a labelled estimate.
    expect(mira.estimate_only.straight_line_month_end).toBe(2139)
    expect(mira.estimate_only.label).toMatch(/estimate/i)
    expect(Object.keys(mira)).not.toContain('pace_vs_prev_month_pct')
  })

  it('stays in parity when data stops before today', () => {
    const short = rows.filter((r) => r.d <= '2026-10-05')
    const card = monthToDate(short, new Date(`${today}T12:00:00Z`), '2026-10-05')
    const mira = revenuePaceFacts(short, today, '2026-10-05')
    expect(mira.days_compared).toBe(5)
    expect(mira.vs_same_days_last_month).toBe(deltaWords(card.vsLastMonth))
    expect(mira.headline).toContain('vs the same 5 days last month')
  })

  it('the card itself uses the shared function', () => {
    const src = readFileSync(path.resolve(__dirname, '../../app/components/cxo/ExecOverview.tsx'), 'utf8')
    expect(src).toMatch(/monthToDate\(/)
    expect(src).toMatch(/month\.vsLastMonth/)
  })
})
