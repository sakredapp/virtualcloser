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
//   - OutboundCall / InboundCall / Call* (call disposition events) — also
//     the ingest path for WAVV-on-GHL clients. Most WAVV users dial *inside*
//     GHL (Chrome extension / embedded dialer) so the call activity lands
//     on the GHL contact and we receive it via this webhook. If the rep has
//     addon_wavv_kpi active, we tag voice_calls.provider='wavv' and roll
//     today's dialer_kpis. No WAVV API key required.
//
// HMAC: GHL sends `x-wh-signature` (HMAC-SHA256 hex of raw body). Per-tenant
// secret in client_integrations.config.webhook_secret. Falls back to skip
// verification when no secret is set (dev / first hookup).

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { sendTelegramMessage } from '@/lib/telegram'
import { recomputeDailyKpis } from '@/lib/wavv'
import { isAddonActive } from '@/lib/entitlements'
import { recordUsage } from '@/lib/usage'

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
    } else if (isCallEventType(type, body)) {
      await handleCallEvent(repId, body)
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

    // SMS workflow trigger — if this rep has a matching sms_workflow on the
    // twilio integration, fire it. Stage match is by GHL stage id OR by
    // human-readable substring of the stage name (e.g. "approved").
    try {
      const { findMatchingSmsWorkflows, fillSmsTemplate, sendSms } = await import('@/lib/sms')
      const stageName =
        (body.stageName as string | undefined) ||
        (body.pipelineStageName as string | undefined) ||
        null
      const flows = await findMatchingSmsWorkflows(repId, { stageId: stage, stageName })
      if (flows.length) {
        // Resolve recipient phone via the linked contact, if any.
        const contactId = body.contactId
        let phone: string | null = null
        let firstName: string | null = null
        if (contactId) {
          const { data: lead } = await supabase
            .from('leads')
            .select('phone, name')
            .eq('rep_id', repId)
            .eq('crm_source', 'ghl')
            .eq('crm_object_id', contactId)
            .maybeSingle()
          phone = (lead?.phone as string | null) || null
          firstName = ((lead?.name as string | null) ?? '').split(' ')[0] || null
        }
        if (phone) {
          for (const flow of flows) {
            const message = fillSmsTemplate(flow.template, {
              first_name: firstName,
              stage_name: stageName,
              opportunity_id: oppId,
            })
            const result = await sendSms(repId, { to: phone, body: message })
            if (!result.ok) {
              console.error('[ghl→sms] send failed', result.reason)
              await pingRep(repId, `⚠️ SMS workflow failed: ${result.reason}`)
            } else {
              await pingRep(repId, `📱 SMS sent → ${firstName ?? phone} ("${message.slice(0, 80)}")`)
            }
          }
        }
      }
    } catch (err) {
      console.error('[ghl→sms] workflow exception', err)
    }
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

// ── Call events (WAVV-on-GHL primary path) ───────────────────────────────
//
// GHL workflows can be configured to fire a webhook on call events. The
// trigger names + payload field names vary across GHL accounts (some use
// "Call Status" trigger, some use "Outbound Calls", and the 1-click "Call
// Logs" workflow templates emit slightly different shapes). We normalize
// defensively, same approach as the standalone WAVV webhook.
//
// Recommended client setup (documented on the onboarding checklist):
//   GHL → Automation → Workflows → New workflow:
//     Trigger: "Call Status" (any status)
//     Action:  "Webhook" → POST {{repId}} URL
//   Save & publish. Every call WAVV places inside GHL fires this webhook.

function isCallEventType(type: string, body: GhlWebhookBody): boolean {
  const t = (type || '').toLowerCase()
  if (
    t.includes('call') ||
    t === 'outboundcall' ||
    t === 'inboundcall' ||
    t === 'callstatus' ||
    t === 'calldisposition'
  ) {
    return true
  }
  // Some GHL workflow webhooks don't set `type` — detect by call-shaped
  // fields instead.
  const hasCallId =
    typeof body['call_id'] === 'string' ||
    typeof body['callId'] === 'string' ||
    typeof body['call_uuid'] === 'string'
  const hasDispo =
    typeof body['call_status'] === 'string' ||
    typeof body['callStatus'] === 'string' ||
    typeof body['disposition'] === 'string'
  return hasCallId || hasDispo
}

function pickStr(b: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = b[k]
    if (typeof v === 'string' && v) return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

function pickNum(b: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = b[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function mapGhlCallStatus(d: string | null, durSec: number | null): string | null {
  if (!d) {
    if (durSec !== null && durSec >= 30) return 'connected'
    if (durSec !== null && durSec > 0) return 'no_answer'
    return null
  }
  const n = d.toLowerCase().replace(/[\s-]+/g, '_')
  if (n.includes('connect') || n.includes('answer') || n === 'completed' || n === 'live') return 'connected'
  if (n.includes('voicemail') || n === 'vm') return 'voicemail'
  if (n.includes('no_answer') || n === 'noanswer' || n === 'missed' || n === 'ring_no_answer') return 'no_answer'
  if (n.includes('busy') || n.includes('fail') || n === 'declined' || n === 'rejected' || n === 'canceled' || n === 'cancelled') return 'failed'
  if (n.includes('booked') || n.includes('appointment') || n === 'set' || n.includes('confirmed')) return 'confirmed'
  return null
}

async function handleCallEvent(repId: string, body: GhlWebhookBody) {
  const b = body as unknown as Record<string, unknown>
  const callId = pickStr(b, 'call_id', 'callId', 'call_uuid', 'id', 'sid')
  if (!callId) return

  const dispoRaw = pickStr(b, 'call_status', 'callStatus', 'disposition', 'status', 'outcome')
  const durationSec = pickNum(b, 'duration', 'duration_sec', 'duration_seconds', 'call_duration', 'talk_time')
  const outcome = mapGhlCallStatus(dispoRaw, durationSec)

  const to = pickStr(b, 'to', 'to_number', 'toNumber', 'phone', 'contact_phone', 'dialed_number')
  const from = pickStr(b, 'from', 'from_number', 'fromNumber', 'caller_id', 'agent_phone')
  const recordingUrl = pickStr(b, 'recording_url', 'recordingUrl', 'recording', 'audio_url')
  const startedAt = pickStr(b, 'started_at', 'startedAt', 'start_time', 'startTime', 'date_added', 'created_at')
  const endedAt = pickStr(b, 'ended_at', 'endedAt', 'end_time', 'endTime')
  const costCents =
    pickNum(b, 'cost_cents', 'costCents') ??
    (() => {
      const dollars = pickNum(b, 'cost', 'cost_usd', 'price', 'amount')
      return dollars === null ? null : Math.round(dollars * 100)
    })()

  // If the WAVV add-on is active, attribute these calls to WAVV. Otherwise
  // we still ingest under provider='ghl' for a generic dialer record.
  const wavvActive = await isAddonActive(repId, 'addon_wavv_kpi')
  const provider: 'wavv' | 'ghl' = wavvActive ? 'wavv' : 'ghl'

  // Lead linkage by GHL contact id first, then fall back to phone last-10.
  let leadId: string | null = null
  const contactId = pickStr(b, 'contactId', 'contact_id')
  if (contactId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('rep_id', repId)
      .eq('crm_source', 'ghl')
      .eq('crm_object_id', contactId)
      .maybeSingle()
    if (lead) leadId = lead.id
  }
  if (!leadId && (to || from)) {
    const last10 = (to || from || '').replace(/\D/g, '').slice(-10)
    if (last10.length === 10) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('rep_id', repId)
        .like('phone', `%${last10}`)
        .maybeSingle()
      if (lead) leadId = lead.id
    }
  }

  await supabase.from('voice_calls').upsert(
    {
      rep_id: repId,
      lead_id: leadId,
      provider,
      provider_call_id: callId,
      direction: 'outbound_dial',
      to_number: to,
      from_number: from,
      status: 'completed',
      outcome,
      recording_url: recordingUrl,
      duration_sec: durationSec,
      cost_cents: costCents,
      started_at: startedAt,
      ended_at: endedAt,
      raw: body as Record<string, unknown>,
    },
    { onConflict: 'provider,provider_call_id' },
  )

  const day = (startedAt || endedAt || new Date().toISOString()).slice(0, 10)
  await recomputeDailyKpis(repId, day).catch((err) =>
    console.error('[ghl→wavv] kpi recompute failed', err),
  )

  if (wavvActive) {
    await recordUsage({
      repId,
      addonKey: 'addon_wavv_kpi',
      eventType: 'wavv_dial',
      sourceTable: 'voice_calls',
      sourceId: callId,
      metadata: { via: 'ghl', disposition_raw: dispoRaw, outcome },
    }).catch((err) => console.error('[ghl→wavv] recordUsage failed', err))
  }
}
