/**
 * Apple fetches this to let the Suite CXO iOS app open suitecxo.com links.
 * Suite CXO hosts only; every other host gets the same 404 as before.
 */
import { NextRequest, NextResponse } from 'next/server'
import { appleAppSiteAssociation, isSuiteCxoHost } from '@/lib/nativeAppLinks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  if (!isSuiteCxoHost(req.headers.get('host'))) return new NextResponse(null, { status: 404 })
  return NextResponse.json(appleAppSiteAssociation(), {
    headers: { 'cache-control': 'public, max-age=3600' },
  })
}
