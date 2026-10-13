import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Tiny in-memory stand-in for the supabase-js query builder: only what the
// owner login-link path uses. Nothing here touches a real database, Vercel or
// a mailbox.
type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}

function from(table: string) {
  db[table] ??= []
  let patch: Row | null = null
  let limit = Infinity
  const filters: Array<(r: Row) => boolean> = []
  const run = () => {
    const hit = db[table].filter((r) => filters.every((f) => f(r)))
    if (patch) {
      hit.forEach((r) => Object.assign(r, patch))
      return { data: hit.map((r) => ({ ...r })), error: null }
    }
    return { data: hit.slice(0, limit).map((r) => ({ ...r })), error: null }
  }
  const q = {
    select: () => q,
    update: (p: Row) => ((patch = p), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    // Only used for the double-send claim; every member here has never been sent one.
    or: () => (filters.push((r) => r.login_link_sent_at == null), q),
    order: () => q,
    limit: (n: number) => ((limit = n), q),
    maybeSingle: async () => {
      const d = run().data
      return { data: d.length ? d[0] : null, error: null }
    },
    then: (res: (v: unknown) => void) => res(run()),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => from(t) } }))

const sent: Array<{ to: string; subject: string; html: string; text?: string; brand?: string }> = []
vi.mock('@/lib/email', async (orig) => {
  const real = await orig<typeof import('@/lib/email')>()
  return {
    ...real,
    sendEmail: vi.fn(async (m: (typeof sent)[number]) => {
      sent.push(m)
      return { ok: true, id: `re_${sent.length}` }
    }),
  }
})

const events: string[] = []
vi.mock('@/lib/admin-db', () => ({
  addClientEvent: vi.fn(async (e: { title: string }) => {
    events.push(e.title)
  }),
}))
vi.mock('@/lib/members', () => ({ createMember: vi.fn() }))
vi.mock('@/lib/client-password', () => ({ hashPassword: vi.fn(async () => 'hash') }))
vi.mock('@/lib/liabilityAgreement', () => ({ recordSignature: vi.fn() }))

/** Every http(s) host an email body links to or shows. */
function hosts(s: string): string[] {
  return [...s.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  sent.length = 0
  events.length = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('operator brand choice', () => {
  it('offers Virtual Closer first (the default) and Suite CXO', async () => {
    const { OPERATOR_BRAND_CHOICES } = await import('@/lib/newClientBrand')
    expect(OPERATOR_BRAND_CHOICES).toEqual([
      { key: 'virtualcloser', label: 'Virtual Closer' },
      { key: 'cxo', label: 'Suite CXO' },
    ])
  })

  it('reads the form field; missing or unknown stays Virtual Closer', async () => {
    const { operatorBrand } = await import('@/lib/newClientBrand')
    expect(operatorBrand('cxo')).toBe('cxo')
    expect(operatorBrand('virtualcloser')).toBe('virtualcloser')
    for (const raw of [null, undefined, '', 'CXO', 'suitecxo', 'nonsense', 1]) {
      expect(operatorBrand(raw), String(raw)).toBe('virtualcloser')
    }
  })
})

describe('brand → tenant address', () => {
  it('Suite CXO is always <slug>.suitecxo.com, whatever ROOT_DOMAIN says', async () => {
    const { tenantDomain } = await import('@/lib/newClientBrand')
    expect(tenantDomain('acme', 'cxo')).toBe('acme.suitecxo.com')
    vi.stubEnv('ROOT_DOMAIN', 'virtualcloser.com')
    expect(tenantDomain('acme', 'cxo')).toBe('acme.suitecxo.com')
    vi.stubEnv('ROOT_DOMAIN', 'https://example.test/')
    expect(tenantDomain('north-ridge', 'cxo')).toBe('north-ridge.suitecxo.com')
  })

  it('Virtual Closer is unchanged: <slug>.<ROOT_DOMAIN>, default virtualcloser.com', async () => {
    const { tenantDomain } = await import('@/lib/newClientBrand')
    vi.stubEnv('ROOT_DOMAIN', '')
    delete process.env.ROOT_DOMAIN
    expect(tenantDomain('acme', 'virtualcloser')).toBe('acme.virtualcloser.com')
    vi.stubEnv('ROOT_DOMAIN', 'https://example.test/')
    expect(tenantDomain('acme', 'virtualcloser')).toBe('acme.example.test')
  })
})

describe('brand → email at creation', () => {
  it('Virtual Closer keeps the original welcome; Suite CXO gets the login-link email', async () => {
    const { creationWelcome } = await import('@/lib/newClientBrand')
    expect(creationWelcome('virtualcloser')).toBe('password_welcome')
    expect(creationWelcome('cxo')).toBe('login_link')
  })

  it('the Virtual Closer welcome with no brand passed is still Virtual Closer', async () => {
    const { welcomeEmail } = await import('@/lib/email')
    const tpl = welcomeEmail({
      toEmail: 'jane@example.test',
      displayName: 'Jane Doe',
      slug: 'acme',
      password: 'pw-123',
      tierLabel: 'Individual',
    })
    expect(tpl.subject).toBe('Welcome to Virtual Closer, Jane')
    expect(tpl.html).toContain('acme.virtualcloser.com')
    expect(`${tpl.html}\n${tpl.text}`).not.toContain('suitecxo.com')
  })

  it('a Suite CXO tenant: owner gets the Suite CXO email and every link is on suitecxo.com', async () => {
    const { getBrand } = await import('@/lib/brand')
    const { sendOwnerLoginLink } = await import('@/lib/onboardingOwner')
    const cxo = getBrand('cxo')
    db.reps = [{ id: 'rep_acme', email: 'jane@example.test', display_name: 'Jane Doe', company: 'Acme Co', brand: 'cxo' }]
    db.members = [
      {
        id: 'mem_1',
        rep_id: 'rep_acme',
        email: 'jane@example.test',
        display_name: 'Jane Doe',
        role: 'owner',
        is_active: true,
        password_reset_token: null,
        password_reset_expires_at: null,
        login_link_sent_at: null,
        created_at: '2026-10-12T00:00:00Z',
      },
    ]

    const result = await sendOwnerLoginLink('rep_acme', 'new client form')
    expect(result.status).toBe('sent')
    expect(sent).toHaveLength(1)
    const mail = sent[0]
    expect(mail.to).toBe('jane@example.test')
    expect(mail.brand).toBe('cxo')
    expect(mail.subject).toBe(`Your ${cxo.name} login is ready`)

    const token = String(db.members[0].password_reset_token)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(mail.html).toContain(`https://suitecxo.com/reset-password?token=${token}`)
    expect(mail.html).toContain('https://suitecxo.com/login')

    // Links: only the brand domain, plus the logo image host that lib/brand names.
    const logoHost = new URL(cxo.logo.markSrc).host
    const linked = hosts(`${mail.html}\n${mail.text ?? ''}`)
    expect(linked.length).toBeGreaterThan(0)
    for (const h of linked) expect([cxo.rootDomain, logoHost], h).toContain(h)
    const all = `${mail.subject}\n${mail.html}\n${mail.text ?? ''}`
    expect(all).not.toMatch(/virtualcloser\.com/i)
    expect(all).not.toContain('Virtual Closer')
    // No password travels in this email.
    expect(all).not.toMatch(/Password:/)
    expect(events.some((e) => e.includes('Login link sent to jane@example.test via new client form'))).toBe(true)
  })

  it('the same call for a Virtual Closer tenant stays on virtualcloser.com', async () => {
    const { sendOwnerLoginLink } = await import('@/lib/onboardingOwner')
    db.reps = [{ id: 'rep_vc', email: 'sam@example.test', display_name: 'Sam', company: null, brand: 'virtualcloser' }]
    db.members = [
      {
        id: 'mem_2',
        rep_id: 'rep_vc',
        email: 'sam@example.test',
        display_name: 'Sam',
        role: 'owner',
        is_active: true,
        password_reset_token: null,
        password_reset_expires_at: null,
        login_link_sent_at: null,
      },
    ]
    await sendOwnerLoginLink('rep_vc', 'test')
    expect(sent[0].brand).toBe('virtualcloser')
    expect(sent[0].html).toContain('https://virtualcloser.com/reset-password?token=')
    expect(sent[0].html).not.toContain('suitecxo.com')
  })
})

describe('the operator form is wired to the brand choice', () => {
  const src = readFileSync(path.resolve(__dirname, '../../app/admin/clients/new/page.tsx'), 'utf8')

  it('has a brand field that defaults to Virtual Closer', () => {
    expect(src).toContain('<select name="brand" defaultValue={OPERATOR_BRAND_CHOICES[0].key}')
    expect(src).toContain("operatorBrand(formData.get('brand'))")
  })

  it('saves the brand, attaches the brand address and picks the brand email', () => {
    expect(src).toContain("...(brand !== 'virtualcloser' ? { brand } : {})")
    expect(src).toContain('const domain = tenantDomain(slug, brand)')
    expect(src).not.toContain('`${slug}.${rootDomain()}`')
    expect(src).toContain("creationWelcome(brand) === 'login_link'")
    expect(src).toContain("sendOwnerLoginLink(id, 'new client form')")
    // The original welcome is still there for Virtual Closer.
    expect(src).toContain('welcomeEmail({')
  })
})
