// POST /api/webhooks/sakredcrm/[repId]/stop
//
// Stops the active 4-step calls-only campaign for a SakredCRM-originated lead.
// Idempotent: stopping a lead that has no active campaign returns
// stopped:false, was_active:false. Same HMAC scheme as the lead-push webhook.
//
// Body:
//   {
//     your_crm_lead_id: string                                 // required
//     phone?: string                                           // optional fallback when your_crm_lead_id missing on older rows
//     reason?: 'manual_pause'|'booked_elsewhere'|'dnc'|'sold'|'other'
//   }
//
// Response 200: { ok: true, stopped: boolean, was_active: boolean }
// Response 401: { ok: false, error: 'invalid_signature' }
// Response 404: { ok: false, error: 'lead_not_found_for_rep' }

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { stopCampaign } from '@/lib/campaign/campaignEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StopReason = 'manual_pause' | 'booked_elsewhere' | 'dnc' | 'sold' | 'other'

type StopPayload = {
  your_crm_lead_id?: string
  phone?: string
  reason?: StopReason
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.SAKREDCRM_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[sakredcrm/stop] SAKREDCRM_WEBHOOK_SECRET not configured — rejecting request')
      return false
    }
    console.warn('[sakredcrm/stop] SAKREDCRM_WEBHOOK_SECRET not configured — accepting (dev only)')
    return true
  }
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature
  if (sig.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params
  const raw = await req.text()

  if (!verifySignature(raw, req.headers.get('x-sakredcrm-signature'))) {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 })
  }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, is_active')
    .eq('id', repId)
    .maybeSingle()

  if (!rep?.is_active) {
    return NextResponse.json({ ok: false, error: 'unknown_rep' }, { status: 404 })
  }

  let body: StopPayload
  try {
    body = JSON.parse(raw) as StopPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  if (!body.your_crm_lead_id && !body.phone) {
    return NextResponse.json(
      { ok: false, error: 'required: your_crm_lead_id or phone' },
      { status: 400 },
    )
  }

  const reason = body.reason ?? 'manual_pause'

  // Resolve VC lead. Prefer your_crm_lead_id (matched via active campaign
  // context), fall back to (rep_id, phone) which is the push-side idempotency
  // key. This handles old rows that pre-date the your_crm_lead_id field.
  let leadId: string | null = null
  let activeCampaignId: string | null = null

  if (body.your_crm_lead_id) {
    const { data: campaigns } = await supabase
      .from('lead_campaigns')
      .select('id, lead_id, status')
      .eq('rep_id', repId)
      .filter('context->>your_crm_lead_id', 'eq', body.your_crm_lead_id)
      .order('created_at', { ascending: false })
      .limit(5)

    const active = campaigns?.find((c) => c.status === 'active') ?? null
    if (active) {
      activeCampaignId = active.id as string
      leadId = active.lead_id as string
    } else if (campaigns && campaigns.length > 0) {
      leadId = campaigns[0].lead_id as string  // lead exists but campaign already terminal
    }
  }

  if (!leadId && body.phone) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('rep_id', repId)
      .eq('phone', body.phone)
      .maybeSingle()
    if (lead) leadId = lead.id as string
  }

  if (!leadId) {
    return NextResponse.json(
      { ok: false, error: 'lead_not_found_for_rep' },
      { status: 404 },
    )
  }

  // If we didn't find the campaign by your_crm_lead_id (e.g. payload had only
  // phone), look one up by lead_id as a fallback.
  if (!activeCampaignId) {
    const { data: byLead } = await supabase
      .from('lead_campaigns')
      .select('id')
      .eq('rep_id', repId)
      .eq('lead_id', leadId)
      .eq('status', 'active')
      .maybeSingle()
    activeCampaignId = (byLead?.id as string | undefined) ?? null
  }

  // Drop any not-yet-dialed queue rows so calls don't fire after the stop signal.
  // 'in_progress' is left alone — we don't yank an active live call.
  await supabase
    .from('dialer_queue')
    .update({ status: 'cancelled' })
    .eq('rep_id', repId)
    .eq('lead_id', leadId)
    .in('status', ['queued', 'scheduled', 'pending'])

  if (!activeCampaignId) {
    return NextResponse.json({ ok: true, stopped: false, was_active: false })
  }

  await stopCampaign(activeCampaignId, `sakredcrm_stop:${reason}`, 'stopped')

  return NextResponse.json({ ok: true, stopped: true, was_active: true })
}
