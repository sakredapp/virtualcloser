import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { duplicateSalesperson } from '@/lib/ai-salesperson'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const role = ctx.member.role as string
  if (!['owner', 'admin', 'manager'].includes(role) && ctx.tenant.tier !== 'individual') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  try {
    const { id } = await params
    const item = await duplicateSalesperson(ctx.tenant.id, id)
    return NextResponse.json({ ok: true, item })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
