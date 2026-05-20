import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/client-auth'
import {
  brandFromHost,
  isAnyGatewayHost,
  slugFromBrandedHost,
} from '@/lib/brand'

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

  // Brand gateway rewrite: when a non-default brand's apex hits "/", show
  // its dedicated marketing route. The browser URL stays on the apex; we
  // just rewrite under the hood. VC continues to serve `/app/page.tsx`.
  if (isAnyGatewayHost(host) && brand.key !== 'virtualcloser' && pathname === '/') {
    const rewriteUrl = req.nextUrl.clone()
    rewriteUrl.pathname = brand.marketingRoute
    return NextResponse.rewrite(rewriteUrl, { request: { headers } })
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

  // Gateway host (apex/www/localhost/preview): no tenant gating.
  if (isAnyGatewayHost(host)) {
    return NextResponse.next({ request: { headers } })
  }

  // Subdomain host: public paths bypass auth.
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request: { headers } })
  }

  const hostSlug = slugFromBrandedHost(host)
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySession(token)

  if (!session || !hostSlug || session.slug !== hostSlug) {
    // Redirect back to the brand's own login page, not the cross-brand root.
    const loginUrl = new URL(`https://${brand.rootDomain}/login`)
    loginUrl.searchParams.set('next', `https://${host}${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
