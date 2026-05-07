// GET /api/me/import-batches — list recent import batches with live counts

import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: batches, error } = await supabase
    .from('import_batches')
    .select(`
      id,
      file_name,
      source,
      vendor_name,
      cost_per_lead,
      total_count,
      inserted_count,
      enrolled_count,
      duplicate_count,
      failed_count,
      status,
      ai_salesperson_id,
      created_at
    `)
    .eq('rep_id', ctx.tenant.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Attach live queue counts per batch so the UI can show real-time progress
  const batchIds = (batches ?? []).map((b) => b.id as string)
  let queueCountsByBatch: Record<string, { pending: number; completed: number; failed: number }> = {}

  if (batchIds.length > 0) {
    const { data: queueRows } = await supabase
      .from('dialer_queue')
      .select('import_batch_id, status')
      .in('import_batch_id', batchIds)

    for (const row of queueRows ?? []) {
      const bid = row.import_batch_id as string
      if (!queueCountsByBatch[bid]) {
        queueCountsByBatch[bid] = { pending: 0, completed: 0, failed: 0 }
      }
      if (row.status === 'pending' || row.status === 'in_progress') {
        queueCountsByBatch[bid].pending++
      } else if (row.status === 'completed') {
        queueCountsByBatch[bid].completed++
      } else if (row.status === 'failed' || row.status === 'cancelled') {
        queueCountsByBatch[bid].failed++
      }
    }
  }

  const enriched = (batches ?? []).map((b) => ({
    ...b,
    queue_counts: queueCountsByBatch[b.id as string] ?? { pending: 0, completed: 0, failed: 0 },
  }))

  return NextResponse.json({ ok: true, batches: enriched })
}
