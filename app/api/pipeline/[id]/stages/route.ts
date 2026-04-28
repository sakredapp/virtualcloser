import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { addStage, reorderStages } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { name?: string; color?: string }
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 })
    }
    const stage = await addStage(id, tenant.id, body.name.trim(), body.color)
    return NextResponse.json({ stage })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

/** PATCH { order: string[] } to reorder stages */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { order?: string[] }
    if (!Array.isArray(body.order)) {
      return NextResponse.json({ error: 'order array required' }, { status: 400 })
    }
    await reorderStages(id, tenant.id, body.order)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
