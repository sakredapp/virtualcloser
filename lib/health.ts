// Worker + job health. Backs the diagnostics safety net:
//   - recordHeartbeat: the Hetzner worker stamps liveness every tick. The
//     health-check cron reads it and pages the operator if it goes stale.
//   - recordJobRun: wrap any cron/subtick so its run (success/failure) is
//     audited in job_runs — generalizes the Pinnacle sync_runs pattern.
//
// All writes are best-effort and never throw — diagnostics must not break the
// thing they observe.

import { supabase } from '@/lib/supabase'

export type HeartbeatFields = {
  tickCount?: number
  consecutiveErrors?: number
  summary?: string | null
}

// Upsert the worker's liveness row. Clears alerted_at on every successful
// heartbeat so a recovered worker re-arms the stall alarm (one outage = one
// alert in the health-check cron).
export async function recordHeartbeat(worker: string, fields: HeartbeatFields = {}): Promise<void> {
  try {
    await supabase.from('worker_health').upsert(
      {
        worker,
        last_tick_at: new Date().toISOString(),
        tick_count: fields.tickCount ?? 0,
        consecutive_errors: fields.consecutiveErrors ?? 0,
        last_summary: fields.summary ? fields.summary.slice(0, 500) : null,
        alerted_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'worker' },
    )
  } catch (err) {
    console.error('[health] heartbeat failed', err instanceof Error ? err.message : String(err))
  }
}

export type WorkerHealthRow = {
  worker: string
  last_tick_at: string
  tick_count: number
  consecutive_errors: number
  last_summary: string | null
  alerted_at: string | null
}

export async function listWorkerHealth(): Promise<WorkerHealthRow[]> {
  const { data, error } = await supabase
    .from('worker_health')
    .select('worker, last_tick_at, tick_count, consecutive_errors, last_summary, alerted_at')
  if (error) {
    console.error('[health] list failed', error.message)
    return []
  }
  return (data ?? []) as WorkerHealthRow[]
}

// Marks that we've paged about this worker's stall, so the cron doesn't re-alert
// every run while it stays down.
export async function markWorkerAlerted(worker: string): Promise<void> {
  try {
    await supabase
      .from('worker_health')
      .update({ alerted_at: new Date().toISOString() })
      .eq('worker', worker)
  } catch (err) {
    console.error('[health] markAlerted failed', err instanceof Error ? err.message : String(err))
  }
}

// Wrap a job so its run is audited. Records start, then success/failure +
// duration. Re-throws so the caller still sees the error; the audit row is the
// side-effect. Returns whatever the job returns.
export async function recordJobRun<T>(
  job: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const startedAt = new Date().toISOString()
  let rowId: string | null = null
  try {
    const { data } = await supabase
      .from('job_runs')
      .insert({ job, started_at: startedAt, meta: meta ?? null })
      .select('id')
      .maybeSingle()
    rowId = (data as { id: string } | null)?.id ?? null
  } catch {
    // Audit insert failed — run the job anyway; observability is best-effort.
  }

  try {
    const result = await fn()
    if (rowId) {
      await supabase
        .from('job_runs')
        .update({ finished_at: new Date().toISOString(), ok: true })
        .eq('id', rowId)
        .then(undefined, () => {})
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (rowId) {
      await supabase
        .from('job_runs')
        .update({ finished_at: new Date().toISOString(), ok: false, error: message.slice(0, 1000) })
        .eq('id', rowId)
        .then(undefined, () => {})
    }
    throw err
  }
}
