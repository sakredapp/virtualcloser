import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Three Google apps (owner 2026-10-17). Same in-memory fakes as
// googleOutsideCalendar.spec: reps + google_tokens, token calls captured.

const repSettings: Record<string, { settings: Record<string, unknown>; brand: string }> = {}
const tokenRows: Array<Record<string, unknown>> = []
const oldCheck = { on: false }

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
      // The database before supabase/cxo_google_token_issuer_brand.sql runs.
      if (oldCheck.on && row.oauth_source === 'brand') return { error: { code: '23514', message: 'violates check constraint' } }
      tokenRows.push({ id: `row-${tokenRows.length + 1}`, created_at: new Date(Date.now() + tokenRows.length).toISOString(), ...row })
      return { error: null }
    },
  })
  return q
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }))
vi.mock('@/lib/cxoInbox', () => ({ inboxAllowedForRep: async () => true, inboxBlockedRepIds: async () => [] }))

const ENV = { ...process.env }
const tokenCalls: Array<Record<string, string>> = []

const GLOBAL_ID = 'global-123.apps.googleusercontent.com'
const PIN_ID = '999-pin.apps.googleusercontent.com'

beforeEach(() => {
  for (const k of Object.keys(repSettings)) delete repSettings[k]
  tokenRows.length = 0
  oldCheck.on = false
  tokenCalls.length = 0
  process.env.GOOGLE_CLIENT_ID = GLOBAL_ID
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

async function givePinnacleClient(clientId: string, secret: string) {
  const g = await lib()
  repSettings.rep_pinnacle = {
    brand: 'cxo',
    settings: { google_oauth: { client_id: clientId, client_secret_enc: g.encryptGoogleSecret(secret)! } },
  }
}

// Three Google apps (owner 2026-10-17): a company's own client ('tenant'), the
// "Suite CXO" app ('brand', no Gmail), the Virtual Closer app ('global').

const BRAND_ID = '432651632027-brand.apps.googleusercontent.com'

function setBrandEnv() {
  process.env.GOOGLE_BRAND_CLIENT_ID = BRAND_ID
  process.env.GOOGLE_BRAND_CLIENT_SECRET = 'brand-secret'
}

describe('which app a new connection uses', () => {
  it('tenant client first, even when the Suite CXO app is set', async () => {
    setBrandEnv()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    const g = await lib()
    expect(await g.oauthClientFor('rep_pinnacle')).toMatchObject({ clientId: PIN_ID, source: 'tenant' })
  })

  it('a Suite CXO company without its own client uses the Suite CXO app', async () => {
    setBrandEnv()
    repSettings.rep_acme = { brand: 'cxo', settings: {} }
    const g = await lib()
    expect(await g.oauthClientFor('rep_acme')).toMatchObject({
      clientId: BRAND_ID,
      clientSecret: 'brand-secret',
      source: 'brand',
      redirectUri: 'https://suitecxo.com/api/google/oauth/callback',
    })
  })

  it('without both brand keys it stays on the global client', async () => {
    process.env.GOOGLE_BRAND_CLIENT_ID = BRAND_ID
    repSettings.rep_acme = { brand: 'cxo', settings: {} }
    const g = await lib()
    expect(await g.oauthClientFor('rep_acme')).toMatchObject({ clientId: GLOBAL_ID, source: 'global' })
  })

  it('a Virtual Closer tenant never gets the Suite CXO app', async () => {
    setBrandEnv()
    repSettings.rep_vc = { brand: 'vc', settings: {} }
    const g = await lib()
    expect(await g.oauthClientFor('rep_vc')).toMatchObject({ clientId: GLOBAL_ID, source: 'global' })
  })

  it('an undecryptable tenant secret falls back to the Suite CXO app, not global', async () => {
    setBrandEnv()
    const g = await lib()
    const enc = g.encryptGoogleSecret('pin-secret')!
    process.env.SESSION_SECRET = 'rotated'
    expect(g.resolveOAuthClient({ client_id: PIN_ID, client_secret_enc: enc }, 'suitecxo.com', { brand: true })?.source).toBe('brand')
  })
})

describe('outside calendars on a company with its own client', () => {
  it('use the Suite CXO app when set, else global', async () => {
    const g = await lib()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    expect(await g.outsideCalendarClientFor('rep_pinnacle')).toMatchObject({ clientId: GLOBAL_ID, source: 'global' })
    setBrandEnv()
    expect(await g.outsideCalendarClientFor('rep_pinnacle')).toMatchObject({ clientId: BRAND_ID, source: 'brand' })
    expect(g.outsideCalendarClient('vc')).toMatchObject({ source: 'global' })
    const url = new URL(g.buildAuthUrl('s', { selectAccount: true, calendarOnly: true }, g.outsideCalendarClient('cxo')))
    expect(url.searchParams.get('client_id')).toBe(BRAND_ID)
    expect(url.searchParams.get('scope')).not.toMatch(/gmail|drive|spreadsheets/)
  })

  it('the two-choice labels still show for a tenant company only', async () => {
    const o = await import('@/lib/google/outsideCalendar')
    expect(o.outsideCalendarCompany('brand', 'Acme')).toBeNull()
    expect(o.outsideCalendarCompany('tenant', 'Pinnacle Life Group')).toBe('Pinnacle')
  })
})

describe('the Suite CXO app is never asked for Gmail', () => {
  it('drops every Gmail scope even when the caller asks for Gmail', async () => {
    setBrandEnv()
    const g = await lib()
    const brand = g.brandOAuthClient()!
    for (const opts of [{}, { gmail: true }, { gmail: false }, { selectAccount: true }]) {
      const url = new URL(g.buildAuthUrl('s', opts, brand))
      const scope = url.searchParams.get('scope') ?? ''
      expect(url.searchParams.get('client_id')).toBe(BRAND_ID)
      expect(scope).not.toMatch(/gmail/)
      expect(scope).toBe(g.GOOGLE_SCOPE_NO_GMAIL)
      expect(url.searchParams.get('include_granted_scopes')).toBeNull()
    }
    // The tenant and global clients are unchanged: Gmail when allowed.
    expect(new URL(g.buildAuthUrl('s', { gmail: true }, g.globalOAuthClient())).searchParams.get('scope')).toMatch(/gmail\.send/)
  })
})

describe('refresh uses the issuer: tenant / brand / global / null', () => {
  async function seed(issuer: { source: 'tenant' | 'brand' | 'global'; clientId: string } | null) {
    setBrandEnv()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    const g = await lib()
    await g.saveTokens({
      repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'rt', expiresInSec: -10,
      email: 'exec@pinnacle.example', ...(issuer ? { consent: true, issuer } : {}),
    })
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1')).resolves.toBe('new-access')
    expect(tokenCalls).toHaveLength(1)
    return tokenCalls[0]
  }

  it('tenant → the company client', async () => {
    expect(await seed({ source: 'tenant', clientId: PIN_ID })).toMatchObject({ client_id: PIN_ID, client_secret: 'pin-secret' })
  })
  it('brand → the Suite CXO app', async () => {
    expect(await seed({ source: 'brand', clientId: BRAND_ID })).toMatchObject({ client_id: BRAND_ID, client_secret: 'brand-secret' })
    expect(tokenRows[0]).toMatchObject({ oauth_source: 'brand', oauth_client_id: BRAND_ID })
  })
  it('global → the Virtual Closer app, even with a tenant and brand client present', async () => {
    expect(await seed({ source: 'global', clientId: GLOBAL_ID })).toMatchObject({ client_id: GLOBAL_ID, client_secret: 'global-secret' })
  })
  it('null (legacy) → the Virtual Closer app first', async () => {
    expect(await seed(null)).toMatchObject({ client_id: GLOBAL_ID, client_secret: 'global-secret' })
  })

  it('refreshClientsFor (pure)', async () => {
    const g = await lib()
    const tenant = { clientId: PIN_ID, clientSecret: 's', redirectUri: 'u', source: 'tenant' as const }
    const brand = { clientId: BRAND_ID, clientSecret: 's', redirectUri: 'u', source: 'brand' as const }
    const global = { clientId: GLOBAL_ID, clientSecret: 's', redirectUri: 'u', source: 'global' as const }
    expect(g.refreshClientsFor({ oauth_source: 'tenant' }, tenant, global, brand)).toEqual([tenant])
    expect(g.refreshClientsFor({ oauth_source: 'brand' }, tenant, global, brand)).toEqual([brand])
    expect(g.refreshClientsFor({ oauth_source: 'global' }, tenant, global, brand)).toEqual([global])
    expect(g.refreshClientsFor({ oauth_source: null }, tenant, global, brand)).toEqual([global, tenant])
    // Brand never refreshes a row it did not issue, and a brand row with the app unset gets nothing.
    expect(g.refreshClientsFor({ oauth_source: null }, null, global, brand)).toEqual([global])
    expect(g.refreshClientsFor({ oauth_source: 'brand' }, tenant, global, null)).toEqual([])
    // A row stored without its source (before the check was widened) matches on the client id.
    expect(g.refreshClientsFor({ oauth_source: null, oauth_client_id: BRAND_ID }, tenant, global, brand)).toEqual([brand])
    expect(g.refreshClientsFor({ oauth_source: 'global', oauth_client_id: BRAND_ID }, tenant, global, brand)).toEqual([brand])
  })
})

describe('revoke and health work for a brand-issued row', () => {
  it('revoking a brand-issued grant goes to Google with its own token, no client needed', async () => {
    setBrandEnv()
    const g = await lib()
    const urls: string[] = []
    const bodies: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      urls.push(String(url))
      bodies.push(String(init.body))
      return new Response('', { status: 200 })
    })
    const out = await g.revokeStoredGoogleGrant({ id: 'row-1', rep_id: 'rep_acme', member_id: 'm1', access_token: g.encryptGoogleSecret('acc')!, refresh_token: g.encryptGoogleSecret('brand-refresh')! })
    expect(out).toEqual({ ok: true, via: 'refresh' })
    expect(urls[0]).toContain('oauth2.googleapis.com/revoke')
    expect(bodies[0]).toContain('token=brand-refresh')
  })

  it('before the check is widened, a brand row is stored without the source and still refreshes with the Suite CXO app', async () => {
    setBrandEnv()
    oldCheck.on = true
    repSettings.rep_acme = { brand: 'cxo', settings: {} }
    const g = await lib()
    await g.saveTokens({ repId: 'rep_acme', memberId: 'm1', accessToken: 'a', refreshToken: 'rt', expiresInSec: -10, email: 'x@acme.example', consent: true, issuer: { source: 'brand', clientId: BRAND_ID } })
    expect(tokenRows).toHaveLength(1)
    expect(tokenRows[0].oauth_source).toBeUndefined()
    expect(tokenRows[0].oauth_client_id).toBe(BRAND_ID)
    await expect(g.getGoogleAccessToken('rep_acme', 'm1')).resolves.toBe('new-access')
    expect(tokenCalls[0]).toMatchObject({ client_id: BRAND_ID, client_secret: 'brand-secret' })
  })

  it('a dead brand grant returns null after one call with the Suite CXO app', async () => {
    setBrandEnv()
    repSettings.rep_acme = { brand: 'cxo', settings: {} }
    const g = await lib()
    await g.saveTokens({ repId: 'rep_acme', memberId: 'm1', accessToken: 'a', refreshToken: 'rt', expiresInSec: -10, email: 'x@acme.example', consent: true, issuer: { source: 'brand', clientId: BRAND_ID } })
    vi.stubGlobal('fetch', async (_url: string, init: { body: string | URLSearchParams }) => {
      tokenCalls.push(Object.fromEntries(new URLSearchParams(init.body.toString())))
      return new Response('{"error":"invalid_grant"}', { status: 400 })
    })
    await expect(g.getGoogleAccessToken('rep_acme', 'm1')).resolves.toBeNull()
    expect(tokenCalls[0]).toMatchObject({ client_id: BRAND_ID })
    const { isInvalidGrant } = await import('@/lib/google/tokenHealth')
    expect(isInvalidGrant(new g.GoogleRefreshError('google token refresh failed: 400 {"error":"invalid_grant"}', 400, 'invalid_grant'))).toBe(true)
  })
})
