import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { brandFromHost, isAnyGatewayHost, isCxoPreviewHost, slugFromBrandedHost } from '@/lib/brand'
import { middleware } from '@/middleware'

const PREVIEW_BRANCH = 'suitecxo-git-feat-cxo-phone-layout-sakred-health.vercel.app'
const PREVIEW_HASH = 'suitecxo-9x2k4abcd-sakred-health.vercel.app'

afterEach(() => vi.unstubAllEnvs())

describe('brand from host', () => {
  it('resolves production hosts exactly as before', () => {
    expect(brandFromHost('suitecxo.com').key).toBe('cxo')
    expect(brandFromHost('www.suitecxo.com').key).toBe('cxo')
    expect(brandFromHost('mike.suitecxo.com').key).toBe('cxo')
    expect(brandFromHost('pinnacle.suitecxo.com:443').key).toBe('cxo')
    expect(brandFromHost('virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost('www.virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost('acme.virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost('roleplay.virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost(null).key).toBe('virtualcloser')
    expect(brandFromHost('').key).toBe('virtualcloser')
  })

  it('shows Suite CXO on a preview of the suitecxo project', () => {
    expect(brandFromHost(PREVIEW_BRANCH).key).toBe('cxo')
    expect(brandFromHost(PREVIEW_HASH).key).toBe('cxo')
    expect(brandFromHost(PREVIEW_BRANCH.toUpperCase()).key).toBe('cxo')
    expect(brandFromHost(`${PREVIEW_BRANCH}:443`).key).toBe('cxo')
    expect(brandFromHost('suitecxo.vercel.app').key).toBe('cxo')
    expect(isCxoPreviewHost(PREVIEW_BRANCH)).toBe(true)
  })

  it('leaves every other vercel.app host on Virtual Closer', () => {
    for (const h of [
      'preview.vercel.app',
      'virtualcloser-git-main-sakred-health.vercel.app',
      'suitecxodemo.vercel.app',
      'notsuitecxo-git-x-sakred-health.vercel.app',
      'my-suitecxo-abc.vercel.app',
      'suitecxo-abc.vercel.app.evil.com',
      'suitecxo-abc.evil.vercel.app',
    ]) {
      expect(brandFromHost(h).key, h).toBe('virtualcloser')
      expect(isCxoPreviewHost(h), h).toBe(false)
    }
  })

  it('keeps localhost on Virtual Closer unless LOCAL_BRAND says otherwise', () => {
    expect(brandFromHost('localhost:3000').key).toBe('virtualcloser')
    expect(brandFromHost('127.0.0.1:3000').key).toBe('virtualcloser')
    vi.stubEnv('LOCAL_BRAND', 'cxo')
    expect(brandFromHost('localhost:3000').key).toBe('cxo')
    expect(brandFromHost('127.0.0.1:3000').key).toBe('cxo')
    vi.stubEnv('LOCAL_BRAND', 'nonsense')
    expect(brandFromHost('localhost:3000').key).toBe('virtualcloser')
  })

  it('never lets LOCAL_BRAND touch a real host', () => {
    vi.stubEnv('LOCAL_BRAND', 'cxo')
    expect(brandFromHost('virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost('acme.virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost('roleplay.virtualcloser.com').key).toBe('virtualcloser')
    expect(brandFromHost('preview.vercel.app').key).toBe('virtualcloser')
    vi.stubEnv('LOCAL_BRAND', 'virtualcloser')
    expect(brandFromHost('suitecxo.com').key).toBe('cxo')
    expect(brandFromHost(PREVIEW_BRANCH).key).toBe('cxo')
  })

  it('treats a preview as a gateway with no tenant', () => {
    expect(isAnyGatewayHost(PREVIEW_BRANCH)).toBe(true)
    expect(isAnyGatewayHost(PREVIEW_HASH)).toBe(true)
    expect(slugFromBrandedHost(PREVIEW_BRANCH)).toBeNull()
    expect(isAnyGatewayHost('mike.suitecxo.com')).toBe(false)
    expect(slugFromBrandedHost('mike.suitecxo.com')).toBe('mike')
  })
})

function hit(host: string, path: string) {
  return middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }))
}

describe('middleware on a Suite CXO preview', () => {
  it('serves the Suite CXO home at /, not the Virtual Closer site', async () => {
    const res = await hit(PREVIEW_BRANCH, '/')
    expect(res.headers.get('x-middleware-rewrite')).toBe(`https://${PREVIEW_BRANCH}/cxo`)
    expect(res.headers.get('x-middleware-request-x-brand')).toBe('cxo')
  })

  it('sends /demo to the Suite CXO demo and /offer to the Suite CXO home, on the same host', async () => {
    const demo = await hit(PREVIEW_BRANCH, '/demo')
    expect(demo.status).toBe(307)
    expect(demo.headers.get('location')).toBe(`https://${PREVIEW_BRANCH}/cxo/demo`)
    const offer = await hit(PREVIEW_HASH, '/offer')
    expect(offer.headers.get('location')).toBe(`https://${PREVIEW_HASH}/cxo`)
  })

  it('lets the public demo and login through with the Suite CXO brand', async () => {
    for (const path of ['/cxo/demo', '/cxo/demo?version=pinnacle', '/login']) {
      const res = await hit(PREVIEW_BRANCH, path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('location'), path).toBeNull()
      expect(res.headers.get('x-middleware-request-x-brand'), path).toBe('cxo')
    }
  })

  it('sends a signed-out /dashboard to login on the same host', async () => {
    const res = await hit(PREVIEW_BRANCH, '/dashboard/work')
    expect(res.headers.get('location')).toBe(`https://${PREVIEW_BRANCH}/login?next=%2Fdashboard%2Fwork`)
  })
})

describe('middleware on production hosts is unchanged', () => {
  it('rewrites the Suite CXO apex home and keeps the Virtual Closer apex as is', async () => {
    expect((await hit('suitecxo.com', '/')).headers.get('x-middleware-rewrite')).toBe('https://suitecxo.com/cxo')
    const vc = await hit('virtualcloser.com', '/')
    expect(vc.headers.get('x-middleware-rewrite')).toBeNull()
    expect(vc.headers.get('x-middleware-request-x-brand')).toBe('virtualcloser')
    expect((await hit('virtualcloser.com', '/demo')).headers.get('location')).toBeNull()
    expect((await hit('virtualcloser.com', '/offer')).headers.get('location')).toBeNull()
  })

  it('still serves the roleplay tool at the root of roleplay.virtualcloser.com', async () => {
    const res = await hit('roleplay.virtualcloser.com', '/')
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://roleplay.virtualcloser.com/roleplay')
  })

  it('keeps another vercel.app preview on Virtual Closer', async () => {
    const res = await hit('preview.vercel.app', '/')
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-middleware-request-x-brand')).toBe('virtualcloser')
  })
})
