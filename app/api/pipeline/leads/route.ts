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

const MAX_NAME_LEN = 200
const MAX_COMPANY_LEN = 200

export async function POST(req: NextRequest) {
  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    company?: string | null
    status?: string | null
    deal_value?: number | null
    pipeline_id?: string | null
    stage_id?: string | null
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `name must be ≤ ${MAX_NAME_LEN} chars` },
      { status: 400 },
    )
  }

  const company = typeof body.company === 'string' ? body.company.trim() : ''
  if (company.length > MAX_COMPANY_LEN) {
    return NextResponse.json(
      { error: `company must be ≤ ${MAX_COMPANY_LEN} chars` },
      { status: 400 },
    )
  }

  // deal_value: accept finite numbers ≥ 0 only. NaN passes typeof===number, so
  // explicit Number.isFinite() guards against it.
  let dealValue: number | null = null
  if (body.deal_value !== null && body.deal_value !== undefined) {
    const n = Number(body.deal_value)
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) {
      return NextResponse.json(
        { error: 'deal_value must be a finite non-negative number ≤ 1B' },
        { status: 400 },
      )
    }
    dealValue = n
  }

  try {
    const lead = await createPipelineLead(tenant.id, {
      name,
      company: company || null,
      status: typeof body.status === 'string' ? body.status : null,
      deal_value: dealValue,
      pipeline_id: typeof body.pipeline_id === 'string' ? body.pipeline_id : null,
      stage_id: typeof body.stage_id === 'string' ? body.stage_id : null,
    })
    return NextResponse.json({ ok: true, lead })
  } catch (err) {
    console.error('[pipeline/leads POST] createPipelineLead failed', err)
    return NextResponse.json(
      { error: 'failed to create lead' },
      { status: 500 },
    )
  }
}
