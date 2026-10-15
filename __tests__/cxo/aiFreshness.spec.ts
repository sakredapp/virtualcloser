/**
 * Owner 10-15: every AI answers from the most recent information.
 * - Every earlier chat turn carries when it was sent, so an old answer's
 *   numbers or status never read as now.
 * - The clock line tells the model to re-read live state and say how current
 *   the numbers are.
 * - A cached rollup computed before the latest Airtable sweep is stale.
 * - Revenue answers carry as_of / last_synced_at, and the payroll assistant
 *   re-reads after a write.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  const chain = () => q
  for (const k of ['select', 'eq', 'is', 'not', 'in', 'gte', 'lte', 'order', 'limit', 'ilike', 'insert', 'update', 'upsert', 'delete']) q[k] = chain
  q.maybeSingle = async () => ({ data: null, error: null })
  q.single = async () => ({ data: null, error: null })
  q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null })
  return { supabase: { from: () => q, rpc: async () => ({ data: [], error: null }) } }
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nowLine, stampHistory } from '@/lib/agent/runAgent'
import { cachedRowIsCurrent } from '@/lib/pinnacle/cache'
import { freshnessStamp } from '@/lib/agent/tools'

const TZ = 'America/New_York'
const read = (p: string) => readFileSync(path.join(__dirname, '..', '..', p), 'utf8')

describe('chat history is stamped', () => {
  const now = '2026-10-15'
  it('same-day turns carry their time, not just old days', () => {
    const out = stampHistory(
      [
        { role: 'user', content: 'how is revenue?', at: '2026-10-15T13:05:00Z' },
        { role: 'assistant', content: '$12.4M month to date', at: '2026-10-15T13:05:20Z' },
      ],
      TZ,
      now,
    )
    expect(out[0].content).toMatch(/^\[sent today 9:05\sAM, earlier\]\n/)
    expect(out[1].content).toContain('$12.4M month to date')
    expect(String(out[1].content).startsWith('[sent today')).toBe(true)
  })
  it('other days say not today', () => {
    const [m] = stampHistory([{ role: 'assistant', content: 'x', at: '2026-10-13T20:00:00Z' }], TZ, now)
    expect(m.content).toMatch(/^\[sent Tue, Oct 13, 2026 4:00\sPM, not today\]/)
  })
  it('a turn without a time is marked unknown, never passed bare', () => {
    const [m] = stampHistory([{ role: 'user', content: 'x' }], TZ, now)
    expect(m.content).toBe('[earlier turn, time unknown]\nx')
  })
})

describe('clock line', () => {
  const line = nowLine(TZ, new Date('2026-10-15T18:40:00Z'))
  it('names the time now', () => expect(line).toMatch(/Thursday, October 15, 2026, 2:40\sPM/))
  it('forbids reusing numbers or status from earlier turns and asks for a fresh read', () => {
    expect(line).toContain('never reuse a date, a meeting list, a number, a status or a count from an earlier turn')
    expect(line).toContain('call the tool again right now')
  })
  it('asks for the as-of time with numbers or status', () => {
    expect(line).toContain('say how current they are')
    expect(line).toContain('as_of / data_through / last_synced')
  })
})

describe('rollup cache is stale after a newer sweep', () => {
  const now = new Date('2026-10-15T16:00:00Z')
  it('fresh when computed today after the latest sweep', () => {
    expect(cachedRowIsCurrent('2026-10-15T10:45:47Z', '2026-10-15T10:40:00Z', TZ, now)).toBe(true)
  })
  it('stale when a sweep finished after it was computed', () => {
    expect(cachedRowIsCurrent('2026-10-15T12:00:00Z', '2026-10-15T14:40:00Z', TZ, now)).toBe(false)
  })
  it('stale when computed on an earlier day', () => {
    expect(cachedRowIsCurrent('2026-10-14T20:00:00Z', null, TZ, now)).toBe(false)
  })
  it('missing or epoch rows are never current', () => {
    expect(cachedRowIsCurrent(null, null, TZ, now)).toBe(false)
    expect(cachedRowIsCurrent(new Date(0).toISOString(), null, TZ, now)).toBe(false)
  })
})

describe('revenue answers carry an as-of stamp', () => {
  it('stamps now and the last sync in the caller zone', () => {
    const s = freshnessStamp(new Date('2026-10-15T18:40:00Z'), TZ, '2026-10-15T10:40:00Z')
    expect(s.as_of).toMatch(/Thu, Oct 15, 2:40\sPM/)
    expect(s.last_synced_at).toMatch(/Thu, Oct 15, 6:40\sAM/)
    expect(s.freshness_note).toContain('Never reuse numbers from an earlier turn')
  })
  it('no sync known → null, not a guess', () => {
    expect(freshnessStamp(new Date(), TZ, null).last_synced_at).toBeNull()
  })
  it('every pinnacle_revenue view spreads the stamp', () => {
    const src = read('lib/agent/tools.ts')
    const handler = src.slice(src.indexOf('async function handle_pinnacle_revenue'), src.indexOf('/** Mira\'s pace summary.'))
    expect(handler.match(/pinnacleFreshness\(ctx\)/g)?.length).toBe(2) // breakdown + trend
    expect(src).toMatch(/return \{ \.\.\.fresh, book_computed_at/) // summary
    expect(src).not.toContain('synced daily from Airtable')
  })
  it('the month summary cache is busted by the sync tag', () => {
    expect(read('lib/pinnacle/rollup.ts')).toMatch(/pinnacle-month-summary-v2'\],[\s\S]{0,200}tags: \['pinnacle'\]/)
  })
  it('MCP overview and snapshot carry sync + compute times', () => {
    const src = read('lib/mcp/data.ts')
    expect(src.match(/as_of: today,\n\s+\.\.\.\(await L\.freshness\(\)\)/g)?.length).toBe(2)
  })
})

describe('payroll assistant re-reads after a write', () => {
  it('rebuilds its data block after a mutation and stamps it', () => {
    const src = read('app/api/payroll/assistant/route.ts')
    expect(src).toContain('if (didMutate) system = await buildSystem()')
    expect(src).toContain('read live as of ${asOf()}')
  })
})
