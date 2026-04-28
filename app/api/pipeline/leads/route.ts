import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { moveLeadToStage } from '@/lib/pipelines'

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
