import { supabase } from '@/lib/supabase'
import { resolveVoiceProviderForMode } from './provider'
import { gateDialerCall } from './dialer'
import { selectLiveTransferTarget } from './liveTransferBridge'
import { stateToTimezone, localCallVars, isCaliforniaState } from '@/lib/campaign/campaignEngine'
import type { DialerMode } from './dialerSettings'
import type { AiSalesperson } from '@/types'

export type QueueRow = {
  id: string
  rep_id: string
  owner_member_id: string | null
  workflow_rule_id: string | null
  lead_id: string | null
  meeting_id: string | null
  ai_salesperson_id: string | null
  dialer_mode: DialerMode
  status: string
  scheduled_for?: string | null
  next_retry_at?: string | null
  attempt_count: number
  max_attempts: number
  phone: string | null
  context: Record<string, unknown> | null
  provider_call_id?: string | null   // idempotency: set once call is placed
}

export type QueueDispatchResult =
  | { ok: true; callId: string; providerCallId: string; provider: string }
  | { ok: false; reason: string; terminal?: boolean }

export type DispatchOptions = {
  setter?: AiSalesperson | null
}

export async function dispatchQueueCall(
  row: QueueRow,
  opts: DispatchOptions = {},
): Promise<QueueDispatchResult> {
  if (!row.phone) return { ok: false, reason: 'no_phone', terminal: true }

  // Idempotency guard: if a provider call was already placed for this queue
  // row (cron ran twice before webhook fired), skip re-dispatch.
  if (row.provider_call_id) {
    return { ok: true, callId: '', providerCallId: row.provider_call_id, provider: 'already_placed' }
  }

  // Cap-enforcement gate. Routes through the unified hour-package /
  // legacy-appts gate. Queue rows know their owner member id, so per-rep
  // budget + shift checks are enforced here when the tenant is on
  // dialer_pool_mode='per_rep'.
  const gate = await gateDialerCall({
    repId: row.rep_id,
    memberId: row.owner_member_id ?? null,
    mode: row.dialer_mode,
  })
  if (!gate.ok) {
    // Concurrency blocks are non-terminal — queue row stays pending so
    // the next cron pass picks it up after the active call ends. We
    // don't insert a 'blocked_cap' row either because a long call would
    // generate hundreds during peak hours.
    if (gate.reason.startsWith('concurrent:')) {
      return { ok: false, reason: gate.reason, terminal: false }
    }
    const providerForMode = await getProviderLabelForMode(
      row.rep_id,
      row.dialer_mode,
      row.owner_member_id ?? undefined,
    )
    await supabase.from('voice_calls').insert({
      rep_id: row.rep_id,
      lead_id: row.lead_id,
      meeting_id: row.meeting_id,
      ai_salesperson_id: row.ai_salesperson_id,
      owner_member_id: row.owner_member_id ?? null,
      provider: providerForMode,
      direction: 'outbound_dial',
      status: 'blocked_cap',
      to_number: row.phone,
      dialer_mode: row.dialer_mode,
      raw: { reason: gate.reason, queue_id: row.id },
    })
    return { ok: false, reason: gate.reason, terminal: true }
  }

  const provider = await resolveVoiceProviderForMode(row.rep_id, row.dialer_mode, {
    memberId: row.owner_member_id ?? undefined,
  })
  if (!provider.ok) {
    return {
      ok: false,
      reason: provider.reason,
      terminal: provider.reason.startsWith('provider_not_implemented'),
    }
  }
  const assistantId = pickAssistantId(provider.client.assistants, row.dialer_mode)
  if (!assistantId) return { ok: false, reason: 'assistant_not_configured', terminal: true }

  const transferCheck = await maybeHandleLiveTransferFallback(row)
  if (!transferCheck.ok) return transferCheck
  const transferPhone = transferCheck.transferPhone ?? null
  const transferMemberId = transferCheck.transferMemberId ?? null

  const { data: callRow, error: insertErr } = await supabase
    .from('voice_calls')
    .insert({
      rep_id: row.rep_id,
      lead_id: row.lead_id,
      meeting_id: row.meeting_id,
      ai_salesperson_id: row.ai_salesperson_id,
      provider: provider.client.provider,
      direction: row.dialer_mode === 'concierge' ? 'outbound_confirm' : 'outbound_dial',
      status: 'queued',
      to_number: row.phone,
      dialer_mode: row.dialer_mode,
      raw: {
        queue_id: row.id,
        workflow_rule_id: row.workflow_rule_id,
        transfer_member_id: transferMemberId,
      },
    })
    .select('id')
    .single()

  if (insertErr || !callRow) {
    return { ok: false, reason: `db_insert_failed:${insertErr?.message ?? 'unknown'}` }
  }

  try {
    const call = await provider.client.placeCall({
      assistantId,
      toNumber: normalizePhone(row.phone),
      forwardingPhoneNumber: transferPhone ?? undefined,
      variableValues: buildVariableValues(row, transferPhone, transferCheck, opts.setter ?? null),
      recordingEnabled: opts.setter?.call_script?.record_calls ?? true,
      metadata: {
        rep_id: row.rep_id,
        queue_id: row.id,
        voice_call_id: callRow.id,
        ai_salesperson_id: row.ai_salesperson_id ?? '',
        dialer_mode: row.dialer_mode,
        purpose: row.dialer_mode,
        transfer_member_id: transferMemberId ?? '',
      },
    })

    await supabase
      .from('voice_calls')
      .update({ provider_call_id: call.id, status: 'ringing' })
      .eq('id', callRow.id)

    await supabase
      .from('dialer_queue')
      .update({
        provider: provider.client.provider,
        provider_call_id: call.id,
      })
      .eq('id', row.id)

    return {
      ok: true,
      callId: callRow.id,
      providerCallId: call.id,
      provider: provider.client.provider,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'provider_error'
    await supabase
      .from('voice_calls')
      .update({ status: 'failed', raw: { error: reason, queue_id: row.id } })
      .eq('id', callRow.id)
    return { ok: false, reason }
  }
}

function buildVariableValues(
  row: QueueRow,
  transferPhone: string | null | undefined,
  transferCheck: { transferRepName?: string },
  setter: AiSalesperson | null,
): Record<string, string> | undefined {
  const vars: Record<string, string> = {}

  // Lead context from queue row — always include for appointment_setter / pipeline
  const ctx = row.context ?? {}
  if (ctx.name)          vars.name          = String(ctx.name)
  if (ctx.first_name)    vars.first_name    = String(ctx.first_name)
  if (ctx.last_name)     vars.last_name     = String(ctx.last_name)
  if (ctx.email)         vars.email         = String(ctx.email)
  if (ctx.company)       vars.company       = String(ctx.company)
  if (ctx.notes)         vars.notes         = String(ctx.notes)
  if (ctx.state)         vars.state         = String(ctx.state)
  if (ctx.customer_name) vars.customer_name = String(ctx.customer_name)
  if (ctx.agency_name)   vars.agency_name   = String(ctx.agency_name)
  if (ctx.ca_opener)     vars.ca_opener     = String(ctx.ca_opener)
  if (ctx.lead_timezone) vars.lead_timezone = String(ctx.lead_timezone)
  if (ctx.lead_tz_name)  vars.lead_tz_name  = String(ctx.lead_tz_name)
  if (ctx.call_date)     vars.call_date     = String(ctx.call_date)
  if (ctx.call_time)     vars.call_time     = String(ctx.call_time)
  // customer_name fallback — SakredCRM direct-inserts use first_name/name, not customer_name
  if (!vars.customer_name && ctx.first_name) vars.customer_name = String(ctx.first_name)
  if (!vars.customer_name && ctx.name)       vars.customer_name = String(ctx.name)

  // Friendly first-name fallback from full name or customer_name
  if (!vars.first_name && vars.customer_name) vars.first_name = vars.customer_name.split(' ')[0]
  if (!vars.first_name && vars.name)          vars.first_name = vars.name.split(' ')[0]

  // Timezone + ca_opener fallback — computed here if executeCallStep didn't pre-populate them
  // (SakredCRM direct-inserts bypass executeCallStep so these fields are absent)
  if (ctx.state && !vars.lead_timezone) {
    const state = String(ctx.state)
    const tz = stateToTimezone(state)
    const tvars = localCallVars(tz)
    vars.lead_timezone = tvars.lead_timezone
    vars.lead_tz_name  = tvars.lead_tz_name
    vars.call_date     = tvars.call_date
    vars.call_time     = tvars.call_time
  }
  if (ctx.state && !vars.ca_opener) {
    const state = String(ctx.state)
    vars.ca_opener = isCaliforniaState(state)
      ? "I'm Rachel — the Sakred Health underwriting team's AI assistant. This call is being recorded."
      : 'this is Rachel from the Sakred Health underwriting team. This call is being recorded.'
  }

  // AI Salesperson persona + script vars (multi-setter model). When a setter
  // is attached to the queue row, push its name/role/opener/product so the
  // provider's prompt template can reference {{ai_name}}, {{role_title}}, etc.
  if (setter) {
    const persona = setter.voice_persona ?? {}
    if (persona.ai_name)    vars.ai_name    = String(persona.ai_name)
    if (persona.role_title) vars.role_title = String(persona.role_title)
    if (persona.tone)       vars.tone       = String(persona.tone)
    if (persona.opener)     vars.opener     = String(persona.opener)

    const intent = setter.product_intent ?? {}
    if (intent.name)        vars.product_name        = String(intent.name)
    if (intent.explanation) vars.product_explanation = String(intent.explanation)
    if (intent.opt_in_reason) vars.opt_in_reason     = String(intent.opt_in_reason)

    const script = setter.call_script ?? {}
    if (script.opening)      vars.script_opening      = String(script.opening)
    if (script.confirmation) vars.script_confirmation = String(script.confirmation)
    if (script.pitch)        vars.script_pitch        = String(script.pitch)
    if (script.close)        vars.script_close        = String(script.close)
    if (Array.isArray(script.qualifying) && script.qualifying.length > 0) {
      vars.qualifying_questions = script.qualifying.join('\n')
    }

    if (Array.isArray(setter.objection_responses) && setter.objection_responses.length > 0) {
      vars.objection_handling = setter.objection_responses
        .map((o) => `${o.trigger}: ${o.response}`)
        .join('\n')
    }

    const cal = setter.calendar ?? {}
    if (cal.calendar_url) vars.appointment_calendar_url = String(cal.calendar_url)

    vars.ai_salesperson_id = setter.id
    vars.ai_salesperson_name = setter.name
  }

  // Live transfer overrides
  if (transferPhone) {
    vars.transfer_phone    = transferPhone
    vars.transfer_rep_name = transferCheck.transferRepName ?? ''
  }

  return Object.keys(vars).length > 0 ? vars : undefined
}

function pickAssistantId(
  assistants: {
    confirm?: string
    appointment_setter?: string
    pipeline?: string
    live_transfer?: string
  },
  mode: DialerMode,
): string | undefined {
  if (mode === 'appointment_setter') {
    return assistants.appointment_setter || assistants.confirm
  }
  if (mode === 'pipeline') {
    return assistants.pipeline || assistants.confirm
  }
  if (mode === 'live_transfer') {
    return assistants.live_transfer || assistants.appointment_setter || assistants.confirm
  }
  return assistants.confirm
}

async function getProviderLabelForMode(
  repId: string,
  mode: DialerMode,
  memberId?: string,
): Promise<string> {
  const resolved = await resolveVoiceProviderForMode(repId, mode, { memberId })
  if (!resolved.ok) {
    const fromReason = resolved.reason.match(/^provider_not_implemented:(.+)$/)?.[1]
    if (fromReason) return fromReason
    const fromMissing = resolved.reason.match(/^(.+)_not_configured$/)?.[1]
    if (fromMissing) return fromMissing
    return 'vapi'
  }
  return resolved.client.provider
}

async function maybeHandleLiveTransferFallback(
  row: QueueRow,
): Promise<
  | (QueueDispatchResult & { ok: false })
  | { ok: true; transferPhone?: string; transferMemberId?: string; transferRepName?: string }
> {
  if (row.dialer_mode !== 'live_transfer') return { ok: true }

  const bridge = await selectLiveTransferTarget(row.rep_id, row.id)

  if (bridge.available) {
    // Store the selected rep in queue context so the webhook can finalize correctly.
    await supabase
      .from('dialer_queue')
      .update({
        live_transfer_status: 'attempted',
        context: {
          ...(row.context ?? {}),
          transfer_target_member_id: bridge.target.member_id,
          transfer_target_phone: bridge.target.phone,
          transfer_target_name: bridge.target.display_name,
        },
      })
      .eq('id', row.id)

    return {
      ok: true,
      transferPhone: bridge.target.phone,
      transferMemberId: bridge.target.member_id,
      transferRepName: bridge.target.display_name,
    }
  }

  const ctx = row.context ?? {}
  const fallback = String(ctx.live_transfer_fallback ?? 'book_appointment')

  if (fallback === 'book_appointment') {
    const scheduledAt =
      typeof ctx.fallback_start_iso === 'string' && ctx.fallback_start_iso
        ? ctx.fallback_start_iso
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { error } = await supabase.from('meetings').insert({
      rep_id: row.rep_id,
      lead_id: row.lead_id,
      source: 'manual',
      source_event_id: `live_transfer_fallback:${row.id}`,
      phone: row.phone,
      scheduled_at: scheduledAt,
      duration_min: 30,
      status: 'scheduled',
      metadata: {
        queue_id: row.id,
        fallback_from: 'live_transfer',
        no_transfer_reason: bridge.reason,
      },
    })

    if (error) return { ok: false, reason: `fallback_booking_failed:${error.message}` }

    await supabase
      .from('dialer_queue')
      .update({ live_transfer_status: 'fallback_booked' })
      .eq('id', row.id)

    return { ok: false, reason: 'fallback_booked', terminal: true }
  }

  if (fallback === 'collect_callback') {
    await supabase
      .from('dialer_queue')
      .update({ live_transfer_status: 'fallback_callback' })
      .eq('id', row.id)
    return { ok: false, reason: 'fallback_callback', terminal: true }
  }

  await supabase
    .from('dialer_queue')
    .update({ live_transfer_status: 'fallback_ended' })
    .eq('id', row.id)
  return { ok: false, reason: 'fallback_ended', terminal: true }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits
}
