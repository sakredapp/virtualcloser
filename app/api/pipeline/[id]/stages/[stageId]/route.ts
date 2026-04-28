import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { updateStage, deleteStage } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { stageId } = await params
    const body = await req.json().catch(() => ({})) as { name?: string; color?: string }
    const patch: { name?: string; color?: string } = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (typeof body.color === 'string') patch.color = body.color
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }
    await updateStage(stageId, tenant.id, patch)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { stageId } = await params
    await deleteStage(stageId, tenant.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
