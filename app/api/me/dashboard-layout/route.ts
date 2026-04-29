import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getMemberById, updateMember } from '@/lib/members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Per-member dashboard layout — which widgets are visible.
 * Stored under members.settings.dashboard_layout = { visible: string[] }.
 */

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const m = await getMemberById(ctx.member.id)
  const settings = (m?.settings ?? {}) as Record<string, unknown>
  const layout = (settings.dashboard_layout as { visible?: string[] } | undefined) ?? null
  return NextResponse.json({ ok: true, layout })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { visible?: string[]; order?: string[] }
  if (!Array.isArray(body.visible)) {
    return NextResponse.json({ ok: false, error: 'visible[] required' }, { status: 400 })
  }
  // Sanitize: only string keys, max 50.
  const visible = body.visible.filter((s) => typeof s === 'string').slice(0, 50)
  const order = Array.isArray(body.order)
    ? body.order.filter((s) => typeof s === 'string').slice(0, 50)
    : []

  const m = await getMemberById(ctx.member.id)
  const settings = ((m?.settings ?? {}) as Record<string, unknown>) || {}
  settings.dashboard_layout = { visible, order }
  await updateMember(ctx.member.id, { settings })

  return NextResponse.json({ ok: true })
}
