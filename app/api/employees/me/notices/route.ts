/**
 * An employee's own notices from Mira (follow-up nudges, close notes,
 * approval results). Only the signed-in member's rows; nothing else is
 * readable here. With the company's employee-ops switch off, only "you were
 * praised" notices show.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { listNotices, markNoticeRead, noticeKindsFor } from '@/lib/followups/notices'
import { actOnNotice, NoticeActionRefused } from '@/lib/followups/noticeActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const notices = await listNotices(ctx.tenant.id, ctx.member.id, 40, noticeKindsFor(cxoEmployeeOps(ctx.tenant))).catch(() => [])
  return NextResponse.json({ notices })
}

/** op: read | act (a one-tap action the notice carries) */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; id?: unknown; action?: unknown }
  if ((b.op !== 'read' && b.op !== 'act') || typeof b.id !== 'string') return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
  try {
    if (b.op === 'act') return NextResponse.json({ ok: true, ...(await actOnNotice(ctx.tenant.id, ctx.member.id, b.id, b.action)) })
    await markNoticeRead(ctx.tenant.id, ctx.member.id, b.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof NoticeActionRefused) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[me/notices]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
