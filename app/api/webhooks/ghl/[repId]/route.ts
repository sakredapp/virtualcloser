// Inbound GHL webhooks. Most GHL tenants configure a single webhook URL
// per location and send all event types to it. We dispatch on `type`.
//
// URL shape: /api/webhooks/ghl/[repId]
//   so we know which tenant the event belongs to without parsing GHL's
//   locationId every time.
//
// Verified events:
//   - ContactCreate / ContactUpdate
//   - ContactTagUpdate
//   - OpportunityCreate / OpportunityStatusUpdate / OpportunityStageUpdate
//   - AppointmentCreate / AppointmentUpdate / AppointmentDelete
//   (No call events: Suite CXO has no calling or texting, owner 2026-10-17.)
//
// HMAC: GHL sends `x-wh-signature` (HMAC-SHA256 hex of raw body). Per-tenant
// secret in client_integrations.config.webhook_secret. Falls back to GHL_WEBHOOK_SECRET
// env var. Fails closed in production if no secret is configured.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { logError } from '@/lib/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GhlWebhookBody = {
  type?: string
  locationId?: string
  contactId?: string
  id?: string
  // Contact fields
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  tags?: string[]
  // Opportunity fields
  pipelineId?: string
  pipelineStageId?: string
  stageId?: string
  status?: string
  monetaryValue?: number
  // Appointment fields
  calendarId?: string
  startTime?: string
  endTime?: string
  appointmentStatus?: string
  // Generic
  [key: string]: unknown
}

async function verifyGhlSignature(
  rawBody: string,
  signature: string | null,
  repId: string,
): Promise<boolean> {
  const cfg = await getIntegrationConfig(repId, 'ghl')
  const secret = (cfg?.webhook_secret as string | undefined) || process.env.GHL_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed in every environment. The dev-mode "accept anyway"
    // path was a footgun — Vercel preview / staging deploys run with
    // NODE_ENV=production but local dev doesn't, so anyone running the
    // worker locally would have silently accepted forged GHL webhooks.
    console.error('[ghl] webhook_secret not configured for rep', repId, '— rejecting request')
    return false
  }
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params
  const raw = await req.text()
  const sig = req.headers.get('x-wh-signature') || req.headers.get('x-ghl-signature')
  if (!(await verifyGhlSignature(raw, sig, repId))) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
  }

  let body: GhlWebhookBody
  try {
    body = JSON.parse(raw) as GhlWebhookBody
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  // Verify the rep exists.
  const { data: rep } = await supabase.from('reps').select('id').eq('id', repId).maybeSingle()
  if (!rep) return NextResponse.json({ error: 'unknown_rep' }, { status: 404 })

  const type = body.type || ''

  try {
    if (type.startsWith('Contact')) {
      await handleContactEvent(repId, body)
    } else if (type.startsWith('Opportunity')) {
      await handleOpportunityEvent(repId, body)
    } else if (type.startsWith('Appointment')) {
      await handleAppointmentEvent(repId, body)
    }
    return NextResponse.json({ ok: true, type })
  } catch (err) {
    console.error('[ghl webhook] error', type, err)
    await logError({
      source: 'webhook/ghl',
      errorType: 'handler_failed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      repId: repId ?? null,
      context: { type, contactId: body.contactId ?? body.id ?? null },
    })
    return NextResponse.json({ ok: false, error: 'handler_failed' }, { status: 500 })
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleContactEvent(repId: string, body: GhlWebhookBody) {
  const ghlContactId = body.contactId || body.id
  if (!ghlContactId) return

  // Upsert lead by (rep_id, crm_source='ghl', crm_object_id).
  const { data: existing } = await supabase
    .from('leads')
    .select('id, name, email, phone')
    .eq('rep_id', repId)
    .eq('crm_source', 'ghl')
    .eq('crm_object_id', ghlContactId)
    .maybeSingle()

  const name = [body.firstName, body.lastName].filter(Boolean).join(' ').trim() || 'Unknown'
  const update = {
    name,
    email: body.email ?? null,
    phone: body.phone ?? null,
  }

  if (existing) {
    await supabase.from('leads').update(update).eq('id', existing.id)
  } else {
    await supabase.from('leads').insert({
      rep_id: repId,
      crm_source: 'ghl',
      crm_object_id: ghlContactId,
      source: 'ghl',
      ...update,
    })
  }
}

// Opportunity events are acknowledged but not acted on: stage changes used to
// fire SMS workflows, and Suite CXO has no texting (owner 2026-10-17).
async function handleOpportunityEvent(_repId: string, _body: GhlWebhookBody) {
  return
}

async function handleAppointmentEvent(repId: string, body: GhlWebhookBody) {
  const apptId = body.id
  if (!apptId || !body.startTime) return

  const { data: existing } = await supabase
    .from('meetings')
    .select('id, status, scheduled_at')
    .eq('rep_id', repId)
    .eq('source', 'ghl')
    .eq('source_event_id', apptId)
    .maybeSingle()

  // Try to link to a lead if we have the GHL contact id mapped.
  let leadId: string | null = null
  if (body.contactId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('rep_id', repId)
      .eq('crm_source', 'ghl')
      .eq('crm_object_id', body.contactId)
      .maybeSingle()
    if (lead) leadId = lead.id
  }

  const phone =
    (body.phone as string | undefined) ||
    (body.contactId
      ? (
          await supabase
            .from('leads')
            .select('phone')
            .eq('rep_id', repId)
            .eq('crm_source', 'ghl')
            .eq('crm_object_id', body.contactId)
            .maybeSingle()
        ).data?.phone
      : null) ||
    null

  if (body.type === 'AppointmentDelete') {
    if (existing) {
      await supabase.from('meetings').update({ status: 'cancelled' }).eq('id', existing.id)
    }
    return
  }

  const dur =
    body.endTime && body.startTime
      ? Math.max(
          5,
          Math.round(
            (new Date(body.endTime).getTime() - new Date(body.startTime).getTime()) / 60_000,
          ),
        )
      : 30

  if (existing) {
    const patch: Record<string, unknown> = {
      scheduled_at: body.startTime,
      duration_min: dur,
      lead_id: leadId ?? undefined,
      phone: phone ?? undefined,
    }
    // If GHL says the appointment was cancelled, mirror it.
    if (body.appointmentStatus === 'cancelled') patch.status = 'cancelled'
    await supabase.from('meetings').update(patch).eq('id', existing.id)
  } else {
    await supabase.from('meetings').insert({
      rep_id: repId,
      lead_id: leadId,
      source: 'ghl',
      source_event_id: apptId,
      attendee_email: body.email ?? null,
      phone,
      scheduled_at: body.startTime,
      duration_min: dur,
      title: (body.title as string) ?? null,
    })
  }
}
