/**
 * An employee's own notices from Mira (follow-up nudges, close notes,
 * approval results). Only the signed-in member's rows; nothing else is
 * readable here. Empty when the company's employee-ops switch is off.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { listNotices, markNoticeRead } from '@/lib/followups/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  if (!cxoEmployeeOps(ctx.tenant)) return NextResponse.json({ notices: [] })
  const notices = await listNotices(ctx.tenant.id, ctx.member.id).catch(() => [])
  return NextResponse.json({ notices })
}

/** op: read */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  if (!cxoEmployeeOps(ctx.tenant)) return NextResponse.json({ error: 'Not switched on.' }, { status: 404 })
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; id?: unknown }
  if (b.op !== 'read' || typeof b.id !== 'string') return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
  try {
    await markNoticeRead(ctx.tenant.id, ctx.member.id, b.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[me/notices]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
