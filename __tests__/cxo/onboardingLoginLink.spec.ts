import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── In-memory database: just enough of the supabase-js query builder for the
// onboarding / login-link code (select, update, insert, delete, eq, is, or,
// order, limit, maybeSingle). Nothing touches a real database or mailbox.
type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}

function parseOr(expr: string): (r: Row) => boolean {
  const parts = expr.split(',').map((p) => p.trim())
  const preds = parts.map((p) => {
    const [col, op, ...rest] = p.split('.')
    const raw = rest.join('.').replace(/^"|"$/g, '')
    if (op === 'is' && raw === 'null') return (r: Row) => r[col] == null
    if (op === 'lt') return (r: Row) => r[col] != null && Date.parse(String(r[col])) < Date.parse(raw)
    throw new Error(`fake .or() cannot parse ${p}`)
  })
  return (r) => preds.some((f) => f(r))
}

function from(table: string) {
  db[table] ??= []
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
  let patch: Row = {}
  let inserted: Row[] = []
  let returning = false
  let limit = Infinity
  let orderCol: string | null = null
  let orderAsc = true
  const filters: Array<(r: Row) => boolean> = []

  const run = () => {
    const rows = db[table]
    if (op === 'insert') {
      rows.push(...inserted)
      return { data: inserted, error: null }
    }
    let hit = rows.filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      hit.forEach((r) => Object.assign(r, patch))
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }
    }
    if (op === 'delete') {
      db[table] = rows.filter((r) => !hit.includes(r))
      return { data: null, error: null }
    }
    if (orderCol) {
      const c = orderCol
      hit = [...hit].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (orderAsc ? 1 : -1))
    }
    return { data: hit.slice(0, limit).map((r) => ({ ...r })), error: null }
  }

  const q = {
    select: () => {
      if (op === 'select') op = 'select'
      else returning = true
      return q
    },
    update: (p: Row) => ((op = 'update'), (patch = p), q),
    insert: (p: Row | Row[]) => ((op = 'insert'), (inserted = Array.isArray(p) ? p : [p]), q),
    delete: () => ((op = 'delete'), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
    or: (expr: string) => (filters.push(parseOr(expr)), q),
    order: (c: string, o?: { ascending?: boolean }) => ((orderCol = c), (orderAsc = o?.ascending !== false), q),
    limit: (n: number) => ((limit = n), q),
    maybeSingle: async () => {
      const r = run()
      const d = r.data as Row[] | null
      return { data: d && d.length ? d[0] : null, error: null }
    },
    single: async () => {
      const r = run()
      const d = r.data as Row[] | null
      return { data: d && d.length ? d[0] : null, error: d && d.length ? null : { message: 'no rows' } }
    },
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
      try {
        res(run())
      } catch (e) {
        rej?.(e)
      }
    },
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => from(t) } }))

const sent: Array<{ to: string; subject: string; html: string; text?: string; brand?: string }> = []
let sendOk = true
vi.mock('@/lib/email', async (orig) => {
  const real = await orig<typeof import('@/lib/email')>()
  return {
    ...real,
    sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text?: string; brand?: string }) => {
      if (!sendOk) return { ok: false, error: 'provider down' }
      sent.push(m)
      return { ok: true, id: `re_${sent.length}` }
    }),
  }
})

const signatures: Array<Record<string, unknown>> = []
vi.mock('@/lib/liabilityAgreement', () => ({
  recordSignature: vi.fn(async (args: Record<string, unknown>) => {
    signatures.push(args)
    return { ok: true }
  }),
}))

const events: string[] = []
vi.mock('@/lib/admin-db', () => ({
  addClientEvent: vi.fn(async (e: { title: string }) => {
    events.push(e.title)
  }),
}))

const hashed: string[] = []
vi.mock('@/lib/client-password', () => ({
  hashPassword: vi.fn(async (plain: string) => {
    hashed.push(plain)
    return `hash:${plain.length}`
  }),
}))

vi.mock('@/lib/members', () => ({
  createMember: vi.fn(async (input: { repId: string; email: string; displayName: string; role: string; passwordHash: string }) => {
    const row = {
      id: `mem_new_${(db.members ?? []).length + 1}`,
      rep_id: input.repId,
      email: input.email,
      display_name: input.displayName,
      role: input.role,
      is_active: true,
      password_hash: input.passwordHash,
      password_reset_token: null,
      password_reset_expires_at: null,
      login_link_sent_at: null,
      created_at: new Date().toISOString(),
    }
    db.members.push(row)
    return row
  }),
}))

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: vi.fn(async (args: { success_url: string; cancel_url: string }) => {
          stripeCalls.push(args)
          return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }
        }),
      },
    },
  }),
}))
const stripeCalls: Array<{ success_url: string; cancel_url: string }> = []

const REP = 'rep_test_cxo'
const DAY = 24 * 60 * 60 * 1000

function seed(opts: { owner?: boolean; tokenWelcome?: string | null } = {}) {
  for (const k of Object.keys(db)) delete db[k]
  sent.length = 0
  signatures.length = 0
  events.length = 0
  hashed.length = 0
  stripeCalls.length = 0
  sendOk = true
  db.reps = [{ id: REP, email: 'owner@example.test', display_name: 'Pat Example', company: 'Example Co', brand: 'cxo' }]
  db.members = opts.owner
    ? [
        {
          id: 'mem_owner',
          rep_id: REP,
          email: 'owner@example.test',
          display_name: 'Pat Example',
          role: 'owner',
          is_active: true,
          password_reset_token: null,
          password_reset_expires_at: null,
          login_link_sent_at: null,
          created_at: '2026-10-01T00:00:00.000Z',
        },
      ]
    : []
  db.onboarding_tokens = [
    {
      token: 'tok_abc',
      rep_id: REP,
      build_fee_cents: 0,
      signature_name: 'Pat Example',
      signed_at: '2026-10-09T12:00:00.000Z',
      signed_ip: '203.0.113.9',
      signed_user_agent: 'UA/1',
      welcome_sent_at: opts.tokenWelcome ?? null,
    },
  ]
  db.client_events = []
}

beforeEach(() => seed())

describe('onboarding link lives on the brand domain', () => {
  it('builds suitecxo.com links for CXO and virtualcloser.com for VC', async () => {
    const { onboardingUrl } = await import('@/lib/onboardingUrl')
    expect(onboardingUrl('cxo', 'abc')).toBe('https://suitecxo.com/onboard/abc')
    expect(onboardingUrl('vc', 'abc')).toBe('https://virtualcloser.com/onboard/abc')
  })

  it('createOnboardingToken returns a suitecxo.com link and Stripe returns there', async () => {
    const { createOnboardingToken } = await import('@/lib/admin-onboarding')
    const r = await createOnboardingToken({ id: REP, display_name: 'Pat', email: 'owner@example.test', build_fee: 500, brand: 'cxo' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.url).toBe(`https://suitecxo.com/onboard/${r.token}`)
    expect(stripeCalls[0].success_url).toBe(`https://suitecxo.com/onboard/${r.token}?paid=1`)
    expect(stripeCalls[0].cancel_url).toBe(`https://suitecxo.com/onboard/${r.token}`)
    expect(JSON.stringify(stripeCalls)).not.toContain('virtualcloser')
  })
})

describe('provisionOnboardingOwner', () => {
  it('existing owner: records the signature against them and emails the login link', async () => {
    seed({ owner: true })
    const { provisionOnboardingOwner } = await import('@/lib/onboardingOwner')
    const r = await provisionOnboardingOwner({
      token: 'tok_abc',
      repId: REP,
      signatureName: 'Pat Example',
      ip: '203.0.113.9',
      ua: 'UA/1',
      source: 'onboarding link',
    })
    expect(r.status).toBe('done')
    if (r.status !== 'done') return
    expect(r.ownerCreated).toBe(false)
    expect(r.memberId).toBe('mem_owner')
    expect(r.signature).toBe('recorded')
    expect(signatures).toHaveLength(1)
    expect(signatures[0]).toMatchObject({
      repId: REP,
      memberId: 'mem_owner',
      signatureName: 'Pat Example',
      signedIp: '203.0.113.9',
      signedUserAgent: 'UA/1',
      brand: 'cxo',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('owner@example.test')
    expect(sent[0].brand).toBe('cxo')
    expect(sent[0].subject).toContain('CXO Suite')
    const token = db.members[0].password_reset_token as string
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(sent[0].html).toContain(`https://suitecxo.com/reset-password?token=${token}`)
    expect(db.onboarding_tokens[0].welcome_sent_at).toBeTruthy()
    // No new owner was created and no password was minted.
    expect(db.members).toHaveLength(1)
    expect(hashed).toHaveLength(0)
  })

  it('new owner: created with a random unusable password, and the email never carries a password or Telegram', async () => {
    const { provisionOnboardingOwner } = await import('@/lib/onboardingOwner')
    const r = await provisionOnboardingOwner({ token: 'tok_abc', repId: REP, signatureName: 'Pat Example', source: 'onboarding link' })
    expect(r.status).toBe('done')
    if (r.status !== 'done') return
    expect(r.ownerCreated).toBe(true)
    expect(hashed).toHaveLength(1)
    expect(hashed[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(sent).toHaveLength(1)
    const mail = `${sent[0].subject}\n${sent[0].html}\n${sent[0].text ?? ''}`
    expect(mail).not.toContain(hashed[0])
    expect(mail.toLowerCase()).not.toContain('password:')
    expect(mail.toLowerCase()).not.toContain('temporary password')
    expect(mail.toLowerCase()).not.toContain('telegram')
    expect(mail).not.toContain('Virtual Closer')
    expect(mail).toContain('https://suitecxo.com/reset-password?token=')
    expect(signatures[0]).toMatchObject({ memberId: r.memberId, brand: 'cxo' })
  })

  it('is idempotent on welcome_sent_at: a second run sends nothing', async () => {
    seed({ owner: true, tokenWelcome: '2026-10-09T12:01:00.000Z' })
    const { provisionOnboardingOwner } = await import('@/lib/onboardingOwner')
    const r = await provisionOnboardingOwner({ token: 'tok_abc', repId: REP, signatureName: 'Pat', source: 'x' })
    expect(r.status).toBe('already_done')
    expect(sent).toHaveLength(0)
    expect(signatures).toHaveLength(0)
  })

  it('paid webhook path uses the stored signer IP and user agent', async () => {
    seed({ owner: true })
    db.onboarding_tokens[0].build_fee_cents = 50000
    const { provisionFromOnboardingCheckout } = await import('@/lib/billing/provisionOnboarding')
    await provisionFromOnboardingCheckout({
      id: 'cs_1',
      metadata: { onboarding_token: 'tok_abc', rep_id: REP },
    } as never)
    expect(signatures[0]).toMatchObject({ memberId: 'mem_owner', signedIp: '203.0.113.9', signedUserAgent: 'UA/1' })
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain('https://suitecxo.com/reset-password?token=')
    expect(db.onboarding_tokens[0].paid_at).toBeTruthy()
    expect(db.reps[0].billing_status).toBe('pending_activation')
  })
})

describe('login link double-send guard', () => {
  it('isDuplicateLoginLinkSend is true only inside 2 minutes', async () => {
    const { isDuplicateLoginLinkSend } = await import('@/lib/loginLinkSend')
    const now = Date.parse('2026-10-09T12:00:00.000Z')
    expect(isDuplicateLoginLinkSend(null, now)).toBe(false)
    expect(isDuplicateLoginLinkSend('garbage', now)).toBe(false)
    expect(isDuplicateLoginLinkSend('2026-10-09T11:59:00.000Z', now)).toBe(true)
    expect(isDuplicateLoginLinkSend('2026-10-09T11:58:00.001Z', now)).toBe(true)
    expect(isDuplicateLoginLinkSend('2026-10-09T11:57:59.000Z', now)).toBe(false)
  })

  it('a second click within 2 minutes is skipped, logged, and sends no email', async () => {
    seed({ owner: true })
    const { sendOwnerLoginLink } = await import('@/lib/onboardingOwner')
    const first = await sendOwnerLoginLink(REP)
    const second = await sendOwnerLoginLink(REP)
    expect(first.status).toBe('sent')
    expect(second.status).toBe('skipped_duplicate')
    expect(sent).toHaveLength(1)
    expect(events.some((t) => t.includes('skipped duplicate'))).toBe(true)
  })

  it('two clicks at the same moment still send one email', async () => {
    seed({ owner: true })
    const { sendOwnerLoginLink } = await import('@/lib/onboardingOwner')
    const [a, b] = await Promise.all([sendOwnerLoginLink(REP), sendOwnerLoginLink(REP)])
    expect([a.status, b.status].sort()).toEqual(['sent', 'skipped_duplicate'])
    expect(sent).toHaveLength(1)
  })

  it('after 2 minutes a resend goes out and re-uses the still-valid link', async () => {
    seed({ owner: true })
    const { sendLoginLinkToMember } = await import('@/lib/loginLinkSend')
    const t0 = Date.parse('2026-10-09T12:00:00.000Z')
    const base = { repId: REP, memberId: 'mem_owner', workspaceLabel: 'Example Co', brand: 'cxo' as const }
    const a = await sendLoginLinkToMember({ ...base, now: t0 })
    const b = await sendLoginLinkToMember({ ...base, now: t0 + 3 * 60 * 1000 })
    expect(a.status).toBe('sent')
    expect(b.status).toBe('sent')
    if (b.status === 'sent') expect(b.reused).toBe(true)
    expect(sent).toHaveLength(2)
    const token = db.members[0].password_reset_token as string
    expect(sent[0].html).toContain(token)
    expect(sent[1].html).toContain(token)
  })

  it('mints a fresh 7-day link when the old one has under a day left', async () => {
    seed({ owner: true })
    const now = Date.parse('2026-10-09T12:00:00.000Z')
    db.members[0].password_reset_token = 'a'.repeat(64)
    db.members[0].password_reset_expires_at = new Date(now + 6 * 60 * 60 * 1000).toISOString()
    const { sendLoginLinkToMember } = await import('@/lib/loginLinkSend')
    const r = await sendLoginLinkToMember({ repId: REP, memberId: 'mem_owner', workspaceLabel: 'X', brand: 'cxo', now })
    expect(r.status).toBe('sent')
    expect(db.members[0].password_reset_token).not.toBe('a'.repeat(64))
    expect(Date.parse(String(db.members[0].password_reset_expires_at)) - now).toBe(7 * DAY)
  })

  it('a failed send releases the claim so an immediate retry works', async () => {
    seed({ owner: true })
    const { sendOwnerLoginLink } = await import('@/lib/onboardingOwner')
    sendOk = false
    const a = await sendOwnerLoginLink(REP)
    expect(a.status).toBe('failed')
    expect(db.members[0].login_link_sent_at).toBeNull()
    expect(events.some((t) => t.includes('FAILED'))).toBe(true)
    sendOk = true
    const b = await sendOwnerLoginLink(REP)
    expect(b.status).toBe('sent')
    expect(sent).toHaveLength(1)
  })
})
