/**
 * Usage beacon: the dashboard posts the page path once per page per day
 * (navigator.sendBeacon, so it never holds up a page). Writes at most one
 * row per member per page per day. `session` marks a new browser session,
 * `note` a meeting note opened; both are plain counts.
 * Our admin viewing as a member is never counted.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isImpersonatedSession, recordHit, recordUsage } from '@/lib/cxoUsage'
import { normalizeUsagePath } from '@/lib/cxoUsageShared'
import { SESSION_KEY, actionKey } from '@/lib/cxoAdoptionShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  if (await isImpersonatedSession()) return new NextResponse(null, { status: 204 })
  const body = (await req.json().catch(() => null)) as { path?: unknown; session?: unknown; note?: unknown } | null
  const path = normalizeUsagePath(body?.path)
  if (!path) return new NextResponse(null, { status: 204 })
  if (body?.note === true) {
    if (path === '/dashboard/meetings') await recordUsage(ctx, actionKey('meeting_note_opened'))
    return new NextResponse(null, { status: 204 })
  }
  await recordHit(ctx.tenant.id, ctx.member.id, path, { tz: ctx.member.timezone || ctx.tenant.timezone })
  if (body?.session === true) await recordUsage(ctx, SESSION_KEY)
  return new NextResponse(null, { status: 204 })
}
