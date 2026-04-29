import { supabase } from '@/lib/supabase'
import { resolveVoiceProviderForMode } from './provider'
import { assertCanUse } from '@/lib/entitlements'
import { resolveActiveAddon } from '@/lib/usage'
import { selectLiveTransferTarget } from './liveTransferBridge'
import type { DialerMode } from './dialerSettings'

export type QueueRow = {
  id: string
  rep_id: string
  owner_member_id: string | null
  workflow_rule_id: string | null
  lead_id: string | null
  meeting_id: string | null
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

export async function dispatchQueueCall(row: QueueRow): Promise<QueueDispatchResult> {
  if (!row.phone) return { ok: false, reason: 'no_phone', terminal: true }

  // Idempotency guard: if a provider call was already placed for this queue
  // row (cron ran twice before webhook fired), skip re-dispatch.
  if (row.provider_call_id) {
    return { ok: true, callId: '', providerCallId: row.provider_call_id, provider: 'already_placed' }
  }

  const dialerKey = await resolveActiveAddon(row.rep_id, [
    'addon_dialer_pro',
    'addon_dialer_lite',
  ])
  if (!dialerKey) return { ok: false, reason: 'dialer_addon_not_active', terminal: true }

  const gate = await assertCanUse(row.rep_id, dialerKey)
  if (!gate.ok) {
    const providerForMode = await getProviderLabelForMode(
      row.rep_id,
      row.dialer_mode,
      row.owner_member_id ?? undefined,
    )
    await supabase.from('voice_calls').insert({
      rep_id: row.rep_id,
      lead_id: row.lead_id,
      meeting_id: row.meeting_id,
      provider: providerForMode,
      direction: 'outbound_dial',
      status: 'blocked_cap',
      to_number: row.phone,
      dialer_mode: row.dialer_mode,
      raw: { reason: gate.reason, used: gate.used, cap: gate.cap, queue_id: row.id },
    })
    return { ok: false, reason: `cap:${gate.reason}`, terminal: true }
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
      variableValues: transferPhone
        ? {
            transfer_phone: transferPhone,
            transfer_rep_name: transferCheck.transferRepName ?? '',
          }
        : undefined,
      metadata: {
        rep_id: row.rep_id,
        queue_id: row.id,
        voice_call_id: callRow.id,
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
