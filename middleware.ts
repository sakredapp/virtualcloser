import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/client-auth'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

function isGatewayHost(host: string): boolean {
  const clean = host.split(':')[0].toLowerCase()
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return true
  if (clean.endsWith('.vercel.app')) return true
  if (clean === ROOT_DOMAIN || clean === `www.${ROOT_DOMAIN}`) return true
  return false
}

function slugFromHost(host: string): string | null {
  const clean = host.split(':')[0].toLowerCase()
  if (clean.endsWith(`.${ROOT_DOMAIN}`)) {
    return clean.slice(0, -1 * (ROOT_DOMAIN.length + 1)).split('.')[0]
  }
  return null
}

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
  '/api/cron',   // cron uses bearer token
  '/api/admin',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const { pathname, search } = req.nextUrl

  const headers = new Headers(req.headers)
  headers.set('x-tenant-host', host)

  // Gateway host (apex/www/localhost/preview): no tenant gating.
  if (isGatewayHost(host)) {
    return NextResponse.next({ request: { headers } })
  }

  // Subdomain host: public paths bypass auth.
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request: { headers } })
  }

  const hostSlug = slugFromHost(host)
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySession(token)

  if (!session || !hostSlug || session.slug !== hostSlug) {
    const loginUrl = new URL(`https://${ROOT_DOMAIN}/login`)
    loginUrl.searchParams.set('next', `https://${host}${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
