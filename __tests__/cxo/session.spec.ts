import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))

import { sessionHomeHost, sessionHostsFor, signSession, verifySession } from '@/lib/client-auth'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-for-session-spec'
})

/** The middleware rule: the host must be the session slug or one of its hosts. */
const hostOk = (p: Awaited<ReturnType<typeof verifySession>>, hostSlug: string | null) =>
  !!p && !!hostSlug && (p.slug === hostSlug || p.hosts.includes(hostSlug))

const SPENCE = { slug: 'spence', host_aliases: ['pinnacle'] }

describe('session hosts', () => {
  it('lists the home host first, then the org slug and aliases', () => {
    expect(sessionHostsFor(SPENCE, 'pinnacle')).toEqual(['pinnacle', 'spence'])
    expect(sessionHostsFor(SPENCE)).toEqual(['spence', 'pinnacle'])
    expect(sessionHostsFor({ slug: 'acme', host_aliases: ['Bad Host!', 'ok-1'] })).toEqual(['acme', 'ok-1'])
  })

  it('signs the canonical slug and works on the alias host', async () => {
    const p = await verifySession(await signSession('spence', { memberId: 'm1', hosts: sessionHostsFor(SPENCE, 'pinnacle') }))
    expect(p).toMatchObject({ slug: 'spence', memberId: 'm1', hosts: ['pinnacle', 'spence'] })
    expect(sessionHomeHost(p!)).toBe('pinnacle')
    expect(hostOk(p, 'pinnacle')).toBe(true)
    expect(hostOk(p, 'spence')).toBe(true)
    expect(hostOk(p, 'otherorg')).toBe(false)
    expect(hostOk(p, null)).toBe(false)
  })

  it('keeps old cookie formats working', async () => {
    const legacy = await verifySession(await signSession('pinnacle'))
    expect(legacy).toMatchObject({ slug: 'pinnacle', memberId: null, hosts: [] })
    expect(sessionHomeHost(legacy!)).toBe('pinnacle')
    const v2 = await verifySession(await signSession('spence', { memberId: 'm2' }))
    expect(v2).toMatchObject({ slug: 'spence', memberId: 'm2', hosts: [] })
    expect(hostOk(v2, 'spence')).toBe(true)
    expect(hostOk(v2, 'pinnacle')).toBe(false)
  })

  it('rejects tampered, expired and malformed tokens', async () => {
    const tok = await signSession('spence', { memberId: 'm1', hosts: ['spence'] })
    const [, sig] = tok.split('.')
    const forged = Buffer.from(`otherorg.${Date.now() + 1e6}.m1.otherorg`).toString('base64url') + '.' + sig
    expect(await verifySession(forged)).toBeNull()
    expect(await verifySession(await signSession('spence', { ttlMs: -1000 }))).toBeNull()
    expect(await verifySession('nope')).toBeNull()
    expect(await verifySession(null)).toBeNull()
  })
})
