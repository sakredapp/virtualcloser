import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type QueueMode = 'concierge' | 'appointment_setter' | 'pipeline' | 'live_transfer'

type EnqueueBody = {
  workflow_rule_id?: string | null
  lead_id?: string | null
  meeting_id?: string | null
  phone: string
  dialer_mode: QueueMode
  priority?: number
  scheduled_for?: string | null
  max_attempts?: number
  context?: Record<string, unknown>
  owner_member_id?: string | null
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const status = req.nextUrl.searchParams.get('status')
  const mode = req.nextUrl.searchParams.get('mode')

  let q = supabase
    .from('dialer_queue')
    .select('*')
    .eq('rep_id', ctx.tenant.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) q = q.eq('status', status)
  if (mode) q = q.eq('dialer_mode', mode)

  if (ctx.tenant.tier === 'enterprise' && ctx.member.role === 'rep') {
    q = q.eq('owner_member_id', ctx.member.id)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, queue: data ?? [] })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (ctx.member.role === 'observer') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<EnqueueBody>
  if (!body.phone || !body.dialer_mode) {
    return NextResponse.json({ ok: false, error: 'phone + dialer_mode required' }, { status: 400 })
  }

  const allowedModes: QueueMode[] = ['concierge', 'appointment_setter', 'pipeline', 'live_transfer']
  if (!allowedModes.includes(body.dialer_mode)) {
    return NextResponse.json({ ok: false, error: 'invalid dialer_mode' }, { status: 400 })
  }

  let ownerMemberId: string | null = body.owner_member_id ?? null
  if (ctx.tenant.tier === 'individual') {
    ownerMemberId = ctx.member.id
  } else if (ctx.member.role === 'rep') {
    ownerMemberId = ctx.member.id
  } else if (!ownerMemberId) {
    ownerMemberId = ctx.member.id
  }

  const row = {
    rep_id: ctx.tenant.id,
    owner_member_id: ownerMemberId,
    workflow_rule_id: body.workflow_rule_id ?? null,
    lead_id: body.lead_id ?? null,
    meeting_id: body.meeting_id ?? null,
    phone: body.phone,
    dialer_mode: body.dialer_mode,
    status: 'pending',
    priority: clamp(body.priority, 1, 100, 10),
    scheduled_for: body.scheduled_for ?? null,
    max_attempts: clamp(body.max_attempts, 1, 10, 2),
    attempt_count: 0,
    context: isObject(body.context) ? body.context : {},
  }

  const { data, error } = await supabase
    .from('dialer_queue')
    .insert(row)
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  await supabase.from('dialer_queue_events').insert({
    rep_id: ctx.tenant.id,
    queue_id: data.id,
    workflow_rule_id: data.workflow_rule_id,
    member_id: ownerMemberId,
    event_type: 'enqueued',
    payload: {
      source: 'api',
      dialer_mode: data.dialer_mode,
    },
  })

  return NextResponse.json({ ok: true, queue_item: data })
}

// DELETE /api/me/dialer-queue?id=<queue_item_id>
// Cancels a pending/in_progress queue item and fires an optional RevRing
// cancel if the provider call has already been placed.
export async function DELETE(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (ctx.member.role === 'observer') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const queueId = req.nextUrl.searchParams.get('id')
  if (!queueId) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  }

  // Scope the lookup to this tenant.
  let q = supabase
    .from('dialer_queue')
    .select('*')
    .eq('id', queueId)
    .eq('rep_id', ctx.tenant.id)

  // Reps in enterprise accounts may only cancel their own items.
  if (ctx.tenant.tier === 'enterprise' && ctx.member.role === 'rep') {
    q = q.eq('owner_member_id', ctx.member.id)
  }

  const { data: row } = await q.maybeSingle()
  if (!row) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'expired') {
    return NextResponse.json({ ok: false, error: 'already_terminal', status: row.status }, { status: 409 })
  }

  // Mark cancelled in DB first so the cron won't dispatch this item again.
  const { error: updateErr } = await supabase
    .from('dialer_queue')
    .update({ status: 'cancelled', last_outcome: 'cancelled_by_user', next_retry_at: null })
    .eq('id', queueId)
    .eq('rep_id', ctx.tenant.id)

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 })
  }

  await supabase.from('dialer_queue_events').insert({
    rep_id: ctx.tenant.id,
    queue_id: queueId,
    workflow_rule_id: row.workflow_rule_id ?? null,
    member_id: ctx.member.id,
    event_type: 'cancelled',
    reason: 'cancelled_by_user',
    payload: { cancelled_by: ctx.member.id },
  })

  // Fire-and-forget provider-side cancel when a live call was already placed.
  const providerCallId = row.provider_call_id as string | null
  const provider = row.provider as string | null

  let providerCancelResult: 'skipped' | 'ok' | 'failed' = 'skipped'
  if (providerCallId && provider) {
    providerCancelResult = await cancelProviderCall(
      ctx.tenant.id,
      provider,
      providerCallId,
    )
  }

  return NextResponse.json({ ok: true, queue_id: queueId, provider_cancel: providerCancelResult })
}

async function cancelProviderCall(
  repId: string,
  provider: string,
  providerCallId: string,
): Promise<'ok' | 'failed'> {
  try {
    if (provider === 'revring') {
      return await cancelRevRingCall(repId, providerCallId)
    }
    if (provider === 'vapi') {
      return await cancelVapiCall(repId, providerCallId)
    }
    return 'skipped' as unknown as 'ok'
  } catch (err) {
    console.error('[dialer-queue cancel] provider cancel failed', provider, err)
    return 'failed'
  }
}

async function cancelRevRingCall(repId: string, callId: string): Promise<'ok' | 'failed'> {
  const cfg = await getIntegrationConfig(repId, 'revring')
  const apiKey = cfg?.api_key as string | undefined
  if (!apiKey) return 'failed'

  const res = await fetch(`https://api.revring.ai/v1/calls/${encodeURIComponent(callId)}/cancel`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
  })
  return res.ok ? 'ok' : 'failed'
}

async function cancelVapiCall(repId: string, callId: string): Promise<'ok' | 'failed'> {
  const cfg = await getIntegrationConfig(repId, 'vapi')
  const apiKey = cfg?.api_key as string | undefined
  if (!apiKey) return 'failed'

  const res = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status: 'ended' }),
  })
  return res.ok ? 'ok' : 'failed'
}

