import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { getItemsForPipeline, createItem } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await requireTenant()
    const { id } = await ctx.params
    const items = await getItemsForPipeline(id, tenant.id)
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await requireTenant()
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      title?: string
      subtitle?: string | null
      notes?: string | null
      value?: number | null
      pipeline_stage_id?: string | null
    }
    if (!body.title || !body.title.trim()) {
      return NextResponse.json({ error: 'title required' }, { status: 400 })
    }
    const item = await createItem(tenant.id, id, {
      title: body.title.trim(),
      subtitle: body.subtitle ?? null,
      notes: body.notes ?? null,
      value: typeof body.value === 'number' ? body.value : null,
      pipeline_stage_id: body.pipeline_stage_id ?? null,
    })
    return NextResponse.json({ item })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
