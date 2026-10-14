/** Server side: getSessionPayload reads the cookie, else a bearer on /api only. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state: { cookie?: string; headers: Record<string, string> } = { headers: {} }
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'vc_session' && state.cookie ? { value: state.cookie } : undefined) }),
  headers: async () => ({ get: (n: string) => state.headers[n.toLowerCase()] ?? null }),
}))

let token = ''
beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'bearer-server-test-secret')
  const { signSession } = await import('@/lib/client-auth')
  token = await signSession('harbor', { memberId: 'm1', hosts: ['harbor'] })
})
beforeEach(() => {
  state.cookie = undefined
  state.headers = {}
})

describe('getSessionPayload', () => {
  it('reads a bearer on an API path', async () => {
    const { getSessionPayload } = await import('@/lib/client-auth')
    state.headers = { 'x-pathname': '/api/today', authorization: `Bearer ${token}` }
    expect((await getSessionPayload())?.memberId).toBe('m1')
  })

  it('ignores a bearer on a page path', async () => {
    const { getSessionPayload } = await import('@/lib/client-auth')
    state.headers = { 'x-pathname': '/dashboard', authorization: `Bearer ${token}` }
    expect(await getSessionPayload()).toBeNull()
  })

  it('prefers the cookie', async () => {
    const { getSessionPayload, signSession } = await import('@/lib/client-auth')
    state.cookie = await signSession('harbor', { memberId: 'cookie-member', hosts: ['harbor'] })
    state.headers = { 'x-pathname': '/api/today', authorization: `Bearer ${token}` }
    expect((await getSessionPayload())?.memberId).toBe('cookie-member')
  })
})
