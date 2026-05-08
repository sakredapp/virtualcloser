// POST /api/me/import-batches/[id]/start
// Enrolls a held (status='pending') import batch into dialer_queue so the
// cron starts calling. Idempotent: re-posting on an already-active batch
// only re-enqueues leads that were never inserted (e.g. partial prior run).

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getSalespersonForRep } from '@/lib/ai-salesperson'
import { startCampaign } from '@/lib/campaign/campaignEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id: batchId } = await params

  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('rep_id', ctx.tenant.id)
    .maybeSingle()

  if (batchErr) {
    console.error('[import-batches/start] batch fetch failed', batchErr)
    return NextResponse.json({ ok: false, error: batchErr.message }, { status: 500 })
  }
  if (!batch) {
    return NextResponse.json({ ok: false, error: 'batch_not_found' }, { status: 404 })
  }
  if (batch.status === 'completed') {
    return NextResponse.json({ ok: false, error: 'batch_already_completed' }, { status: 400 })
  }

  // Find leads in this batch that don't yet have a queue row
  const { data: existingQueuePhones } = await supabase
    .from('dialer_queue')
    .select('phone')
    .eq('import_batch_id', batchId)
    .in('status', ['pending', 'in_progress', 'completed'])

  const alreadyQueued = new Set<string>(
    (existingQueuePhones ?? []).map((r) => r.phone as string).filter(Boolean),
  )

  const { data: batchLeads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, phone, email, company, notes')
    .eq('import_batch_id', batchId)
    .eq('rep_id', ctx.tenant.id)
    .not('phone', 'is', null)

  if (leadsErr) {
    console.error('[import-batches/start] leads fetch failed', leadsErr)
    return NextResponse.json({ ok: false, error: leadsErr.message }, { status: 500 })
  }

  const toEnroll = (batchLeads ?? []).filter(
    (l) => l.phone && !alreadyQueued.has(l.phone as string),
  )

  const setterId = batch.ai_salesperson_id as string | null
  if (!setterId) {
    return NextResponse.json({ ok: false, error: 'batch_has_no_salesperson' }, { status: 400 })
  }

  // Verify setter still exists and is active
  let setter
  try {
    setter = await getSalespersonForRep(ctx.tenant.id, setterId)
  } catch (e) {
    console.error('[import-batches/start] setter resolve failed', e)
    return NextResponse.json({ ok: false, error: 'setter_not_found' }, { status: 404 })
  }
  if (!setter) {
    return NextResponse.json({ ok: false, error: 'setter_not_found' }, { status: 404 })
  }

  let enrolled = 0
  for (let i = 0; i < toEnroll.length; i += 100) {
    const chunk = toEnroll.slice(i, i + 100)
    const { error } = await supabase.from('dialer_queue').insert(
      chunk.map((lead) => ({
        rep_id: ctx.tenant.id,
        owner_member_id: ctx.member.id,
        ai_salesperson_id: setterId,
        lead_id: lead.id,
        import_batch_id: batchId,
        dialer_mode: 'appointment_setter',
        status: 'pending',
        phone: lead.phone,
        attempt_count: 0,
        max_attempts: 3,
        source_kind: 'csv',
        context: {
          import_batch_id: batchId,
          lead_id: lead.id,
        },
      })),
    )
    if (error) {
      console.error('[import-batches/start] queue insert failed', error.message)
      continue
    }
    enrolled += chunk.length
  }

  await supabase
    .from('import_batches')
    .update({
      status: 'active',
      enrolled_count: alreadyQueued.size + enrolled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  // Auto-start AI campaigns for each newly enrolled lead.
  // Campaign key comes from the setter's product_category; falls back to
  // 'mortgage_protection' so existing batches keep working.
  const templateKey = setter.product_category ?? 'mortgage_protection'
  let campaignCount = 0
  for (const lead of toEnroll) {
    const r = await startCampaign({
      repId: ctx.tenant.id,
      aiSalespersonId: setterId,
      leadId: lead.id as string,
      templateKey,
      context: {
        import_batch_id: batchId,
      },
    })
    if (r.ok) campaignCount++
  }

  const leadsPerDay = setter.schedule?.leads_per_day ?? setter.schedule?.max_calls_per_day ?? 120
  const totalPending = alreadyQueued.size + enrolled
  const estimatedDays = Math.ceil(totalPending / leadsPerDay)

  return NextResponse.json({
    ok: true,
    batch_id: batchId,
    enrolled,
    campaigns_started: campaignCount,
    total_queued: totalPending,
    estimate: {
      leads_per_day: leadsPerDay,
      estimated_days: estimatedDays,
      estimated_completion_date: new Date(Date.now() + estimatedDays * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
  })
}
