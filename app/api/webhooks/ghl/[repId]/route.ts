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
//
// HMAC: GHL sends `x-wh-signature` (HMAC-SHA256 hex of raw body). Per-tenant
// secret in client_integrations.config.webhook_secret. Falls back to skip
// verification when no secret is set (dev / first hookup).

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { sendTelegramMessage } from '@/lib/telegram'

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
  if (!secret) return true
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

  // Tag-update events are noisy but useful for downstream automations —
  // if a rep tagged the contact something meaningful, ping Telegram.
  if (body.type === 'ContactTagUpdate' && Array.isArray(body.tags) && body.tags.length) {
    const meaningful = body.tags.filter((t) => !t.startsWith('vc-'))
    if (meaningful.length) {
      await pingRep(repId, `🏷️ ${name}: tags updated → ${meaningful.join(', ')}`)
    }
  }
}

async function handleOpportunityEvent(repId: string, body: GhlWebhookBody) {
  const oppId = body.id
  if (!oppId) return

  // Find the lead linked to this opportunity (by GHL opportunity object_id).
  // We currently track contacts as leads, not opportunities — best-effort
  // notify only.
  const stage = body.pipelineStageId || body.stageId
  if (body.type === 'OpportunityStageUpdate' && stage) {
    await pingRep(repId, `📊 GHL pipeline stage changed for opportunity ${oppId}`)
  }
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

async function pingRep(repId: string, message: string) {
  const { data: members } = await supabase
    .from('members')
    .select('telegram_chat_id, role')
    .eq('rep_id', repId)
    .not('telegram_chat_id', 'is', null)
  for (const m of members ?? []) {
    if (!m.telegram_chat_id) continue
    if (!['owner', 'admin', 'rep'].includes(m.role)) continue
    await sendTelegramMessage(m.telegram_chat_id, message).catch(() => {})
    break // ping one — owner/admin first
  }
}
