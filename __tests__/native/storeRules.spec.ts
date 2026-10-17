/**
 * Inside the Suite CXO store app: no billing, no pricing, and Connect Google
 * goes through the phone's browser with a short pass. In a browser, and on
 * Virtual Closer hosts, nothing changes.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { signSession, verifySession, SESSION_COOKIE_NAME } from '@/lib/client-auth'
import { isNativeAppUA, isPurchaseHref, nativeBlockFor, stripPurchaseNav, NATIVE_UA_MARKER } from '@/lib/nativeApp'
import { appReturnLink, NATIVE_TICKET_TTL_MS, signNativeTicket, ticketFromState, verifyNativeTicket } from '@/lib/nativeTicket'
import { resolveDeepLink } from '../../native/src/host'

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const APP = `Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ${NATIVE_UA_MARKER}/1.0`

let cookie = ''
beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'store-rules-test-secret')
  cookie = `${SESSION_COOKIE_NAME}=${await signSession('harbor', { memberId: 'm1', hosts: ['harbor'] })}`
})

function hit(host: string, p: string, opts: { ua?: string; method?: string; signedIn?: boolean } = {}) {
  const headers: Record<string, string> = { host, 'user-agent': opts.ua ?? SAFARI }
  if (opts.signedIn !== false) headers.cookie = cookie
  return middleware(new NextRequest(`https://${host}${p}`, { headers, method: opts.method ?? 'GET' }))
}
const passed = (res: Response) => res.status === 200 && !res.headers.get('location')

const BILLING_PAGES = ['/dashboard/billing', '/dashboard/billing/account', '/dashboard/billing/team', '/dashboard/billing?plan=x']
const BILLING_CALLS = ['/api/billing/subscribe', '/api/billing/portal', '/api/billing/setup-intent', '/api/billing/overflow', '/api/billing/change-request', '/api/billing/agent-payer', '/api/checkout', '/api/checkout/session']

describe('the app marker', () => {
  it('is only on the app', () => {
    expect(isNativeAppUA(APP)).toBe(true)
    expect(isNativeAppUA(SAFARI)).toBe(false)
    expect(isNativeAppUA(null)).toBe(false)
    expect(isNativeAppUA('')).toBe(false)
  })

  it('matches the user agent the app is built with', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cfg = fs.readFileSync(path.resolve(__dirname, '../../native/capacitor.config.ts'), 'utf8')
    expect(cfg).toContain(`appendUserAgent: '${NATIVE_UA_MARKER}/`)
  })

  it('names what is closed', () => {
    expect(nativeBlockFor('/dashboard/billing/account', { gatewayHost: false })).toBe('purchase-page')
    expect(nativeBlockFor('/Dashboard//Billing/', { gatewayHost: false })).toBe('purchase-page')
    expect(nativeBlockFor('/dashboard/billingx', { gatewayHost: false })).toBeNull()
    expect(nativeBlockFor('/api/billing/subscribe', { gatewayHost: false })).toBe('purchase-api')
    expect(nativeBlockFor('/api/billing/webhook', { gatewayHost: true })).toBeNull()
    expect(nativeBlockFor('/', { gatewayHost: true })).toBe('sales-page')
    expect(nativeBlockFor('/', { gatewayHost: false })).toBeNull()
    expect(nativeBlockFor('/cxo/demo', { gatewayHost: true })).toBeNull()
    expect(nativeBlockFor('/dashboard/settings/plan', { gatewayHost: false })).toBeNull()
  })

  it('takes billing and upgrades out of the menu, and nothing else', () => {
    const nav = {
      tabs: [
        { href: '/dashboard', label: 'Today' },
        { href: '/dashboard/settings', label: 'Settings', children: [{ href: '/dashboard/integrations', label: 'Integrations' }, { href: '/dashboard/billing/account', label: 'Billing' }] },
        { href: '/dashboard/billing', label: 'Billing' },
      ],
      lockedAddons: [{ key: 'x' }],
      activeAddonKeys: ['a'],
    }
    const out = stripPurchaseNav(nav)
    expect(out.tabs.map((t) => t.href)).toEqual(['/dashboard', '/dashboard/settings'])
    expect(out.tabs[1].children?.map((c) => c.href)).toEqual(['/dashboard/integrations'])
    expect(out.lockedAddons).toEqual([])
    expect(out.activeAddonKeys).toEqual(['a'])
    expect(nav.tabs).toHaveLength(3)
    expect(isPurchaseHref('/dashboard/settings')).toBe(false)
  })
})

describe('inside the store app, on a Suite CXO host', () => {
  it('sends every billing page to the plain note', async () => {
    for (const p of BILLING_PAGES) {
      const res = await hit('harbor.suitecxo.com', p, { ua: APP })
      expect(res.status, p).toBe(307)
      expect(res.headers.get('location'), p).toBe('https://harbor.suitecxo.com/dashboard/settings/plan')
    }
    expect((await hit('harbor.suitecxo.com', '/dashboard/billing', { ua: APP, method: 'POST' })).status).toBe(404)
  })

  it('refuses purchase calls, but not the payment webhook', async () => {
    for (const p of BILLING_CALLS) {
      for (const method of ['GET', 'POST']) {
        const res = await hit('harbor.suitecxo.com', p, { ua: APP, method })
        expect(res.status, `${method} ${p}`).toBe(403)
        expect(await res.json()).toEqual({ error: 'Plans are managed on the web.' })
      }
    }
    expect(passed(await hit('suitecxo.com', '/api/billing/webhook', { ua: APP, method: 'POST', signedIn: false }))).toBe(true)
  })

  it('shows sign-in, not the pricing page', async () => {
    for (const p of ['/', '/cxo', '/cxo/request-access', '/offer']) {
      const res = await hit('suitecxo.com', p, { ua: APP, signedIn: false })
      expect(res.headers.get('location'), p).toBe('https://suitecxo.com/login')
    }
  })

  it('serves the note and the rest of the app', async () => {
    for (const p of ['/dashboard/settings/plan', '/dashboard', '/dashboard/settings', '/dashboard/integrations', '/dashboard/inbox', '/api/today', '/api/native/google-ticket']) {
      expect(passed(await hit('harbor.suitecxo.com', p, { ua: APP })), p).toBe(true)
    }
    for (const p of ['/login', '/cxo/demo', '/privacy', '/terms', '/reset-password', '/api/google/oauth/start?ticket=x', '/api/google/oauth/callback?code=x']) {
      expect(passed(await hit('suitecxo.com', p, { ua: APP, signedIn: false })), p).toBe(true)
    }
  })

  it('the note has no link, price or button', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/settings/plan/page.tsx'), 'utf8')
    const body = src.slice(src.indexOf('return ('))
    expect(body).not.toMatch(/<a\b|<Link\b|href=|<button\b|https?:\/\/|\$\d|suitecxo\.com|per month|upgrade|subscribe|buy/i)
  })
})

describe('in a browser, nothing changes', () => {
  it('Suite CXO billing calls and the site are served as before', async () => {
    for (const p of BILLING_CALLS) {
      expect(passed(await hit('harbor.suitecxo.com', p)), p).toBe(true)
      expect(passed(await hit('harbor.suitecxo.com', p, { method: 'POST' })), p).toBe(true)
    }
    // The billing pages are Virtual Closer's weekly dialer plan: closed on a
    // Suite CXO host (lib/cxoRoutes.ts), so a browser lands on the app home.
    for (const p of BILLING_PAGES) {
      const res = await hit('harbor.suitecxo.com', p)
      expect(res.status, p).toBe(307)
      expect(res.headers.get('location'), p).toBe('https://harbor.suitecxo.com/dashboard')
    }
    expect((await hit('suitecxo.com', '/', { signedIn: false })).headers.get('x-middleware-rewrite')).toBe('https://suitecxo.com/cxo')
    expect(passed(await hit('suitecxo.com', '/cxo', { signedIn: false }))).toBe(true)
    expect(passed(await hit('suitecxo.com', '/cxo/request-access', { signedIn: false }))).toBe(true)
  })

  it('Virtual Closer hosts ignore the marker entirely', async () => {
    const vc = `${SESSION_COOKIE_NAME}=${await signSession('acme', { memberId: 'm2', hosts: ['acme'] })}`
    for (const p of [...BILLING_PAGES.slice(0, 3), ...BILLING_CALLS]) {
      const res = await middleware(new NextRequest(`https://acme.virtualcloser.com${p}`, { headers: { host: 'acme.virtualcloser.com', cookie: vc, 'user-agent': APP } }))
      expect(passed(res), p).toBe(true)
    }
    for (const p of ['/', '/offer']) {
      const res = await middleware(new NextRequest(`https://virtualcloser.com${p}`, { headers: { host: 'virtualcloser.com', 'user-agent': APP } }))
      expect(passed(res), p).toBe(true)
    }
  })
})

describe('the Connect Google pass', () => {
  const who = { slug: 'harbor', memberId: '0b1c2d3e-0000-4000-8000-000000000001', home: 'dana' }

  it('round-trips and names the member', () => {
    const t = signNativeTicket(who, 1_000)
    expect(verifyNativeTicket(t, 2_000)).toEqual({ ...who, exp: 1_000 + NATIVE_TICKET_TTL_MS })
    expect(verifyNativeTicket(signNativeTicket({ slug: 'harbor', memberId: null, home: 'harbor' }))?.memberId).toBeNull()
  })

  it('takes ids with an underscore', () => {
    expect(verifyNativeTicket(signNativeTicket({ slug: 'acme', memberId: 'mem_acme_owner', home: 'acme' }))?.memberId).toBe('mem_acme_owner')
  })

  it('expires after ten minutes', () => {
    const t = signNativeTicket(who, 1_000)
    expect(verifyNativeTicket(t, 1_000 + NATIVE_TICKET_TTL_MS - 1)).not.toBeNull()
    expect(verifyNativeTicket(t, 1_000 + NATIVE_TICKET_TTL_MS + 1)).toBeNull()
  })

  it('rejects anything altered, empty or signed with another secret', () => {
    const t = signNativeTicket(who)
    const [payload, sig] = t.split('~')
    const other = Buffer.from('other.m.other.99999999999999', 'utf8').toString('base64url')
    for (const bad of [null, '', 'x', `${payload}~`, `~${sig}`, `${other}~${sig}`, `${payload}~${sig}x`, `${t}~x`, 'a'.repeat(700)]) {
      expect(verifyNativeTicket(bad), String(bad)).toBeNull()
    }
    vi.stubEnv('SESSION_SECRET', 'a-different-secret')
    expect(verifyNativeTicket(t)).toBeNull()
    vi.stubEnv('SESSION_SECRET', 'store-rules-test-secret')
    expect(verifyNativeTicket(t)).not.toBeNull()
  })

  it('is never a session, and a session is never a pass', async () => {
    const t = signNativeTicket(who)
    expect(await verifySession(t)).toBeNull()
    expect(await verifySession(t.replace('~', '.'))).toBeNull()
    const session = await signSession('harbor', { memberId: who.memberId, hosts: ['dana'] })
    expect(verifyNativeTicket(session)).toBeNull()
    expect(verifyNativeTicket(session.replace('.', '~'))).toBeNull()
  })

  it('refuses input that could break the state format', () => {
    for (const bad of ['a:b', 'a|b', 'a.b', 'a~b', 'a b']) {
      expect(() => signNativeTicket({ slug: bad, memberId: null, home: 'x' }), bad).toThrow()
      expect(() => signNativeTicket({ slug: 'x', memberId: bad, home: 'x' }), bad).toThrow()
    }
  })

  it('survives the trip through the OAuth state', () => {
    const t = signNativeTicket(who)
    expect(t).not.toMatch(/[:|]/)
    const state = `rep-1:${who.memberId}:nonce123:add|ret=${encodeURIComponent('/dashboard/calendar')}|app=${t}`
    const back = new URL(`https://suitecxo.com/cb?state=${encodeURIComponent(state)}`).searchParams.get('state')
    expect(ticketFromState(back)).toBe(t)
    expect(verifyNativeTicket(ticketFromState(back))?.home).toBe('dana')
    expect(ticketFromState('rep-1:m:nonce')).toBeNull()
    expect(ticketFromState('rep-1:m:nonce:add|ret=%2Fdashboard')).toBeNull()
    expect(ticketFromState(null)).toBeNull()
  })

  it('hands the result back to a link the app opens on the right company', () => {
    const link = appReturnLink('dana', '/dashboard/calendar?gcal=connected')
    expect(link.startsWith('suitecxo://open?')).toBe(true)
    expect(resolveDeepLink(link)).toEqual({ kind: 'open', url: 'https://dana.suitecxo.com/dashboard/calendar?gcal=connected' })
  })
})
