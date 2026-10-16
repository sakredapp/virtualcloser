/**
 * Search / AI-engine rules: only the public Suite CXO site is indexable, and
 * on it only the marketing pages. Company hosts, previews and roleplay are not.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import {
  AI_AND_SEARCH_BOTS,
  CXO_SITEMAP_PATHS,
  cxoJsonLd,
  cxoLlmsTxt,
  isCxoMarketingHost,
  robotsFor,
  shouldNoindex,
  sitemapFor,
} from '@/lib/seo'
import { cxoPathAllowed } from '@/lib/cxoRoutes'
import { CXO_PRICE_PER_PERSON } from '@/lib/cxoSite'

beforeAll(() => {
  vi.stubEnv('SESSION_SECRET', 'seo-test-secret')
})

function hit(host: string, p: string) {
  return middleware(new NextRequest(`https://${host}${p}`, { headers: { host } }))
}

describe('which host is the public site', () => {
  it('is the apex and www only', () => {
    expect(isCxoMarketingHost('www.suitecxo.com')).toBe(true)
    expect(isCxoMarketingHost('suitecxo.com:443')).toBe(true)
    for (const h of ['mike.suitecxo.com', 'pinnacle.suitecxo.com', 'spence.suitecxo.com', 'suitecxo-git-x-sakred.vercel.app', 'localhost:3000', 'roleplay.virtualcloser.com', '', null]) {
      expect(isCxoMarketingHost(h), String(h)).toBe(false)
    }
  })
})

describe('robots.txt', () => {
  it('opens the public site to search and AI bots, with the sitemap', () => {
    const r = robotsFor('www.suitecxo.com')
    expect(r.sitemap).toBe('https://www.suitecxo.com/sitemap.xml')
    const named = r.rules.find((x) => Array.isArray(x.userAgent))!
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Bingbot']) {
      expect(AI_AND_SEARCH_BOTS as readonly string[]).toContain(bot)
      expect(named.userAgent).toContain(bot)
    }
    for (const rule of r.rules) {
      expect(rule.allow).toBe('/')
      expect(rule.disallow).toEqual(expect.arrayContaining(['/dashboard', '/admin', '/api/']))
    }
    expect(r.rules.some((x) => x.userAgent === '*')).toBe(true)
  })

  it('closes company hosts, previews and roleplay entirely, with no sitemap', () => {
    for (const h of ['mike.suitecxo.com', 'pinnacle.suitecxo.com', 'suitecxo.vercel.app', 'roleplay.virtualcloser.com', 'localhost']) {
      const r = robotsFor(h)
      expect(r.sitemap, h).toBeUndefined()
      expect(r.rules, h).toEqual([{ userAgent: '*', disallow: '/' }])
    }
  })
})

describe('sitemap', () => {
  it('lists the marketing pages on www and nothing anywhere else', () => {
    const urls = sitemapFor('www.suitecxo.com').map((e) => e.url)
    expect(urls).toEqual([
      'https://www.suitecxo.com/',
      'https://www.suitecxo.com/cxo/request-access',
      'https://www.suitecxo.com/privacy',
      'https://www.suitecxo.com/terms',
    ])
    expect(sitemapFor('mike.suitecxo.com')).toEqual([])
    expect(sitemapFor('roleplay.virtualcloser.com')).toEqual([])
  })

  it('only lists pages that exist, are open on Suite CXO and are indexable', () => {
    for (const p of CXO_SITEMAP_PATHS) {
      expect(cxoPathAllowed(p), p).toBe(true)
      expect(shouldNoindex('www.suitecxo.com', p), p).toBe(false)
      const file = p === '/' ? 'app/cxo/page.tsx' : `app${p}/page.tsx`
      expect(fs.existsSync(path.resolve(__dirname, '../..', file)), file).toBe(true)
    }
  })
})

describe('noindex', () => {
  it('keeps app, sign-in and demo pages on www out of the index', () => {
    for (const p of ['/login', '/login?next=x', '/dashboard', '/dashboard/boards', '/admin/login', '/cxo/demo', '/cxo/demo/', '/set-password', '/onboard/abc', '/api/x']) {
      expect(shouldNoindex('www.suitecxo.com', p), p).toBe(true)
    }
    for (const p of ['/', '/cxo', '/cxo/request-access', '/privacy', '/terms', '/robots.txt', '/sitemap.xml', '/llms.txt']) {
      expect(shouldNoindex('www.suitecxo.com', p), p).toBe(false)
    }
  })
  it('marks every page on company hosts, previews and roleplay', () => {
    for (const h of ['mike.suitecxo.com', 'pinnacle.suitecxo.com', 'suitecxo-abc-sakred.vercel.app', 'roleplay.virtualcloser.com']) {
      expect(shouldNoindex(h, '/'), h).toBe(true)
      expect(shouldNoindex(h, '/privacy'), h).toBe(true)
    }
  })
})

describe('middleware', () => {
  it('serves robots.txt, sitemap.xml and llms.txt on a company host instead of bouncing to sign-in', async () => {
    for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
      const res = await hit('mike.suitecxo.com', p)
      expect(res.headers.get('location'), p).toBeNull()
      expect(res.headers.get('x-robots-tag'), p).toBe('noindex')
    }
  })
  it('tags company-host redirects and www app pages noindex, leaves the www home alone', async () => {
    expect((await hit('mike.suitecxo.com', '/dashboard')).headers.get('x-robots-tag')).toBe('noindex')
    expect((await hit('www.suitecxo.com', '/login')).headers.get('x-robots-tag')).toBe('noindex')
    expect((await hit('www.suitecxo.com', '/cxo/demo')).headers.get('x-robots-tag')).toBe('noindex')
    const home = await hit('www.suitecxo.com', '/')
    expect(home.headers.get('x-robots-tag')).toBeNull()
    expect((await hit('www.suitecxo.com', '/robots.txt')).headers.get('x-robots-tag')).toBeNull()
  })
})

describe('structured data and llms.txt', () => {
  it('has Organization, WebSite and SoftwareApplication with the site price', () => {
    const g = cxoJsonLd()['@graph']
    expect(g.map((x) => x['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication'])
    const app = g[2] as { offers: { price: string; priceCurrency: string } }
    expect(app.offers).toMatchObject({ price: String(CXO_PRICE_PER_PERSON), priceCurrency: 'USD' })
  })
  it('llms.txt names Ciao, the price and the public pages, never a client', () => {
    const t = cxoLlmsTxt()
    expect(t.startsWith('# Suite CXO')).toBe(true)
    expect(t).toContain('Ciao')
    expect(t).toContain(`$${CXO_PRICE_PER_PERSON} per person, per month`)
    expect(t).toContain('https://www.suitecxo.com/cxo/request-access')
    expect(t).not.toMatch(/pinnacle|spencer|\/cxo\/demo/i)
  })
})
