import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Every read of the database is recorded. A tenant that is not mapped to the
// Pinnacle book must get nothing back AND must not cause a single pinnacle_*
// read — the tables have no tenant column, so the guard is the only wall.
const touched: string[] = []
function chain(name: string): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: null, error: null })
      return () => new Proxy({}, handler)
    },
  }
  touched.push(name)
  return new Proxy({}, handler)
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => chain(`from:${t}`),
    rpc: (fn: string) => chain(`rpc:${fn}`),
  },
}))
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
  revalidateTag: () => {},
}))

let memberTenant = 'rep_other'
vi.mock('@/lib/tenant', () => ({
  requireMember: async () => ({ tenant: { id: memberTenant, timezone: 'America/New_York' }, member: { id: 'm1' } }),
}))

const ENV = process.env.PINNACLE_VIEWER_REP_IDS
beforeEach(() => {
  touched.length = 0
  delete process.env.PINNACLE_VIEWER_REP_IDS
})
afterEach(() => {
  if (ENV === undefined) delete process.env.PINNACLE_VIEWER_REP_IDS
  else process.env.PINNACLE_VIEWER_REP_IDS = ENV
})

const pinnacleReads = () => touched.filter((t) => t.includes('pinnacle'))

describe('Pinnacle data is readable only by mapped tenants', () => {
  it('the allow-list defaults to Pinnacle only, never everyone', async () => {
    const { pinnacleAllowed } = await import('@/lib/pinnacle/access')
    expect(pinnacleAllowed('rep_spence')).toBe(true)
    expect(pinnacleAllowed('rep_other')).toBe(false)
    expect(pinnacleAllowed('')).toBe(false)
    expect(pinnacleAllowed(null)).toBe(false)
    process.env.PINNACLE_VIEWER_REP_IDS = 'rep_a, rep_b'
    expect(pinnacleAllowed('rep_a')).toBe(true)
    expect(pinnacleAllowed('rep_other')).toBe(false)
  })

  it('the exec overview gives another tenant nothing and reads no pinnacle table', async () => {
    const { getPinnacleOverview } = await import('@/lib/pinnacle/cache')
    const o = await getPinnacleOverview('rep_other', { view: 'full' })
    expect(o.allowed).toBe(false)
    expect(o.configured).toBe(false)
    expect(o.pinnacleRows).toEqual([])
    expect(o.statusRows).toEqual([])
    expect(pinnacleReads()).toEqual([])
  })

  it('the breakdown and summary API routes refuse another tenant', async () => {
    memberTenant = 'rep_other'
    const { NextRequest } = await import('next/server')
    const breakdown = await import('@/app/api/pinnacle/breakdown/route')
    const summary = await import('@/app/api/pinnacle/summary/route')
    const b = await breakdown.GET(new NextRequest('https://x.suitecxo.com/api/pinnacle/breakdown?dim=agent&line=All&start=2026-01-01&end=2026-10-09'))
    const s = await summary.GET(new NextRequest('https://x.suitecxo.com/api/pinnacle/summary?start=2026-10-01&end=2026-10-09'))
    expect(b.status).toBe(403)
    expect(s.status).toBe(403)
    expect(pinnacleReads()).toEqual([])
  })

  it('Mira and MCP helpers return nothing for another tenant', async () => {
    const mcp = await import('@/lib/mcp/data')
    const today = await import('@/lib/todayMira')
    const brief = await import('@/lib/exec/summary')
    const emp = await import('@/lib/employees/data')
    expect(mcp.pinnacleAllowed('rep_other')).toBe(false)
    expect(await today.teamSignals('rep_other')).toBeNull()
    expect(await today.searchAgents('rep_other', 'smith')).toEqual([])
    expect(await brief.buildPinnacleBriefData('rep_other', '2026-10-09')).toBeNull()
    expect(emp.bookReadable('rep_other')).toBe(false)
    expect(pinnacleReads()).toEqual([])
  })
})
