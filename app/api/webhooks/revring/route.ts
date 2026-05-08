import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { verifyRevringSecret } from '@/lib/voice/revring'
import { notifyAppointmentSetterBooked, syncAppointmentSetterBookingToGHL, applyAiSalespersonOutcome, recordDialerHoursForCall } from '@/lib/voice/dialer'
import { reconcilePeriodUsage } from '@/lib/billing/agentBilling'
import { runPostCallAnalysis } from '@/lib/voice/postCall'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RevRingWebhook = {
  type?: string
  event?: string
  callId?: string
  id?: string
  status?: string
  outcome?: string
  call?: {
    id?: string
    status?: string
    outcome?: string
    direction?: string
    transcript?: string
    recordingUrl?: string
    summary?: string
    startedAt?: string
    endedAt?: string
    endedReason?: string
    durationSeconds?: number
    metadata?: Record<string, unknown>
    variables?: Record<string, unknown>
  }
  endedReason?: string
  metadata?: Record<string, unknown>
  transcript?: string
  recordingUrl?: string
  summary?: string
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
  variables?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  let body: RevRingWebhook
  try {
    body = JSON.parse(raw) as RevRingWebhook
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const providerCallId = body.call?.id || body.callId || body.id
  if (!providerCallId) return NextResponse.json({ ok: true, ignored: true })

  // Auth-first: if the payload carries rep_id in metadata, verify the secret
  // before touching the DB. This prevents unauthenticated DB reads on spoofed
  // calls. If rep_id is absent we fall through to the DB lookup path below.
  const hintedRepId =
    (body.call?.metadata?.rep_id as string | undefined) ||
    (body.metadata?.rep_id as string | undefined)

  if (hintedRepId) {
    const ok = await verifyRevringSecret(hintedRepId, req)
    if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: callRow } = await supabase
    .from('voice_calls')
    .select('*')
    .eq('provider', 'revring')
    .eq('provider_call_id', providerCallId)
    .maybeSingle()

  if (!callRow) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  // If rep_id was not in the payload, verify secret against the DB row's rep.
  if (!hintedRepId) {
    const ok = await verifyRevringSecret(callRow.rep_id, req)
    if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const status = mapStatus(body.call?.status || body.status)
  if (status && status !== 'completed' && status !== 'failed') {
    await supabase
      .from('voice_calls')
      .update({ status })
      .eq('id', callRow.id)
    return NextResponse.json({ ok: true })
  }

  const terminalStatus = status ?? 'completed'
  const outcome = deriveOutcome(body.call?.outcome || body.outcome, terminalStatus)

  // Collect richer post-call fields from whichever payload shape was sent.
  const summary        = body.call?.summary ?? body.summary ?? null
  const hangupCause    = body.call?.endedReason ?? body.endedReason ?? null
  const callVariables  = body.call?.variables ?? body.variables ?? null
  const durationSec    = body.call?.durationSeconds ?? body.durationSeconds ?? null
  const startedAt      = body.call?.startedAt ?? body.startedAt ?? null
  const endedAt        = body.call?.endedAt ?? body.endedAt ?? null
  const transcript     = body.call?.transcript ?? body.transcript ?? null
  const recordingUrl   = body.call?.recordingUrl ?? body.recordingUrl ?? null

  // Error message is set if the status maps to failed/cancelled.
  const errorMessage: string | null =
    (terminalStatus === 'failed' ? hangupCause ?? 'provider_failed' : null)

  // metrics: anything numeric worth storing long-term
  const callMetrics: Record<string, unknown> = {}
  if (typeof durationSec === 'number') callMetrics.duration_sec = durationSec

  await supabase
    .from('voice_calls')
    .update({
      status: terminalStatus,
      outcome,
      transcript,
      recording_url: recordingUrl,
      duration_sec: durationSec,
      started_at: startedAt,
      ended_at: endedAt,
      summary,
      hangup_cause: hangupCause,
      error_message: errorMessage,
      call_variables: callVariables ?? {},
      call_metrics: callMetrics,
      raw: body as unknown as Record<string, unknown>,
    })
    .eq('id', callRow.id)

  await finalizeQueueFromCall(callRow, outcome)

  // Hour-package usage: count dialer-active seconds against the SDR's
  // weekly cap. Provider-agnostic — same call also fires from the Vapi
  // webhook on `call.ended`.
  if (typeof durationSec === 'number' && durationSec > 0) {
    void recordDialerHoursForCall(callRow.id as string, {
      durationSec,
      mode: (callRow.dialer_mode as string | null) ?? null,
      memberId: (callRow.owner_member_id as string | null) ?? null,
      repId: callRow.rep_id as string,
    }).catch((err) => console.error('[revring] recordDialerHours failed', err))

    // Per-agent monthly billing — push consumed_seconds into the open
    // agent_billing_period row so the dashboard bar updates in real time.
    // Reconciles from voice_calls so it's idempotent + drift-resistant.
    const memberId = (callRow.owner_member_id as string | null) ?? null
    if (memberId) {
      void reconcilePeriodUsage(memberId).catch((err) =>
        console.error('[revring] reconcilePeriodUsage failed', err),
      )
    }
  }

  // AI Salesperson canonical pipeline: move lead + create followup row.
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
    callVariables: (callVariables ?? {}) as Record<string, unknown>,
  })

  // Appointment Setter realtime alert: notify Telegram when a booking lands.
  if (callRow.dialer_mode === 'appointment_setter' && outcome === 'confirmed') {
    const vars = (callVariables ?? {}) as Record<string, unknown>
    const bookedAtIso =
      (vars.booking_time as string | undefined) ??
      (vars.appointment_time as string | undefined) ??
      (vars.booked_for as string | undefined) ??
      null
    const bookedEndIso =
      (vars.booking_end_time as string | undefined) ??
      (vars.appointment_end_time as string | undefined) ??
      null

    // If the AI confirmed the call but didn't extract a booking time, flag it
    // visibly on the call row so it shows up in the dashboard and isn't lost.
    if (!bookedAtIso) {
      console.error('[revring] confirmed call has no booking time in call variables — appointment NOT booked to calendar. call_id:', callRow.id, 'vars:', JSON.stringify(vars))
      await supabase
        .from('voice_calls')
        .update({ error_message: 'Confirmed but no booking_time extracted — appointment not booked to calendar. Check RevRing assistant variables.' })
        .eq('id', callRow.id)
    }

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
      leadName: (vars.name as string | undefined) ?? null,
      phone: (callRow.to_number as string | null) ?? null,
      bookedAtIso,
      setterName,
    }).catch((err) => console.error('[revring] setter booked notify failed', err))
    void syncAppointmentSetterBookingToGHL({
      repId: callRow.rep_id,
      leadName: (vars.name as string | undefined) ?? null,
      phone: (callRow.to_number as string | null) ?? null,
      email: (vars.email as string | undefined) ?? null,
      bookedAtIso,
      bookedEndIso,
      setterId,
      leadId: (callRow.lead_id as string | null) ?? null,
      voiceCallId: callRow.id as string,
    })
  }

  // AI post-call analysis: summary, follow-up task, Telegram recap, GHL note.
  // Runs async — does not block the 200 response back to RevRing.
  if (transcript) {
    void (async () => {
      const meetingId = (callRow.meeting_id as string | null) ?? null
      const leadId = (callRow.lead_id as string | null) ?? null

      // For receptionist calls: pull attendee name + scheduled time from the meeting row.
      let attendeeName: string | null = null
      let scheduledAtIso: string | null = null
      if (meetingId) {
        const { data: mtg } = await supabase
          .from('meetings')
          .select('attendee_name, scheduled_at')
          .eq('id', meetingId)
          .maybeSingle()
        attendeeName = (mtg?.attendee_name as string | null) ?? null
        scheduledAtIso = (mtg?.scheduled_at as string | null) ?? null
      }
      // For appointment setter calls: name comes from call variables.
      if (!attendeeName) {
        attendeeName = (callVariables?.name as string | undefined) ?? null
      }
      const newScheduledAtIso =
        (callVariables?.booking_time as string | undefined) ??
        (callVariables?.appointment_time as string | undefined) ??
        (callVariables?.booked_for as string | undefined) ??
        null

      await runPostCallAnalysis({
        voiceCallId: callRow.id as string,
        repId: callRow.rep_id as string,
        meetingId,
        leadId,
        phone: (callRow.to_number as string | null) ?? null,
        outcome,
        transcript,
        attendeeName,
        scheduledAtIso,
        newScheduledAtIso,
      }).catch((err) => console.error('[revring] postCall analysis failed', err))
    })()
  }

  return NextResponse.json({ ok: true })
}

function mapStatus(s: string | undefined): string | null {
  if (!s) return null
  const x = s.toLowerCase()
  if (x === 'queued') return 'queued'
  if (x === 'initiated' || x === 'dialing' || x === 'ringing') return 'ringing'
  if (x === 'ongoing' || x === 'in_progress' || x === 'in-progress') return 'in_progress'
  if (x === 'completed' || x === 'ended' || x === 'done') return 'completed'
  if (x === 'failed' || x === 'canceled' || x === 'cancelled') return 'failed'
  return null
}

function deriveOutcome(raw: string | undefined, terminalStatus: string): string | null {
  if (raw) return raw.toLowerCase()
  if (terminalStatus === 'failed') return 'failed'
  return null
}

async function finalizeQueueFromCall(
  callRow: { id: string; rep_id: string; raw: Record<string, unknown> | null },
  outcome: string | null,
): Promise<void> {
  const queueId =
    typeof callRow.raw?.queue_id === 'string' ? (callRow.raw.queue_id as string) : null
  if (!queueId) return

  const isFailed = !outcome || outcome === 'failed'
  const status = isFailed ? 'failed' : 'completed'

  await supabase
    .from('dialer_queue')
    .update({
      status,
      last_outcome: outcome,
      next_retry_at: null,
    })
    .eq('id', queueId)
    .eq('rep_id', callRow.rep_id)

  await supabase.from('dialer_queue_events').insert({
    rep_id: callRow.rep_id,
    queue_id: queueId,
    event_type: isFailed ? 'failed' : 'provider_call_completed',
    outcome,
    reason: isFailed ? 'provider_call_failed_or_unknown' : null,
    payload: { voice_call_id: callRow.id, outcome },
  })
}
