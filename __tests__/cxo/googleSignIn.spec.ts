import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIGNIN_ERRORS,
  SIGNIN_TTL_MS,
  checkIdToken,
  googleTokenSlot,
  pickSignInMember,
  readIdTokenClaims,
  retiresStartingPassword,
  safeLoginHost,
  safeNextUrl,
  signSignInState,
  verifySignInState,
} from '@/lib/google/signin'

// Sign in with Google (lib/google/signin.ts) and Google connection health
// (lib/google/tokenHealth.ts). The database is a small in-memory fake that
// honours the filters these modules use.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const table = (t: string) => (db[t] ??= [])

function query(t: string) {
  const preds: Array<(r: Row) => boolean> = []
  let op: { kind: 'select' } | { kind: 'update'; patch: Row } | { kind: 'insert'; row: Row } = { kind: 'select' }
  let returning = false
  const q: Record<string, unknown> = {}
  const matches = () => table(t).filter((r) => preds.every((p) => p(r)))
  const run = () => {
    if (op.kind === 'insert') {
      const row = op.row
      if (t === 'cxo_followup_notices' && table(t).some((r) => r.rep_id === row.rep_id && r.key === row.key)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } }
      }
      table(t).push({ id: `${t}-${table(t).length + 1}`, created_at: new Date().toISOString(), ...row })
      return { data: null, error: null }
    }
    if (op.kind === 'update') {
      const hit = matches()
      for (const r of hit) Object.assign(r, op.patch)
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
    }
    return { data: matches(), error: null }
  }
  Object.assign(q, {
    select: () => {
      if (op.kind !== 'select') returning = true
      return q
    },
    eq: (k: string, v: unknown) => (preds.push((r) => (v === false ? r[k] === false || r[k] == null : r[k] === v)), q),
    is: (k: string, v: unknown) => (preds.push((r) => (v === null ? r[k] == null : r[k] === v)), q),
    ilike: (k: string, v: string) => {
      const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
      preds.push((r) => re.test(String(r[k] ?? '')))
      return q
    },
    like: (k: string, v: string) => {
      const prefix = v.replace(/%$/, '')
      preds.push((r) => String(r[k] ?? '').startsWith(prefix))
      return q
    },
    or: (expr: string) => {
      // only the form brokenGoogleFor uses: member_id.eq.<id>,member_id.is.null
      const id = /member_id\.eq\.([^,]+)/.exec(expr)?.[1]
      preds.push((r) => r.member_id === id || r.member_id == null)
      return q
    },
    in: (k: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[k])), q),
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: (run().data as Row[] | null)?.[0] ?? null, error: null }),
    update: (patch: Row) => ((op = { kind: 'update', patch }), q),
    insert: (row: Row) => ((op = { kind: 'insert', row }), q),
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
      try {
        res(run())
      } catch (e) {
        rej?.(e)
      }
    },
  })
  return q
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }))
import { retireStartingPassword } from '@/lib/google/signinPassword'

const SECRET = 'test-session-secret-for-google-signin'
const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

function idToken(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b({ alg: 'RS256' })}.${b(claims)}.sig`
}

describe('sign-in state: signed, short-lived, bound to this browser', () => {
  const make = (over: Partial<{ now: number; secret: string }> = {}) =>
    signSignInState(
      { repId: 'rep_spence', loginHost: 'suitecxo.com', next: 'https://mike.suitecxo.com/dashboard', nonce: NONCE },
      { secret: over.secret ?? SECRET, now: over.now ?? NOW },
    )

  it('round-trips with the matching cookie nonce', () => {
    const s = make()
    expect(s.startsWith('gsi.')).toBe(true)
    const out = verifySignInState(s, { secret: SECRET, cookieNonce: NONCE, now: NOW + 1000 })
    expect(out).toEqual({
      ok: true,
      state: { v: 1, repId: 'rep_spence', loginHost: 'suitecxo.com', next: 'https://mike.suitecxo.com/dashboard', nonce: NONCE, exp: NOW + SIGNIN_TTL_MS },
    })
  })

  it('a connect state is not a sign-in', () => {
    expect(verifySignInState('rep_spence::abc123', { secret: SECRET, cookieNonce: NONCE })).toEqual({ ok: false, reason: 'not_signin' })
  })

  it('rejects a tampered payload (another company swapped in)', () => {
    const s = make()
    const [payload, sig] = s.slice(4).split('.')
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
    forged.repId = 'rep_other'
    const bad = `gsi.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`
    expect(verifySignInState(bad, { secret: SECRET, cookieNonce: NONCE, now: NOW })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a state signed with another secret', () => {
    expect(verifySignInState(make({ secret: 'other-secret' }), { secret: SECRET, cookieNonce: NONCE, now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('expires after ten minutes', () => {
    const s = make()
    expect(verifySignInState(s, { secret: SECRET, cookieNonce: NONCE, now: NOW + SIGNIN_TTL_MS - 1 }).ok).toBe(true)
    expect(verifySignInState(s, { secret: SECRET, cookieNonce: NONCE, now: NOW + SIGNIN_TTL_MS + 1 })).toEqual({ ok: false, reason: 'expired' })
  })

  it('a state from the future (clock games) is refused', () => {
    const s = make({ now: NOW + 60 * 60 * 1000 })
    expect(verifySignInState(s, { secret: SECRET, cookieNonce: NONCE, now: NOW })).toEqual({ ok: false, reason: 'expired' })
  })

  it('CSRF: a sign-in started in another browser (no or wrong cookie) is refused', () => {
    const s = make()
    expect(verifySignInState(s, { secret: SECRET, cookieNonce: null, now: NOW })).toEqual({ ok: false, reason: 'nonce_mismatch' })
    expect(verifySignInState(s, { secret: SECRET, cookieNonce: 'ffffffffffffffffffffffffffffffff', now: NOW })).toEqual({
      ok: false,
      reason: 'nonce_mismatch',
    })
  })

  it('garbage is malformed or unsigned, never a throw', () => {
    expect(verifySignInState('gsi.', { secret: SECRET, cookieNonce: NONCE }).ok).toBe(false)
    expect(verifySignInState('gsi.abc', { secret: SECRET, cookieNonce: NONCE }).ok).toBe(false)
    expect(verifySignInState(null, { secret: SECRET, cookieNonce: NONCE }).ok).toBe(false)
  })

  it('next and login host stay on our own https hosts', () => {
    const roots = ['virtualcloser.com', 'suitecxo.com']
    expect(safeNextUrl('https://mike.suitecxo.com/dashboard/inbox', roots)).toBe('https://mike.suitecxo.com/dashboard/inbox')
    expect(safeNextUrl('http://mike.suitecxo.com/', roots)).toBe('')
    expect(safeNextUrl('https://evil.com/?x=suitecxo.com', roots)).toBe('')
    expect(safeNextUrl('https://suitecxo.com.evil.com/', roots)).toBe('')
    expect(safeLoginHost('Mike.SuiteCXO.com:443', roots)).toBe('mike.suitecxo.com')
    expect(safeLoginHost('evil.com', roots)).toBeNull()
  })
})

describe('the Google id_token', () => {
  const base = { iss: 'https://accounts.google.com', aud: 'pin-client', exp: NOW / 1000 + 3600, email: 'Mike@Pinnacle.example', email_verified: true }

  it('a verified email for our client passes, lowercased', () => {
    expect(checkIdToken(readIdTokenClaims(idToken(base)), { clientId: 'pin-client', now: NOW })).toEqual({ ok: true, email: 'mike@pinnacle.example' })
    expect(checkIdToken({ ...base, email_verified: 'true' }, { clientId: 'pin-client', now: NOW }).ok).toBe(true)
  })

  it('an unverified email is refused', () => {
    expect(checkIdToken({ ...base, email_verified: false }, { clientId: 'pin-client', now: NOW })).toEqual({ ok: false, reason: 'unverified' })
    expect(checkIdToken({ ...base, email_verified: undefined }, { clientId: 'pin-client', now: NOW })).toEqual({ ok: false, reason: 'unverified' })
  })

  it('a token minted for another client, issuer or time is refused', () => {
    expect(checkIdToken(base, { clientId: 'other-client', now: NOW })).toEqual({ ok: false, reason: 'bad_audience' })
    expect(checkIdToken({ ...base, iss: 'https://evil.example' }, { clientId: 'pin-client', now: NOW })).toEqual({ ok: false, reason: 'bad_issuer' })
    expect(checkIdToken({ ...base, exp: NOW / 1000 - 3600 }, { clientId: 'pin-client', now: NOW })).toEqual({ ok: false, reason: 'expired' })
    expect(checkIdToken({ ...base, email: '' }, { clientId: 'pin-client', now: NOW })).toEqual({ ok: false, reason: 'no_email' })
    expect(checkIdToken(readIdTokenClaims(undefined), { clientId: 'pin-client', now: NOW })).toEqual({ ok: false, reason: 'no_token' })
    expect(readIdTokenClaims('not-a-jwt')).toBeNull()
  })
})

describe('which member is signing in', () => {
  const rows = [
    { id: 'm_mike', rep_id: 'rep_spence', email: 'Mike@Pinnacle.example', is_active: true, role: 'owner' },
    { id: 'm_gone', rep_id: 'rep_spence', email: 'gone@pinnacle.example', is_active: false, role: 'member' },
    { id: 'm_x', rep_id: 'rep_spence', email: 'a_b@pinnacle.example', is_active: true, role: 'member' },
    { id: 'm_other', rep_id: 'rep_other', email: 'both@pinnacle.example', is_active: true, role: 'owner' },
  ]

  it('exact email, case-insensitive, active, same company', () => {
    expect(pickSignInMember(rows, 'rep_spence', 'mike@pinnacle.example')?.id).toBe('m_mike')
    expect(pickSignInMember(rows, 'rep_spence', ' MIKE@PINNACLE.EXAMPLE ')?.id).toBe('m_mike')
  })

  it('unknown email: no account is ever made', () => {
    expect(pickSignInMember(rows, 'rep_spence', 'stranger@gmail.com')).toBeNull()
    expect(pickSignInMember(rows, 'rep_spence', '')).toBeNull()
  })

  it("wrong company: another tenant's member never signs in here", () => {
    expect(pickSignInMember(rows, 'rep_spence', 'both@pinnacle.example')).toBeNull()
    expect(pickSignInMember(rows, 'rep_other', 'both@pinnacle.example')?.id).toBe('m_other')
  })

  it('a deactivated member cannot sign in', () => {
    expect(pickSignInMember(rows, 'rep_spence', 'gone@pinnacle.example')).toBeNull()
  })

  it('ilike wildcards do not widen the match (_ is not "any character")', () => {
    expect(pickSignInMember(rows, 'rep_spence', 'aXb@pinnacle.example')).toBeNull()
    expect(pickSignInMember(rows, 'rep_spence', 'a_b@pinnacle.example')?.id).toBe('m_x')
  })

  it('tokens land where Connect Google puts them', () => {
    expect(googleTokenSlot('individual', { id: 'm_mike', role: 'owner' })).toBeNull()
    expect(googleTokenSlot('individual', { id: 'm_ea', role: 'member' })).toBe('m_ea')
    expect(googleTokenSlot('enterprise', { id: 'm_mike', role: 'owner' })).toBe('m_mike')
    expect(googleTokenSlot('individual', null)).toBeNull()
  })

  it('the unknown-email message is the one the owner asked for', () => {
    expect(SIGNIN_ERRORS.google_not_member).toBe("That Google account isn't on this team. Ask your admin to add you.")
  })
})

describe('Google connection health', () => {
  const ENV = { ...process.env }
  let refreshReply: () => Response

  beforeEach(() => {
    for (const k of Object.keys(db)) delete db[k]
    process.env.GOOGLE_CLIENT_ID = 'global-123.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'global-secret'
    process.env.GOOGLE_REDIRECT_URI = 'https://suitecxo.com/api/google/oauth/callback'
    process.env.SESSION_SECRET = 'test-session-secret-for-google-key'
    table('reps').push({ id: 'rep_spence', brand: 'cxo', settings: {} })
    table('members').push(
      { id: 'm_owner', rep_id: 'rep_spence', role: 'owner', is_active: true, created_at: '2026-01-01' },
      { id: 'm_ea', rep_id: 'rep_spence', role: 'member', is_active: true, created_at: '2026-02-01' },
    )
    refreshReply = () => new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: 400 })
    vi.stubGlobal('fetch', async () => refreshReply())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    process.env = { ...ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function connectOwner(g: typeof import('@/lib/google')) {
    await g.saveTokens({ repId: 'rep_spence', accessToken: 'a', refreshToken: 'r1', expiresInSec: -10, email: 'mike@pinnacle.example', consent: true })
    return table('google_tokens')[0]
  }

  it('invalid_grant flags the row and writes ONE notice to the owner; a second failure writes none', async () => {
    const g = await import('@/lib/google')
    const row = await connectOwner(g)
    await expect(g.getGoogleAccessToken('rep_spence')).resolves.toBeNull()
    expect(row).toMatchObject({ needs_reconnect: true, reconnect_reason: 'invalid_grant' })
    expect(typeof row.broken_at).toBe('string')
    const notices = table('cxo_followup_notices')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      rep_id: 'rep_spence',
      member_id: 'm_owner',
      kind: 'report',
      item_id: row.id,
      title: 'Reconnect Google',
      href: '/dashboard/integrations#google',
    })
    expect(String(notices[0].key).startsWith('greconnect-')).toBe(true)
    expect(String(notices[0].body)).toContain('mike@pinnacle.example')

    // Dead grant: no more calls to Google, no second notice.
    let calls = 0
    vi.stubGlobal('fetch', async () => (calls++, refreshReply()))
    await expect(g.getGoogleAccessToken('rep_spence')).resolves.toBeNull()
    expect(calls).toBe(0)
    expect(table('cxo_followup_notices')).toHaveLength(1)
  })

  it('a network or 5xx failure is not a dead grant: nothing flagged', async () => {
    const g = await import('@/lib/google')
    refreshReply = () => new Response('backend error', { status: 503 })
    const row = await connectOwner(g)
    await expect(g.getGoogleAccessToken('rep_spence')).resolves.toBeNull()
    expect(row.needs_reconnect).toBeFalsy()
    expect(table('cxo_followup_notices')).toHaveLength(0)
  })

  it('a member row notifies that member, and the bar shows only for them', async () => {
    const g = await import('@/lib/google')
    const { brokenGoogleFor } = await import('@/lib/google/tokenHealth')
    await g.saveTokens({ repId: 'rep_spence', memberId: 'm_ea', accessToken: 'a', refreshToken: 'r', expiresInSec: -10, email: 'ea@pinnacle.example' })
    await g.getGoogleAccessToken('rep_spence', 'm_ea')
    expect(table('cxo_followup_notices')[0]).toMatchObject({ member_id: 'm_ea' })
    expect(await brokenGoogleFor('rep_spence', { id: 'm_ea', role: 'member' })).toMatchObject({ email: 'ea@pinnacle.example' })
    expect(await brokenGoogleFor('rep_spence', { id: 'm_owner', role: 'owner' })).toBeNull()
  })

  it('a reconnect clears the flag and marks the notice read; the next refresh works', async () => {
    const g = await import('@/lib/google')
    const row = await connectOwner(g)
    await g.getGoogleAccessToken('rep_spence')
    expect(row.needs_reconnect).toBe(true)

    await g.saveTokens({ repId: 'rep_spence', accessToken: 'b', refreshToken: 'r2', expiresInSec: 3600, email: 'mike@pinnacle.example', consent: true })
    expect(table('google_tokens')).toHaveLength(1)
    expect(row).toMatchObject({ needs_reconnect: false, reconnect_reason: null, broken_at: null })
    expect(typeof table('cxo_followup_notices')[0].read_at).toBe('string')
    const accounts = await g.listConnectedGoogleAccounts('rep_spence')
    expect(accounts[0]).toMatchObject({ email: 'mike@pinnacle.example', needsReconnect: false })
  })

  it('a background token refresh never clears the flag (only a consent does)', async () => {
    const g = await import('@/lib/google')
    const { markGoogleTokenBroken } = await import('@/lib/google/tokenHealth')
    const row = await connectOwner(g)
    await markGoogleTokenBroken({ id: row.id as string, rep_id: 'rep_spence', member_id: null }, 'scope')
    refreshReply = () => new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }), { status: 200 })
    // A scope problem keeps the token in use.
    await expect(g.getGoogleAccessToken('rep_spence')).resolves.toBe('fresh')
    expect(row).toMatchObject({ needs_reconnect: true, reconnect_reason: 'scope' })
    expect((await g.listConnectedGoogleAccounts('rep_spence'))[0].needsReconnect).toBe(true)
  })

  it('a reconnect with no new refresh_token keeps the old one', async () => {
    const g = await import('@/lib/google')
    const row = await connectOwner(g)
    await g.saveTokens({ repId: 'rep_spence', accessToken: 'b', refreshToken: null, expiresInSec: 3600, email: 'mike@pinnacle.example', consent: true })
    expect(table('google_tokens')).toHaveLength(1)
    expect(g.decryptGoogleSecret(row.refresh_token as string)).toBe('r1')
  })

  it('every consent URL asks for offline access with a consent prompt (so Google returns a refresh_token)', async () => {
    const g = await import('@/lib/google')
    for (const opts of [{}, { selectAccount: true }, { gmail: false }]) {
      const u = new URL(g.buildAuthUrl('s', opts))
      expect(u.searchParams.get('access_type')).toBe('offline')
      expect(u.searchParams.get('prompt')).toContain('consent')
    }
  })

  it('isInvalidGrant reads Google’s error code, not just any 400', async () => {
    const { isInvalidGrant } = await import('@/lib/google/tokenHealth')
    const g = await import('@/lib/google')
    expect(isInvalidGrant(new g.GoogleRefreshError('x', 400, 'invalid_grant'))).toBe(true)
    expect(isInvalidGrant(new Error('google token refresh failed: 400 {"error":"invalid_grant"}'))).toBe(true)
    expect(isInvalidGrant(new Error('google token refresh failed: 400 {"error":"invalid_client"}'))).toBe(false)
    expect(isInvalidGrant(new Error('fetch failed'))).toBe(false)
  })
})

describe('first Google sign-in retires an emailed starting password', () => {
  beforeEach(() => {
    for (const k of Object.keys(db)) delete db[k]
  })

  it('the rule: first login, a password on file, not an assistant', () => {
    expect(retiresStartingPassword({ last_login_at: null, password_hash: 'h', role: 'member' })).toBe(true)
    expect(retiresStartingPassword({ last_login_at: null, password_hash: 'h', role: 'owner' })).toBe(true)
    expect(retiresStartingPassword({ last_login_at: '2026-10-01T00:00:00Z', password_hash: 'h', role: 'member' })).toBe(false)
    expect(retiresStartingPassword({ last_login_at: null, password_hash: null, role: 'member' })).toBe(false)
    expect(retiresStartingPassword({ last_login_at: null, password_hash: 'h', role: 'assistant' })).toBe(false)
  })

  it('clears a member starting password; the rep row is untouched for a non-owner', async () => {
    table('members').push({ id: 'm_dana', rep_id: 'rep_spence', role: 'member', password_hash: 'start', last_login_at: null })
    table('reps').push({ id: 'rep_spence', password_hash: 'owner-pw' })
    expect(await retireStartingPassword(table('members')[0] as never)).toBe(true)
    expect(table('members')[0].password_hash).toBeNull()
    expect(table('reps')[0].password_hash).toBe('owner-pw')
  })

  it('an owner: the same starting password on the rep row (legacy login) is cleared too', async () => {
    table('members').push({ id: 'm_mike', rep_id: 'rep_spence', role: 'owner', password_hash: 'start', last_login_at: null })
    table('reps').push({ id: 'rep_spence', password_hash: 'start' })
    await retireStartingPassword(table('members')[0] as never)
    expect(table('members')[0].password_hash).toBeNull()
    expect(table('reps')[0].password_hash).toBeNull()
  })

  it('a password changed since the sign-in read is never wiped', async () => {
    table('members').push({ id: 'm_dana', rep_id: 'rep_spence', role: 'owner', password_hash: 'their-own', last_login_at: null })
    table('reps').push({ id: 'rep_spence', password_hash: 'their-own' })
    await retireStartingPassword({ id: 'm_dana', rep_id: 'rep_spence', role: 'owner', password_hash: 'start', last_login_at: null })
    expect(table('members')[0].password_hash).toBe('their-own')
    expect(table('reps')[0].password_hash).toBe('their-own')
  })

  it('a returning member or an assistant keeps their password', async () => {
    table('members').push(
      { id: 'm_back', rep_id: 'rep_spence', role: 'member', password_hash: 'pw', last_login_at: '2026-10-01T00:00:00Z' },
      { id: 'm_ea', rep_id: 'rep_spence', role: 'assistant', password_hash: 'pw2', last_login_at: null },
    )
    expect(await retireStartingPassword(table('members')[0] as never)).toBe(false)
    expect(await retireStartingPassword(table('members')[1] as never)).toBe(false)
    expect(table('members')[0].password_hash).toBe('pw')
    expect(table('members')[1].password_hash).toBe('pw2')
  })
})
