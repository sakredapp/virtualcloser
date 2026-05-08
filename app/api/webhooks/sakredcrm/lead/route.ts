// POST /api/webhooks/sakredcrm/lead
//
// Inbound webhook from SakredCRM — fires when a new lead is created or
// assigned in a campaign. Inserts the lead into VC, starts an AI campaign,
// and returns the VC lead_id + campaign_id so SakredCRM can correlate
// future updates.
//
// Auth: HMAC-SHA256 signature in x-sakredcrm-signature header
//       (shared secret: SAKREDCRM_WEBHOOK_SECRET env var)
//
// Body:
//   {
//     sakred_lead_id: string          // SakredCRM's internal lead ID
//     campaign_source: string         // e.g. "Real Time Meta Health Campaign"
//     product_intent: string          // e.g. "health_insurance"
//     first_name: string
//     last_name: string
//     phone: string                   // E.164
//     email?: string
//     state?: string                  // 2-letter abbreviation
//     assigned_rep_id?: string        // SakredCRM rep/agent ID
//     vc_rep_id?: string              // Virtual Closer rep_id to run the campaign under
//     vc_setter_id?: string           // AiSalesperson.id to use
//     context?: Record<string, unknown>
//   }
//
// Response 200: { ok: true, vc_lead_id, campaign_id }
// Response 4xx/5xx: { ok: false, error }

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { startCampaign } from '@/lib/campaign/campaignEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SakredLeadPayload = {
  sakred_lead_id: string
  campaign_source?: string
  product_intent?: string
  first_name: string
  last_name?: string
  phone: string
  email?: string
  state?: string
  assigned_rep_id?: string    // SakredCRM agent ID — stored for reference
  vc_rep_id?: string          // VC tenant/rep to run the campaign under
  vc_setter_id?: string       // AiSalesperson.id
  context?: Record<string, unknown>
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.SAKREDCRM_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[sakredcrm] SAKREDCRM_WEBHOOK_SECRET not set — accepting all requests (insecure)')
    }
    return true
  }
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature
  if (sig.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

  if (!verifySignature(raw, req.headers.get('x-sakredcrm-signature'))) {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 })
  }

  let body: SakredLeadPayload
  try {
    body = JSON.parse(raw) as SakredLeadPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  if (!body.sakred_lead_id || !body.phone || !body.first_name) {
    return NextResponse.json(
      { ok: false, error: 'required: sakred_lead_id, phone, first_name' },
      { status: 400 },
    )
  }

  // Resolve which VC rep runs this campaign.
  // Priority: body.vc_rep_id → env SAKREDCRM_DEFAULT_VC_REP_ID
  const repId = body.vc_rep_id || process.env.SAKREDCRM_DEFAULT_VC_REP_ID
  if (!repId) {
    return NextResponse.json({ ok: false, error: 'vc_rep_id required (no default set)' }, { status: 400 })
  }

  // Resolve setter — body.vc_setter_id → env SAKREDCRM_DEFAULT_SETTER_ID
  const setterId = body.vc_setter_id || process.env.SAKREDCRM_DEFAULT_SETTER_ID
  if (!setterId) {
    return NextResponse.json({ ok: false, error: 'vc_setter_id required (no default set)' }, { status: 400 })
  }

  // Idempotency: don't create a duplicate lead if this webhook fires twice
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('rep_id', repId)
    .eq('phone', body.phone)
    .maybeSingle()

  let leadId: string

  if (existing?.id) {
    leadId = existing.id as string
  } else {
    // Insert lead into VC
    const { data: newLead, error: insertErr } = await supabase
      .from('leads')
      .insert({
        rep_id: repId,
        first_name: body.first_name,
        last_name: body.last_name ?? '',
        phone: body.phone,
        email: body.email ?? null,
        notes: `SakredCRM lead ${body.sakred_lead_id} — ${body.campaign_source ?? 'unknown campaign'}`,
        source: body.campaign_source ?? 'sakredcrm',
      })
      .select('id')
      .single()

    if (insertErr || !newLead) {
      console.error('[sakredcrm] lead insert failed', insertErr)
      return NextResponse.json({ ok: false, error: insertErr?.message ?? 'lead_insert_failed' }, { status: 500 })
    }
    leadId = newLead.id as string

    // Also insert into crm_leads for disposition tracking
    await supabase.from('crm_leads').insert({
      id: leadId,
      rep_id: repId,
      disposition: 'new',
      product_intent: body.product_intent ?? 'health_insurance',
      sms_consent: true,
      lead_date: new Date().toISOString().slice(0, 10),
      campaign_notes: `SakredCRM: ${body.campaign_source ?? ''} | assigned_rep: ${body.assigned_rep_id ?? ''}`,
    }).maybeSingle()
  }

  // Start the AI campaign
  const templateKey = body.product_intent ?? 'health_insurance'
  const campaign = await startCampaign({
    repId,
    aiSalespersonId: setterId,
    leadId,
    templateKey,
    context: {
      customer_name: body.first_name,
      state: body.state ?? '',
      sakred_lead_id: body.sakred_lead_id,
      sakred_assigned_rep: body.assigned_rep_id ?? '',
      campaign_source: body.campaign_source ?? '',
      ...body.context,
    },
  })

  if (!campaign.ok && campaign.reason !== 'campaign_already_active') {
    console.error('[sakredcrm] startCampaign failed', campaign.reason)
    // Don't fail the webhook — lead was inserted, campaign can be retried
  }

  return NextResponse.json({
    ok: true,
    vc_lead_id: leadId,
    campaign_id: campaign.campaignId ?? null,
    campaign_status: campaign.ok ? 'started' : campaign.reason,
  })
}
