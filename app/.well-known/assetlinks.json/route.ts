/**
 * Google fetches this to let the Suite CXO Android app open suitecxo.com
 * links. Needs CXO_ANDROID_CERT_SHA256 (the Play app signing fingerprint,
 * known once the app exists in Play Console); 404 until it is set.
 * CXO_PINNACLE_ANDROID_CERT_SHA256 adds Pinnacle's own app the same way.
 */
import { NextRequest, NextResponse } from 'next/server'
import { androidAssetLinks, isSuiteCxoHost } from '@/lib/nativeAppLinks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  if (!isSuiteCxoHost(req.headers.get('host'))) return new NextResponse(null, { status: 404 })
  const body = androidAssetLinks(process.env.CXO_ANDROID_CERT_SHA256, process.env.CXO_PINNACLE_ANDROID_CERT_SHA256)
  if (!body) return new NextResponse(null, { status: 404 })
  return NextResponse.json(body, { headers: { 'cache-control': 'public, max-age=3600' } })
}
