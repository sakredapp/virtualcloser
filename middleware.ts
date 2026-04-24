import { NextRequest, NextResponse } from 'next/server'

/**
 * Capture the incoming host and pass it to server components via a request
 * header. This is what lets every page know which tenant's subdomain was
 * used without reading env vars.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const res = NextResponse.next()
  res.headers.set('x-tenant-host', host)
  const headers = new Headers(req.headers)
  headers.set('x-tenant-host', host)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
