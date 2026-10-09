// Pinnacle Airtable sync tick — runs from the Hetzner worker.
//
// The Vercel cron route can't actually finish this sync — a full pull of
// Brad's three bases takes ~9 minutes (167K rows across 9 tables) and
// Vercel's hard maxDuration is 300s. Hetzner has no timeout, so we run
// it there on a daily gate.
//
// Idempotency: syncPinnacleAirtable() upserts in place by
// (base_id, table_name, record_id) — safe to re-run any time, never
// duplicates rows.
//
// Gate: only runs if the most recent successful sync_runs row is more
// than RUN_INTERVAL_HOURS old, so a worker restart doesn't trigger an
// immediate re-sync.

import { supabase } from '@/lib/supabase'
import { syncPinnacleAirtable, getBases, type SyncResult } from './airtable'
import { acquireSyncLease, releaseSyncLease } from './syncLease'

const RUN_INTERVAL_HOURS = 23 // ~daily, with a 1-hour float
// One pull per lease; a table cut off here resumes from its cursor next time.
const TICK_BUDGET_MS = 20 * 60_000

export type PinnacleSyncTickResult =
  | { ran: false; reason: string }
  | { ran: true; result: SyncResult; durationMs: number }

export async function runPinnacleSyncTick(): Promise<PinnacleSyncTickResult> {
  if (!process.env.PINNACLE_AIRTABLE_TOKEN) {
    return { ran: false, reason: 'PINNACLE_AIRTABLE_TOKEN unset' }
  }
  const bases = getBases()
  if (bases.length === 0) {
    return { ran: false, reason: 'no bases configured' }
  }

  // Skip if the last successful sync was within the cooldown window.
  const { data: lastRun } = await supabase
    .from('pinnacle_airtable_sync_runs')
    .select('finished_at, ok')
    .eq('ok', true)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const last = lastRun as { finished_at: string | null; ok: boolean | null } | null
  if (last?.finished_at) {
    const ageHours = (Date.now() - new Date(last.finished_at).getTime()) / 3_600_000
    if (ageHours < RUN_INTERVAL_HOURS) {
      return {
        ran: false,
        reason: `last sync ${ageHours.toFixed(1)}h ago (< ${RUN_INTERVAL_HOURS}h cooldown)`,
      }
    }
  }

  const t0 = Date.now()
  // Same lease as the Vercel cron and the Refresh button: never two pulls at once.
  const lease = await acquireSyncLease(TICK_BUDGET_MS + 2 * 60_000)
  if (!lease) return { ran: false, reason: 'another Pinnacle sync holds the lease' }
  try {
    const result = await syncPinnacleAirtable({ deadlineAt: t0 + TICK_BUDGET_MS })
    return { ran: true, result, durationMs: Date.now() - t0 }
  } finally {
    await releaseSyncLease(lease).catch(() => {})
  }
}
