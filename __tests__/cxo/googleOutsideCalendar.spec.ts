import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Outside calendars (owner 2026-10-17): a company with its own Google client
// can add a personal Gmail or another company's calendar through the GLOBAL
// client, calendar only. Each stored connection records the client that issued
// it; refreshes use that client; an outside calendar is never used for mail.
// Same fakes as googleOAuthTenant.spec: reps + google_tokens in memory, every
// token request to Google captured instead of sent.

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
const PIN_NEW_ID = '555-pin-new.apps.googleusercontent.com'

beforeEach(() => {
  for (const k of Object.keys(repSettings)) delete repSettings[k]
  tokenRows.length = 0
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

describe('the issuing client is recorded', () => {
  it('a company account records the tenant client; an outside calendar records the global client', async () => {
    const g = await lib()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    const tenant = (await g.oauthClientFor('rep_pinnacle'))!
    const global = g.globalOAuthClient()!
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'r', expiresInSec: 3600, email: 'exec@pinnacle.example', consent: true, issuer: g.issuerOf(tenant) })
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'b', refreshToken: 's', expiresInSec: 3600, email: 'exec@gmail.example', consent: true, newAccount: true, issuer: g.issuerOf(global), calendarOnly: true })
    expect(tokenRows[0]).toMatchObject({ oauth_source: 'tenant', oauth_client_id: PIN_ID, calendar_only: false })
    expect(tokenRows[1]).toMatchObject({ oauth_source: 'global', oauth_client_id: GLOBAL_ID, calendar_only: true })
  })

  it('a background refresh never changes the recorded issuer', async () => {
    const g = await lib()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'r', expiresInSec: -10, email: 'x@gmail.example', consent: true, issuer: { source: 'global', clientId: GLOBAL_ID }, calendarOnly: true })
    await g.getGoogleAccessToken('rep_pinnacle', 'm1')
    expect(tokenRows[0]).toMatchObject({ oauth_source: 'global', oauth_client_id: GLOBAL_ID, calendar_only: true })
  })

  it('an outside calendar never overwrites a company connection of the same account', async () => {
    const g = await lib()
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'r', expiresInSec: 3600, email: 'exec@pinnacle.example', consent: true, issuer: { source: 'tenant', clientId: PIN_ID } })
    await expect(
      g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'b', refreshToken: 's', expiresInSec: 3600, email: 'EXEC@pinnacle.example', consent: true, newAccount: true, issuer: { source: 'global', clientId: GLOBAL_ID }, calendarOnly: true }),
    ).rejects.toBeInstanceOf(g.GoogleAccountAlreadyConnectedError)
    expect(tokenRows).toHaveLength(1)
    expect(tokenRows[0]).toMatchObject({ oauth_source: 'tenant', calendar_only: false })
  })
})

describe('refresh uses the client that issued the connection', () => {
  it('a tenant row stays on the tenant client after that client changes', async () => {
    const g = await lib()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'refresh-t', expiresInSec: -10, email: 'exec@pinnacle.example', consent: true, issuer: { source: 'tenant', clientId: PIN_ID } })
    await givePinnacleClient(PIN_NEW_ID, 'pin-new-secret')
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1')).resolves.toBe('new-access')
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0]).toMatchObject({ client_id: PIN_NEW_ID, client_secret: 'pin-new-secret', refresh_token: 'refresh-t' })
    expect(tokenRows[0].oauth_source).toBe('tenant')
  })

  it('a global row refreshes with the global client even when the tenant has its own', async () => {
    const g = await lib()
    await givePinnacleClient(PIN_ID, 'pin-secret')
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'refresh-g', expiresInSec: -10, email: 'exec@gmail.example', consent: true, issuer: { source: 'global', clientId: GLOBAL_ID }, calendarOnly: true })
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1')).resolves.toBe('new-access')
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0]).toMatchObject({ client_id: GLOBAL_ID, client_secret: 'global-secret', refresh_token: 'refresh-g' })
  })

  it('a tenant row is never refreshed with the global client (the tenant client is gone: no call)', async () => {
    const g = await lib()
    repSettings.rep_pinnacle = { brand: 'cxo', settings: {} }
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'a', refreshToken: 'r', expiresInSec: -10, email: 'exec@pinnacle.example', consent: true, issuer: { source: 'tenant', clientId: PIN_ID } })
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1')).resolves.toBeNull()
    expect(tokenCalls).toHaveLength(0)
  })

  it('refreshClientsFor: global → global; tenant → tenant only; unknown → global then tenant', async () => {
    const g = await lib()
    const tenant = { clientId: PIN_ID, clientSecret: 's', redirectUri: 'u', source: 'tenant' as const }
    const global = { clientId: GLOBAL_ID, clientSecret: 's', redirectUri: 'u', source: 'global' as const }
    expect(g.refreshClientsFor({ oauth_source: 'global' }, tenant, global)).toEqual([global])
    expect(g.refreshClientsFor({ oauth_source: 'tenant' }, tenant, global)).toEqual([tenant])
    expect(g.refreshClientsFor({ oauth_source: 'tenant' }, global, global)).toEqual([])
    expect(g.refreshClientsFor({ oauth_source: null }, tenant, global)).toEqual([global, tenant])
    expect(g.refreshClientsFor({ oauth_source: null }, global, global)).toEqual([global])
  })
})

describe('the outside path asks for the calendar only', () => {
  it('requests calendar scopes, never Gmail, Drive or Sheets', async () => {
    const g = await lib()
    const url = new URL(g.buildAuthUrl('state', { selectAccount: true, calendarOnly: true }, g.globalOAuthClient()))
    const scope = url.searchParams.get('scope') ?? ''
    expect(url.searchParams.get('client_id')).toBe(GLOBAL_ID)
    expect(scope).not.toMatch(/gmail|drive|spreadsheets/)
    for (const s of ['calendar.events', 'calendar.readonly', 'calendar.freebusy', 'openid', 'email']) expect(scope).toContain(s)
    expect(url.searchParams.get('include_granted_scopes')).toBeNull()
    // Even if a caller also says gmail: true, calendar-only wins.
    const both = new URL(g.buildAuthUrl('state', { gmail: true, calendarOnly: true }, g.globalOAuthClient()))
    expect(both.searchParams.get('scope')).not.toMatch(/gmail/)
  })
})

describe('an outside calendar is never used for mail', () => {
  async function seed() {
    const g = await lib()
    // The outside calendar is the OLDER row, so a plain "first row" would pick it.
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'outside-access', refreshToken: 'r1', expiresInSec: 3600, email: 'exec@gmail.example', consent: true, issuer: { source: 'global', clientId: GLOBAL_ID }, calendarOnly: true })
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'company-access', refreshToken: 'r2', expiresInSec: 3600, email: 'exec@pinnacle.example', consent: true, newAccount: true, issuer: { source: 'tenant', clientId: PIN_ID } })
    return g
  }

  it("a 'full' token (mail, Drive, Sheets) skips the outside calendar", async () => {
    const g = await seed()
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1', null, 'full')).resolves.toBe('company-access')
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1')).resolves.toBe('outside-access')
  })

  it("asking for the outside account by id for mail returns nothing", async () => {
    const g = await seed()
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1', 'row-1', 'full')).resolves.toBeNull()
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1', 'row-1')).resolves.toBe('outside-access')
  })

  it('an outside calendar alone gives no mail token', async () => {
    const g = await lib()
    await g.saveTokens({ repId: 'rep_pinnacle', memberId: 'm1', accessToken: 'outside-access', refreshToken: 'r1', expiresInSec: 3600, email: 'exec@gmail.example', consent: true, issuer: { source: 'global', clientId: GLOBAL_ID }, calendarOnly: true })
    await expect(g.getGoogleAccessToken('rep_pinnacle', 'm1', null, 'full')).resolves.toBeNull()
  })

  it('the mailbox picker never lists an outside calendar', async () => {
    const { computeMailboxScope } = await import('@/lib/email/mailboxAccess')
    const member = { id: 'm1', rep_id: 'rep_pinnacle', email: 'exec@pinnacle.example', role: 'member', is_active: true }
    const tokens = [
      { id: 'row-1', member_id: 'm1', email: 'exec@gmail.example', created_at: '2026-10-01', calendar_only: true },
      { id: 'row-2', member_id: 'm1', email: 'exec@pinnacle.example', created_at: '2026-10-02', calendar_only: false },
    ]
    const scope = computeMailboxScope('rep_pinnacle', member, tokens)
    expect(scope.mailboxes.map((m) => m.accountId)).toEqual(['row-2'])
    expect(computeMailboxScope('rep_pinnacle', member, [tokens[0]]).mailboxes).toEqual([])
  })
})

describe('labels and choices', () => {
  it('a company with its own client gets two choices and labelled accounts; others get none', async () => {
    const o = await import('@/lib/google/outsideCalendar')
    expect(o.outsideCalendarCompany('tenant', 'Pinnacle Life Group')).toBe('Pinnacle')
    expect(o.outsideCalendarCompany('global', 'Pinnacle Life Group')).toBeNull()
    expect(o.outsideCalendarCompany(undefined, 'Acme')).toBeNull()
    expect(o.addChoiceLabels('Pinnacle')).toEqual({ company: 'Another Pinnacle account', outside: 'A calendar outside Pinnacle' })
    expect(o.googleAccountKindLabel({ calendarOnly: false }, 'Pinnacle')).toBe('Pinnacle account')
    expect(o.googleAccountKindLabel({ calendarOnly: true }, 'Pinnacle')).toBe('Outside calendar')
    expect(o.googleAccountKindLabel({ calendarOnly: false }, null)).toBeNull()
    expect(o.addCalendarHrefs('/dashboard/calendar').outside).toBe('/api/google/oauth/start?add=1&outside=1&return=%2Fdashboard%2Fcalendar')
  })
})
