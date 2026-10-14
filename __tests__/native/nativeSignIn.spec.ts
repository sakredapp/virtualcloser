/**
 * Phone-app sign-in (lib/nativeSession.ts) and the phone's revenue route:
 * same password rules as the web, a token the middleware accepts, and plain
 * answers for anyone the app is not for. Another tenant never reads the
 * Pinnacle book.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: { member: Row | null; rep: Row | null; touched: string[] } = { member: null, rep: null, touched: [] }

function chain(table: string): unknown {
  db.touched.push(table)
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: null, error: null })
      if (prop === 'maybeSingle') return async () => ({ data: table === 'reps' ? db.rep : null, error: null })
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => chain(t), rpc: (fn: string) => chain(`rpc:${fn}`) },
}))
vi.mock('@/lib/members', () => ({
  findMemberByEmailGlobal: async () => db.member,
  recordMemberLogin: async () => {},
}))
vi.mock('@/lib/client-password', () => ({
  verifyPassword: async (pw: string, hash: string | null) => !!hash && hash === `hash:${pw}`,
}))
const limit = { allowed: true }
vi.mock('@/lib/rateLimit', () => ({
  enforceRateLimit: async (key: string, l: number, w: number) => ({ allowed: limit.allowed, key, limit: l, windowSec: w, retryAfterSec: limit.allowed ? 0 : w }),
}))
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
  revalidateTag: () => {},
}))

const CXO_REP = { id: 'rep_harbor', slug: 'harbor', display_name: 'Harbor Holdings', brand: 'cxo', host_aliases: ['hh'], is_active: true, password_hash: null }
const OWNER = { id: 'm1', rep_id: 'rep_harbor', email: 'ann@harbor.test', display_name: 'Ann Lee', role: 'owner', password_hash: 'hash:right', is_active: true, last_login_at: '2026-10-01T00:00:00Z', home_subdomain: null, settings: {} }

beforeAll(() => vi.stubEnv('SESSION_SECRET', 'native-signin-test-secret'))
beforeEach(() => {
  db.member = { ...OWNER }
  db.rep = { ...CXO_REP }
  db.touched = []
  delete process.env.PINNACLE_VIEWER_REP_IDS
})

describe('nativeSignIn', () => {
  it('signs in an exec and returns a token for their own host', async () => {
    const { nativeSignIn } = await import('@/lib/nativeSession')
    const { verifySession } = await import('@/lib/client-auth')
    const r = await nativeSignIn('  Ann@Harbor.test ', 'right')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.host).toBe('harbor.suitecxo.com')
    expect(r.company).toBe('Harbor Holdings')
    expect(r.name).toBe('Ann Lee')
    expect(r.pinnacle).toBe(false)
    const s = await verifySession(r.token)
    expect(s?.slug).toBe('harbor')
    expect(s?.memberId).toBe('m1')
    expect(s?.hosts).toEqual(['harbor', 'hh'])
    expect(s?.scope).toBeNull()
  })

  it('refuses a wrong password and a missing field', async () => {
    const { nativeSignIn } = await import('@/lib/nativeSession')
    expect(await nativeSignIn('ann@harbor.test', 'wrong')).toMatchObject({ ok: false, status: 401 })
    expect(await nativeSignIn('', 'right')).toMatchObject({ ok: false, status: 400 })
    expect(await nativeSignIn('ann@harbor.test', 42)).toMatchObject({ ok: false, status: 400 })
  })

  it('is for Suite CXO accounts only', async () => {
    const { nativeSignIn } = await import('@/lib/nativeSession')
    db.rep = { ...CXO_REP, brand: 'virtualcloser' }
    expect(await nativeSignIn('ann@harbor.test', 'right')).toMatchObject({ ok: false, status: 403 })
  })

  it('sends an employee-only login and a first sign-in to the web', async () => {
    const { nativeSignIn } = await import('@/lib/nativeSession')
    db.member = { ...OWNER, role: 'rep' }
    expect(await nativeSignIn('ann@harbor.test', 'right')).toMatchObject({ ok: false, status: 403 })
    db.member = { ...OWNER, last_login_at: null }
    const first = await nativeSignIn('ann@harbor.test', 'right')
    expect(first).toMatchObject({ ok: false, status: 403 })
    if (!first.ok) expect(first.error).toMatch(/password/i)
  })

  it('marks the Pinnacle book account', async () => {
    const { nativeSignIn } = await import('@/lib/nativeSession')
    process.env.PINNACLE_VIEWER_REP_IDS = 'rep_harbor'
    const r = await nativeSignIn('ann@harbor.test', 'right')
    expect(r).toMatchObject({ ok: true, pinnacle: true })
  })
})

describe('POST /api/native/session', () => {
  it('returns the session as JSON and never echoes the password', async () => {
    const { NextRequest } = await import('next/server')
    const route = await import('@/app/api/native/session/route')
    const res = await route.POST(new NextRequest('https://suitecxo.com/api/native/session', { method: 'POST', body: JSON.stringify({ email: 'ann@harbor.test', password: 'right' }) }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(typeof j.token).toBe('string')
    expect(j.ok).toBeUndefined()
    expect(JSON.stringify(j)).not.toContain('right')
    const bad = await route.POST(new NextRequest('https://suitecxo.com/api/native/session', { method: 'POST', body: '{' }))
    expect(bad.status).toBe(400)
  })

  it('slows down repeated tries', async () => {
    const { NextRequest } = await import('next/server')
    const route = await import('@/app/api/native/session/route')
    limit.allowed = false
    const res = await route.POST(new NextRequest('https://suitecxo.com/api/native/session', { method: 'POST', body: JSON.stringify({ email: 'ann@harbor.test', password: 'right' }) }))
    limit.allowed = true
    expect(res.status).toBe(429)
  })
})

describe('GET /api/native/revenue', () => {
  it('gives another tenant no Pinnacle book read, and an empty state when it may not see money', async () => {
    vi.doMock('@/lib/cxoAccess', () => ({
      NotExec: class extends Error {},
      requireExecMember: async () => ({ tenant: { id: 'rep_harbor', timezone: 'America/New_York' }, member: { id: 'm1', role: 'rep', settings: {} } }),
    }))
    vi.resetModules()
    const route = await import('@/app/api/native/revenue/route')
    db.touched = []
    const res = await route.GET()
    expect(await res.json()).toEqual({ kind: 'none', reason: 'not_allowed' })
    expect(db.touched.filter((t) => t.includes('pinnacle'))).toEqual([])
    vi.doUnmock('@/lib/cxoAccess')
  })
})
