/**
 * Adoption data for the signed-in org: owner and admins only (403 for
 * everyone else). The org comes from the session, never from the request.
 */
import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { AdoptionForbidden, adoptionFor } from '@/lib/cxoAdoption'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await adoptionFor(ctx), { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    if (err instanceof AdoptionForbidden) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    console.error('[adoption] api', err)
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
}
