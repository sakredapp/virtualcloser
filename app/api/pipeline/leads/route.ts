import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { createPipelineLead, moveLeadToStage } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  try {
    const tenant = await requireTenant()
    const body = await req.json().catch(() => ({})) as {
      lead_id?: string
      pipeline_id?: string | null
      stage_id?: string | null
    }
    if (typeof body.lead_id !== 'string') {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
    }
    const result = await moveLeadToStage(
      body.lead_id,
      tenant.id,
      typeof body.pipeline_id === 'string' ? body.pipeline_id : null,
      typeof body.stage_id === 'string' ? body.stage_id : null,
    )
    return NextResponse.json({ ok: true, crmPushed: result.crmPushed, crmSource: result.crmSource })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant()
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      company?: string | null
      status?: string | null
      deal_value?: number | null
      pipeline_id?: string | null
      stage_id?: string | null
    }
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 })
    }
    const lead = await createPipelineLead(tenant.id, {
      name: body.name.trim(),
      company: typeof body.company === 'string' ? body.company.trim() || null : null,
      status: typeof body.status === 'string' ? body.status : null,
      deal_value: typeof body.deal_value === 'number' ? body.deal_value : null,
      pipeline_id: typeof body.pipeline_id === 'string' ? body.pipeline_id : null,
      stage_id: typeof body.stage_id === 'string' ? body.stage_id : null,
    })
    return NextResponse.json({ ok: true, lead })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
