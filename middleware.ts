import { NextRequest, NextResponse } from 'next/server'
import { verifySession, sessionHomeHost, SESSION_COOKIE_NAME } from '@/lib/client-auth'
import { HOST_RENAMES, canonicalHost } from '@/lib/hostRenames'
import {
  brandFromHost,
  isAnyGatewayHost,
  slugFromBrandedHost,
} from '@/lib/brand'
import { EMPLOYEE_HOME, employeePathAllowed } from '@/lib/employees/access'

// Paths that never require a client session.
const PUBLIC_PREFIXES = [
  '/_next',
  '/favicon',
  '/robots',
  '/sitemap',
  '/offer',
  '/demo',
  '/login',
  '/logout',
  '/admin',      // admin has its own password gate
  '/api/cron',     // cron uses bearer token
  '/api/admin',
  '/api/webhooks', // each webhook authenticates via its own secret / HMAC
  '/api/meetings/inbound', // per-member secret token in the path
  '/brands',       // /public/brands/* — brand-specific static assets
  '/cxo',          // CXO marketing route group
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const { pathname, search } = req.nextUrl

  const brand = brandFromHost(host)

  const headers = new Headers(req.headers)
  headers.set('x-tenant-host', host)
  headers.set('x-brand', brand.key)
  // Always ours, never the client's: lib/tenant.ts uses it to keep employee
  // logins on their own page.
  headers.set('x-pathname', pathname)
  // The real path, for the exec-assistant gate (lib/assistants.ts). Always
  // overwritten here so a client cannot pick its own.
  headers.set('x-cx-path', pathname)

  // Product host: roleplay.virtualcloser.com is the standalone roleplay tool,
  // NOT a tenant portal. Serve the /roleplay route group at the root of that
  // host (/ → /roleplay, /floor → /roleplay/floor) and skip tenant gating —
  // the floor does its own session check (the cookie is scoped to the brand
  // root, so a client logged in anywhere on *.virtualcloser.com carries over).
  const hostName = host.split(':')[0].toLowerCase()
  if (hostName === `roleplay.${brand.rootDomain}`) {
    if (
      pathname.startsWith('/api') ||
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon') ||
      pathname.startsWith('/robots') ||
      pathname.startsWith('/sitemap') ||
      pathname.startsWith('/brands') ||
      pathname.startsWith('/roleplay')
    ) {
      return NextResponse.next({ request: { headers } })
    }
    const rewriteUrl = req.nextUrl.clone()
    rewriteUrl.pathname = `/roleplay${pathname === '/' ? '' : pathname}`
    return NextResponse.rewrite(rewriteUrl, { request: { headers } })
  }

  // Brand gateway rewrite: when a non-default brand's apex hits "/", show
  // its dedicated marketing route. The browser URL stays on the apex; we
  // just rewrite under the hood. VC continues to serve `/app/page.tsx`.
  if (isAnyGatewayHost(host) && brand.key !== 'virtualcloser' && pathname === '/') {
    const rewriteUrl = req.nextUrl.clone()
    rewriteUrl.pathname = brand.marketingRoute
    return NextResponse.rewrite(rewriteUrl, { request: { headers } })
  }

  // CXO has its own executive demo dashboard at /cxo/demo. Point the short
  // /demo URL there on the CXO host so suitecxo.com/demo lands on the demo
  // (not the marketing page, and not the red VC /demo). Same on a tenant's
  // own CXO host (mike.suitecxo.com/demo), which used to show the VC demo.
  if (
    brand.key === 'cxo' &&
    (pathname === '/demo' || pathname.startsWith('/demo/'))
  ) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/cxo/demo'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  // VC-only marketing surfaces (/offer, /demo) should never render on a
  // non-VC brand's host — if someone hand-types suitecxo.com/offer they'd
  // see a red VC marketing page that breaks the brand frame. Bounce them
  // to the brand's own marketing route instead.
  const VC_MARKETING_PATHS = ['/offer', '/demo']
  if (
    isAnyGatewayHost(host) &&
    brand.key !== 'virtualcloser' &&
    VC_MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = brand.marketingRoute
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  // Gateway host (apex/www/localhost/preview): no tenant gating. The app
  // itself (/dashboard) lives on the tenant's own host, never the gateway:
  // www has no tenant, so a dashboard page there could only fail with "No
  // tenant found for this host". Send a signed-in member to their home host,
  // anyone else to the login page.
  if (isAnyGatewayHost(host)) {
    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
      const gwSession = await verifySession(req.cookies.get(SESSION_COOKIE_NAME)?.value)
      const home = gwSession ? canonicalHost(sessionHomeHost(gwSession)) : null
      if (home && brand.rootDomain) {
        return NextResponse.redirect(`https://${home}.${brand.rootDomain}${pathname}${search}`)
      }
      const loginUrl = req.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.search = ''
      loginUrl.searchParams.set('next', `${pathname}${search}`)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next({ request: { headers } })
  }

  // Renamed tenant hosts: the old name keeps working and lands on the new
  // one (spence.suitecxo.com → mike.suitecxo.com). Page loads only; API
  // calls are left alone so nothing in flight breaks.
  {
    const fromSlug = slugFromBrandedHost(host)
    const to = fromSlug ? HOST_RENAMES[fromSlug] : undefined
    if (to && (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/')) {
      return NextResponse.redirect(`https://${to}.${brand.rootDomain}${pathname}${search}`, 308)
    }
  }

  // Subdomain host: public paths bypass auth.
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request: { headers } })
  }

  const hostSlug = slugFromBrandedHost(host)
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySession(token)

  // A session is valid on its own slug, or (current cookies) on any host it
  // was signed for: the member's home host plus the org's slug and aliases.
  // The server re-checks that the host's tenant is the session's tenant.
  const hostOk =
    !!session && !!hostSlug && (session.slug === hostSlug || session.hosts.includes(hostSlug))
  if (!hostOk) {
    // Redirect back to the brand's own login page, not the cross-brand root.
    const loginUrl = new URL(`https://${brand.rootDomain}/login`)
    loginUrl.searchParams.set('next', `https://${host}${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  // Employee login: their own page only (server re-checks in getCurrentMember).
  if (session?.scope === 'employee' && !employeePathAllowed(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Your login shows your own page only.' }, { status: 403 })
    }
    const home = req.nextUrl.clone()
    home.pathname = EMPLOYEE_HOME
    home.search = ''
    return NextResponse.redirect(home)
  }

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
