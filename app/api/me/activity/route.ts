/**
 * Usage beacon: the dashboard posts the page path once per page per day
 * (navigator.sendBeacon, so it never holds up a page). Writes at most one
 * row per member per page per day.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { recordHit } from '@/lib/cxoUsage'
import { normalizeUsagePath } from '@/lib/cxoUsageShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  const body = (await req.json().catch(() => null)) as { path?: unknown } | null
  const path = normalizeUsagePath(body?.path)
  if (!path) return new NextResponse(null, { status: 204 })
  await recordHit(ctx.tenant.id, ctx.member.id, path, { tz: ctx.member.timezone || ctx.tenant.timezone })
  return new NextResponse(null, { status: 204 })
}
