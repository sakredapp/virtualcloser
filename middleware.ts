import { NextRequest, NextResponse } from 'next/server'
import { bearerSessionToken, verifySession, sessionHomeHost, SESSION_COOKIE_NAME } from '@/lib/client-auth'
import { HOST_RENAMES, canonicalHost } from '@/lib/hostRenames'
import {
  brandFromHost,
  isAnyGatewayHost,
  slugFromBrandedHost,
} from '@/lib/brand'
import { EMPLOYEE_HOME, employeePathAllowed } from '@/lib/employees/access'
import { cxoHomeFor, cxoPathAllowed } from '@/lib/cxoRoutes'
import { isNativeAppUA, nativeBlockFor, NATIVE_PLAN_NOTE_PATH } from '@/lib/nativeApp'
import { shouldNoindex } from '@/lib/seo'

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
  '/api/ops/onboarding', // Accounts (crmbuilds): its own shared-secret bearer
  '/api/webhooks', // each webhook authenticates via its own secret / HMAC
  '/api/meetings/inbound', // per-member secret token in the path
  '/api/native/session', // the phone app's sign-in (email + password in the body)
  '/brands',       // /public/brands/* — brand-specific static assets
  '/cxo',          // CXO marketing route group
  // Crawler files by exact name: '/robots' above only matches '/robots/...',
  // so robots.txt on a company host used to bounce to sign-in.
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

// Every response says whether it may be indexed: only the public Suite CXO
// marketing pages may (lib/seo.ts). Company hosts, previews, roleplay and the
// sign-in/app pages carry X-Robots-Tag: noindex, redirects included.
export async function middleware(req: NextRequest) {
  const res = await route(req)
  if (shouldNoindex(req.headers.get('host'), req.nextUrl.pathname)) {
    res.headers.set('X-Robots-Tag', 'noindex')
  }
  return res
}

async function route(req: NextRequest): Promise<NextResponse> {
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

  // Suite CXO store app: Apple and Google fetch these two files, signed out,
  // from the apex and from company hosts, to let the app open suitecxo.com
  // links. Suite CXO hosts only, these two exact paths only; everything else
  // falls through unchanged.
  if (
    brand.key === 'cxo' &&
    (pathname === '/.well-known/apple-app-site-association' || pathname === '/.well-known/assetlinks.json')
  ) {
    return NextResponse.next({ request: { headers } })
  }

  // Inside the Suite CXO store app (its WebView marks its user agent), nothing
  // that sells or changes a plan is shown: Apple 3.1.1 and Google Play do not
  // allow it outside their own purchase systems. Billing pages go to a plain
  // note with no link and no price, purchase calls are refused, and the public
  // pricing page goes to sign-in. Browsers never match, so the web is unchanged.
  if (brand.key === 'cxo' && isNativeAppUA(req.headers.get('user-agent'))) {
    const block = nativeBlockFor(pathname, { gatewayHost: isAnyGatewayHost(host) })
    if (block === 'purchase-api') {
      return NextResponse.json({ error: 'Plans are managed on the web.' }, { status: 403 })
    }
    if (block) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return new NextResponse(null, { status: 404 })
      const to = req.nextUrl.clone()
      to.pathname = block === 'sales-page' ? '/login' : NATIVE_PLAN_NOTE_PATH
      to.search = ''
      return NextResponse.redirect(to)
    }
  }

  // Product host: roleplay.virtualcloser.com is the standalone roleplay tool,
  // NOT a tenant portal. Serve the /roleplay route group at the root of that
  // host (/ → /roleplay, /floor → /roleplay/floor) and skip tenant gating —
  // the floor does its own session check (the cookie is scoped to the brand
  // root, so a client logged in anywhere on *.virtualcloser.com carries over).
  const hostName = host.split(':')[0].toLowerCase()
  // Virtual Closer only: there is no roleplay product on Suite CXO.
  if (brand.key === 'virtualcloser' && hostName === `roleplay.${brand.rootDomain}`) {
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

  // Suite CXO hosts serve Suite CXO pages only. This repo also holds the
  // Virtual Closer pages (dialer, prospects, SMS, roleplay...), and a typed URL
  // used to open them here. Anything not on the one list in lib/cxoRoutes.ts
  // goes to the Suite CXO home; a new page is closed here until it is listed.
  // Virtual Closer hosts never reach this block.
  if (
    brand.key === 'cxo' &&
    !cxoPathAllowed(pathname, { hasToken: req.nextUrl.searchParams.has('token') })
  ) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new NextResponse(null, { status: 404 })
    }
    const homeUrl = req.nextUrl.clone()
    homeUrl.pathname = cxoHomeFor(isAnyGatewayHost(host))
    homeUrl.search = ''
    return NextResponse.redirect(homeUrl)
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
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value
  // The phone app (no cookies) sends the same signed token as a bearer, on
  // API calls only. Pages never read it.
  const bearer = !cookieToken && pathname.startsWith('/api/') ? bearerSessionToken(req.headers.get('authorization')) : null
  const token = cookieToken ?? bearer ?? undefined
  const session = await verifySession(token)

  // A session is valid on its own slug, or (current cookies) on any host it
  // was signed for: the member's home host plus the org's slug and aliases.
  // The server re-checks that the host's tenant is the session's tenant.
  const hostOk =
    !!session && !!hostSlug && (session.slug === hostSlug || session.hosts.includes(hostSlug))
  if (!hostOk) {
    // The phone app gets a plain 401 it can act on, never a login page.
    const auth = req.headers.get('authorization') ?? ''
    const appCall = !cookieToken && pathname.startsWith('/api/') && /^Bearer\s/i.test(auth) && !/^Bearer\s+(vc_|cxo_)/i.test(auth)
    if (appCall) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
    }
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
