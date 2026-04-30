// Vapi webhook receiver.
//
// Vapi posts events for every call: `status-update`, `end-of-call-report`,
// `transcript`, `function-call`, etc. We care about:
//   - `end-of-call-report`     → finalize voice_calls row, flip meeting
//                                status, stamp GHL tag, ping rep on TG.
//   - `function-call`          → reschedule assistant invoking our
//                                free-slots / book-slot tools (handled in
//                                /api/voice/reschedule-tool — Vapi calls
//                                that endpoint directly when configured).
//
// Per-tenant secret lives in client_integrations.config.webhook_secret.
// We resolve it via the metadata.rep_id on the call record.

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { verifyVapiSecret } from '@/lib/voice/vapi'
import { updateMeetingStatus, getMeeting } from '@/lib/meetings'
import {
  dispatchRescheduleCall,
  notifyAppointmentSetterBooked,
  notifyRepOfDialerOutcome,
  syncAppointmentSetterBookingToGHL,
  applyAiSalespersonOutcome,
} from '@/lib/voice/dialer'
import { runPostCallAnalysis } from '@/lib/voice/postCall'
import { makeAgentCRMForRep } from '@/lib/agentcrm'
import { recordUsage, resolveActiveAddon } from '@/lib/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type VapiCallObject = {
  id?: string
  status?: string
  endedReason?: string
  metadata?: Record<string, unknown>
  analysis?: {
    summary?: string
    structuredData?: Record<string, unknown>
    // Vapi can return successEvaluation as a string keyword, a number score,
    // OR a boolean depending on rubric type. Type-narrow at use site.
    successEvaluation?: string | number | boolean
  }
}

type VapiArtifact = {
  transcript?: string
  recordingUrl?: string
  recording?: {
    stereoUrl?: string
    url?: string
    mono?: { combinedUrl?: string }
  }
  messages?: Array<{ role: string; message?: string; toolCalls?: unknown }>
}

type VapiWebhookBody = {
  message?: {
    type?: string
    call?: VapiCallObject
    artifact?: VapiArtifact
    transcript?: string
    recordingUrl?: string
    durationSeconds?: number
    startedAt?: string
    endedAt?: string
    endedReason?: string
    cost?: number                    // dollars (top-level on the message)
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

  let body: VapiWebhookBody
  try {
    body = JSON.parse(raw) as VapiWebhookBody
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const repId = (body.message?.call?.metadata?.rep_id as string) || undefined
  const ok = await verifyVapiSecret(
    req.headers.get('x-vapi-secret'),
    req.headers.get('authorization'),
    repId,
  )
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const msg = body.message
  if (!msg) return NextResponse.json({ ok: true })

  const type = msg.type
  const vapiCallId = msg.call?.id
  if (!vapiCallId) return NextResponse.json({ ok: true })

  // Find our voice_calls row for this Vapi call id.
  const { data: callRow } = await supabase
    .from('voice_calls')
    .select('*')
    .eq('provider', 'vapi')
    .eq('provider_call_id', vapiCallId)
    .maybeSingle()

  if (!callRow) {
    // Could be a call we didn't originate — record minimally for audit.
    console.warn('[vapi] webhook for unknown call', vapiCallId, type)
    return NextResponse.json({ ok: true, ignored: true })
  }

  // Lightweight status updates (status-update events).
  if (type === 'status-update') {
    const status = mapStatus(msg.call?.status)
    if (status) {
      await supabase.from('voice_calls').update({ status }).eq('id', callRow.id)
    }
    return NextResponse.json({ ok: true })
  }

  if (type !== 'end-of-call-report' && type !== 'call.ended') {
    // Other event types (transcript chunks, hang, function-call) — ignore;
    // function-call is handled by the assistant tool endpoint directly.
    return NextResponse.json({ ok: true })
  }

  // End-of-call: persist transcript, recording, cost, and derive outcome.
  const transcript = msg.artifact?.transcript ?? msg.transcript ?? null
  const recordingUrl =
    msg.artifact?.recording?.stereoUrl ??
    msg.artifact?.recording?.url ??
    msg.artifact?.recording?.mono?.combinedUrl ??
    msg.artifact?.recordingUrl ??
    msg.recordingUrl ??
    null
  const costCents =
    typeof msg.cost === 'number' ? Math.round(msg.cost * 100) : null
  const durationSec = msg.durationSeconds ?? null
  const startedAt = msg.startedAt ?? null
  const endedAt = msg.endedAt ?? null

  // Vapi puts analysis on the call object: message.call.analysis.{summary,structuredData,successEvaluation}
  const analysis = msg.call?.analysis
  const endedReason = msg.endedReason ?? msg.call?.endedReason

  const outcome = deriveOutcome({ analysis, endedReason }, callRow.direction)
  const dtmf = (analysis?.structuredData?.dtmf as string | undefined) ?? null

  // Enrich with post-call fields (columns added by post_call_enrichment_migration.sql).
  const vapiSummary    = analysis?.summary ?? null
  const vapiHangup     = endedReason ?? null
  const errorMessage   = (endedReason && endedReason.includes('error')) ? endedReason : null
  const callVariables  = (analysis?.structuredData ?? {}) as Record<string, unknown>
  const callMetrics: Record<string, unknown> = {}
  if (typeof durationSec === 'number') callMetrics.duration_sec = durationSec
  if (typeof costCents === 'number')   callMetrics.cost_cents    = costCents

  await supabase
    .from('voice_calls')
    .update({
      status: 'completed',
      outcome,
      transcript,
      recording_url: recordingUrl,
      cost_cents: costCents,
      duration_sec: durationSec,
      started_at: startedAt,
      ended_at: endedAt,
      dtmf_input: dtmf,
      summary: vapiSummary,
      hangup_cause: vapiHangup,
      error_message: errorMessage,
      call_variables: callVariables,
      call_metrics: callMetrics,
      raw: msg as unknown as Record<string, unknown>,
    })
    .eq('id', callRow.id)

  // If the call ended because it was transferred, mark the transfer as completed.
  if (endedReason === 'transfer' || endedReason === 'forwarded') {
    const queueId =
      (msg.call?.metadata?.queue_id as string | undefined) ??
      (typeof callRow.raw?.queue_id === 'string' ? callRow.raw.queue_id : null)
    if (queueId) {
      await supabase
        .from('dialer_queue')
        .update({ live_transfer_status: 'transferred', status: 'completed', last_outcome: 'transferred' })
        .eq('id', queueId)
        .eq('rep_id', callRow.rep_id)
      await supabase.from('dialer_queue_events').insert({
        rep_id: callRow.rep_id,
        queue_id: queueId,
        event_type: 'live_transfer_attempted',
        outcome: 'transferred',
        payload: { voice_call_id: callRow.id, ended_reason: endedReason },
      })
    }
  }

  // Queue lifecycle: if this call came from dialer_queue, mark the queue item
  // complete/failed only when the provider says the call actually ended.
  await finalizeQueueFromCall(callRow, {
    queueIdFromMeta: (msg.call?.metadata?.queue_id as string | undefined) ?? null,
    outcome,
  }).catch((err) => console.error('[vapi] queue finalize failed', err))

  // AI Salesperson canonical pipeline: move lead + create followup row.
  // Only fires for appointment_setter mode rows that have an ai_salesperson_id
  // and a lead_id. Idempotent and best-effort.
  await applyAiSalespersonOutcome({
    callRow: {
      id: callRow.id,
      rep_id: callRow.rep_id,
      lead_id: (callRow.lead_id as string | null) ?? null,
      ai_salesperson_id: (callRow.ai_salesperson_id as string | null) ?? null,
      dialer_mode: (callRow.dialer_mode as string | null) ?? null,
      raw: (callRow.raw as Record<string, unknown> | null) ?? null,
    },
    outcome,
    transcript,
    callVariables,
  })

  // Appointment Setter realtime alert: whenever this mode books an appt,
  // push an immediate Telegram ping with who/when.
  if (callRow.dialer_mode === 'appointment_setter' && outcome === 'confirmed') {
    const bookedAtIso =
      (callVariables.booking_time as string | undefined) ??
      (callVariables.appointment_time as string | undefined) ??
      (callVariables.booked_for as string | undefined) ??
      null
    const bookedEndIso =
      (callVariables.booking_end_time as string | undefined) ??
      (callVariables.appointment_end_time as string | undefined) ??
      null
    const setterId = (callRow.ai_salesperson_id as string | null) ?? null
    let setterName: string | null = null
    if (setterId) {
      const { data: s } = await supabase
        .from('ai_salespeople')
        .select('name')
        .eq('id', setterId)
        .maybeSingle()
      setterName = (s?.name as string | undefined) ?? null
    }
    await notifyAppointmentSetterBooked({
      repId: callRow.rep_id,
      leadName: callVariables.name as string | null,
      phone: (callRow.to_number as string | null) ?? null,
      bookedAtIso,
      setterName,
    }).catch((err) => console.error('[vapi] setter booked notify failed', err))
    void syncAppointmentSetterBookingToGHL({
      repId: callRow.rep_id,
      leadName: callVariables.name as string | null,
      phone: (callRow.to_number as string | null) ?? null,
      email: callVariables.email as string | null ?? null,
      bookedAtIso,
      bookedEndIso,
      setterId,
    })
  }

  // Record usage against the dialer add-on cap. Only count outcomes that
  // actually used billable Vapi minutes; we do NOT count blocked/failed
  // calls. Confirmed appointments are the primary cap unit.
  if (outcome === 'confirmed') {
    const dialerKey = await resolveActiveAddon(callRow.rep_id, [
      'addon_dialer_pro',
      'addon_dialer_lite',
    ])
    if (dialerKey) {
      await recordUsage({
        repId: callRow.rep_id,
        addonKey: dialerKey,
        eventType: 'appt_confirmed',
        quantity: 1,
        unit: 'appts_confirmed',
        costCentsEstimate: costCents ?? 20,
        sourceTable: 'voice_calls',
        sourceId: callRow.id,
        metadata: { direction: callRow.direction, vapi_call_id: vapiCallId },
      }).catch((err) => console.error('[vapi] recordUsage failed', err))
    }
  }

  // Flip meeting status based on outcome.
  if (callRow.meeting_id && outcome) {
    const meetingStatus = outcomeToMeetingStatus(outcome, callRow.direction)
    if (meetingStatus) {
      await updateMeetingStatus(callRow.meeting_id, { status: meetingStatus })
    }

    const meeting = await getMeeting(callRow.meeting_id)

    // Stamp GHL tag if we have a CRM contact for this lead.
    if (meeting?.lead_id) {
      await stampGhlTag(callRow.rep_id, meeting.lead_id, outcome).catch((err) =>
        console.error('[vapi] ghl tag failed', err),
      )
    }

    // If reschedule requested, fire the reschedule assistant.
    if (outcome === 'reschedule_requested' && callRow.direction === 'outbound_confirm') {
      dispatchRescheduleCall(callRow.meeting_id).catch((err) =>
        console.error('[vapi] reschedule dispatch failed', err),
      )
    }

    // Ping the rep on Telegram.
    notifyRepOfDialerOutcome({
      repId: callRow.rep_id,
      meetingId: callRow.meeting_id,
      outcome,
      attendeeName: meeting?.attendee_name ?? null,
    }).catch((err) => console.error('[vapi] notify failed', err))

    // Run Claude over the transcript: 2-3 sentence summary + next-action,
    // create a follow-up brain_item if outcome is negative. Fire-and-forget.
    runPostCallAnalysis({
      voiceCallId: callRow.id,
      repId: callRow.rep_id,
      meetingId: callRow.meeting_id,
      outcome,
      transcript,
      attendeeName: meeting?.attendee_name ?? null,
      scheduledAtIso: meeting?.scheduled_at ?? null,
    }).catch((err) => console.error('[vapi] post-call analysis failed', err))
  }

  return NextResponse.json({ ok: true })
}

// Map Vapi call.status → voice_calls.status enum.
function mapStatus(s: string | undefined): string | null {
  if (!s) return null
  switch (s) {
    case 'queued':
      return 'queued'
    case 'ringing':
      return 'ringing'
    case 'in-progress':
    case 'ongoing':
      return 'in_progress'
    case 'forwarding':
      return 'in_progress'
    case 'ended':
      return 'completed'
    default:
      return null
  }
}

function deriveOutcome(
  msg: {
    analysis?: {
      structuredData?: Record<string, unknown>
      successEvaluation?: string | number | boolean
    }
    endedReason?: string
  },
  direction: string,
): string | null {
  // Vapi gives us a few signals: endedReason, analysis.successEvaluation,
  // structuredData. Prefer structuredData if the assistant was configured to
  // output a `result: 'confirmed' | 'reschedule' | ...` field; fall back to
  // endedReason heuristics.
  const structured = msg.analysis?.structuredData as
    | { result?: string; outcome?: string; confirmed?: boolean }
    | undefined
  const explicit =
    (structured?.result as string | undefined) ||
    (structured?.outcome as string | undefined)
  if (explicit) {
    const norm = explicit.toLowerCase().replace(/\s+/g, '_')
    if (norm.startsWith('confirm')) return 'confirmed'
    if (norm.startsWith('resched')) return direction === 'outbound_reschedule' ? 'rescheduled' : 'reschedule_requested'
    if (norm === 'cancelled' || norm === 'canceled') return 'cancelled'
    if (norm.includes('voicemail')) return 'voicemail'
    if (norm.includes('no_answer') || norm === 'no-answer') return 'no_answer'
  }

  if (typeof structured?.confirmed === 'boolean') {
    return structured.confirmed ? 'confirmed' : 'reschedule_requested'
  }

  const reason = msg.endedReason || ''
  if (reason.includes('voicemail')) return 'voicemail'
  if (reason.includes('no-answer') || reason.includes('no_answer')) return 'no_answer'
  if (reason.includes('failed')) return 'failed'
  if (reason.includes('customer-ended-call')) return 'connected'
  if (reason.includes('assistant-ended-call')) return 'connected'

  return null
}

function outcomeToMeetingStatus(
  outcome: string,
  direction: string,
): 'confirmed' | 'reschedule_requested' | 'rescheduled' | 'cancelled' | 'no_response' | null {
  switch (outcome) {
    case 'confirmed':
      return 'confirmed'
    case 'reschedule_requested':
      return direction === 'outbound_reschedule' ? null : 'reschedule_requested'
    case 'rescheduled':
      return 'rescheduled'
    case 'cancelled':
      return 'cancelled'
    case 'voicemail':
    case 'no_answer':
      return 'no_response'
    default:
      return null
  }
}

async function stampGhlTag(repId: string, leadId: string, outcome: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('crm_source, crm_object_id, email, phone')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return
  if (lead.crm_source && lead.crm_source !== 'ghl') return

  const crm = await makeAgentCRMForRep(repId)
  if (!crm) return

  // Find the contact id. If we don't already have an `crm_object_id` mapping,
  // try a duplicate-search by email or phone.
  let contactId: string | undefined
  if (lead.crm_source === 'ghl' && lead.crm_object_id) {
    contactId = lead.crm_object_id
  } else {
    const query = lead.email || lead.phone
    if (!query) return
    const matches = await crm.searchContacts(query).catch(() => [])
    contactId = matches[0]?.id
  }
  if (!contactId) return

  const tagMap: Record<string, string[]> = {
    confirmed: ['vc-confirmed'],
    reschedule_requested: ['vc-reschedule-requested'],
    rescheduled: ['vc-rescheduled'],
    cancelled: ['vc-cancelled'],
    voicemail: ['vc-voicemail'],
    no_answer: ['vc-no-answer'],
  }
  const tags = tagMap[outcome]
  if (!tags) return
  await crm.addTag(contactId, tags)
}

async function finalizeQueueFromCall(
  callRow: {
    id: string
    rep_id: string
    raw: Record<string, unknown> | null
  },
  args: {
    queueIdFromMeta: string | null
    outcome: string | null
  },
): Promise<void> {
  const rawQueueId =
    typeof callRow.raw?.queue_id === 'string' ? (callRow.raw.queue_id as string) : null
  const queueId = args.queueIdFromMeta || rawQueueId
  if (!queueId) return

  const isFailed = !args.outcome || args.outcome === 'failed'
  const status = isFailed ? 'failed' : 'completed'

  await supabase
    .from('dialer_queue')
    .update({
      status,
      last_outcome: args.outcome,
      next_retry_at: null,
    })
    .eq('id', queueId)
    .eq('rep_id', callRow.rep_id)

  await supabase.from('dialer_queue_events').insert({
    rep_id: callRow.rep_id,
    queue_id: queueId,
    event_type: isFailed ? 'failed' : 'provider_call_completed',
    outcome: args.outcome,
    reason: isFailed ? 'provider_call_failed_or_unknown' : null,
    payload: {
      voice_call_id: callRow.id,
      outcome: args.outcome,
    },
  })
}
