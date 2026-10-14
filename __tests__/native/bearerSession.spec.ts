/**
 * The phone app (Expo, no cookies) sends the signed session token as a
 * bearer on /api calls. Pages never read it, API keys and MCP tokens are left
 * to their own checks, and a browser with a cookie is unchanged.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { bearerSessionToken, signSession, SESSION_COOKIE_NAME } from '@/lib/client-auth'

let token = ''
let otherToken = ''
beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'bearer-session-test-secret')
  token = await signSession('harbor', { memberId: 'm1', hosts: ['harbor'] })
  otherToken = await signSession('elsewhere', { memberId: 'm2', hosts: ['elsewhere'] })
})

function hit(host: string, p: string, h: Record<string, string> = {}, method = 'GET') {
  return middleware(new NextRequest(`https://${host}${p}`, { headers: { host, ...h }, method }))
}
const passed = (res: Response) => res.status === 200 && !res.headers.get('location')

describe('bearerSessionToken', () => {
  it('reads a signed session token and nothing else', () => {
    expect(bearerSessionToken(`Bearer ${token}`)).toBe(token)
    expect(bearerSessionToken(`bearer   ${token}  `)).toBe(token)
    expect(bearerSessionToken(token)).toBeNull()
    expect(bearerSessionToken('Bearer vc_' + 'a'.repeat(64))).toBeNull()
    expect(bearerSessionToken('Bearer cxo_' + 'a'.repeat(64))).toBeNull()
    expect(bearerSessionToken('Bearer not-a-token')).toBeNull()
    expect(bearerSessionToken('Basic abc')).toBeNull()
    expect(bearerSessionToken(null)).toBeNull()
    expect(bearerSessionToken(undefined)).toBeNull()
  })
})

describe('middleware on a Suite CXO company host', () => {
  it('lets an API call with a valid bearer through', async () => {
    expect(passed(await hit('harbor.suitecxo.com', '/api/today', { authorization: `Bearer ${token}` }))).toBe(true)
    expect(passed(await hit('harbor.suitecxo.com', '/api/mira/ask', { authorization: `Bearer ${token}` }, 'POST'))).toBe(true)
  })

  it('answers 401 JSON, never a login redirect, to a bad or foreign bearer', async () => {
    for (const auth of ['Bearer junk', `Bearer ${otherToken}`, `Bearer ${token.slice(0, -1)}0`]) {
      const res = await hit('harbor.suitecxo.com', '/api/today', { authorization: auth })
      expect(res.status).toBe(401)
      expect(res.headers.get('location')).toBeNull()
      expect(await res.json()).toEqual({ error: 'Please sign in again.' })
    }
  })

  it('never opens a page with a bearer', async () => {
    const res = await hit('harbor.suitecxo.com', '/dashboard', { authorization: `Bearer ${token}` })
    expect(res.headers.get('location')).toContain('/login')
  })

  it('leaves signed-out, API-key and cookie requests exactly as before', async () => {
    const signedOut = await hit('harbor.suitecxo.com', '/api/today')
    expect(signedOut.headers.get('location')).toContain('/login')
    const apiKey = await hit('harbor.suitecxo.com', '/api/today', { authorization: 'Bearer vc_' + 'a'.repeat(64) })
    expect(apiKey.headers.get('location')).toContain('/login')
    const cookie = await hit('harbor.suitecxo.com', '/api/today', { cookie: `${SESSION_COOKIE_NAME}=${token}` })
    expect(passed(cookie)).toBe(true)
    const page = await hit('harbor.suitecxo.com', '/dashboard', { cookie: `${SESSION_COOKIE_NAME}=${token}` })
    expect(passed(page)).toBe(true)
  })

  it('keeps the sign-in route public on the company host', async () => {
    expect(passed(await hit('harbor.suitecxo.com', '/api/native/session', {}, 'POST'))).toBe(true)
  })
})
