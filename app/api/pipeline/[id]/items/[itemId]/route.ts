import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { updateItem, moveItemToStage, deleteItem } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { itemId } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      title?: string
      subtitle?: string | null
      notes?: string | null
      value?: number | null
      stage_id?: string | null
    }
    if (body.stage_id !== undefined) {
      await moveItemToStage(itemId, tenant.id, body.stage_id ?? null)
    }
    await updateItem(itemId, tenant.id, {
      title: body.title,
      subtitle: body.subtitle,
      notes: body.notes,
      value: body.value,
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { itemId } = await ctx.params
    await deleteItem(itemId, tenant.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
