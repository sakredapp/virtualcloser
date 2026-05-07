// Dialer orchestration. Glue between meetings, Vapi, and the rep's
// notification surfaces. The cron + manual-trigger endpoints both call
// `dispatchConfirmCall(meetingId)`.

import { supabase } from '../supabase'
import { sendTelegramMessage } from '../telegram'
import { getMeeting, incrementConfirmationAttempt, type Meeting } from '../meetings'
import { assertCanUse, resolveActiveHourPackage } from '../entitlements'
import { recordUsage, resolveActiveAddon } from '../usage'
import { resolveVoiceProviderForMode } from './provider'
import { makeAgentCRMForRep, enrollContactInStageWorkflow } from '../agentcrm'
import { getIntegrationConfig } from '../client-integrations'
import { moveLeadToCanonicalStage, type Pipeline, type PipelineStage } from '../pipelines'
import { pushStageToCRM } from '../crm-sync'
import { setDisposition } from '../crmLeads'
import { mapStageToFurnaceDisposition, mapOutcomeToFurnaceDisposition, pushLeadDispositionToFurnace } from '../furnace'
import type { AppointmentSetterConfig, Disposition } from '@/types'

export type DispatchResult =
  | { ok: true; callId: string; provider: string; providerCallId: string }
  | { ok: false; reason: string }

/**
 * Fire the confirm-call for a single meeting. Idempotency: caller is
 * responsible for filtering on `confirmation_attempts = 0`. We always
 * insert a `voice_calls` row before placing the call so failures are
 * traceable, then increment `meetings.confirmation_attempts`.
 */
export async function dispatchConfirmCall(meetingId: string): Promise<DispatchResult> {
  const meeting = await getMeeting(meetingId)
  if (!meeting) return { ok: false, reason: 'meeting_not_found' }
  if (!meeting.phone) return { ok: false, reason: 'no_phone' }
  if (meeting.status !== 'scheduled') return { ok: false, reason: `wrong_status:${meeting.status}` }

  // Cap-enforcement gate. Routes through gateDialerCall which prefers the
  // hour-package SKU when active and falls back to legacy lite/pro for
  // tenants on the old pricing. Per-rep budget + shift checks happen there
  // when memberId is known.
  // Confirm-call meetings don't have a member context yet (the cron picks
  // them up tenant-wide); pass null so it stays at tenant level for now.
  const gate = await gateDialerCall({
    repId: meeting.rep_id,
    memberId: null,
    mode: 'concierge',
  })
  if (!gate.ok) {
    // Concurrency blocks are silent — the cron will retry next pass when
    // the active call ends. Skipping the insert keeps voice_calls clean
    // during long calls. Cap/budget/shift blocks DO get logged as
    // 'blocked_cap' rows so the dashboard surfaces them.
    if (!gate.reason.startsWith('concurrent:')) {
      const providerForMode = await getProviderLabelForMode(meeting.rep_id, 'concierge')
      await supabase.from('voice_calls').insert({
        rep_id: meeting.rep_id,
        meeting_id: meeting.id,
        lead_id: meeting.lead_id,
        provider: providerForMode,
        direction: 'outbound_confirm',
        to_number: meeting.phone,
        status: 'blocked_cap',
        raw: { reason: gate.reason },
      })
    }
    return { ok: false, reason: gate.reason }
  }

  const provider = await resolveVoiceProviderForMode(meeting.rep_id, 'concierge')
  if (!provider.ok) return { ok: false, reason: provider.reason }
  if (!provider.client.assistants.confirm) return { ok: false, reason: 'no_confirm_assistant' }

  // Pre-insert the call row so we have an id to attach to meeting + Vapi metadata.
  const { data: callRow, error: callErr } = await supabase
    .from('voice_calls')
    .insert({
      rep_id: meeting.rep_id,
      meeting_id: meeting.id,
      lead_id: meeting.lead_id,
      provider: provider.client.provider,
      direction: 'outbound_confirm',
      to_number: meeting.phone,
      status: 'queued',
    })
    .select()
    .single()
  if (callErr || !callRow) {
    return { ok: false, reason: `db_insert_failed:${callErr?.message ?? 'unknown'}` }
  }

  const repInfo = await loadRepDisplay(meeting.rep_id)
  const variables = buildAssistantVariables(meeting, repInfo, provider.client.aiName)

  try {
    const call = await provider.client.placeCall({
      assistantId: provider.client.assistants.confirm,
      toNumber: normalizePhone(meeting.phone),
      customerName: meeting.attendee_name ?? undefined,
      customerEmail: meeting.attendee_email ?? undefined,
      variableValues: variables,
      firstMessage: buildFirstMessage(variables),
      metadata: {
        rep_id: meeting.rep_id,
        meeting_id: meeting.id,
        voice_call_id: callRow.id,
        purpose: 'confirm_appointment',
      },
    })
    await supabase
      .from('voice_calls')
      .update({ provider_call_id: call.id, status: 'ringing' })
      .eq('id', callRow.id)
    await incrementConfirmationAttempt(meeting.id, callRow.id)
    return {
      ok: true,
      callId: callRow.id,
      provider: provider.client.provider,
      providerCallId: call.id,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_provider_error'
    await supabase
      .from('voice_calls')
      .update({ status: 'failed', raw: { error: reason } })
      .eq('id', callRow.id)
    return { ok: false, reason }
  }
}

/**
 * Reschedule path. Called when an inbound webhook tells us a confirm-call
 * came back as `reschedule_requested`. Spins up a second provider call using the
 * reschedule assistant, which will tool-call `/api/voice/reschedule-tool` to
 * read free slots + patch the calendar event.
 */
export async function dispatchRescheduleCall(meetingId: string): Promise<DispatchResult> {
  const meeting = await getMeeting(meetingId)
  if (!meeting) return { ok: false, reason: 'meeting_not_found' }
  if (!meeting.phone) return { ok: false, reason: 'no_phone' }

  // Reschedule calls also count against the dialer cap (they're billable
  // provider minutes). Same gate path as the confirm flow.
  const gate = await gateDialerCall({
    repId: meeting.rep_id,
    memberId: null,
    mode: 'concierge',
  })
  if (!gate.ok) return { ok: false, reason: gate.reason }

  const provider = await resolveVoiceProviderForMode(meeting.rep_id, 'concierge')
  if (!provider.ok) return { ok: false, reason: provider.reason }
  if (!provider.client.assistants.reschedule) return { ok: false, reason: 'no_reschedule_assistant' }

  const { data: callRow, error: callErr } = await supabase
    .from('voice_calls')
    .insert({
      rep_id: meeting.rep_id,
      meeting_id: meeting.id,
      lead_id: meeting.lead_id,
      provider: provider.client.provider,
      direction: 'outbound_reschedule',
      to_number: meeting.phone,
      status: 'queued',
    })
    .select()
    .single()
  if (callErr || !callRow) {
    return { ok: false, reason: `db_insert_failed:${callErr?.message ?? 'unknown'}` }
  }

  const repInfo = await loadRepDisplay(meeting.rep_id)
  const variables = buildAssistantVariables(meeting, repInfo, provider.client.aiName)

  try {
    const call = await provider.client.placeCall({
      assistantId: provider.client.assistants.reschedule,
      toNumber: normalizePhone(meeting.phone),
      customerName: meeting.attendee_name ?? undefined,
      variableValues: variables,
      metadata: {
        rep_id: meeting.rep_id,
        meeting_id: meeting.id,
        voice_call_id: callRow.id,
        purpose: 'reschedule_appointment',
      },
    })
    await supabase
      .from('voice_calls')
      .update({ provider_call_id: call.id, status: 'ringing' })
      .eq('id', callRow.id)
    return {
      ok: true,
      callId: callRow.id,
      provider: provider.client.provider,
      providerCallId: call.id,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_provider_error'
    await supabase
      .from('voice_calls')
      .update({ status: 'failed', raw: { error: reason } })
      .eq('id', callRow.id)
    return { ok: false, reason }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  // Assume US/CA if 10 digits (most common for our reps).
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits
}

function buildAssistantVariables(
  meeting: Meeting,
  rep: { display_name: string; company: string | null },
  aiName?: string,
): Record<string, string> {
  const firstName = (meeting.attendee_name ?? '').split(' ')[0] || 'there'
  const when = friendlyWhen(meeting.scheduled_at, meeting.timezone)
  return {
    first_name: firstName,
    rep_name: rep.display_name,
    company: rep.company || rep.display_name,
    ai_name: aiName || 'the assistant',
    when_natural: when,
    meeting_iso: meeting.scheduled_at,
    meeting_id: meeting.id,
  }
}

async function getProviderLabelForMode(repId: string, mode: 'concierge'): Promise<string> {
  const resolved = await resolveVoiceProviderForMode(repId, mode)
  if (!resolved.ok) {
    const fromReason = resolved.reason.match(/^provider_not_implemented:(.+)$/)?.[1]
    if (fromReason) return fromReason
    const fromMissing = resolved.reason.match(/^(.+)_not_configured$/)?.[1]
    if (fromMissing) return fromMissing
    return 'revring'
  }
  return resolved.client.provider
}

function buildFirstMessage(vars: Record<string, string>): string {
  return `Hi ${vars.first_name}, this is ${vars.ai_name} calling on behalf of ${vars.rep_name} at ${vars.company} to confirm our appointment ${vars.when_natural}. Press 1 to confirm, or press 2 if you need to reschedule.`
}

function friendlyWhen(iso: string, tz?: string | null): string {
  try {
    const d = new Date(iso)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined,
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    return `at ${fmt.format(d)}`
  } catch {
    return 'at the scheduled time'
  }
}

async function loadRepDisplay(
  repId: string,
): Promise<{ display_name: string; company: string | null }> {
  const { data } = await supabase
    .from('reps')
    .select('display_name, company')
    .eq('id', repId)
    .maybeSingle()
  return {
    display_name: (data?.display_name as string) || 'your rep',
    company: (data?.company as string) || null,
  }
}

// ── Telegram surface ─────────────────────────────────────────────────────

export async function notifyRepOfDialerOutcome(args: {
  repId: string
  meetingId: string
  outcome: string
  attendeeName: string | null
}): Promise<void> {
  const { data: members } = await supabase
    .from('members')
    .select('telegram_chat_id, role')
    .eq('rep_id', args.repId)
    .not('telegram_chat_id', 'is', null)
  const recipients = (members ?? []).filter((m) =>
    ['owner', 'admin', 'rep'].includes(m.role),
  )
  if (!recipients.length) return

  const name = args.attendeeName || 'lead'
  const text = (() => {
    switch (args.outcome) {
      case 'confirmed':
        return `${name} confirmed their appointment.`
      case 'reschedule_requested':
        return `${name} wants to reschedule — handing off to reschedule assistant.`
      case 'rescheduled':
        return `${name} rescheduled — calendar updated.`
      case 'voicemail':
        return `${name} didn't pick up — left voicemail.`
      case 'no_answer':
        return `${name} didn't pick up.`
      case 'cancelled':
        return `${name} cancelled the appointment.`
      default:
        return `Dialer update for ${name}: ${args.outcome}`
    }
  })()

  for (const m of recipients) {
    if (!m.telegram_chat_id) continue
    await sendTelegramMessage(m.telegram_chat_id, text).catch((err) =>
      console.error('[dialer] telegram notify failed', err),
    )
  }
}

export async function notifyAppointmentSetterBooked(args: {
  repId: string
  leadName?: string | null
  phone?: string | null
  bookedAtIso?: string | null
  setterName?: string | null
}): Promise<void> {
  const { data: members } = await supabase
    .from('members')
    .select('telegram_chat_id, role')
    .eq('rep_id', args.repId)
    .not('telegram_chat_id', 'is', null)

  const recipients = (members ?? []).filter((m) => ['owner', 'admin', 'manager', 'rep'].includes(m.role))
  if (!recipients.length) return

  const who = args.leadName || args.phone || 'a new lead'
  const when = args.bookedAtIso
    ? ` at ${new Date(args.bookedAtIso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}`
    : ''

  // Multi-setter: prefix the alert with the salesperson name so reps can tell
  // which AI booked the appointment when they're running multiple in parallel.
  const setterPrefix = args.setterName ? `*${args.setterName}* — ` : ''
  const text = `📅 ${setterPrefix}Appointment Setter booked an appointment with *${who}*${when}.`
  for (const m of recipients) {
    if (!m.telegram_chat_id) continue
    await sendTelegramMessage(m.telegram_chat_id, text).catch((err) =>
      console.error('[dialer] setter booked notify failed', err),
    )
  }
}

export async function getAppointmentSetterTodaySnapshot(repId: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10)
  const fromIso = `${day}T00:00:00.000Z`

  const [{ data: queueRows }, { data: calls }] = await Promise.all([
    supabase
      .from('dialer_queue')
      .select('status, last_outcome')
      .eq('rep_id', repId)
      .eq('dialer_mode', 'appointment_setter')
      .gte('created_at', fromIso),
    supabase
      .from('voice_calls')
      .select('outcome, duration_sec')
      .eq('rep_id', repId)
      .eq('dialer_mode', 'appointment_setter')
      .gte('created_at', fromIso),
  ])

  const q = queueRows ?? []
  const c = calls ?? []
  const countQ = (s: string) => q.filter((r) => r.status === s).length
  const countC = (vals: string[]) => c.filter((r) => vals.includes(String(r.outcome ?? ''))).length

  const totalTalkSec = c.reduce((acc, row) => acc + (row.duration_sec ?? 0), 0)
  const talkMin = Math.round(totalTalkSec / 60)

  const apptsSet = q.filter((r) => r.last_outcome === 'confirmed').length
  const connects = countC(['connected', 'confirmed', 'reschedule_requested', 'rescheduled'])
  const noAnswer = countC(['no_answer'])
  const voicemail = countC(['voicemail'])

  return [
    '📊 *Appointment Setter — Today*',
    '',
    `• Appointments set: *${apptsSet}*`,
    `• Connects: *${connects}*`,
    `• Voicemails: *${voicemail}*`,
    `• No answer: *${noAnswer}*`,
    `• Queue pending: *${countQ('pending')}*`,
    `• Queue in progress: *${countQ('in_progress')}*`,
    `• Queue completed: *${countQ('completed')}*`,
    `• Queue failed: *${countQ('failed')}*`,
    `• Talk time: *${talkMin} min*`,
  ].join('\n')
}

/**
 * After a confirmed booking, creates a GHL appointment for the contact.
 * Silently no-ops when GHL is not configured or ghl_calendar_id not set.
 */
export async function syncAppointmentSetterBookingToGHL(args: {
  repId: string
  leadName?: string | null
  phone?: string | null
  email?: string | null
  bookedAtIso?: string | null
  bookedEndIso?: string | null
  setterId?: string | null
  leadId?: string | null
}): Promise<void> {
  try {
    const crm = await makeAgentCRMForRep(args.repId)
    if (!crm) return

    // Multi-setter model: prefer the setter's calendar mapping. Fall back to
    // the legacy `appointment_setter_config` row for back-compat.
    let calendarId: string | undefined
    if (args.setterId) {
      const { data: setter } = await supabase
        .from('ai_salespeople')
        .select('calendar')
        .eq('id', args.setterId)
        .maybeSingle()
      const cal = (setter?.calendar ?? {}) as { calendar_id?: string; provider?: string }
      if (cal.calendar_id) calendarId = cal.calendar_id
    }
    if (!calendarId) {
      const cfg = (await getIntegrationConfig(args.repId, 'appointment_setter_config')) as AppointmentSetterConfig | null
      calendarId = cfg?.ghl_calendar_id || undefined
    }
    if (!calendarId) {
      console.warn('[dialer] syncAppointmentSetterBookingToGHL: no GHL calendar_id configured for rep', args.repId, '— appointment not booked to GHL calendar')
      return
    }

    // Find or create the GHL contact
    let contactId: string | undefined
    const searchQuery = args.phone ?? args.email ?? ''
    if (searchQuery) {
      const existing = await crm.searchContacts(searchQuery)
      contactId = existing[0]?.id
    }
    if (!contactId) {
      const name = args.leadName ?? ''
      const [fn, ...rest] = name.split(' ')
      const created = await crm.upsertContact({
        firstName: fn ?? '',
        lastName: rest.join(' ') || undefined,
        email: args.email ?? undefined,
        phone: args.phone ?? undefined,
        tags: ['vc-appointment-setter'],
      })
      contactId = created.id
    }
    if (!contactId) return

    // Write the resolved GHL contact id back to the lead so post-call note
    // push (postCall.ts step 4) can find it without a phone search.
    if (args.leadId && contactId) {
      void supabase
        .from('leads')
        .update({ crm_contact_id: contactId })
        .eq('id', args.leadId)
        .eq('rep_id', args.repId)
        .then(({ error }) => {
          if (error) console.error('[dialer] crm_contact_id write-back failed', error)
        })
    }

    // Hard-fail if the AI didn't extract a booking time — better to log a
    // clear warning than silently book the appointment at the current time.
    if (!args.bookedAtIso) {
      console.error('[dialer] syncAppointmentSetterBookingToGHL: no bookedAtIso — appointment NOT booked. Check that the RevRing assistant sets booking_time / appointment_time in call variables on confirmed outcome. rep_id:', args.repId)
      return
    }

    // Build appointment times. Default to 30-min slot if no end time extracted.
    const startTime = args.bookedAtIso
    const explicitEnd = args.bookedEndIso ?? null
    const endMs = explicitEnd
      ? new Date(explicitEnd).getTime()
      : new Date(startTime).getTime() + 30 * 60 * 1000
    const endTime = new Date(endMs).toISOString()

    await crm.createAppointment({
      calendarId,
      contactId,
      startTime,
      endTime,
      title: `Appointment with ${args.leadName ?? args.phone ?? 'Lead'}`,
      notes: 'Booked by VirtualCloser Appointment Setter',
    })

    // Tag + workflow: mark the contact as booked and trigger any GHL automation
    // configured for "Appointment Set" (e.g. confirmation SMS sequence in GHL).
    await crm.updateContact(contactId, { tags: ['vc-appointment-setter', 'vc-appointment-set'] }).catch(() => {})
    void enrollContactInStageWorkflow(args.repId, contactId, 'Appointment Set').catch(() => {})
  } catch (err) {
    console.error('[dialer] syncAppointmentSetterBookingToGHL failed', err)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AI Salesperson outcome → pipeline stage + followup row.
// Called by the Vapi + RevRing webhooks after the call row + outcome have
// been persisted. Idempotent and best-effort: any failure is logged, not
// thrown, so the webhook still returns 200.
// ────────────────────────────────────────────────────────────────────────────

type OutcomeCallRow = {
  id: string
  rep_id: string
  lead_id: string | null
  ai_salesperson_id: string | null
  dialer_mode: string | null
  raw: Record<string, unknown> | null
}

const STOP_REGEX = /\b(stop|unsubscribe|do not (?:call|contact)|opt[\s-]?out|remove me|take me off)\b/i

function detectEscalation(vars: Record<string, unknown>): boolean {
  const flag =
    vars.escalate ??
    vars.needs_human ??
    vars.handoff_required ??
    vars.requires_human
  if (typeof flag === 'boolean') return flag
  if (typeof flag === 'string') return /^(true|yes|1)$/i.test(flag)
  return false
}

function parseFollowupDueAt(vars: Record<string, unknown>): string {
  const candidates = [
    vars.callback_time,
    vars.followup_time,
    vars.callback_at,
    vars.followup_at,
    vars.next_contact_at,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c) {
      const ms = new Date(c).getTime()
      if (Number.isFinite(ms)) return new Date(ms).toISOString()
    }
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function mapOutcomeToCanonicalStage(args: {
  outcome: string | null
  transcript: string | null
  callVariables: Record<string, unknown>
}): { stage: string; insertFollowup: 'call' | null } | null {
  const escalation = detectEscalation(args.callVariables)
  if (escalation) return { stage: 'Needs Human Review', insertFollowup: null }

  if (args.transcript && STOP_REGEX.test(args.transcript)) {
    return { stage: 'Opted Out', insertFollowup: null }
  }
  // Some prompts will set this directly via structured data.
  const optOut = args.callVariables.opted_out ?? args.callVariables.do_not_call
  if (optOut === true || (typeof optOut === 'string' && /^(true|yes|1)$/i.test(optOut))) {
    return { stage: 'Opted Out', insertFollowup: null }
  }

  switch (args.outcome) {
    case 'confirmed':
      return { stage: 'Appointment Set', insertFollowup: null }
    case 'reschedule_requested':
      return { stage: 'Follow-Up Scheduled', insertFollowup: 'call' }
    case 'cancelled':
      return { stage: 'Disqualified', insertFollowup: null }
    case 'connected':
      return { stage: 'Engaged', insertFollowup: null }
    // voicemail / no_answer / failed → no canonical move, leave the lead where it sits.
    default:
      return null
  }
}

export async function applyAiSalespersonOutcome(args: {
  callRow: OutcomeCallRow
  outcome: string | null
  transcript: string | null
  callVariables: Record<string, unknown>
}): Promise<void> {
  try {
    if (args.callRow.dialer_mode !== 'appointment_setter') return
    const setterId = args.callRow.ai_salesperson_id
    const leadId = args.callRow.lead_id
    if (!setterId || !leadId) return

    const STAGE_TO_DISPOSITION: Record<string, Disposition> = {
      'Appointment Set': 'appointment_set',
      'Follow-Up Scheduled': 'reschedule',
      'Disqualified': 'disqualified',
      'Engaged': 'callback',
      'Opted Out': 'do_not_contact',
      'Needs Human Review': 'callback',
    }

    const decision = mapOutcomeToCanonicalStage({
      outcome: args.outcome,
      transcript: args.transcript,
      callVariables: args.callVariables,
    })

    // Voicemail / no-answer: no stage move but still write disposition so the
    // CRM activity feed shows accurate contact history.
    if (!decision) {
      if (args.outcome === 'voicemail') {
        await setDisposition(args.callRow.rep_id, leadId, 'left_voicemail').catch(err =>
          console.error('[dialer] setDisposition voicemail failed', err)
        )
        // Schedule SMS follow-up 2 hours after voicemail if SMS AI is enabled
        if (process.env.SMS_AI_ENABLED === 'true') {
          void scheduleSmsFollowup({
            repId: args.callRow.rep_id,
            setterId,
            leadId,
            sourceCallId: args.callRow.id,
            delayMinutes: 120,
            callOutcome: 'voicemail',
            reason: 'Left voicemail — following up via text',
          })
        }
      } else if (args.outcome === 'no_answer') {
        await setDisposition(args.callRow.rep_id, leadId, 'no_answer').catch(err =>
          console.error('[dialer] setDisposition no_answer failed', err)
        )
        // Schedule SMS follow-up 30 minutes after no-answer
        if (process.env.SMS_AI_ENABLED === 'true') {
          void scheduleSmsFollowup({
            repId: args.callRow.rep_id,
            setterId,
            leadId,
            sourceCallId: args.callRow.id,
            delayMinutes: 30,
            callOutcome: 'no_answer',
            reason: 'No answer on call — following up via text',
          })
        }
      }
      return
    }

    const moved = await moveLeadToCanonicalStage(
      args.callRow.rep_id,
      leadId,
      decision.stage,
    )

    // Permanently gate this lead out of future dials. The cron reads
    // do_not_call before placing any call, so this prevents re-dialing
    // even if the lead is re-imported in a later CSV batch.
    if (decision.stage === 'Opted Out') {
      void supabase
        .from('leads')
        .update({ do_not_call: true })
        .eq('id', leadId)
        .eq('rep_id', args.callRow.rep_id)
        .then(({ error }) => {
          if (error) console.error('[dialer] do_not_call flag failed', error)
        })
    }

    // Mirror the stage move to GHL if the lead has a CRM link + stage mapping.
    if (moved.stageId) {
      void pushStageToCRM(args.callRow.rep_id, leadId, moved.stageId).catch((err) =>
        console.error('[dialer] GHL stage push failed', err),
      )
    }

    // Push disposition to Furnace for Furnace-originated leads.
    // Prefer the stage-derived disposition; fall back to raw outcome.
    const furnaceDisp =
      mapStageToFurnaceDisposition(decision.stage) ??
      (args.outcome ? mapOutcomeToFurnaceDisposition(args.outcome) : null)
    if (furnaceDisp) {
      void pushLeadDispositionToFurnace(args.callRow.rep_id, leadId, furnaceDisp)
    }

    // Sync pipeline stage → CRM disposition so the Prospects board reflects
    // the outcome of every AI SDR call without manual rep intervention.
    const dispositionForStage = STAGE_TO_DISPOSITION[decision.stage]
    if (dispositionForStage) {
      await setDisposition(args.callRow.rep_id, leadId, dispositionForStage).catch(err =>
        console.error('[dialer] setDisposition after stage move failed', err)
      )
    }

    // Enroll the GHL contact in any workflow mapped to this stage name
    // (e.g. "Appointment Set" → send confirmation sequence in GHL).
    // Only fires if the lead's crm_contact_id is set.
    if (decision.stage) {
      const { data: lead } = await supabase
        .from('leads')
        .select('crm_contact_id')
        .eq('id', leadId)
        .eq('rep_id', args.callRow.rep_id)
        .maybeSingle()
      const contactId = (lead as { crm_contact_id: string | null } | null)?.crm_contact_id
      if (contactId) {
        void enrollContactInStageWorkflow(args.callRow.rep_id, contactId, decision.stage).catch(() => {})
      }
    }

    if (decision.insertFollowup) {
      const queueId =
        typeof args.callRow.raw?.queue_id === 'string'
          ? (args.callRow.raw.queue_id as string)
          : null
      const dueAt = parseFollowupDueAt(args.callVariables)
      const reason =
        (args.callVariables.callback_reason as string | undefined) ??
        (args.callVariables.followup_reason as string | undefined) ??
        'Lead requested a callback'

      await supabase.from('ai_salesperson_followups').insert({
        rep_id: args.callRow.rep_id,
        ai_salesperson_id: setterId,
        lead_id: leadId,
        queue_id: queueId,
        source_call_id: args.callRow.id,
        due_at: dueAt,
        channel: decision.insertFollowup,
        reason,
        status: 'pending',
      })
    }

    if (!moved.moved) {
      console.warn('[dialer] applyAiSalespersonOutcome — lead not moved', {
        rep_id: args.callRow.rep_id,
        lead_id: leadId,
        stage: decision.stage,
      })
    }
  } catch (err) {
    console.error('[dialer] applyAiSalespersonOutcome failed', err)
  }
}

// Re-export to keep a single tree-shake-friendly module API.
export type { Pipeline, PipelineStage }

/**
 * Record a finished dialer call's seconds against the tenant's active hour
 * package. Called from the Vapi + RevRing webhook routes once they've
 * persisted duration_sec on the voice_calls row. Provider-agnostic.
 *
 * Idempotent through usage_events.source_id — a second invocation for the
 * same call row will silently insert a duplicate row, which is fine
 * because the cap math sums by quantity (and webhooks should fire once
 * per call). If we ever see double-counting we can add a unique index on
 * (source_table, source_id, event_type) — but that's premature for now.
 */
/**
 * Stale-call window. A queued/ringing/in_progress voice_calls row older
 * than this is treated as orphaned (the provider webhook never fired) so
 * a crashed dispatch can't permanently block the dialer's concurrency cap.
 *
 * Set to 30 min so a real long call (max ~25 min in practice) is still
 * counted as active — the provider terminates well before this.
 */
const STALE_CALL_WINDOW_MS = 30 * 60 * 1000

const ACTIVE_CALL_STATUSES = ['queued', 'ringing', 'in_progress']

/**
 * Hard concurrency cap: at most ONE active dialer call per tenant at any
 * time. The AI dialer is a single phone line, single mouth — even when
 * multiple shifts/modes/reps are configured, it dials one number, hangs
 * up, then dials the next.
 *
 * Returns true if a non-stale active call already exists for this tenant.
 */
async function hasActiveDialerCall(repId: string): Promise<boolean> {
  const sinceIso = new Date(Date.now() - STALE_CALL_WINDOW_MS).toISOString()
  const { data } = await supabase
    .from('voice_calls')
    .select('id')
    .eq('rep_id', repId)
    .eq('provider', 'revring')
    .in('status', ACTIVE_CALL_STATUSES)
    .gte('created_at', sinceIso)
    .limit(1)
  return Boolean(data && data.length > 0)
}

/**
 * Unified pre-call gate. Replaces the inline cap check inside dispatch*Call.
 *
 * Order of checks:
 *   0. Concurrency cap → 1 active call per tenant, hard limit.
 *   1. Hour package active? → weekly cap via assertCanUse (hours_per_week unit)
 *   2. Per-rep budget if reps.dialer_pool_mode = 'per_rep' AND we know
 *      which member this call belongs to.
 *   3. Active shift for the member+mode (if any shifts defined).
 *   4. If no hour package, fall back to legacy lite/pro appts cap.
 *
 * Returns { ok: true, addon } on pass, { ok: false, reason } on fail.
 * The reason is human-readable + machine-parseable ('cap:over_cap',
 * 'budget:exhausted', 'shift:inactive', 'concurrent:already_active',
 * 'addon_not_active').
 */
export async function gateDialerCall(args: {
  repId: string
  memberId: string | null
  mode: 'concierge' | 'appointment_setter' | 'live_transfer' | 'pipeline'
}): Promise<
  | { ok: true; addon: 'hour_package' | 'legacy'; addonKey: string }
  | { ok: false; reason: string }
> {
  // 0. Concurrency: bail before any other DB work if the dialer is already
  // on a call. Cheapest possible block.
  if (await hasActiveDialerCall(args.repId)) {
    return { ok: false, reason: 'concurrent:already_active' }
  }

  const hourAddon = await resolveActiveHourPackage(args.repId)

  if (hourAddon) {
    // 1. Tenant weekly cap
    const gate = await assertCanUse(args.repId, hourAddon)
    if (!gate.ok) return { ok: false, reason: `cap:${gate.reason}` }

    // 2. Per-rep budget if pool mode = per_rep
    if (args.memberId) {
      const { data: repRow } = await supabase
        .from('reps')
        .select('dialer_pool_mode')
        .eq('id', args.repId)
        .maybeSingle()
      const poolMode = (repRow as { dialer_pool_mode: string | null } | null)?.dialer_pool_mode ?? 'per_rep'
      if (poolMode === 'per_rep') {
        const { getMemberWeeklyBudgetSeconds, getMemberUsedSeconds, isInActiveShift } = await import('../dialerHours')
        const [budget, used] = await Promise.all([
          getMemberWeeklyBudgetSeconds(args.repId, args.memberId),
          getMemberUsedSeconds(args.repId, args.memberId),
        ])
        if (budget.budget <= 0) {
          return { ok: false, reason: 'budget:no_grant' }
        }
        if (used >= budget.budget) {
          return { ok: false, reason: 'budget:exhausted' }
        }
        // 3. Shift check (only blocks if shifts are defined for this member).
        const { data: tenantRow } = await supabase
          .from('reps')
          .select('timezone')
          .eq('id', args.repId)
          .maybeSingle()
        const tz = (tenantRow as { timezone: string | null } | null)?.timezone ?? 'UTC'
        const inShift = await isInActiveShift({
          repId: args.repId,
          memberId: args.memberId,
          mode: args.mode,
          timezone: tz,
        })
        if (!inShift) return { ok: false, reason: 'shift:inactive' }
      }
    }
    return { ok: true, addon: 'hour_package', addonKey: hourAddon }
  }

  // Legacy fallback for tenants still on appts-based dialer pricing.
  const legacy = await resolveActiveAddon(args.repId, ['addon_dialer_pro', 'addon_dialer_lite'])
  if (!legacy) return { ok: false, reason: 'dialer_addon_not_active' }
  const gate = await assertCanUse(args.repId, legacy)
  if (!gate.ok) return { ok: false, reason: `cap:${gate.reason}` }
  return { ok: true, addon: 'legacy', addonKey: legacy }
}

// Schedule an SMS follow-up after a call outcome.
// Inserts into ai_salesperson_followups with channel='sms'.
// The SMS cron picks these up and dispatches via lib/sms/aiEngine.sendFirstSms.
async function scheduleSmsFollowup(args: {
  repId: string
  setterId: string
  leadId: string
  sourceCallId: string
  delayMinutes: number
  callOutcome: string
  reason: string
}): Promise<void> {
  try {
    const dueAt = new Date(Date.now() + args.delayMinutes * 60_000).toISOString()
    await supabase.from('ai_salesperson_followups').insert({
      rep_id: args.repId,
      ai_salesperson_id: args.setterId,
      lead_id: args.leadId,
      source_call_id: args.sourceCallId,
      due_at: dueAt,
      channel: 'sms',
      reason: args.reason,
      status: 'pending',
      context: { call_outcome: args.callOutcome },
    })
  } catch (err) {
    console.error('[dialer] scheduleSmsFollowup failed', err)
  }
}

export async function recordDialerHoursForCall(
  callId: string,
  opts: { durationSec: number; mode: string | null; memberId: string | null; repId: string },
): Promise<void> {
  if (!Number.isFinite(opts.durationSec) || opts.durationSec <= 0) return
  // Only count dialer modes — inbound or non-dialer calls (e.g. Vapi
  // assistant-only voice memos) shouldn't count against the SDR's hours.
  if (!opts.mode || !['concierge', 'appointment_setter', 'live_transfer', 'pipeline'].includes(opts.mode)) {
    return
  }
  const addon = await resolveActiveHourPackage(opts.repId)
  if (!addon) return
  await recordUsage({
    repId: opts.repId,
    addonKey: addon,
    eventType: 'dialer_active_seconds',
    quantity: Math.round(opts.durationSec),
    unit: 'hours_per_week',
    sourceTable: 'voice_calls',
    sourceId: callId,
    metadata: {
      dialer_mode: opts.mode,
      owner_member_id: opts.memberId,
    },
  })
}
