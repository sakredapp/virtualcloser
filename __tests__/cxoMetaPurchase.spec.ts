import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { cxoPurchaseEvent, cxoPurchaseEventId, sendCxoPurchase } from '@/lib/billing/metaPurchase'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const env = { CXO_META_PIXEL_ID: '123456', CXO_META_CAPI_TOKEN: 'tok' }
const fbc = 'fb.1.1729600000000.AbCdEfGh123'
const fbp = 'fb.1.1729600000000.1234567890'
const pay = (md: Record<string, unknown> = {}) => ({
  id: 'pay_abc',
  user: { email: ' Owner@Example.com ', phone: '(555) 123-4567' },
  metadata: { app: 'suitecxo', ad_gpc: '0', ad_fbc: fbc, ad_fbp: fbp, ad_ua: 'UA/1', ad_url: 'https://suitecxo.com/start?utm_source=fb&fbclid=x', ...md },
})
const okFetch = () => vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

describe('CXO Meta Purchase (our own ads)', () => {
  it('does nothing and never errors when the pixel or token is not set', async () => {
    const f = okFetch()
    expect(await sendCxoPurchase(pay(), 50000, { env: {}, fetchImpl: f })).toBe('no_pixel')
    expect(await sendCxoPurchase(pay(), 50000, { env: { CXO_META_PIXEL_ID: '1' }, fetchImpl: f })).toBe('no_pixel')
    expect(f).not.toHaveBeenCalled()
  })

  it('sends nothing under Global Privacy Control', async () => {
    const f = okFetch()
    expect(await sendCxoPurchase(pay({ ad_gpc: '1' }), 50000, { env, fetchImpl: f })).toBe('gpc')
    expect(f).not.toHaveBeenCalled()
  })

  it('fails closed: no GPC signal on the checkout sends nothing', async () => {
    const f = okFetch()
    expect(await sendCxoPurchase(pay({ ad_gpc: undefined }), 50000, { env, fetchImpl: f })).toBe('gpc')
    expect(await sendCxoPurchase({ id: 'pay_x', metadata: { app: 'suitecxo', kind: 'cxo_build_fee' } }, 50000, { env, fetchImpl: f })).toBe('gpc')
    expect(await sendCxoPurchase(pay({ ad_gpc: 'yes' }), 50000, { env, fetchImpl: f })).toBe('gpc')
    expect(f).not.toHaveBeenCalled()
  })

  it('builds a deduplicable Purchase with hashed identity and no query string', () => {
    const e = cxoPurchaseEvent(pay(), 50000, () => 1_729_600_000_000) as Record<string, any>
    expect(e.event_name).toBe('Purchase')
    expect(e.event_id).toBe(cxoPurchaseEventId('pay_abc'))
    expect(e.event_id).toBe('cxo-pur-pay_abc')
    expect(e.event_source_url).toBe('https://suitecxo.com/start')
    expect(e.user_data.em).toEqual([sha('owner@example.com')])
    expect(e.user_data.ph).toEqual([sha('15551234567')])
    expect(e.user_data.fbc).toBe(fbc)
    expect(e.user_data.fbp).toBe(fbp)
    expect(e.custom_data).toEqual({ currency: 'USD', value: 500 })
    expect(JSON.stringify(e)).not.toContain('Owner@Example.com')
  })

  it('drops malformed click ids', () => {
    const e = cxoPurchaseEvent(pay({ ad_fbc: 'junk', ad_fbp: 'fb.1.x' }), 100) as Record<string, any>
    expect(e.user_data.fbc).toBeUndefined()
    expect(e.user_data.fbp).toBeUndefined()
  })

  it('posts to the pixel with the token in the body, not the URL', async () => {
    const f = okFetch()
    expect(await sendCxoPurchase(pay(), 50000, { env: { ...env, CXO_META_TEST_EVENT_CODE: 'TEST1' }, fetchImpl: f })).toBe('sent')
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/events')
    expect(url).not.toContain('tok')
    const body = JSON.parse(String(init.body))
    expect(body.access_token).toBe('tok')
    expect(body.test_event_code).toBe('TEST1')
    expect(body.data[0].event_id).toBe('cxo-pur-pay_abc')
  })

  it('returns failed (never throws) when Meta errors or the network fails', async () => {
    const bad = vi.fn(async () => new Response('no', { status: 400 })) as unknown as typeof fetch
    const boom = vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch
    expect(await sendCxoPurchase(pay(), 1, { env, fetchImpl: bad })).toBe('failed')
    expect(await sendCxoPurchase(pay(), 1, { env, fetchImpl: boom })).toBe('failed')
  })

  it('needs a payment id', async () => {
    expect(await sendCxoPurchase({ metadata: { ad_gpc: '0' } }, 1, { env, fetchImpl: okFetch() })).toBe('no_payment')
  })
})
