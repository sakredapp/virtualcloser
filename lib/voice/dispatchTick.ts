// Single dispatch tick — pulled out of /api/cron/dialer-queue so it can be
// called from the Hetzner worker (every 30s) instead of relying on Vercel's
// 5-minute cron schedule. Same logic, same gates, same output shape.
//
// The Hetzner worker imports runDispatchTick() from here. The cron route
// (kept as a manual-trigger backup) also calls this same function.
//
// All in-process caches (setterCache, settingsCache, activeByRep) live inside
// the function so each tick gets a fresh view of the world — no stale-cache
// surprises across ticks.

import { supabase } from '@/lib/supabase'
import { dispatchQueueCall, type QueueRow } from '@/lib/voice/queueDispatch'
import { getDialerSettings } from '@/lib/voice/dialerSettings'
import { getOrCreateDefaultSalesperson, getSalespersonForRep } from '@/lib/ai-salesperson'
import type { AiSalesperson } from '@/types'
import { canDial } from '@/lib/billing/canDial'
import { reconcileStaleVoiceCalls, type ReconcileResult } from '@/lib/voice/reconcileStale'

const DISPATCH_LIMIT = 250
const CONCURRENCY = 20

export type DispatchTickResult = {
  ok: true
  scanned: number
  dispatched: number
  failed: number
  skipped: number
  results: Array<{ queue_id: string; ok: boolean; reason?: string }>
  skipped_reasons: Array<{ queue_id: string; reason: string }>
  reconciled_expired: number
  reconciled_retried: number
  voice_calls_reconciled: ReconcileResult
}

export async function runDispatchTick(): Promise<DispatchTickResult> {
  // ── Reconcile orphan voice_calls rows (RevRing trunk-layer failures that
  // never fire the post-call webhook). Mirrors terminal state from RevRing's
  // API, frees the concurrency cap, and fires disposition pushback to
  // upstream CRMs (SakredCRM) so trunk-level failures don't disappear silently.
  const voiceCallsReconciled = await reconcileStaleVoiceCalls().catch((err) => {
    console.error('[dispatchTick] reconcileStaleVoiceCalls failed', err)
    return { scanned: 0, reconciled: 0, still_active: 0, errors: 1 } as ReconcileResult
  })

  // ── Reconciliation: expire in_progress rows stuck longer than 30 min ────
  const staleThreshold = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data: staleRows } = await supabase
    .from('dialer_queue')
    .select('id, rep_id, attempt_count, max_attempts, workflow_rule_id, owner_member_id')
    .eq('status', 'in_progress')
    .lt('updated_at', staleThreshold)

  let reconciledExpired = 0
  let reconciledRetried = 0
  for (const stale of staleRows ?? []) {
    const nextAttempt = (stale.attempt_count as number) + 1
    const maxAttempts = stale.max_attempts as number
    if (nextAttempt < maxAttempts) {
      const nextRetryAt = new Date(Date.now() + 5 * 60_000).toISOString()
      await supabase
        .from('dialer_queue')
        .update({ status: 'pending', attempt_count: nextAttempt, next_retry_at: nextRetryAt, last_outcome: 'reconcile_timeout' })
        .eq('id', stale.id)
      await supabase.from('dialer_queue_events').insert({
        rep_id: stale.rep_id,
        queue_id: stale.id,
        workflow_rule_id: stale.workflow_rule_id ?? null,
        member_id: stale.owner_member_id ?? null,
        event_type: 'retry_scheduled',
        reason: 'reconcile_timeout',
        payload: { attempt_count: nextAttempt, next_retry_at: nextRetryAt },
      })
      reconciledRetried++
    } else {
      await supabase
        .from('dialer_queue')
        .update({ status: 'failed', attempt_count: nextAttempt, last_outcome: 'reconcile_timeout_max_attempts' })
        .eq('id', stale.id)
      await supabase.from('dialer_queue_events').insert({
        rep_id: stale.rep_id,
        queue_id: stale.id,
        workflow_rule_id: stale.workflow_rule_id ?? null,
        member_id: stale.owner_member_id ?? null,
        event_type: 'failed',
        reason: 'reconcile_timeout_max_attempts',
        payload: {},
      })
      reconciledExpired++
    }
  }

  const { data: rows, error } = await supabase
    .from('dialer_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(DISPATCH_LIMIT)

  if (error) {
    console.error('[dispatchTick] queue query failed', error)
    return {
      ok: true, scanned: 0, dispatched: 0, failed: 0, skipped: 0,
      results: [], skipped_reasons: [],
      reconciled_expired: reconciledExpired, reconciled_retried: reconciledRetried,
      voice_calls_reconciled: voiceCallsReconciled,
    }
  }

  const queue = ((rows ?? []) as QueueRow[]).filter((row) => {
    const dueBySchedule = !rowHasFutureTime(row.scheduled_for)
    const dueByRetry = !rowHasFutureTime(row.next_retry_at)
    return dueBySchedule && dueByRetry
  })

  if (!queue.length) {
    return {
      ok: true, scanned: 0, dispatched: 0, failed: 0, skipped: 0,
      results: [], skipped_reasons: [],
      reconciled_expired: reconciledExpired, reconciled_retried: reconciledRetried,
      voice_calls_reconciled: voiceCallsReconciled,
    }
  }

  // ── DNC preflight: batch-load do_not_call for all lead_ids in the queue ──
  const leadIdsInQueue = Array.from(
    new Set(queue.map((r) => r.lead_id).filter((id): id is string => Boolean(id))),
  )
  const dncLeadIds = new Set<string>()
  if (leadIdsInQueue.length > 0) {
    const { data: dncRows } = await supabase
      .from('leads')
      .select('id')
      .in('id', leadIdsInQueue)
      .eq('do_not_call', true)
    for (const row of dncRows ?? []) dncLeadIds.add(row.id as string)
  }

  // Per-tick caches — fresh on every call so DB updates are seen immediately.
  const settingsCache = new Map<string, Awaited<ReturnType<typeof getDialerSettings>>>()
  const setterCache = new Map<string, AiSalesperson | null>()
  const activeByRep = new Map<string, number>()
  const dispatchSetterByRow = new Map<string, AiSalesperson | null>()

  async function getActiveCalls(repId: string): Promise<number> {
    if (activeByRep.has(repId)) return activeByRep.get(repId) || 0
    const { count } = await supabase
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', repId)
      .in('status', ['queued', 'ringing', 'in_progress'])
    const v = count ?? 0
    activeByRep.set(repId, v)
    return v
  }

  async function getSetter(repId: string, setterId: string | null): Promise<AiSalesperson | null> {
    const key = `${repId}|${setterId ?? 'default'}`
    if (setterCache.has(key)) return setterCache.get(key) ?? null
    let setter: AiSalesperson | null = null
    try {
      setter = setterId
        ? await getSalespersonForRep(repId, setterId)
        : await getOrCreateDefaultSalesperson(repId)
    } catch (err) {
      console.error('[dispatchTick] getSetter failed', err)
    }
    setterCache.set(key, setter)
    return setter
  }

  const candidates: QueueRow[] = []
  const skipped: Array<{ queue_id: string; reason: string }> = []

  for (const row of queue) {
    let settings = settingsCache.get(row.rep_id)
    if (!settings) {
      settings = await getDialerSettings(row.rep_id)
      settingsCache.set(row.rep_id, settings)
    }

    if (!settings.enabled_modes.includes(row.dialer_mode)) {
      skipped.push({ queue_id: row.id, reason: 'mode_disabled' })
      await markSkipped(row.id, 'mode_disabled')
      continue
    }

    if (row.dialer_mode === 'pipeline' && !settings.pipeline_opt_in) {
      skipped.push({ queue_id: row.id, reason: 'pipeline_opt_in_disabled' })
      await markSkipped(row.id, 'pipeline_opt_in_disabled')
      continue
    }

    if (row.lead_id && dncLeadIds.has(row.lead_id)) {
      skipped.push({ queue_id: row.id, reason: 'lead_do_not_call' })
      await supabase
        .from('dialer_queue')
        .update({ status: 'failed', last_outcome: 'lead_do_not_call', next_retry_at: null })
        .eq('id', row.id)
      await logEvent(row, 'failed', { reason: 'lead_do_not_call' })
      continue
    }

    if (row.dialer_mode === 'appointment_setter') {
      const setter = await getSetter(row.rep_id, row.ai_salesperson_id)
      if (!setter) {
        skipped.push({ queue_id: row.id, reason: 'no_salesperson_configured' })
        await markSkipped(row.id, 'no_salesperson_configured')
        continue
      }
      if (setter.status !== 'active') {
        skipped.push({ queue_id: row.id, reason: `salesperson_${setter.status}` })
        await markSkipped(row.id, `salesperson_${setter.status}`)
        continue
      }
      if (!isWithinSetterSchedule(setter)) {
        skipped.push({ queue_id: row.id, reason: 'outside_schedule_window' })
        continue
      }
      const hourly = await getDialsThisHour(row.rep_id, setter.id)
      const leadsPerHour = setter.schedule.leads_per_hour ?? 18
      if (hourly >= leadsPerHour) {
        skipped.push({ queue_id: row.id, reason: 'hourly_pacing_cap_reached' })
        continue
      }
      const daily = await getDialsToday(row.rep_id, setter.id, setter.schedule.timezone ?? undefined)
      const leadsPerDay = setter.schedule.leads_per_day ?? setter.schedule.max_calls_per_day ?? 120
      if (daily >= leadsPerDay) {
        skipped.push({ queue_id: row.id, reason: 'daily_pacing_cap_reached' })
        continue
      }
      dispatchSetterByRow.set(row.id, setter)
    }

    if (row.owner_member_id) {
      const billingCheck = await canDial({ memberId: row.owner_member_id, mode: row.dialer_mode })
      if (!billingCheck.ok) {
        if (billingCheck.reason === 'outside_shift') {
          skipped.push({ queue_id: row.id, reason: 'outside_shift' })
          continue
        }
        skipped.push({ queue_id: row.id, reason: `agent_billing_${billingCheck.reason}` })
        await markSkipped(row.id, `agent_billing_${billingCheck.reason}`)
        continue
      }
    }

    const active = await getActiveCalls(row.rep_id)
    if (active >= settings.max_concurrent_calls) {
      skipped.push({ queue_id: row.id, reason: 'max_concurrency_reached' })
      continue
    }

    activeByRep.set(row.rep_id, active + 1)
    candidates.push(row)
  }

  const results: Array<{ queue_id: string; ok: boolean; reason?: string }> = []
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(batch.map((row) => processOne(row, dispatchSetterByRow.get(row.id) ?? null)))
    results.push(...settled)
  }

  return {
    ok: true,
    scanned: queue.length,
    dispatched: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: skipped.length,
    results,
    skipped_reasons: skipped,
    reconciled_expired: reconciledExpired,
    reconciled_retried: reconciledRetried,
    voice_calls_reconciled: voiceCallsReconciled,
  }
}

async function processOne(row: QueueRow, setter: AiSalesperson | null): Promise<{ queue_id: string; ok: boolean; reason?: string }> {
  await supabase
    .from('dialer_queue')
    .update({ status: 'in_progress' })
    .eq('id', row.id)

  await logEvent(row, 'dispatched')

  const dispatch = await dispatchQueueCall(row, { setter })

  if (dispatch.ok) {
    await supabase
      .from('dialer_queue')
      .update({
        status: 'in_progress',
        attempt_count: row.attempt_count + 1,
        last_outcome: 'provider_call_started',
      })
      .eq('id', row.id)

    await logEvent(row, 'provider_call_started', {
      provider: dispatch.provider,
      provider_call_id: dispatch.providerCallId,
      voice_call_id: dispatch.callId,
    })

    return { queue_id: row.id, ok: true }
  }

  const nextAttempt = row.attempt_count + 1
  const canRetry = !dispatch.terminal && nextAttempt < row.max_attempts

  if (canRetry) {
    const retryDelayMin = getRetryDelayMin(row)
    const nextRetryAt = new Date(Date.now() + retryDelayMin * 60_000).toISOString()
    await supabase
      .from('dialer_queue')
      .update({
        status: 'pending',
        attempt_count: nextAttempt,
        next_retry_at: nextRetryAt,
        last_outcome: dispatch.reason,
      })
      .eq('id', row.id)

    await logEvent(row, 'retry_scheduled', {
      reason: dispatch.reason,
      attempt_count: nextAttempt,
      next_retry_at: nextRetryAt,
    })
    return { queue_id: row.id, ok: false, reason: dispatch.reason }
  }

  await supabase
    .from('dialer_queue')
    .update({
      status: dispatch.reason.startsWith('fallback_') ? 'completed' : 'failed',
      attempt_count: nextAttempt,
      last_outcome: dispatch.reason,
      next_retry_at: null,
    })
    .eq('id', row.id)

  await logEvent(row, fallbackEventType(dispatch.reason), {
    reason: dispatch.reason,
    attempt_count: nextAttempt,
  })

  return { queue_id: row.id, ok: false, reason: dispatch.reason }
}

async function markSkipped(queueId: string, reason: string): Promise<void> {
  const nextRetryAt = new Date(Date.now() + 15 * 60_000).toISOString()
  await supabase
    .from('dialer_queue')
    .update({
      status: 'pending',
      next_retry_at: nextRetryAt,
      last_outcome: reason,
    })
    .eq('id', queueId)
}

async function logEvent(
  row: QueueRow,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from('dialer_queue_events').insert({
    rep_id: row.rep_id,
    queue_id: row.id,
    workflow_rule_id: row.workflow_rule_id,
    member_id: row.owner_member_id,
    event_type: eventType,
    reason: (payload.reason as string | undefined) ?? null,
    outcome: (payload.outcome as string | undefined) ?? null,
    payload,
  })
}

function rowHasFutureTime(iso: string | null | undefined): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return false
  return t > Date.now()
}

function getRetryDelayMin(row: QueueRow): number {
  const context = row.context ?? {}
  const raw = context.retry_delay_min
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(1440, Math.round(raw)))
  }
  return 30
}

function fallbackEventType(reason: string): string {
  if (reason === 'fallback_callback') return 'live_transfer_fallback_callback'
  if (reason === 'fallback_ended') return 'live_transfer_fallback_ended'
  if (reason === 'fallback_booked') return 'live_transfer_fallback_booked'
  return 'failed'
}

// ── Schedule + pacing helpers (no module-level cache — settings live in
// per-tick Maps inside runDispatchTick so DB updates are seen immediately) ─

function isWithinSetterSchedule(setter: AiSalesperson): boolean {
  const sched = setter.schedule ?? {}
  const tz = sched.timezone || 'America/New_York'
  const activeDays = sched.active_days && sched.active_days.length > 0 ? sched.active_days : [1, 2, 3, 4, 5]
  const now = new Date()
  const dayStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dayNum = dayMap[dayStr] ?? now.getDay()
  if (!activeDays.includes(dayNum)) return false
  const hour = parseInt(
    now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }),
    10,
  )
  const windows = Array.isArray(sched.windows) && sched.windows.length > 0
    ? sched.windows
    : [{ start: typeof sched.start_hour === 'number' ? sched.start_hour : 9,
         end:   typeof sched.end_hour   === 'number' ? sched.end_hour   : 17 }]
  return windows.some((w) => hour >= w.start && hour < w.end)
}

async function getDialsThisHour(repId: string, setterId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString()
  const { count } = await supabase
    .from('voice_calls')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('ai_salesperson_id', setterId)
    .eq('dialer_mode', 'appointment_setter')
    .gte('created_at', since)
  return count ?? 0
}

function localMidnightIso(timezone: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(now)
  const [h, m, s] = parts.split(':').map(Number)
  const elapsedMs = ((h % 24) * 3600 + m * 60 + (s || 0)) * 1000
  return new Date(now.getTime() - elapsedMs).toISOString()
}

async function getDialsToday(repId: string, setterId: string, tz?: string): Promise<number> {
  const midnightIso = localMidnightIso(tz || 'America/New_York')
  const { count } = await supabase
    .from('voice_calls')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('ai_salesperson_id', setterId)
    .eq('dialer_mode', 'appointment_setter')
    .gte('created_at', midnightIso)
  return count ?? 0
}
