// POST /api/webhooks/sakredcrm/[repId]/lead
//
// Inbound webhook from SakredCRM. repId is in the URL — no env vars needed
// for routing. The active AI agent for this rep is auto-resolved from the DB
// by product_intent (defaults to health_insurance).
//
// Auth: HMAC-SHA256 in x-sakredcrm-signature (secret: SAKREDCRM_WEBHOOK_SECRET)
//
// Body:
//   {
//     sakred_lead_id: string
//     campaign_source?: string
//     product_intent?: string        // e.g. "health_insurance" — used to pick agent
//     first_name: string
//     last_name?: string
//     phone: string                  // E.164
//     email?: string
//     state?: string
//     assigned_rep_id?: string       // SakredCRM agent ID — stored for reference
//     context?: Record<string, unknown>
//   }
//
// Response 200: { ok: true, vc_lead_id, campaign_id, campaign_status }

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
  assigned_rep_id?: string
  context?: Record<string, unknown>
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.SAKREDCRM_WEBHOOK_SECRET
  if (!secret) return true // warn-only in dev; lock down in prod via env
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

  // Verify rep exists and is active
  const { data: rep } = await supabase
    .from('reps')
    .select('id, is_active')
    .eq('id', repId)
    .maybeSingle()

  if (!rep?.is_active) {
    return NextResponse.json({ ok: false, error: 'unknown_rep' }, { status: 404 })
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

  // Auto-resolve the AI agent: exact product_category match first, then any active agent.
  const productCategory = body.product_intent ?? 'health_insurance'
  const { data: allAgents } = await supabase
    .from('ai_salespeople')
    .select('id, product_category')
    .eq('rep_id', repId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const setterId =
    allAgents?.find((a) => a.product_category === productCategory)?.id ??
    allAgents?.[0]?.id
  if (!setterId) {
    return NextResponse.json(
      { ok: false, error: 'no_active_agent — provision one at /admin/clients/' + repId },
      { status: 422 },
    )
  }

  // Idempotency — don't duplicate if webhook fires twice
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
      return NextResponse.json(
        { ok: false, error: insertErr?.message ?? 'lead_insert_failed' },
        { status: 500 },
      )
    }
    leadId = newLead.id as string

    await supabase.from('crm_leads').insert({
      id: leadId,
      rep_id: repId,
      disposition: 'new',
      product_intent: productCategory,
      sms_consent: true,
      lead_date: new Date().toISOString().slice(0, 10),
      campaign_notes: `SakredCRM: ${body.campaign_source ?? ''} | assigned_rep: ${body.assigned_rep_id ?? ''}`,
    }).maybeSingle()
  }

  const campaign = await startCampaign({
    repId,
    aiSalespersonId: setterId,
    leadId,
    templateKey: productCategory,
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
  }

  return NextResponse.json({
    ok: true,
    vc_lead_id: leadId,
    campaign_id: campaign.campaignId ?? null,
    campaign_status: campaign.ok ? 'started' : campaign.reason,
  })
}
