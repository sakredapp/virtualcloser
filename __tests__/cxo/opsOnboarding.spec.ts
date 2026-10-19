import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Every database read is recorded; nothing real is touched.
const touched: string[] = []
const tables: Record<string, unknown[]> = {}
function chain(name: string): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: tables[name] ?? [], error: null })
      if (prop === 'maybeSingle') return async () => ({ data: (tables[name] ?? [])[0] ?? null, error: null })
      return () => new Proxy({}, handler)
    },
  }
  touched.push(name)
  return new Proxy({}, handler)
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
const sendOwnerLoginLink = vi.fn(async () => ({ status: 'sent', email: 'o@x.com' }))
const createOnboardingToken = vi.fn(async () => ({ ok: true, url: 'https://suitecxo.com/onboard/t', token: 't' }))
vi.mock('@/lib/onboardingOwner', () => ({ sendOwnerLoginLink }))
vi.mock('@/lib/admin-onboarding', () => ({ createOnboardingToken }))
vi.mock('@/lib/admin-db', () => ({ addClientEvent: async () => {}, createClientRow: vi.fn(), updateClientRow: vi.fn() }))
const sendSeatCheckout = vi.fn(async () => ({ ok: true as const, status: 200, data: { checkout_url: 'https://whop.com/checkout/x', seats: 1 } }))
const compClient = vi.fn(async () => ({ ok: true as const, status: 200, data: { billing_status: 'comped' } }))
vi.mock('@/lib/billing/cxoBillingActions', () => ({ sendSeatCheckout, compClient }))

import {
  UNREADABLE,
  buildCxoBoard,
  deriveCxoSteps,
  memberSummary,
  type MemberFact,
  type TenantFacts,
} from '@/lib/opsOnboarding/shared'
import { isOpsAuthorized, OPS_SECRET_MIN_LENGTH } from '@/lib/opsOnboarding/auth'

const NOW = new Date('2026-10-19T12:00:00Z')
const HOST = 'acme.suitecxo.com'
const SECRET = 'x'.repeat(48)

const member = (p: Partial<MemberFact> & { id: string }): MemberFact => ({
  role: 'rep', created_at: '2026-10-10T00:00:00Z', invited_at: null, accepted_at: null, last_login_at: null,
  login_link_sent_at: null, about_at: null, about_skipped_at: null, ...p,
})
const OWNER = member({ id: 'o', role: 'owner', created_at: '2026-10-01T00:00:00Z' })

function facts(p: Partial<TenantFacts> = {}): TenantFacts {
  return {
    rep: { id: 'rep_acme', slug: 'acme', display_name: 'Ann', company: 'Acme', email: 'ann@acme.com', is_active: true, billing_status: null, created_at: '2026-10-01T00:00:00Z' },
    edition: 'suitecxo',
    review_demo: false,
    token: null,
    members: [OWNER],
    google: [],
    dayOne: [],
    optional: { quickbooks: { connected: false, needs_reconnect: false }, slack: false, plaud: false, producer_book: false },
    ...p,
  }
}
const step = (f: TenantFacts, key: string) => deriveCxoSteps(f, NOW, HOST).find((s) => s.key === key)!

describe('Suite CXO onboarding steps', () => {
  it('uses the six shared keys, in order, with both field names', () => {
    const steps = deriveCxoSteps(facts(), NOW, HOST)
    expect(steps.map((s) => s.key)).toEqual(['pay', 'account', 'intake', 'addresses', 'connect', 'go_live'])
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6])
    for (const s of steps) {
      expect(s.title).toBe(s.label)
      expect(s.reason).toBe(s.detail)
      expect(s.href.startsWith(`https://${HOST}/`)).toBe(true)
    }
  })

  it('pay: no link = waiting on us with the issue action; unsigned = customer; expired = us', () => {
    expect(step(facts(), 'pay')).toMatchObject({ status: 'waiting_on_us', action: { kind: 'action', id: 'issue_sign_and_pay_link' } })
    const tok = { signed_at: null, paid_at: null, build_fee_cents: 200000, expires_at: '2026-10-25T00:00:00Z', welcome_sent_at: null, created_at: '2026-10-18T00:00:00Z' }
    expect(step(facts({ token: tok }), 'pay').status).toBe('waiting_on_customer')
    expect(step(facts({ token: { ...tok, expires_at: '2026-10-18T00:00:00Z' } }), 'pay').status).toBe('waiting_on_us')
    const signed = step(facts({ token: { ...tok, signed_at: '2026-10-18T00:00:00Z' } }), 'pay')
    expect(signed.status).toBe('waiting_on_customer')
    expect(signed.reason).toContain('$2,000')
  })

  it('pay: done when paid, when signed with no fee, or when Whop billing is active', () => {
    const tok = { signed_at: '2026-10-18T00:00:00Z', paid_at: null, build_fee_cents: 0, expires_at: null, welcome_sent_at: null, created_at: null }
    expect(step(facts({ token: tok }), 'pay').status).toBe('done')
    expect(step(facts({ token: { ...tok, build_fee_cents: 5000, paid_at: '2026-10-18T01:00:00Z' } }), 'pay').status).toBe('done')
    const active = facts({ rep: { ...facts().rep, billing_status: 'active' } })
    expect(step(active, 'pay')).toMatchObject({ status: 'done', action: null })
  })

  it('an unreadable source is unknown, never done', () => {
    const f = facts({ token: UNREADABLE, members: UNREADABLE, google: UNREADABLE, dayOne: UNREADABLE })
    for (const s of deriveCxoSteps(f, NOW, HOST)) expect(s.status).toBe('unknown')
    expect(memberSummary(f)).toBeNull()
  })

  it('account: no owner and no email is blocked; sent but not signed in waits on the customer', () => {
    expect(step(facts({ members: [], rep: { ...facts().rep, email: null } }), 'account').status).toBe('blocked')
    expect(step(facts({ members: [] }), 'account')).toMatchObject({ status: 'waiting_on_us', action: { id: 'resend_login_link' } })
    expect(step(facts(), 'account').status).toBe('waiting_on_us')
    const sent = member({ ...OWNER, login_link_sent_at: '2026-10-18T00:00:00Z' })
    expect(step(facts({ members: [sent] }), 'account').status).toBe('waiting_on_customer')
    const inn = member({ ...OWNER, accepted_at: '2026-10-18T00:00:00Z' })
    expect(step(facts({ members: [inn] }), 'account').status).toBe('done')
  })

  it('about you, seats, Google and day one read the owner and the seats', () => {
    const owner = member({ ...OWNER, accepted_at: '2026-10-02T00:00:00Z', about_skipped_at: '2026-10-02T00:00:00Z' })
    const exec = member({ id: 'e1', role: 'admin', accepted_at: '2026-10-05T00:00:00Z' })
    const pending = member({ id: 'e2', role: 'rep' })
    const ea = member({ id: 'a1', role: 'assistant' })
    const f = facts({
      members: [owner, exec, pending, ea],
      google: [{ member_id: 'o', needs_reconnect: false }, { member_id: 'e1', needs_reconnect: true }],
      dayOne: [{ member_id: 'o', completed_at: '2026-10-03T00:00:00Z' }],
    })
    expect(step(f, 'intake').status).toBe('done')
    const seats = step(f, 'addresses')
    expect(seats.status).toBe('waiting_on_customer')
    expect(seats.reason).toBe('1 of 3 seats has not signed in yet.')
    expect(step(f, 'connect').status).toBe('waiting_on_customer')
    expect(step(f, 'go_live').status).toBe('done')
    expect(memberSummary(f)).toEqual({
      seats: 3, invited: 2, signed_in: 2, pending: 1, assistants: 1,
      google_healthy: 1, google_needs_reconnect: 1, about_you_done: 1, day_one_done: 1,
    })
  })

  it('a company-level Google row covers everyone, as on the integrations page', () => {
    const owner = member({ ...OWNER, accepted_at: '2026-10-02T00:00:00Z' })
    const f = facts({ members: [owner, member({ id: 'e1', accepted_at: '2026-10-03T00:00:00Z' })], google: [{ member_id: null, needs_reconnect: false }] })
    expect(step(f, 'connect').status).toBe('done')
  })

  it('Pinnacle: the book sync decides with day one; only status and time come out', () => {
    const owner = member({ ...OWNER, accepted_at: '2026-10-02T00:00:00Z' })
    const base = facts({ edition: 'pinnacle', members: [owner], dayOne: [{ member_id: 'o', completed_at: '2026-10-03T00:00:00Z' }] })
    const okRun = { started_at: '2026-10-19T10:00:00Z', finished_at: '2026-10-19T10:05:00Z', ok: true }
    expect(step({ ...base, sync: okRun }, 'go_live').status).toBe('done')
    expect(step({ ...base, sync: { ...okRun, ok: false } }, 'go_live').status).toBe('blocked')
    expect(step({ ...base, sync: null }, 'go_live').status).toBe('waiting_on_us')
    expect(step({ ...base, sync: { ...okRun, finished_at: '2026-10-15T00:00:00Z' } }, 'go_live').status).toBe('waiting_on_us')
    const board = buildCxoBoard([{ ...base, sync: okRun }], NOW)
    const t = board.tenants[0]
    expect(t.pinnacle).toEqual({ sync: { status: 'ok', at: '2026-10-19T10:05:00Z' } })
    expect(Object.keys(t).sort()).toEqual([
      'company', 'created_at', 'current_step', 'current_step_number', 'edition', 'host', 'is_active', 'members',
      'name', 'optional', 'pinnacle', 'rep_id', 'review_demo', 'slug', 'steps', 'waiting_on',
    ])
  })

  it('review demos are labelled, carry no action ids and are left out of the counts', () => {
    const demo = facts({ rep: { ...facts().rep, id: 'rep_store_review', slug: 'store-review' }, review_demo: true })
    const board = buildCxoBoard([demo, facts()], NOW)
    const d = board.tenants.find((t) => t.rep_id === 'rep_store_review')!
    expect(d.review_demo).toBe(true)
    expect(d.steps.some((s) => s.action?.kind === 'action')).toBe(false)
    expect(board.tenants[board.tenants.length - 1].rep_id).toBe('rep_store_review')
    expect(board.counts.us + board.counts.customer + board.counts.nobody + board.counts.unknown).toBe(1)
  })

  it('renamed hosts point at the new host', () => {
    const f = facts({ rep: { ...facts().rep, slug: 'spence' } })
    expect(buildCxoBoard([f], NOW, { spence: 'mike' }).tenants[0].host).toBe('mike.suitecxo.com')
  })
})

describe('ops onboarding auth', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isOpsAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(isOpsAuthorized(`bearer  ${SECRET} `, SECRET)).toBe(true)
    expect(isOpsAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(isOpsAuthorized(SECRET, SECRET)).toBe(false)
    expect(isOpsAuthorized(null, SECRET)).toBe(false)
    expect(isOpsAuthorized('Bearer ', SECRET)).toBe(false)
  })

  it('fails closed when the secret is unset or short', () => {
    expect(isOpsAuthorized('Bearer ', '')).toBe(false)
    expect(isOpsAuthorized('Bearer abc', 'abc')).toBe(false)
    const short = 'y'.repeat(OPS_SECRET_MIN_LENGTH - 1)
    expect(isOpsAuthorized(`Bearer ${short}`, short)).toBe(false)
  })
})

describe('ops onboarding routes', () => {
  const ENV = process.env.OPS_ONBOARDING_SECRET
  beforeEach(() => {
    process.env.OPS_ONBOARDING_SECRET = SECRET
    touched.length = 0
    for (const k of Object.keys(tables)) delete tables[k]
    sendOwnerLoginLink.mockClear()
    createOnboardingToken.mockClear()
    sendSeatCheckout.mockClear()
    compClient.mockClear()
  })
  afterEach(() => {
    if (ENV === undefined) delete process.env.OPS_ONBOARDING_SECRET
    else process.env.OPS_ONBOARDING_SECRET = ENV
  })

  const post = async (body: unknown, auth = `Bearer ${SECRET}`) => {
    const { NextRequest } = await import('next/server')
    const route = await import('@/app/api/ops/onboarding/actions/route')
    return route.POST(new NextRequest('https://suitecxo.com/api/ops/onboarding/actions', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  }

  it('GET without the secret is 401 and reads nothing', async () => {
    const { NextRequest } = await import('next/server')
    const route = await import('@/app/api/ops/onboarding/route')
    const res = await route.GET(new NextRequest('https://suitecxo.com/api/ops/onboarding'))
    expect(res.status).toBe(401)
    const wrong = await route.GET(new NextRequest('https://suitecxo.com/api/ops/onboarding', { headers: { authorization: 'Bearer nope' } }))
    expect(wrong.status).toBe(401)
    expect(touched).toEqual([])
  })

  it('GET with the secret answers the board and never reads a Pinnacle book table', async () => {
    tables.reps = [{ id: 'rep_acme', slug: 'acme', display_name: 'Ann', company: 'Acme', email: 'a@x.com', is_active: true, billing_status: null, created_at: null }]
    const { NextRequest } = await import('next/server')
    const route = await import('@/app/api/ops/onboarding/route')
    const res = await route.GET(new NextRequest('https://suitecxo.com/api/ops/onboarding', { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.tenants).toHaveLength(1)
    expect(body.tenants[0].steps).toHaveLength(6)
    expect(touched.filter((t) => t.startsWith('pinnacle'))).toEqual([])
  })

  it('POST without the secret is 401 and does nothing', async () => {
    const res = await post({ action: 'resend_login_link', rep_id: 'rep_acme' }, 'Bearer wrong')
    expect(res.status).toBe(401)
    expect(sendOwnerLoginLink).not.toHaveBeenCalled()
  })

  it('every action on a review demo is refused before anything is read or sent', async () => {
    for (const rep_id of ['rep_store_review', 'rep_store_review_pinnacle']) {
      for (const action of ['resend_login_link', 'issue_sign_and_pay_link']) {
        const res = await post({ action, rep_id })
        expect(res.status).toBe(403)
        expect((await res.json()).error).toBe('review_demo')
      }
    }
    const create = await post({ action: 'create_client', input: { slug: 'store-review', display_name: 'X', email: 'x@y.com' } })
    expect(create.status).toBe(403)
    expect(sendOwnerLoginLink).not.toHaveBeenCalled()
    expect(createOnboardingToken).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('refuses a tenant that is not Suite CXO, and an unknown action', async () => {
    tables.reps = [{ id: 'rep_vc', slug: 'vc', display_name: 'V', email: null, build_fee: 0, brand: 'virtualcloser' }]
    expect((await post({ action: 'resend_login_link', rep_id: 'rep_vc' })).status).toBe(404)
    expect((await post({ action: 'delete_everything', rep_id: 'rep_vc' })).status).toBe(400)
  })

  it('resends the login link and issues a sign-and-pay link for a Suite CXO tenant', async () => {
    tables.reps = [{ id: 'rep_acme', slug: 'acme', display_name: 'Ann', email: 'a@x.com', build_fee: 2000, brand: 'cxo' }]
    const r1 = await post({ action: 'resend_login_link', rep_id: 'rep_acme' })
    expect(r1.status).toBe(200)
    expect(sendOwnerLoginLink).toHaveBeenCalledWith('rep_acme', 'Accounts')
    const r2 = await post({ action: 'issue_sign_and_pay_link', rep_id: 'rep_acme' })
    expect(r2.status).toBe(200)
    expect((await r2.json()).url).toBe('https://suitecxo.com/onboard/t')
    expect(createOnboardingToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep_acme', build_fee: 2000, brand: 'cxo' }))
  })

  it('activate_billing emails the Whop seat checkout and comp_billing comps with no charge', async () => {
    tables.reps = [{ id: 'rep_acme', slug: 'acme', display_name: 'Ann', email: 'a@x.com', build_fee: 2000, brand: 'cxo' }]
    const r1 = await post({ action: 'activate_billing', rep_id: 'rep_acme' })
    expect(r1.status).toBe(200)
    expect(sendSeatCheckout).toHaveBeenCalledWith('rep_acme', expect.objectContaining({ kind: 'admin' }))
    const r2 = await post({ action: 'comp_billing', rep_id: 'rep_acme', reason: 'design partner', amount_cents: 6000 })
    expect(r2.status).toBe(200)
    expect(compClient).toHaveBeenCalledWith('rep_acme', 6000, 'design partner', expect.objectContaining({ kind: 'admin' }))
  })

  it('billing actions never run on a review demo or a non-CXO tenant', async () => {
    tables.reps = [{ id: 'rep_vc', slug: 'vc', display_name: 'V', email: null, build_fee: 0, brand: 'virtualcloser' }]
    expect((await post({ action: 'activate_billing', rep_id: 'rep_store_review' })).status).toBe(403)
    expect((await post({ action: 'comp_billing', rep_id: 'rep_vc', reason: 'x' })).status).toBe(404)
    expect(sendSeatCheckout).not.toHaveBeenCalled()
    expect(compClient).not.toHaveBeenCalled()
  })
})
