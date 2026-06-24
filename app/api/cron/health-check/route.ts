// Health-check cron — the "know before users do" watchdog.
//
// Runs every few minutes and does two things:
//   1. Pages the operator if a long-running worker (the Hetzner worker) has
//      gone stale — i.e. stopped heartbeating, which means campaigns / SMS /
//      email / Plaud have silently stopped. One alert per outage (alerted_at
//      gates re-paging; a recovered heartbeat clears it).
//   2. Trims app_errors past the retention window so the table doesn't grow
//      unbounded (fulfilling the schema's 30-day promise).

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { listWorkerHealth, markWorkerAlerted } from '@/lib/health'
import { alertOperator } from '@/lib/alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Worst-case gap between heartbeats is one tick. Normal ticks are ~30s, but a
// single tick can run long (the ~9-min Pinnacle sync), so the threshold sits
// above that to avoid false alarms.
const STALE_MINUTES = parseInt(process.env.WORKER_STALE_MINUTES ?? '10', 10)
const ERROR_RETENTION_DAYS = parseInt(process.env.APP_ERROR_RETENTION_DAYS ?? '30', 10)

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const staleMs = STALE_MINUTES * 60_000

  // 1. Stale-worker detection.
  const workers = await listWorkerHealth()
  const alerted: string[] = []
  for (const w of workers) {
    const ageMs = now - new Date(w.last_tick_at).getTime()
    const isStale = ageMs > staleMs
    if (isStale && !w.alerted_at) {
      const ageMin = Math.round(ageMs / 60_000)
      await alertOperator({
        key: `worker-stale:${w.worker}`,
        severity: 'fatal',
        title: `Worker "${w.worker}" has stalled`,
        body:
          `No heartbeat from "${w.worker}" for ~${ageMin} min (threshold ${STALE_MINUTES} min). ` +
          `Campaigns, SMS, email triage, and Plaud are likely NOT running. ` +
          `Check the Hetzner box: \`pm2 status\` / \`pm2 restart ${w.worker}\`.`,
        context: {
          worker: w.worker,
          last_tick_at: w.last_tick_at,
          consecutive_errors: w.consecutive_errors,
          last_summary: w.last_summary,
        },
      })
      await markWorkerAlerted(w.worker)
      alerted.push(w.worker)
    }
  }

  // 2. Retention trim.
  let trimmed = 0
  const cutoff = new Date(now - ERROR_RETENTION_DAYS * 86_400_000).toISOString()
  try {
    const { data } = await supabase
      .from('app_errors')
      .delete()
      .lt('occurred_at', cutoff)
      .select('id')
    trimmed = (data ?? []).length
  } catch (err) {
    console.error('[health-check] trim failed', err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({
    ok: true,
    workers_checked: workers.length,
    stale_alerted: alerted,
    errors_trimmed: trimmed,
  })
}
