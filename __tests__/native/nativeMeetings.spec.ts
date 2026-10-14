/**
 * The phone's Meetings list only shows notes that are shared or the signed-in
 * member's own, the same rule /api/today uses. Another exec's private notes
 * never reach this phone.
 */
import { describe, expect, it, vi } from 'vitest'

const calls: Array<{ method: string; args: unknown[] }> = []
function chain(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: [], error: null })
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args })
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => chain() } }))
vi.mock('@/lib/today', () => ({ todaysMeetings: async () => null }))
vi.mock('@/lib/cxoAccess', () => {
  class NotExec extends Error {}
  return {
    NotExec,
    requireExecMember: async () => ({ tenant: { id: 'rep_harbor', timezone: 'America/New_York' }, member: { id: 'm-ann', timezone: null } }),
  }
})

describe('GET /api/native/meetings', () => {
  it('reads only shared notes and the member’s own, inside their tenant', async () => {
    const { GET } = await import('@/app/api/native/meetings/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(calls).toContainEqual({ method: 'eq', args: ['rep_id', 'rep_harbor'] })
    expect(calls).toContainEqual({ method: 'or', args: ['owner_member_id.is.null,owner_member_id.eq.m-ann'] })
    const body = await res.json()
    expect(body).toEqual({ timezone: 'America/New_York', today: null, notes: [] })
  })
})
