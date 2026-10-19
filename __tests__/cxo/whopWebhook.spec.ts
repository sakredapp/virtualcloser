import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Records every reps update and webhook-event insert; nothing real is touched.
const updates: Array<{ table: string; patch: unknown }> = []
const inserts: Array<{ table: string; row: unknown }> = []
const rows: Record<string, unknown> = {}
function chain(table: string): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: null, error: null })
      if (prop === 'maybeSingle') return async () => ({ data: rows[table] ?? null, error: null })
      if (prop === 'update') return (patch: unknown) => { updates.push({ table, patch }); return new Proxy({}, handler) }
      if (prop === 'insert') return async (row: unknown) => { inserts.push({ table, row }); return { data: null, error: null } }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }))
const audit = vi.fn(async () => {})
vi.mock('@/lib/billing/auditLog', () => ({ audit }))
const provisionFromOnboardingPayment = vi.fn(async () => {})
vi.mock('@/lib/billing/provisionOnboarding', () => ({ provisionFromOnboardingPayment }))

import { verifyWhopWebhook } from '@/lib/billing/whop'
import { cxoMetadata, isCxoObject } from '@/lib/billing/whopEvents'

const SECRET = 'whsec_test_secret_value'
function sign(body: string, id = 'msg_1', ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64')
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` }
}
const hdr = (h: Record<string, string>) => (n: string) => h[n] ?? null

describe('verifyWhopWebhook', () => {
  const body = '{"type":"payment.succeeded","data":{}}'
  it('accepts a good signature and returns the webhook id', () => {
    expect(verifyWhopWebhook(body, hdr(sign(body)), SECRET)).toEqual({ ok: true, id: 'msg_1' })
  })
  it('rejects a wrong secret, a tampered body, a stale timestamp, missing headers and no secret', () => {
    expect(verifyWhopWebhook(body, hdr(sign(body, 'msg_1', undefined, 'other')), SECRET)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyWhopWebhook(body + ' ', hdr(sign(body)), SECRET)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyWhopWebhook(body, hdr(sign(body, 'msg_1', Math.floor(Date.now() / 1000) - 3600)), SECRET)).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(verifyWhopWebhook(body, hdr({}), SECRET)).toEqual({ ok: false, reason: 'missing_headers' })
    expect(verifyWhopWebhook(body, hdr(sign(body)), undefined)).toEqual({ ok: false, reason: 'no_secret' })
  })
})

describe('isCxoObject / cxoMetadata', () => {
  it('claims Suite CXO payments by metadata, kind or product, and nothing else', () => {
    expect(isCxoObject({ metadata: { app: 'suitecxo' } })).toBe(true)
    expect(isCxoObject({ metadata: { kind: 'cxo_build_fee', rep_id: 'r' } })).toBe(true)
    expect(isCxoObject({ product: { id: 'prod_3VrVQnPFhmgHT' } })).toBe(true)
    expect(isCxoObject({ metadata: { kind: 'vc_seat' }, product: { id: 'prod_other' } })).toBe(false)
    expect(isCxoObject({})).toBe(false)
  })
  it('reads metadata from the membership when the payment has none', () => {
    expect(cxoMetadata({ membership: { metadata: { kind: 'cxo_subscription', rep_id: 'rep_a' } } })).toMatchObject({ rep_id: 'rep_a' })
  })
})

describe('POST /api/webhooks/whop', () => {
  const ENV = process.env.WHOP_WEBHOOK_SECRET
  beforeEach(() => {
    process.env.WHOP_WEBHOOK_SECRET = SECRET
    updates.length = 0
    inserts.length = 0
    for (const k of Object.keys(rows)) delete rows[k]
    audit.mockClear()
    provisionFromOnboardingPayment.mockClear()
  })
  afterEach(() => {
    if (ENV === undefined) delete process.env.WHOP_WEBHOOK_SECRET
    else process.env.WHOP_WEBHOOK_SECRET = ENV
  })
  const send = async (event: unknown, headers?: Record<string, string>) => {
    const { NextRequest } = await import('next/server')
    const route = await import('@/app/api/webhooks/whop/route')
    const body = JSON.stringify(event)
    return route.POST(new NextRequest('https://www.suitecxo.com/api/webhooks/whop', { method: 'POST', headers: headers ?? sign(body), body }))
  }

  it('401 on a bad signature and 503 with no secret, writing nothing', async () => {
    const bad = await send({ type: 'payment.succeeded', data: {} }, { 'webhook-id': 'x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' })
    expect(bad.status).toBe(401)
    delete process.env.WHOP_WEBHOOK_SECRET
    expect((await send({ type: 'payment.succeeded', data: {} })).status).toBe(503)
    expect(updates).toEqual([])
    expect(inserts).toEqual([])
  })

  it('ignores a payment that is not Suite CXO', async () => {
    const res = await send({ type: 'payment.succeeded', data: { id: 'pay_vc', metadata: { kind: 'vc_seat' } } })
    expect((await res.json()).outcome).toBe('ignored')
    expect(updates).toEqual([])
    expect(inserts).toHaveLength(1)
  })

  it('a seat payment marks the client active with the membership', async () => {
    const res = await send({ type: 'payment.succeeded', data: { id: 'pay_1', total: 60, metadata: { kind: 'cxo_subscription', rep_id: 'rep_acme', app: 'suitecxo' }, membership: { id: 'mem_1' } } })
    expect((await res.json()).outcome).toBe('subscription_paid')
    expect(updates[0]).toMatchObject({ table: 'reps', patch: { billing_status: 'active', is_active: true, whop_membership_id: 'mem_1', whop_last_payment_id: 'pay_1' } })
  })

  it('a build-fee payment provisions the onboarding owner', async () => {
    await send({ type: 'payment.succeeded', data: { id: 'pay_2', metadata: { kind: 'cxo_build_fee', rep_id: 'rep_acme', onboarding_token: 'tok' } } })
    expect(provisionFromOnboardingPayment).toHaveBeenCalledWith({ onboardingToken: 'tok', repId: 'rep_acme', paymentId: 'pay_2' })
  })

  it('a comped client is never moved by membership churn', async () => {
    rows.reps = { billing_status: 'comped' }
    const res = await send({ type: 'membership.deactivated', data: { id: 'mem_1', metadata: { kind: 'cxo_subscription', rep_id: 'rep_acme' } } })
    expect((await res.json()).outcome).toBe('comped_unchanged')
    expect(updates).toEqual([])
  })
})
