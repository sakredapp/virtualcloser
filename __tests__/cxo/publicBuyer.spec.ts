import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Supabase chain: reps lookups answer from `found`; updates are recorded.
const updates: Array<{ table: string; patch: unknown }> = []
let found: unknown[] = []
let bySlug: unknown = null
function chain(table: string): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: found, error: null })
      if (prop === 'maybeSingle') return async () => ({ data: bySlug, error: null })
      if (prop === 'update') return (patch: unknown) => { updates.push({ table, patch }); return new Proxy({}, handler) }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
type Res = { status: number; body: Record<string, unknown> }
const { alertOperator, runOpsAction } = vi.hoisted(() => ({
  alertOperator: vi.fn(async (_i: { title: string; severity?: string }) => {}),
  runOpsAction: vi.fn(async (_b: Record<string, unknown>): Promise<Res> => ({
    status: 201,
    body: { ok: true, rep_id: 'rep_jane_1a2b3c', host: 'jane-1a2b3c.suitecxo.com', login_link: 'sent' },
  })),
}))
vi.mock('@/lib/alerts', () => ({ alertOperator }))
vi.mock('@/lib/opsOnboarding/actions', () => ({ runOpsAction }))

import { buyerEmail, buyerName, ensurePublicBuyerRep, membershipIdOf, publicBuyerSlug } from '@/lib/billing/publicBuyer'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

describe('public buyer helpers', () => {
  it('finds the email on the payment, the membership or the member', () => {
    expect(buyerEmail({ user: { email: ' Jane@Acme.com ' } })).toBe('jane@acme.com')
    expect(buyerEmail({ email: 'a@b.co' })).toBe('a@b.co')
    expect(buyerEmail({ membership: { user: { email: 'm@b.co' } } })).toBe('m@b.co')
    expect(buyerEmail({ user: { email: 'not-an-email' } })).toBeNull()
    expect(buyerEmail({})).toBeNull()
  })
  it('names the account from Whop, else the email', () => {
    expect(buyerName({ user: { name: 'Jane Doe' } }, 'jane@acme.com')).toBe('Jane Doe')
    expect(buyerName({}, 'jane@acme.com')).toBe('jane')
  })
  it('reads the membership id from a payment or a membership', () => {
    expect(membershipIdOf({ id: 'pay_1', membership: { id: 'mem_9' } })).toBe('mem_9')
    expect(membershipIdOf({ id: 'mem_9' })).toBe('mem_9')
    expect(membershipIdOf({ id: 'pay_1' })).toBeNull()
  })
  it('builds the same valid slug on every retry, different per purchase', () => {
    const a = publicBuyerSlug('Jane.Doe+cxo@acme.com', 'mem_1')
    expect(a).toBe(publicBuyerSlug('jane.doe+cxo@acme.com', 'mem_1'))
    expect(a).not.toBe(publicBuyerSlug('jane.doe+cxo@acme.com', 'mem_2'))
    expect(a.startsWith('jane-doe-cxo-')).toBe(true)
    for (const e of ['Jane.Doe+cxo@acme.com', '__@x.io', 'a-very-long-local-part-that-goes-on-and-on@x.io', '9@x.io']) {
      const s = publicBuyerSlug(e, 'mem_1')
      expect(s).toMatch(SLUG_RE)
      expect(s.length).toBeLessThanOrEqual(40)
    }
  })
})

describe('ensurePublicBuyerRep', () => {
  beforeEach(() => {
    updates.length = 0
    found = []
    bySlug = null
    alertOperator.mockClear()
    runOpsAction.mockClear()
  })
  const pay = { id: 'pay_1', user: { email: 'jane@acme.com', name: 'Jane' }, membership: { id: 'mem_1' }, plan: { id: 'plan_KEayyFwJhavJH' } }

  it('creates the account with the welcome email, links the membership and alerts the owner', async () => {
    const r = await ensurePublicBuyerRep(pay, 'payment.succeeded')
    expect(r).toMatchObject({ ok: true, repId: 'rep_jane_1a2b3c', created: true, welcome: 'sent' })
    const call = runOpsAction.mock.calls[0][0] as { action: string; input: Record<string, unknown> }
    expect(call.action).toBe('create_client')
    expect(call.input).toMatchObject({ email: 'jane@acme.com', display_name: 'Jane', send_welcome: true })
    expect(updates).toContainEqual({ table: 'reps', patch: { whop_membership_id: 'mem_1' } })
    expect(alertOperator.mock.calls[0][0].title).toBe('New Suite CXO self-serve buyer')
  })

  it('links to the account the racing webhook already made (409)', async () => {
    runOpsAction.mockResolvedValueOnce({ status: 409, body: { ok: false, error: 'exists' } })
    bySlug = { id: 'rep_first' }
    const r = await ensurePublicBuyerRep(pay, 'membership.activated')
    expect(r).toMatchObject({ ok: true, repId: 'rep_first', created: false })
  })

  it('links an existing client with this email instead of making a second account', async () => {
    found = [{ id: 'rep_old', whop_membership_id: null }]
    const r = await ensurePublicBuyerRep(pay, 'payment.succeeded')
    expect(r).toMatchObject({ ok: true, repId: 'rep_old', created: false })
    expect(runOpsAction).not.toHaveBeenCalled()
  })

  it('alerts and stops when an existing client is on another membership', async () => {
    found = [{ id: 'rep_old', whop_membership_id: 'mem_other' }]
    const r = await ensurePublicBuyerRep(pay, 'payment.succeeded')
    expect(r).toMatchObject({ ok: false, reason: 'other_membership' })
    expect(alertOperator).toHaveBeenCalledTimes(1)
  })

  it('alerts the owner when Whop sent no email', async () => {
    const r = await ensurePublicBuyerRep({ id: 'pay_2', membership: { id: 'mem_2' } }, 'payment.succeeded')
    expect(r).toMatchObject({ ok: false, reason: 'no_email' })
    expect(alertOperator.mock.calls[0][0].title).toContain('no email')
  })

  it('alerts and throws on a failed create, so Whop retries', async () => {
    runOpsAction.mockResolvedValueOnce({ status: 500, body: { ok: false, error: 'create_failed' } })
    await expect(ensurePublicBuyerRep(pay, 'payment.succeeded')).rejects.toThrow('public buyer create failed')
    expect(alertOperator.mock.calls[0][0].severity).toBe('fatal')
  })
})
