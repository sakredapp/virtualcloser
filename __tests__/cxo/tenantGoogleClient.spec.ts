/**
 * A company's own Google OAuth client (owner 10-10): who may manage it, what
 * the browser may see (never the secret), input validation, and how Google's
 * answer to the "test connection" probe is read. Pure; the reps table is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reps: Record<string, { settings: Record<string, unknown> }> = {}
const updates: Array<{ id: string; settings: Record<string, unknown> }> = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (_k: string, id: string) => ({ maybeSingle: async () => ({ data: reps[id] ?? null, error: null }) }) }),
      update: (patch: { settings: Record<string, unknown> }) => ({
        eq: async (_k: string, id: string) => {
          updates.push({ id, settings: patch.settings })
          reps[id] = { settings: patch.settings }
          return { error: null }
        },
      }),
    }),
  },
}))

const ENV = { ...process.env }
beforeEach(() => {
  for (const k of Object.keys(reps)) delete reps[k]
  updates.length = 0
  process.env.SESSION_SECRET = 'test-session-secret-for-google-key'
  delete process.env.GOOGLE_TOKEN_KEY
})
afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
})

const ID = '123456789012-abcdefghij.apps.googleusercontent.com'

describe('who may manage it', () => {
  it('owner and admin only', async () => {
    const { canManageGoogleClient } = await import('@/lib/google/tenantClient')
    expect(canManageGoogleClient({ role: 'owner' })).toBe(true)
    expect(canManageGoogleClient({ role: 'admin' })).toBe(true)
    for (const r of ['manager', 'rep', 'observer', 'assistant', '', null]) expect(canManageGoogleClient({ role: r })).toBe(false)
    expect(canManageGoogleClient(null)).toBe(false)
  })
})

describe('what the browser sees', () => {
  it('masks the id, never carries the secret, and names the callback to register', async () => {
    const t = await import('@/lib/google/tenantClient')
    const { encryptGoogleSecret } = await import('@/lib/google')
    const enc = encryptGoogleSecret('GOCSPX-super-secret')!
    const v = t.tenantGoogleClientView({ client_id: ID, client_secret_enc: enc, updated_at: '2026-10-10T00:00:00Z' }, 'suitecxo.com')
    expect(v.own).toBe(true)
    expect(v.clientIdMasked).toBe('123456789012…' + ID.slice(-10))
    expect(v.clientIdMasked).not.toBe(ID)
    expect(v.redirectUri).toBe('https://suitecxo.com/api/google/oauth/callback')
    expect(JSON.stringify(v)).not.toContain('client_secret')
    expect(JSON.stringify(v)).not.toContain('super-secret')
    expect(JSON.stringify(v)).not.toContain(enc)
    expect(t.tenantGoogleClientView(null, 'suitecxo.com')).toMatchObject({ own: false, clientIdMasked: null, secretUnreadable: false })
  })
  it('flags a secret sealed under another key instead of pretending it works', async () => {
    const t = await import('@/lib/google/tenantClient')
    const v = t.tenantGoogleClientView({ client_id: ID, client_secret_enc: 'v1.not-decryptable' }, 'suitecxo.com')
    expect(v.own).toBe(false)
    expect(v.secretUnreadable).toBe(true)
  })
})

describe('saving', () => {
  it('rejects a malformed id, secret or callback and never writes', async () => {
    const t = await import('@/lib/google/tenantClient')
    expect(t.validateTenantGoogleClient({ clientId: 'nope', clientSecret: 'GOCSPX-abcdefghijk' }, null)).toMatchObject({ ok: false })
    expect(t.validateTenantGoogleClient({ clientId: ID, clientSecret: 'bad secret with spaces' }, null)).toMatchObject({ ok: false })
    expect(t.validateTenantGoogleClient({ clientId: ID, clientSecret: 'GOCSPX-abcdefghijk', redirectUri: 'https://evil.example/steal' }, null)).toMatchObject({ ok: false })
    expect(t.validateTenantGoogleClient({ clientId: ID }, null)).toMatchObject({ ok: false, error: 'Enter the client secret.' })
    expect(t.validateTenantGoogleClient({ clientSecret: 'GOCSPX-abcdefghijk' }, null)).toMatchObject({ ok: false, error: 'Enter the client ID.' })
    expect(updates).toHaveLength(0)
  })
  it('stores the secret encrypted, keeps it when the field is left blank, and clears cleanly', async () => {
    const t = await import('@/lib/google/tenantClient')
    const { decryptGoogleSecret } = await import('@/lib/google')
    reps['rep-pin'] = { settings: { cxo_employee_ops: false, other: 1 } }
    const r = await t.saveTenantGoogleClient('rep-pin', { clientId: ID, clientSecret: 'GOCSPX-super-secret' })
    expect(r).toEqual({ ok: true })
    const saved = reps['rep-pin'].settings.google_oauth as { client_id: string; client_secret_enc: string }
    expect(saved.client_id).toBe(ID)
    expect(saved.client_secret_enc.startsWith('v1.')).toBe(true)
    expect(JSON.stringify(reps['rep-pin'].settings)).not.toContain('super-secret')
    expect(decryptGoogleSecret(saved.client_secret_enc)).toBe('GOCSPX-super-secret')
    expect(reps['rep-pin'].settings.other).toBe(1) // other settings untouched

    // Update the id only: the secret stays.
    const r2 = await t.saveTenantGoogleClient('rep-pin', { clientId: '999999999999-zzzzzzzzzz.apps.googleusercontent.com', clientSecret: '' })
    expect(r2).toEqual({ ok: true })
    const again = reps['rep-pin'].settings.google_oauth as { client_id: string; client_secret_enc: string }
    expect(again.client_id).toBe('999999999999-zzzzzzzzzz.apps.googleusercontent.com')
    expect(again.client_secret_enc).toBe(saved.client_secret_enc)

    await t.clearTenantGoogleClient('rep-pin')
    expect(reps['rep-pin'].settings.google_oauth).toBeUndefined()
    expect(reps['rep-pin'].settings.other).toBe(1)
  })
  it('refuses to store a secret when the app has no encryption key', async () => {
    delete process.env.SESSION_SECRET
    const t = await import('@/lib/google/tenantClient')
    const r = t.validateTenantGoogleClient({ clientId: ID, clientSecret: 'GOCSPX-abcdefghijk' }, null)
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toContain('Nothing was saved')
  })
})

describe('test connection', () => {
  it("reads Google's answer: bad client vs good client vs unregistered callback", async () => {
    const { classifyGoogleClientCheck } = await import('@/lib/google/tenantClient')
    expect(classifyGoogleClientCheck(401, { error: 'invalid_client' })).toMatchObject({ ok: false, code: 'invalid_client' })
    expect(classifyGoogleClientCheck(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' })).toMatchObject({ ok: true })
    expect(classifyGoogleClientCheck(400, { error: 'redirect_uri_mismatch' })).toMatchObject({ ok: false, code: 'redirect_uri_mismatch' })
    expect(classifyGoogleClientCheck(503, null)).toMatchObject({ ok: false, code: 'google_unavailable' })
  })
  it('sends the saved credentials once and stores nothing', async () => {
    const t = await import('@/lib/google/tenantClient')
    const calls: Array<Record<string, string>> = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
      calls.push(Object.fromEntries(new URLSearchParams(init.body.toString())))
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    })
    const r = await t.testGoogleClient({ clientId: ID, clientSecret: 'GOCSPX-x', redirectUri: 'https://suitecxo.com/api/google/oauth/callback' })
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ client_id: ID, client_secret: 'GOCSPX-x', grant_type: 'authorization_code' })
    expect(updates).toHaveLength(0)
  })
})

describe('SES fallback stays off', () => {
  it('needs CXO_SES_FALLBACK=1 on top of the AWS variables', async () => {
    process.env.AWS_SES_ACCESS_KEY_ID = 'a'
    process.env.AWS_SES_SECRET_ACCESS_KEY = 'b'
    process.env.AWS_SES_REGION = 'us-east-1'
    process.env.CXO_SES_FROM_DOMAIN = 'mail.suitecxo.com'
    delete process.env.CXO_SES_FALLBACK
    const { sesConfigured } = await import('@/lib/ses')
    expect(sesConfigured()).toBe(false)
    process.env.CXO_SES_FALLBACK = '1'
    expect(sesConfigured()).toBe(true)
  })
})
