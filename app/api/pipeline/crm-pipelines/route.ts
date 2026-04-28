import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { fetchCrmPipelines, type CrmSource } from '@/lib/crm-sync'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const VALID_SOURCES: CrmSource[] = ['ghl', 'hubspot']

/**
 * GET /api/pipeline/crm-pipelines?source=ghl|hubspot
 * Returns the pipelines available in the CRM so the user can pick which one
 * to mirror and then map stages.
 *
 * PATCH /api/pipeline/crm-pipelines
 * Body: { pipeline_id, crm_source, crm_pipeline_id, stage_mappings: [{stage_id, crm_stage_id}] }
 * Saves the CRM link for a pipeline + updates each stage's crm_stage_id.
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant()
    const source = req.nextUrl.searchParams.get('source') as CrmSource | null
    if (!source || !VALID_SOURCES.includes(source)) {
      return NextResponse.json({ error: 'source must be ghl or hubspot' }, { status: 400 })
    }
    const pipelines = await fetchCrmPipelines(tenant.id, source)
    return NextResponse.json({ pipelines })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const tenant = await requireTenant()
    const body = await req.json().catch(() => ({})) as {
      pipeline_id?: string
      crm_source?: string
      crm_pipeline_id?: string
      stage_mappings?: Array<{ stage_id: string; crm_stage_id: string }>
    }

    if (!body.pipeline_id) {
      return NextResponse.json({ error: 'pipeline_id required' }, { status: 400 })
    }

    // Update the pipeline's CRM link
    const patchData: Record<string, unknown> = {}
    if (typeof body.crm_source === 'string') patchData.crm_source = body.crm_source || null
    if (typeof body.crm_pipeline_id === 'string') patchData.crm_pipeline_id = body.crm_pipeline_id || null

    if (Object.keys(patchData).length) {
      const { error } = await supabase
        .from('pipelines')
        .update(patchData)
        .eq('id', body.pipeline_id)
        .eq('rep_id', tenant.id)
      if (error) throw error
    }

    // Update stage mappings
    if (Array.isArray(body.stage_mappings)) {
      await Promise.all(
        body.stage_mappings.map((m) =>
          supabase
            .from('pipeline_stages')
            .update({ crm_stage_id: m.crm_stage_id || null })
            .eq('id', m.stage_id)
            .eq('rep_id', tenant.id),
        ),
      )
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
