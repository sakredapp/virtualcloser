import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CXO_WHOP_PIXEL_ACCOUNT_ID,
  cxoLeadEvent,
  cxoPixelHostAllowed,
  cxoPixelPathAllowed,
  cxoWhopPixelSnippet,
  safeProspectId,
} from '@/lib/whopPixel'
import { cxoRegistrationEvent, sendCxoRegistrationEvent, whopVisitorIdFromCookie } from '@/lib/billing/whopServerEvents'
import { NATIVE_UA_MARKER } from '@/lib/nativeApp'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('Whop Pixel: where it loads', () => {
  it('loads on the public site only, in a browser', () => {
    expect(cxoPixelHostAllowed('www.suitecxo.com', 'Mozilla/5.0')).toBe(true)
    expect(cxoPixelHostAllowed('suitecxo.com', 'Mozilla/5.0')).toBe(true)
    expect(cxoPixelHostAllowed('pinnacle.suitecxo.com', 'Mozilla/5.0')).toBe(false)
    expect(cxoPixelHostAllowed('mike.suitecxo.com', 'Mozilla/5.0')).toBe(false)
    expect(cxoPixelHostAllowed('suitecxo-git-x.vercel.app', 'Mozilla/5.0')).toBe(false)
    expect(cxoPixelHostAllowed('app.virtualcloser.com', 'Mozilla/5.0')).toBe(false)
    expect(cxoPixelHostAllowed('www.suitecxo.com', `Mozilla/5.0 ${NATIVE_UA_MARKER}`)).toBe(false)
  })

  it('fires on the selling pages', () => {
    for (const p of ['/', '/cxo', '/pricing', '/cxo/request-access', '/cxo/sizing', '/cxo/demo', '/login', '/forgot-password', '/login/'])
      expect(cxoPixelPathAllowed(p), p).toBe(true)
  })

  it('the privacy page names Whop and its cookie', () => {
    const p = read('app/privacy/CxoPrivacy.tsx')
    expect(p).toContain("item('Whop',")
    expect(p).not.toContain('We do not use advertising or third-party analytics cookies')
  })

  it('never fires inside the app or on a page whose URL carries a token', () => {
    for (const p of ['/dashboard', '/dashboard/ciao', '/admin', '/api/onboard/x/sign', '/onboard/tok_secret', '/reset-password', '/set-password', '/welcome', '/u/jane', '/logout', '/privacy', '/terms', '/support', '/loginx', '/cxo-anything'])
      expect(cxoPixelPathAllowed(p), p).toBe(false)
  })
})

describe('Whop Pixel: the snippet', () => {
  it('is the documented snippet, scoped to the Suite CXO business', () => {
    const s = cxoWhopPixelSnippet()
    expect(CXO_WHOP_PIXEL_ACCOUNT_ID).toBe('biz_SPZ04AFkJaua4I')
    expect(s).toContain('(window,document,"script","https://t.whop.tw","whop");')
    expect(s).toContain('whop.setScope("biz_SPZ04AFkJaua4I");')
    expect(s.trim().endsWith('whop.track("page");')).toBe(true)
    // Its own route tracking, form reading and URL reading are off; WhopPixel.tsx fires page on allowed paths only.
    expect(s).toContain('whop.c=Object.assign({},whop.c,{autoPage:false,forms:false,urlIdentity:false});')
  })

  it('never sends purchase from our code', () => {
    for (const f of ['lib/whopPixel.ts', 'lib/whopPixelClient.ts', 'app/components/cxo/WhopPixel.tsx', 'app/cxo/request-access/LeadPixel.tsx', 'lib/billing/whopServerEvents.ts']) {
      expect(read(f), f).not.toMatch(/track\(\s*['"]purchase['"]|event_name:\s*['"]purchase['"]/)
    }
  })

  it('is mounted by the layout only behind the host check', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/cxoPixelHostAllowed\(/)
    expect(layout).toMatch(/\{pixel && <WhopPixel snippet=\{cxoWhopPixelSnippet\(\)\} \/>\}/)
    expect(read('app/components/cxo/WhopPixel.tsx')).toMatch(/strategy="afterInteractive"/)
  })
})

describe('Whop Pixel: lead', () => {
  it('uses our prospect id as the event_id, plus email and name', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(cxoLeadEvent(id, { email: ' a@example.com ', name: 'Pat Doe' })).toEqual({ event_id: `cxo_lead_${id}`, email: 'a@example.com', name: 'Pat Doe' })
    expect(cxoLeadEvent(id)).toEqual({ event_id: `cxo_lead_${id}` })
    expect(safeProspectId(id.toUpperCase())).toBe(id)
    expect(safeProspectId('<script>')).toBeNull()
    expect(safeProspectId(undefined)).toBeNull()
  })
})

describe('Whop server event: complete_registration', () => {
  const base = { repId: 'rep_1', email: 'owner@example.com', name: 'Pat  Q Doe', ip: '203.0.113.1', userAgent: 'UA', at: new Date('2026-10-22T12:00:00Z') }

  it('builds one event per company, with plain-text contact and no token in the URL', () => {
    const ev = cxoRegistrationEvent({ ...base, whopVisitorId: 'wuid_abc123' })
    expect(ev).toEqual({
      account_id: 'biz_SPZ04AFkJaua4I',
      event_name: 'complete_registration',
      event_id: 'cxo_reg_rep_1',
      event_time: '2026-10-22T12:00:00.000Z',
      action_source: 'website',
      url: 'https://www.suitecxo.com/onboard',
      user: { external_id: 'cxo_rep_rep_1', email: 'owner@example.com', first_name: 'Pat', last_name: 'Q Doe', anonymous_id: 'wuid_abc123' },
      context: { ip_address: '203.0.113.1', user_agent: 'UA' },
    })
    expect(cxoRegistrationEvent({ repId: 'r', whopVisitorId: 'not a wuid' }).user).toEqual({ external_id: 'cxo_rep_r' })
  })

  it('reads the visitor id from the cookie header', () => {
    expect(whopVisitorIdFromCookie('a=1; _wuid=wuid_k3j9x2m1; b=2')).toBe('wuid_k3j9x2m1')
    expect(whopVisitorIdFromCookie('_wuid=evil;')).toBeNull()
    expect(whopVisitorIdFromCookie(null)).toBeNull()
  })

  it('posts to the Events API, and never throws', async () => {
    const prev = process.env.WHOP_API_KEY
    process.env.WHOP_API_KEY = 'test_key'
    try {
      const f = vi.fn(async () => new Response('{}', { status: 200 }))
      expect(await sendCxoRegistrationEvent(base, f as unknown as typeof fetch)).toEqual({ ok: true, status: 200 })
      const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.whop.com/api/v1/events')
      expect(JSON.parse(String(init.body)).event_name).toBe('complete_registration')
      const boom = vi.fn(async () => { throw new Error('down') })
      expect(await sendCxoRegistrationEvent(base, boom as unknown as typeof fetch)).toEqual({ ok: false })
      delete process.env.WHOP_API_KEY
      expect(await sendCxoRegistrationEvent(base, f as unknown as typeof fetch)).toEqual({ ok: false, skipped: 'no_key' })
    } finally {
      if (prev === undefined) delete process.env.WHOP_API_KEY
      else process.env.WHOP_API_KEY = prev
    }
  })

  it('is sent from the sign route for Suite CXO companies only', () => {
    const route = read('app/api/onboard/[token]/sign/route.ts')
    expect(route).toMatch(/brand === 'cxo'/)
    expect(route).toMatch(/sendCxoRegistrationEvent\(/)
  })
})
