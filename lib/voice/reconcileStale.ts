// Stale voice_calls reconciler.
//
// Background: when a RevRing call fails BEFORE the agent ever picks up the
// call (e.g. SIP trunk rejects with 480, request timeout, ANI blocked, etc.)
// RevRing does NOT fire the post-call webhook. Our voice_calls row sits at
// status='ringing' forever, our dialer_queue row sits at status='in_progress'
// forever, the tenant's concurrency cap (max 1 active call) is permanently
// tripped, and SakredCRM never receives a disposition pushback — so the lead
// shows no call attempt on their side.
//
// This module reconciles those orphan rows by polling RevRing's call-status
// API for any voice_calls row that's been non-terminal longer than the
// threshold, mirrors the state, marks dialer_queue failed, and fires the
// SakredCRM disposition pushback so trunk-layer failures land in their CRM.
//
// Safe to call on every cron tick — only touches rows older than the
// threshold and uses RevRing's API as the source of truth.
//
// Called from app/api/cron/dialer-queue/route.ts before the dispatch loop.

import { supabase } from '@/lib/supabase'
import { pushDispositionToSakredCRM } from '@/lib/integrations/sakredcrm'

const REVRING_BASE = 'https://api.revring.ai/v1'
const STALE_THRESHOLD_SEC = 90  // RevRing usually rejects/answers within seconds; 90s is safe

type RevringTerminal = 'FAILED' | 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'CANCELED'
const TERMINAL_STATUSES = new Set<string>(['FAILED', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'CANCELED'])

function mapTerminalToOutcome(revringStatus: string, errorMessage: string | null): string {
  const s = revringStatus.toUpperCase()
  if (s === 'COMPLETED') return 'connected'  // post-call analysis will refine
  if (s === 'NO_ANSWER') return 'no_answer'
  if (s === 'BUSY')      return 'no_answer'
  if (s === 'CANCELED')  return 'failed'
  // FAILED → distinguish trunk/SIP failures from delivery failures via errorMessage
  if (s === 'FAILED' && errorMessage) {
    if (/timed out|timeout/i.test(errorMessage))           return 'failed'
    if (/480|temporarily unavailable/i.test(errorMessage)) return 'no_answer'
    if (/486|busy/i.test(errorMessage))                    return 'no_answer'
    if (/403|404|sip/i.test(errorMessage))                 return 'failed'
  }
  return 'failed'
}

export type ReconcileResult = {
  scanned: number
  reconciled: number
  still_active: number
  errors: number
}

export async function reconcileStaleVoiceCalls(opts: { repId?: string } = {}): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, reconciled: 0, still_active: 0, errors: 0 }

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_SEC * 1000).toISOString()
  let query = supabase
    .from('voice_calls')
    .select('id, rep_id, lead_id, ai_salesperson_id, provider_call_id, dialer_mode, raw, call_variables, created_at')
    .in('status', ['queued', 'ringing'])
    .eq('provider', 'revring')
    .not('provider_call_id', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50)
  if (opts.repId) query = query.eq('rep_id', opts.repId)

  const { data: stale, error } = await query
  if (error) {
    console.error('[reconcileStale] query failed', error)
    return result
  }

  result.scanned = stale?.length ?? 0
  if (result.scanned === 0) return result

  const apiKey = process.env.REVRING_API_KEY
  if (!apiKey) {
    console.warn('[reconcileStale] REVRING_API_KEY not set — cannot reconcile')
    return result
  }

  for (const row of stale ?? []) {
    try {
      const res = await fetch(`${REVRING_BASE}/calls/${row.provider_call_id}`, {
        headers: { 'x-api-key': apiKey },
      })
      if (!res.ok) {
        console.warn(`[reconcileStale] revring API ${res.status} for call ${row.provider_call_id}`)
        result.errors++
        continue
      }
      const json = (await res.json()) as { data?: Record<string, unknown> }
      const call = json.data ?? {}
      const revringStatus = String(call.status ?? '').toUpperCase()

      if (!TERMINAL_STATUSES.has(revringStatus)) {
        result.still_active++
        continue
      }

      const errorMessage = (call.errorMessage as string | null) ?? null
      const durationSec  = (call.durationSeconds as number | null) ?? null
      const endedAt      = (call.endedAt as string | null) ?? new Date().toISOString()
      const startedAt    = (call.startedAt as string | null) ?? null
      const outcome      = mapTerminalToOutcome(revringStatus, errorMessage)

      // 1. Mirror to voice_calls
      await supabase
        .from('voice_calls')
        .update({
          status: revringStatus === 'COMPLETED' ? 'completed' : 'failed',
          outcome,
          error_message: errorMessage,
          ended_at: endedAt,
          started_at: startedAt,
          duration_sec: durationSec,
        })
        .eq('id', row.id)

      // 2. Mark dialer_queue row failed if still in_progress
      const queueId = (row.raw as Record<string, unknown> | null)?.queue_id as string | undefined
      if (queueId) {
        await supabase
          .from('dialer_queue')
          .update({
            status: revringStatus === 'COMPLETED' ? 'completed' : 'failed',
            last_outcome: `reconcile:${outcome}:${errorMessage ? errorMessage.slice(0, 80) : revringStatus}`,
            next_retry_at: null,
          })
          .eq('id', queueId)
          .eq('status', 'in_progress')
      }

      // 3. Push disposition to SakredCRM (if this call originated from them)
      // Reads queue context for your_crm_lead_id; no-ops silently otherwise.
      await pushDispositionToSakredCRM({
        callId:       row.id as string,
        repId:        row.rep_id as string,
        queueId:      queueId ?? null,
        outcome,
        summary:      errorMessage ? `Call did not complete: ${errorMessage}` : null,
        transcript:   null,
        recordingUrl: null,
        durationSec:  durationSec,
        callVariables: (row.call_variables as Record<string, unknown> | null) ?? {},
      }).catch((err) => console.error('[reconcileStale] disposition push failed', err))

      result.reconciled++
    } catch (err) {
      console.error('[reconcileStale] row error', row.id, err)
      result.errors++
    }
  }

  return result
}
