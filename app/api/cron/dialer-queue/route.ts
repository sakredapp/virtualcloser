import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { dispatchQueueCall, type QueueRow } from '@/lib/voice/queueDispatch'
import { getDialerSettings } from '@/lib/voice/dialerSettings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DISPATCH_LIMIT = 250
const CONCURRENCY = 20

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Reconciliation: expire in_progress rows stuck longer than 30 min ────
  // A row stays `in_progress` if the queue worker set it but the provider
  // webhook never arrived (e.g. network timeout, provider outage, deploy).
  // After 30 min we expire it so the cron can retry up to max_attempts.
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
    console.error('[cron/dialer-queue] query failed', error)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }

  const queue = ((rows ?? []) as QueueRow[]).filter((row) => {
    const dueBySchedule = !rowHasFutureTime(row.scheduled_for)
    const dueByRetry = !rowHasFutureTime(row.next_retry_at)
    return dueBySchedule && dueByRetry
  })
  if (!queue.length) {
    return NextResponse.json({ ok: true, scanned: 0, dispatched: 0, skipped: 0, failed: 0, reconciled_expired: reconciledExpired, reconciled_retried: reconciledRetried })
  }

  const settingsCache = new Map<string, Awaited<ReturnType<typeof getDialerSettings>>>()
  const activeByRep = new Map<string, number>()

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
    const settled = await Promise.all(batch.map(processOne))
    results.push(...settled)
  }

  return NextResponse.json({
    ok: true,
    scanned: queue.length,
    dispatched: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: skipped.length,
    results,
    skipped_reasons: skipped,
    reconciled_expired: reconciledExpired,
    reconciled_retried: reconciledRetried,
  })
}

async function processOne(row: QueueRow): Promise<{ queue_id: string; ok: boolean; reason?: string }> {
  await supabase
    .from('dialer_queue')
    .update({ status: 'in_progress' })
    .eq('id', row.id)

  await logEvent(row, 'dispatched')

  const dispatch = await dispatchQueueCall(row)

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
