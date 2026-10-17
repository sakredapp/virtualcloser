/**
 * Offboarding and disconnect end the grant at the provider (owner 10-17).
 * Stored Google/QuickBooks tokens are encrypted at rest; the revoke call must
 * send the DECRYPTED token (sending the ciphertext made Google answer 400 and
 * nothing was revoked), fall back to the access token, record a failed revoke
 * in app_errors without blocking, and always delete our rows. fetch and the
 * database are faked; no real token is ever sent anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown> & { id: string }
const db: Record<string, Row[]> = {}
const errors: Array<Record<string, unknown>> = []

// Chainable fake: select/delete/update with eq/is/in filters, awaitable.
function chain(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'delete' | 'update' | 'insert' = 'select'
  let patch: Record<string, unknown> = {}
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.delete = () => ((op = 'delete'), c)
  c.update = (p: Record<string, unknown>) => ((op = 'update'), (patch = p), c)
  c.insert = (p: Record<string, unknown>) => {
    if (table === 'app_errors') errors.push(p)
    return Promise.resolve({ error: null })
  }
  c.eq = (k: string, v: unknown) => (filters.push((r) => r[k] === v), c)
  c.is = (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), c)
  c.in = (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), c)
  c.maybeSingle = async () => ({ data: (db[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null, error: null })
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const rows = db[table] ?? []
    const hit = rows.filter((r) => filters.every((f) => f(r)))
    if (op === 'delete') db[table] = rows.filter((r) => !hit.includes(r))
    if (op === 'update') hit.forEach((r) => Object.assign(r, patch))
    return Promise.resolve({ data: op === 'select' ? hit : null, error: null }).then(res, rej)
  }
  return c
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
vi.mock('@/lib/alerts', () => ({ alertOperator: vi.fn() }))

import { decryptGoogleSecret, disconnectRep, encryptGoogleSecret, GOOGLE_REVOKE_URL, revokeStoredGoogleGrant } from '@/lib/google'
import { disconnectMemberCalendars } from '@/lib/members'
import { disconnectQbo } from '@/lib/qbo/data'
import { encryptToken, QBO_REVOKE_URL, qboTokenKey } from '@/lib/qbo/shared'

const ENV = { ...process.env }
type Call = { url: string; body: string; headers: Record<string, string> }
let calls: Call[] = []
function stubFetch(answer: (c: Call) => { status: number; body?: string } | Error) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const c = { url, body: String(init.body ?? ''), headers: (init.headers ?? {}) as Record<string, string> }
    calls.push(c)
    const a = answer(c)
    if (a instanceof Error) throw a
    return new Response(a.body ?? '', { status: a.status })
  })
}
const sentToken = (c: Call) => new URLSearchParams(c.body).get('token')

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  errors.length = 0
  calls = []
  process.env.SESSION_SECRET = 'test-session-secret-for-revoke'
  delete process.env.GOOGLE_TOKEN_KEY
  delete process.env.QBO_TOKEN_KEY
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function googleRow(id: string, over: Partial<Row> = {}): Row & { access_token: string | null; refresh_token: string | null } {
  return {
    id,
    rep_id: 'org-a',
    member_id: 'm-leaver',
    email: `${id}@lakeside.test`,
    access_token: encryptGoogleSecret(`ya29.access-${id}`),
    refresh_token: encryptGoogleSecret(`1//refresh-${id}`),
    ...over,
  } as Row & { access_token: string | null; refresh_token: string | null }
}

describe('Google revoke', () => {
  it('tokens really are encrypted at rest (the bug: ciphertext was sent)', () => {
    const r = googleRow('g1')
    expect(String(r.refresh_token).startsWith('v1.')).toBe(true)
    expect(decryptGoogleSecret(r.refresh_token as string)).toBe('1//refresh-g1')
  })

  it('offboarding sends the decrypted refresh token to Google, then deletes the row', async () => {
    db.google_tokens = [googleRow('g1'), googleRow('g-other', { member_id: 'm-stays', email: 'stays@lakeside.test' })]
    db.cxo_ics_feeds = [{ id: 'f1', member_id: 'm-leaver' }]
    db.mcp_tokens = [{ id: 'k1', member_id: 'm-leaver', revoked_at: null }]
    stubFetch(() => ({ status: 200 }))

    await disconnectMemberCalendars('m-leaver')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(GOOGLE_REVOKE_URL)
    expect(sentToken(calls[0])).toBe('1//refresh-g1')
    expect(calls[0].body).not.toContain('v1.')
    expect(db.google_tokens.map((r) => r.id)).toEqual(['g-other'])
    expect(db.cxo_ics_feeds).toEqual([])
    expect(db.mcp_tokens[0].revoked_at).toBeTruthy()
    expect(errors).toEqual([])
  })

  it('falls back to the access token when Google refuses the refresh token', async () => {
    stubFetch((c) => (sentToken(c)?.startsWith('1//') ? { status: 400, body: '{"error":"invalid_token"}' } : { status: 200 }))
    const out = await revokeStoredGoogleGrant(googleRow('g1'))
    expect(out).toEqual({ ok: true, via: 'access' })
    expect(calls.map(sentToken)).toEqual(['1//refresh-g1', 'ya29.access-g1'])
    expect(errors).toEqual([])
  })

  it('uses the access token when there is no refresh token', async () => {
    stubFetch(() => ({ status: 200 }))
    const out = await revokeStoredGoogleGrant(googleRow('g1', { refresh_token: null }))
    expect(out).toEqual({ ok: true, via: 'access' })
    expect(calls.map(sentToken)).toEqual(['ya29.access-g1'])
  })

  it('a failed revoke is recorded (no token in the log) and never blocks the delete', async () => {
    db.google_tokens = [googleRow('g1')]
    stubFetch(() => ({ status: 400, body: '{"error":"invalid_token"}' }))
    await disconnectMemberCalendars('m-leaver')
    expect(db.google_tokens).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ source: 'google/revoke', error_type: 'google_revoke_rejected', severity: 'warn', member_id: 'm-leaver' })
    expect(JSON.stringify(errors[0])).not.toContain('refresh-g1')
    expect(JSON.stringify(errors[0])).not.toContain('access-g1')
  })

  it('a network failure is recorded and the row still goes', async () => {
    db.google_tokens = [googleRow('g1')]
    stubFetch(() => new Error('socket hang up'))
    await disconnectMemberCalendars('m-leaver')
    expect(db.google_tokens).toEqual([])
    expect(errors[0]).toMatchObject({ error_type: 'google_revoke_network' })
  })

  it('an undecryptable token (key rotated) is recorded, nothing is sent, the row still goes', async () => {
    const r = googleRow('g1')
    process.env.SESSION_SECRET = 'a-different-secret'
    db.google_tokens = [r]
    stubFetch(() => ({ status: 200 }))
    await disconnectMemberCalendars('m-leaver')
    expect(calls).toEqual([])
    expect(db.google_tokens).toEqual([])
    expect(errors[0]).toMatchObject({ error_type: 'google_revoke_undecryptable' })
  })

  it('legacy plain-text rows are sent as stored', async () => {
    stubFetch(() => ({ status: 200 }))
    await revokeStoredGoogleGrant({ access_token: 'ya29.plain', refresh_token: '1//plain' })
    expect(calls.map(sentToken)).toEqual(['1//plain'])
  })

  it('self-serve disconnect of one account revokes it and deletes only that row', async () => {
    db.google_tokens = [googleRow('g1'), googleRow('g2')]
    stubFetch(() => ({ status: 200 }))
    await disconnectRep('org-a', { accountId: 'g2' })
    expect(calls.map(sentToken)).toEqual(['1//refresh-g2'])
    expect(db.google_tokens.map((r) => r.id)).toEqual(['g1'])
  })

  it('self-serve disconnect of the tenant-level row revokes and deletes it', async () => {
    db.google_tokens = [googleRow('owner', { member_id: null }), googleRow('g1')]
    stubFetch(() => ({ status: 200 }))
    await disconnectRep('org-a', { memberId: null })
    expect(calls.map(sentToken)).toEqual(['1//refresh-owner'])
    expect(db.google_tokens.map((r) => r.id)).toEqual(['g1'])
  })

  it('does not revoke a Google account that is still connected on another row (would kill that one too)', async () => {
    db.google_tokens = [googleRow('g1', { email: 'shared@lakeside.test' }), googleRow('owner', { member_id: null, email: 'shared@lakeside.test' })]
    stubFetch(() => ({ status: 200 }))
    await disconnectMemberCalendars('m-leaver')
    expect(calls).toEqual([])
    expect(db.google_tokens.map((r) => r.id)).toEqual(['owner'])
  })
})

describe('QuickBooks revoke', () => {
  beforeEach(() => {
    process.env.QBO_CLIENT_ID = 'qbo-client'
    process.env.QBO_CLIENT_SECRET = 'qbo-secret'
    process.env.QBO_ENVIRONMENT = 'sandbox'
  })
  function qboRow(): Row {
    const key = qboTokenKey()!
    return {
      id: 'c1',
      rep_id: 'org-a',
      realm_id: 'r1',
      access_token_enc: encryptToken('qbo-access', key),
      refresh_token_enc: encryptToken('qbo-refresh', key),
    }
  }
  const sentQbo = (c: Call) => (JSON.parse(c.body) as { token: string }).token

  it('sends the decrypted refresh token to Intuit with client auth, then deletes everything', async () => {
    db.cxo_qbo_connections = [qboRow()]
    stubFetch(() => ({ status: 200 }))
    await disconnectQbo('org-a')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(QBO_REVOKE_URL)
    expect(sentQbo(calls[0])).toBe('qbo-refresh')
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('qbo-client:qbo-secret').toString('base64')}`)
    expect(db.cxo_qbo_connections).toEqual([])
    expect(errors).toEqual([])
  })

  it('falls back to the access token, and records a revoke Intuit refuses without blocking', async () => {
    db.cxo_qbo_connections = [qboRow()]
    stubFetch(() => ({ status: 400, body: '{"error":"invalid_request"}' }))
    await disconnectQbo('org-a')
    expect(calls.map(sentQbo)).toEqual(['qbo-refresh', 'qbo-access'])
    expect(db.cxo_qbo_connections).toEqual([])
    expect(errors[0]).toMatchObject({ source: 'qbo/revoke', error_type: 'qbo_revoke_rejected', rep_id: 'org-a' })
    expect(JSON.stringify(errors[0])).not.toContain('qbo-refresh')
  })
})
