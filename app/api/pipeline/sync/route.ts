import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { pullDealsFromCRM } from '@/lib/crm-sync'

export const dynamic = 'force-dynamic'

/**
 * POST /api/pipeline/sync
 * Body: { pipeline_id: string }
 *
 * Pulls deals from the linked CRM, upserts names + stages into `leads`.
 * Only works if the pipeline has crm_source + crm_pipeline_id configured.
 * Safe to call repeatedly — updates existing leads by crm_object_id.
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant()
    const body = await req.json().catch(() => ({})) as { pipeline_id?: string }
    if (typeof body.pipeline_id !== 'string') {
      return NextResponse.json({ error: 'pipeline_id required' }, { status: 400 })
    }
    const result = await pullDealsFromCRM(tenant.id, body.pipeline_id)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
