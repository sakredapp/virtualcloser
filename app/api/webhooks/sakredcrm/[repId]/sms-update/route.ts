// POST /api/webhooks/sakredcrm/[repId]/sms-update
//
// SakredCRM fires this every time an inbound SMS arrives for a lead.
// VC appends it to the campaign's sms_thread so Rachel has full context
// before the call fires. Opt-out language kills the campaign immediately.
//
// Body: { vc_lead_id, direction, body, sent_at }

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { stopCampaign } from '@/lib/campaign/campaignEngine'
import { classifySmsReply } from '@/lib/campaign/aiDecision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SmsUpdatePayload = {
  vc_lead_id: string
  direction: 'inbound' | 'outbound'
  body: string
  sent_at?: string
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.SAKREDCRM_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[sakredcrm/sms-update] SAKREDCRM_WEBHOOK_SECRET not configured — rejecting request')
      return false
    }
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

  let body: SmsUpdatePayload
  try {
    body = JSON.parse(raw) as SmsUpdatePayload
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  if (!body.vc_lead_id || !body.body) {
    return NextResponse.json({ ok: false, error: 'required: vc_lead_id, body' }, { status: 400 })
  }

  // Find the active campaign for this lead
  const { data: campaign } = await supabase
    .from('lead_campaigns')
    .select('id, context, current_step, max_steps')
    .eq('rep_id', repId)
    .eq('lead_id', body.vc_lead_id)
    .eq('status', 'active')
    .maybeSingle()

  if (!campaign) {
    // No active campaign — still 200 so SakredCRM doesn't retry
    return NextResponse.json({ ok: true, note: 'no_active_campaign' })
  }

  const ctx = (campaign.context ?? {}) as Record<string, unknown>
  const thread = (ctx.sms_thread as { direction: string; body: string; sent_at: string }[]) ?? []

  // Append this message to the thread
  thread.push({ direction: body.direction, body: body.body, sent_at: body.sent_at ?? new Date().toISOString() })

  // Check for opt-out on inbound messages — cancel campaign immediately
  if (body.direction === 'inbound') {
    const classification = classifySmsReply(body.body)
    if (classification === 'sms_replied_negative') {
      await supabase
        .from('lead_campaigns')
        .update({ context: { ...ctx, sms_thread: thread } })
        .eq('id', campaign.id)
      await stopCampaign(campaign.id, 'sms_opt_out_or_negative', 'stopped')
      await supabase
        .from('leads')
        .update({ disposition: 'not_interested' })
        .eq('id', body.vc_lead_id)
      return NextResponse.json({ ok: true, action: 'campaign_stopped' })
    }
  }

  // Otherwise just update the context with the new thread
  await supabase
    .from('lead_campaigns')
    .update({ context: { ...ctx, sms_thread: thread } })
    .eq('id', campaign.id)

  return NextResponse.json({ ok: true, thread_length: thread.length })
}
