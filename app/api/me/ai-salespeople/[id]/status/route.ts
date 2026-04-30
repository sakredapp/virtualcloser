import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { setStatus } from '@/lib/ai-salesperson'
import type { AiSalespersonStatus } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  let body: { status?: AiSalespersonStatus }
  try {
    body = (await req.json()) as { status?: AiSalespersonStatus }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }
  if (!body.status || !['draft', 'active', 'paused', 'archived'].includes(body.status)) {
    return NextResponse.json({ ok: false, error: 'bad_status' }, { status: 400 })
  }

  try {
    const { id } = await params
    const item = await setStatus(ctx.tenant.id, id, body.status)
    return NextResponse.json({ ok: true, item })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
