/**
 * Suite CXO hosts serve Suite CXO pages only; Virtual Closer hosts are untouched.
 *
 * The page list is read from app/ on disk, so a page added later is covered
 * without editing this file: it is closed on Suite CXO hosts until it is added
 * to lib/cxoRoutes.ts, and the "every page is classified" test fails until
 * someone decides which side it belongs on.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

vi.mock('@/lib/cxoRoutes', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cxoRoutes')>('@/lib/cxoRoutes')
  return { ...actual, cxoPathAllowed: vi.fn(actual.cxoPathAllowed), cxoHomeFor: vi.fn(actual.cxoHomeFor) }
})

import { middleware } from '@/middleware'
import { cxoHomeFor, cxoPathAllowed, isNonPagePath } from '@/lib/cxoRoutes'
import { signSession, SESSION_COOKIE_NAME } from '@/lib/client-auth'

/** Every page (and non-API route handler) in app/, as a concrete URL path. */
function pageRoutes(): string[] {
  const root = path.resolve(__dirname, '../../app')
  const out: string[] = []
  const walk = (dir: string, url: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (url === '' && e.name === 'api') continue
        if (e.name.startsWith('_') || e.name === 'components') continue
        // (group) folders add no URL segment; [param] gets a sample value.
        const seg = /^\(.*\)$/.test(e.name) ? '' : `/${e.name.replace(/^\[+\.{0,3}(.+?)\]+$/, 'sample-$1')}`
        walk(path.join(dir, e.name), url + seg)
      } else if (/^(page|route)\.(tsx?|jsx?)$/.test(e.name)) {
        out.push(url || '/')
      }
    }
  }
  walk(root, '')
  return Array.from(new Set(out)).sort()
}

const ROUTES = pageRoutes()
const PAGES = ROUTES.filter((r) => !isNonPagePath(r))

/** Pages that are Suite CXO's. Everything else on disk must be closed there. */
const OPEN_ON_CXO = new Set([
  '/', '/cxo', '/cxo/demo', '/cxo/request-access', '/login', '/logout', '/forgot-password', '/reset-password', '/set-password',
  '/privacy', '/terms', '/onboard/sample-token',
  '/dashboard', '/dashboard/inbox', '/dashboard/plan', '/dashboard/revenue', '/dashboard/pinnacle', '/dashboard/execs',
  '/dashboard/partners', '/dashboard/employees', '/dashboard/calendar', '/dashboard/meetings', '/dashboard/boards',
  '/dashboard/approvals', '/dashboard/work', '/dashboard/me', '/dashboard/settings', '/dashboard/settings/adoption',
  '/dashboard/integrations', '/dashboard/billing', '/dashboard/billing/account', '/dashboard/billing/team', '/dashboard/assistant',
  '/dashboard/analytics', '/dashboard/recordings', '/dashboard/accounting', '/dashboard/pipeline', '/dashboard/leads/sample-id', '/dashboard/projects', '/dashboard/projects/sample-id',
])
const isAdmin = (p: string) => p === '/admin' || p.startsWith('/admin/')
/** Handled by an older rule before the gate (Suite CXO demo redirect). */
const isDemo = (p: string) => p === '/demo' || p.startsWith('/demo/')

/** The Virtual Closer pages the owner named: none may open on a Suite CXO host. */
const NAMED_VC_PAGES = [
  '/dashboard/prospects', '/dashboard/prospects/sample-id', '/dashboard/sms', '/dashboard/dialer', '/dashboard/dialer/analytics',
  '/dashboard/dialer/appointment-setter', '/dashboard/dialer/appointment-setter/sample-id', '/dashboard/dialer/hours',
  '/dashboard/dialer/live-transfer', '/dashboard/dialer/receptionist', '/dashboard/dialer/workflows', '/dashboard/roleplay',
  '/dashboard/shifts', '/dashboard/org', '/dashboard/room/sample-scope',
  '/dashboard/team', '/dashboard/team/goals', '/dashboard/feedback', '/dashboard/trello', '/dashboard/wavv', '/dashboard/contacts',
  '/dashboard/plaud', '/brain', '/welcome', '/roleplay', '/roleplay/floor', '/u/sample-memberSlug', '/offer', '/offer/enterprise',
]

let cxoCookie = ''
let vcCookie = ''
beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'host-routes-test-secret')
  cxoCookie = `${SESSION_COOKIE_NAME}=${await signSession('harbor', { memberId: 'm1', hosts: ['harbor'] })}`
  vcCookie = `${SESSION_COOKIE_NAME}=${await signSession('acme', { memberId: 'm2', hosts: ['acme'] })}`
})
beforeEach(() => {
  vi.mocked(cxoPathAllowed).mockClear()
  vi.mocked(cxoHomeFor).mockClear()
})

function hit(host: string, p: string, opts: { cookie?: string; method?: string } = {}) {
  const headers: Record<string, string> = { host }
  if (opts.cookie) headers.cookie = opts.cookie
  return middleware(new NextRequest(`https://${host}${p}`, { headers, method: opts.method ?? 'GET' }))
}
const passed = (res: Response) => res.status === 200 && !res.headers.get('location')

describe('the page list on disk', () => {
  it('finds the pages', () => {
    expect(PAGES.length).toBeGreaterThan(60)
    for (const p of ['/dashboard/dialer', '/dashboard/boards', '/brain', '/cxo/demo', '/roleplay/floor']) expect(PAGES, p).toContain(p)
  })

  it('has every page classified: Suite CXO, operator console, or closed on Suite CXO', () => {
    for (const p of OPEN_ON_CXO) expect(PAGES, `${p} is listed as open but no such page exists`).toContain(p)
    for (const p of NAMED_VC_PAGES) expect(PAGES, `${p} is named but no such page exists`).toContain(p)
    for (const p of PAGES) {
      const open = cxoPathAllowed(p)
      if (OPEN_ON_CXO.has(p) || isAdmin(p)) expect(open, `${p} should be open on Suite CXO`).toBe(true)
      else expect(open, `${p} is not a Suite CXO page: it must stay closed there (or be added to lib/cxoRoutes.ts and this list on purpose)`).toBe(false)
    }
  })

  it('closes a page that does not exist yet', () => {
    for (const p of ['/dashboard/some-new-page', '/dashboard/some-new-page/x', '/brand-new', '/dashboardx', '/dashboard/boardsx', '/cxox']) {
      expect(cxoPathAllowed(p), p).toBe(false)
    }
  })

  it('never gates API routes, framework files or static files', () => {
    for (const p of ['/api/sms/send', '/api/roleplay/x', '/api/webhooks/stripe', '/_next/data/x.json', '/brands/cxo/logo.png', '/logo.png',
      '/favicon.ico', '/robots.txt', '/sitemap.xml', '/.well-known/apple-app-site-association', '/.well-known/assetlinks.json', '/manifest.webmanifest']) {
      expect(cxoPathAllowed(p), p).toBe(true)
    }
  })

  it('is not fooled by case, slashes or dot segments', () => {
    for (const p of ['/Dashboard/Dialer', '/dashboard//dialer', '/dashboard/dialer/', '/dashboard/boards/../dialer', '/BRAIN', '/dashboard/dialer.png/x']) {
      expect(cxoPathAllowed(p), p).toBe(false)
    }
    expect(cxoPathAllowed('/Dashboard/Boards/')).toBe(true)
  })

  it('opens /welcome only for the emailed sign-in link', () => {
    expect(cxoPathAllowed('/welcome')).toBe(false)
    expect(cxoPathAllowed('/welcome', { hasToken: true })).toBe(true)
    expect(cxoPathAllowed('/brain', { hasToken: true })).toBe(false)
  })
})

describe('a company host on Suite CXO (harbor.suitecxo.com), signed in', () => {
  it('sends every Virtual Closer page to the Suite CXO home', async () => {
    for (const p of PAGES.filter((x) => !OPEN_ON_CXO.has(x) && !isAdmin(x) && !isDemo(x))) {
      const res = await hit('harbor.suitecxo.com', p, { cookie: cxoCookie })
      expect(res.status, p).toBe(307)
      expect(res.headers.get('location'), p).toBe('https://harbor.suitecxo.com/dashboard')
    }
  })

  it('covers each page the owner named', async () => {
    for (const p of NAMED_VC_PAGES) {
      const res = await hit('harbor.suitecxo.com', p, { cookie: cxoCookie })
      expect(res.headers.get('location'), p).toBe('https://harbor.suitecxo.com/dashboard')
    }
  })

  it('drops the query string and refuses a form post to a closed page', async () => {
    const res = await hit('harbor.suitecxo.com', '/dashboard/dialer?tab=x&next=https://evil.example', { cookie: cxoCookie })
    expect(res.headers.get('location')).toBe('https://harbor.suitecxo.com/dashboard')
    const post = await hit('harbor.suitecxo.com', '/dashboard/org', { cookie: cxoCookie, method: 'POST' })
    expect(post.status).toBe(404)
    expect(post.headers.get('location')).toBeNull()
  })

  it('serves every Suite CXO page', async () => {
    for (const p of OPEN_ON_CXO) {
      const res = await hit('harbor.suitecxo.com', p, { cookie: cxoCookie })
      expect(passed(res), p).toBe(true)
      expect(res.headers.get('x-middleware-request-x-brand'), p).toBe('cxo')
    }
  })

  it('leaves API calls alone, the old ones included', async () => {
    for (const p of ['/api/today', '/api/sms/send', '/api/roleplay/sessions', '/api/pipeline']) {
      expect(passed(await hit('harbor.suitecxo.com', p, { cookie: cxoCookie })), p).toBe(true)
      expect(passed(await hit('harbor.suitecxo.com', p, { cookie: cxoCookie, method: 'POST' })), p).toBe(true)
    }
  })

  it('keeps the emailed sign-in link working and the demo redirect as it was', async () => {
    expect(passed(await hit('harbor.suitecxo.com', '/welcome?token=abc', { cookie: cxoCookie }))).toBe(true)
    expect((await hit('harbor.suitecxo.com', '/demo', { cookie: cxoCookie })).headers.get('location')).toBe('https://harbor.suitecxo.com/cxo/demo')
  })
})

describe('a company host on Suite CXO, signed out', () => {
  it('never shows a Virtual Closer page: public ones go home, the rest to login like any page', async () => {
    for (const p of NAMED_VC_PAGES) {
      const res = await hit('harbor.suitecxo.com', p)
      expect(res.status, p).toBe(307)
      expect(res.headers.get('location'), p).toBe('https://harbor.suitecxo.com/dashboard')
    }
    const home = await hit('harbor.suitecxo.com', '/dashboard')
    expect(home.headers.get('location')).toBe('https://suitecxo.com/login?next=https%3A%2F%2Fharbor.suitecxo.com%2Fdashboard')
  })
})

describe('the Suite CXO apex and previews', () => {
  it('send Virtual Closer pages to the Suite CXO site', async () => {
    for (const host of ['suitecxo.com', 'www.suitecxo.com', 'suitecxo-git-feat-x-sakred-health.vercel.app']) {
      for (const p of ['/brain', '/welcome', '/roleplay', '/roleplay/floor', '/u/someone', '/dashboard/dialer', '/dashboard/sms']) {
        const res = await hit(host, p)
        expect(res.status, host + p).toBe(307)
        expect(res.headers.get('location'), host + p).toBe(`https://${host}/`)
      }
    }
  })

  it('keep the site, sign-in, legal and setup pages', async () => {
    for (const p of ['/cxo', '/cxo/demo', '/cxo/request-access', '/login', '/forgot-password', '/reset-password', '/set-password', '/privacy', '/terms', '/onboard/tok', '/admin', '/admin/clients']) {
      expect(passed(await hit('suitecxo.com', p)), p).toBe(true)
    }
    expect((await hit('suitecxo.com', '/')).headers.get('x-middleware-rewrite')).toBe('https://suitecxo.com/cxo')
    expect((await hit('suitecxo.com', '/offer')).headers.get('location')).toBe('https://suitecxo.com/cxo')
    expect((await hit('suitecxo.com', '/dashboard/boards')).headers.get('location')).toBe('https://suitecxo.com/login?next=%2Fdashboard%2Fboards')
  })

  it('has no roleplay product host', async () => {
    const res = await hit('roleplay.suitecxo.com', '/')
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect((await hit('roleplay.suitecxo.com', '/floor')).headers.get('location')).toBe('https://roleplay.suitecxo.com/dashboard')
  })
})

describe('Virtual Closer hosts are exactly as before', () => {
  it('a signed-in company host serves every page in the repo and never consults the Suite CXO list', async () => {
    for (const p of PAGES) {
      const res = await hit('acme.virtualcloser.com', p, { cookie: vcCookie })
      expect(passed(res), p).toBe(true)
      expect(res.headers.get('x-middleware-rewrite'), p).toBeNull()
      expect(res.headers.get('x-middleware-request-x-brand'), p).toBe('virtualcloser')
      expect(res.headers.get('x-middleware-request-x-pathname'), p).toBe(p)
    }
    expect(cxoPathAllowed).not.toHaveBeenCalled()
    expect(cxoHomeFor).not.toHaveBeenCalled()
  })

  it('a signed-out company host sends private pages to login and serves public ones', async () => {
    const PUBLIC = ['/', '/offer', '/demo', '/login', '/logout', '/admin', '/cxo']
    const isPublic = (p: string) => PUBLIC.some((x) => p === x || (x !== '/' && p.startsWith(`${x}/`)))
    for (const p of PAGES) {
      const res = await hit('acme.virtualcloser.com', p)
      if (isPublic(p)) expect(passed(res), p).toBe(true)
      else expect(res.headers.get('location'), p).toBe(`https://virtualcloser.com/login?next=${encodeURIComponent(`https://acme.virtualcloser.com${p}`)}`)
    }
    expect(cxoPathAllowed).not.toHaveBeenCalled()
  })

  it('the apex, www, localhost and other previews serve every page; /dashboard goes to login', async () => {
    for (const host of ['virtualcloser.com', 'www.virtualcloser.com', 'localhost:3000', 'preview.vercel.app']) {
      for (const p of PAGES) {
        const res = await hit(host, p)
        if (p === '/dashboard' || p.startsWith('/dashboard/')) {
          expect(res.headers.get('location'), host + p).toBe(`https://${host}/login?next=${encodeURIComponent(p)}`)
        } else {
          expect(passed(res), host + p).toBe(true)
          expect(res.headers.get('x-middleware-rewrite'), host + p).toBeNull()
        }
      }
    }
    expect(cxoPathAllowed).not.toHaveBeenCalled()
  })

  it('form posts to the old pages still go through', async () => {
    for (const p of ['/dashboard/org', '/dashboard/room/managers', '/dashboard/dialer', '/brain']) {
      expect(passed(await hit('acme.virtualcloser.com', p, { cookie: vcCookie, method: 'POST' })), p).toBe(true)
    }
    expect(cxoPathAllowed).not.toHaveBeenCalled()
  })

  it('the roleplay product host still serves the tool at its root', async () => {
    expect((await hit('roleplay.virtualcloser.com', '/')).headers.get('x-middleware-rewrite')).toBe('https://roleplay.virtualcloser.com/roleplay')
    expect((await hit('roleplay.virtualcloser.com', '/floor')).headers.get('x-middleware-rewrite')).toBe('https://roleplay.virtualcloser.com/roleplay/floor')
    expect(passed(await hit('roleplay.virtualcloser.com', '/api/roleplay/x'))).toBe(true)
    expect(cxoPathAllowed).not.toHaveBeenCalled()
  })
})
