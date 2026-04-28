import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { updatePipelineMeta, deletePipeline } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      description?: string | null
    }
    const patch: { name?: string; description?: string | null } = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (body.description !== undefined) patch.description = body.description
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'name or description required' }, { status: 400 })
    }
    await updatePipelineMeta(id, tenant.id, patch)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenant = await requireTenant()
    const { id } = await params
    await deletePipeline(id, tenant.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
