import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Per-tenant Google OAuth client + tokens at rest + Gmail MIME.
// The reps table is faked: each tenant's settings live in `repSettings`, and
// every token request to Google is captured instead of sent.

const repSettings: Record<string, { settings: Record<string, unknown>; brand: string }> = {}
const tokenRows: Array<Record<string, unknown>> = []

function query(table: string) {
  const filters: Array<[string, unknown]> = []
  const q: Record<string, unknown> = {}
  const rows = () => {
    if (table === 'reps') {
      const id = filters.find(([k]) => k === 'id')?.[1] as string
      return repSettings[id] ? [{ id, ...repSettings[id] }] : []
    }
    if (table === 'google_tokens') {
      return tokenRows.filter((r) => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)))
    }
    return []
  }
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push([k, v]), q),
    is: (k: string, v: unknown) => (filters.push([k, v]), q),
    order: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: (v: unknown) => void) => res({ data: rows(), error: null }),
    update: (patch: Record<string, unknown>) => ({
      eq: async (_k: string, id: string) => {
        const r = tokenRows.find((x) => x.id === id)
        if (r) Object.assign(r, patch)
        return { error: null }
      },
    }),
    insert: async (row: Record<string, unknown>) => {
      tokenRows.push({ id: `row-${tokenRows.length + 1}`, created_at: new Date().toISOString(), ...row })
      return { error: null }
    },
  })
  return q
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }))

const ENV = { ...process.env }
const tokenCalls: Array<Record<string, string>> = []

beforeEach(() => {
  for (const k of Object.keys(repSettings)) delete repSettings[k]
  tokenRows.length = 0
  tokenCalls.length = 0
  process.env.GOOGLE_CLIENT_ID = 'global-123.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'global-secret'
  process.env.GOOGLE_REDIRECT_URI = 'https://suitecxo.com/api/google/oauth/callback'
  process.env.SESSION_SECRET = 'test-session-secret-for-google-key'
  vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
    tokenCalls.push(Object.fromEntries(new URLSearchParams(init.body.toString())))
    return new Response(JSON.stringify({ access_token: 'new-access', expires_in: 3600 }), { status: 200 })
  })
})
afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
})

async function lib() {
  return import('@/lib/google')
}

describe('Google OAuth client per tenant', () => {
  it('a tenant with its own client uses it; the secret is stored encrypted', async () => {
    const g = await lib()
    const enc = g.encryptGoogleSecret('pinnacle-secret')!
    expect(enc.startsWith('v1.')).toBe(true)
    expect(enc).not.toContain('pinnacle-secret')
    repSettings.rep_pinnacle = { brand: 'cxo', settings: { google_oauth: { client_id: '999-pin.apps.googleusercontent.com', client_secret_enc: enc } } }
    const c = await g.oauthClientFor('rep_pinnacle')
    expect(c).toMatchObject({ clientId: '999-pin.apps.googleusercontent.com', clientSecret: 'pinnacle-secret', source: 'tenant', redirectUri: 'https://suitecxo.com/api/google/oauth/callback' })
    const url = new URL(g.buildAuthUrl('state', {}, c))
    expect(url.searchParams.get('client_id')).toBe('999-pin.apps.googleusercontent.com')
  })

  it('another tenant never gets that client: it falls back to the global one', async () => {
    const g = await lib()
    repSettings.rep_pinnacle = { brand: 'cxo', settings: { google_oauth: { client_id: '999-pin.apps.googleusercontent.com', client_secret_enc: g.encryptGoogleSecret('pinnacle-secret')! } } }
    repSettings.rep_other = { brand: 'cxo', settings: {} }
    const c = await g.oauthClientFor('rep_other')
    expect(c).toMatchObject({ clientId: 'global-123.apps.googleusercontent.com', source: 'global' })
  })

  it('an undecryptable secret (key rotated) falls back to the global client', async () => {
    const g = await lib()
    const enc = g.encryptGoogleSecret('pinnacle-secret')!
    process.env.SESSION_SECRET = 'rotated'
    const c = g.resolveOAuthClient({ client_id: '999-pin.apps.googleusercontent.com', client_secret_enc: enc }, 'suitecxo.com')
    expect(c?.source).toBe('global')
  })

  it('token refresh uses the tenant client, and tokens are encrypted at rest', async () => {
    const g = await lib()
    repSettings.rep_pinnacle = { brand: 'cxo', settings: { google_oauth: { client_id: '999-pin.apps.googleusercontent.com', client_secret_enc: g.encryptGoogleSecret('pinnacle-secret')! } } }
    await g.saveTokens({ repId: 'rep_pinnacle', accessToken: 'old-access', refreshToken: 'refresh-1', expiresInSec: -10, email: 'exec@pinnacle.example' })
    expect(tokenRows[0].access_token).not.toBe('old-access')
    expect(String(tokenRows[0].refresh_token)).toMatch(/^v1\./)
    const token = await g.getGoogleAccessToken('rep_pinnacle')
    expect(token).toBe('new-access')
    expect(tokenCalls[0]).toMatchObject({ client_id: '999-pin.apps.googleusercontent.com', client_secret: 'pinnacle-secret', refresh_token: 'refresh-1' })
  })

  it('a revoked grant returns null instead of throwing', async () => {
    const g = await lib()
    vi.stubGlobal('fetch', async () => new Response('{"error":"invalid_grant"}', { status: 400 }))
    repSettings.rep_other = { brand: 'cxo', settings: {} }
    await g.saveTokens({ repId: 'rep_other', accessToken: 'a', refreshToken: 'r', expiresInSec: -10, email: 'x@y.example' })
    await expect(g.getGoogleAccessToken('rep_other')).resolves.toBeNull()
  })
})

describe('Gmail reply MIME', () => {
  it('body survives "=" and non-ASCII; subject is RFC 2047 encoded', async () => {
    const g = await lib()
    const raw = g.buildRawGmail({ to: 'a@b.example', subject: 'Re: Café plan', body: 'a=3D b — ✓', inReplyTo: '<m1@x>', references: '<m0@x>' })
    const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const [head, body] = text.split('\r\n\r\n')
    expect(head).toContain('Content-Transfer-Encoding: base64')
    expect(head).toContain('Subject: =?UTF-8?B?')
    expect(head).toContain('In-Reply-To: <m1@x>')
    expect(head).toContain('References: <m0@x> <m1@x>')
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('a=3D b — ✓')
  })
})
