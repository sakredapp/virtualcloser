/**
 * Precomputed executive rollup.
 *
 * Freshness model (owner, 2026-10-08): the numbers are computed on the first
 * load of the day and reused for the rest of that day. `getPinnacleOverview`
 * returns the cached row when its `computed_at` falls on today in the tenant's
 * time zone; otherwise it recomputes live, stores the result and returns it.
 * A per-tenant in-flight lock (`computing_since`) stops two executives from
 * both recomputing at 8am: the second waits for the first.
 *
 * The daily cron (after the Airtable sync) and the Refresh button both force
 * a recompute. Until `pinnacle_rollup_cache` exists, the live loader runs
 * through Next's data cache (1h, tag 'pinnacle') so pages still stay fast.
 */
import { unstable_cache } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { loadPinnacleOverview, type PinnacleOverview } from '@/lib/pinnacle/load'
import type { BreakdownDim } from '@/lib/pinnacle/rollup'

export const PINNACLE_CACHE_TAG = 'pinnacle'
const TABLE = 'pinnacle_rollup_cache'
const LOCK_STALE_MS = 3 * 60_000
const WAIT_MS = 90_000
const POLL_MS = 2_000

export type PinnacleView = 'overview' | 'performance' | 'reports' | 'full'

export type CachedOverview = PinnacleOverview & {
  /** When the numbers were computed (ISO). Null when nothing could be computed. */
  computedAt: string | null
  /** True while another request is building today's numbers and we gave up waiting. */
  building: boolean
  source: 'cache' | 'live' | 'empty'
}

type Row = { tenant_id: string; payload: PinnacleOverview; computed_at: string; computing_since: string | null }

/** Memo so a missing table costs one failed query per cold start, not one per page. */
let tableMissing = false

function dayIn(iso: string | Date, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      typeof iso === 'string' ? new Date(iso) : iso,
    )
  } catch {
    return (typeof iso === 'string' ? new Date(iso) : iso).toISOString().slice(0, 10)
  }
}

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache')
}

async function readRow(tenantId: string): Promise<Row | null> {
  if (tableMissing) return null
  const { data, error } = await supabase.from(TABLE).select('tenant_id, payload, computed_at, computing_since').eq('tenant_id', tenantId).maybeSingle()
  if (error) {
    if (isMissingTable(error.message)) tableMissing = true
    else console.error('[pinnacle-cache] read', error.message)
    return null
  }
  return (data as Row | null) ?? null
}

/** Live loader behind Next's data cache: the fallback while the table is missing. */
function liveCached(tenantId: string) {
  return unstable_cache(() => loadPinnacleOverview(tenantId), ['pinnacle-overview', tenantId], { revalidate: 3600, tags: [PINNACLE_CACHE_TAG] })
}

/** Try to take the per-tenant lock. Returns true if this request now owns it. */
async function takeLock(tenantId: string, existing: Row | null): Promise<boolean> {
  if (tableMissing) return true
  const now = new Date()
  const stale = existing?.computing_since ? now.getTime() - new Date(existing.computing_since).getTime() > LOCK_STALE_MS : true
  if (existing?.computing_since && !stale) return false
  if (!existing) {
    const { error } = await supabase.from(TABLE).insert({ tenant_id: tenantId, payload: {}, computed_at: new Date(0).toISOString(), computing_since: now.toISOString() })
    if (error) {
      if (isMissingTable(error.message)) {
        tableMissing = true
        return true
      }
      // Someone else inserted first; they hold the lock.
      return false
    }
    return true
  }
  const q = supabase.from(TABLE).update({ computing_since: now.toISOString() }).eq('tenant_id', tenantId)
  const { data, error } = await (existing.computing_since ? q.eq('computing_since', existing.computing_since) : q.is('computing_since', null)).select('tenant_id')
  if (error) return false
  return (data ?? []).length > 0
}

async function releaseLock(tenantId: string) {
  if (tableMissing) return
  await supabase.from(TABLE).update({ computing_since: null }).eq('tenant_id', tenantId)
}

/** Compute the full rollup live and store it. Used by crons, Refresh and the first load of the day. */
export async function computePinnacleOverview(tenantId: string): Promise<CachedOverview> {
  const payload = await loadPinnacleOverview(tenantId)
  const computedAt = new Date().toISOString()
  if (!tableMissing && payload.configured) {
    const { error } = await supabase.from(TABLE).upsert({ tenant_id: tenantId, payload, computed_at: computedAt, computing_since: null }, { onConflict: 'tenant_id' })
    if (error) {
      if (isMissingTable(error.message)) tableMissing = true
      else console.error('[pinnacle-cache] upsert', error.message)
    }
  }
  return { ...payload, computedAt, building: false, source: 'live' }
}

async function waitForOther(tenantId: string, tz: string | null | undefined): Promise<Row | null> {
  const deadline = Date.now() + WAIT_MS
  const today = dayIn(new Date(), tz)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const row = await readRow(tenantId)
    if (!row) return null
    if (!row.computing_since && row.computed_at && dayIn(row.computed_at, tz) === today) return row
    if (!row.computing_since) return row // the other side finished (or failed and released)
  }
  return null
}

function trim(view: PinnacleView, data: CachedOverview): CachedOverview {
  if (view === 'full' || view === 'performance') return data
  if (view === 'reports') return { ...data, breakdowns: {}, tables: [] }
  // Overview: the 12-month waves, month/window summaries, product mix, and
  // the top five agents and carriers only.
  const keep: BreakdownDim[] = ['agent', 'carrier', 'team', 'product', 'state']
  const breakdowns: CachedOverview['breakdowns'] = {}
  for (const k of keep) if (data.breakdowns[k]) breakdowns[k] = data.breakdowns[k]!.slice(0, k === 'agent' || k === 'carrier' ? 5 : 10)
  return { ...data, breakdowns, tables: [] }
}

/**
 * The executive rollup for a tenant: today's cached row if it exists, else a
 * fresh compute (stored for the rest of the day). `force` recomputes
 * regardless of the day (Refresh button, crons).
 */
export async function getPinnacleOverview(
  tenantId: string,
  opts: { force?: boolean; tz?: string | null; view?: PinnacleView } = {},
): Promise<CachedOverview> {
  const view = opts.view ?? 'full'
  const row = await readRow(tenantId)
  const today = dayIn(new Date(), opts.tz)
  const fresh = row && row.computed_at && new Date(row.computed_at).getTime() > 0 && dayIn(row.computed_at, opts.tz) === today

  if (fresh && !opts.force && row) {
    return trim(view, { ...row.payload, computedAt: row.computed_at, building: false, source: 'cache' })
  }

  if (tableMissing) {
    const payload = await liveCached(tenantId)()
    return trim(view, { ...payload, computedAt: new Date().toISOString(), building: false, source: 'live' })
  }

  if (await takeLock(tenantId, row)) {
    try {
      return trim(view, await computePinnacleOverview(tenantId))
    } catch (err) {
      console.error('[pinnacle-cache] compute', err)
      await releaseLock(tenantId)
      if (row && row.payload && new Date(row.computed_at).getTime() > 0) {
        return trim(view, { ...row.payload, computedAt: row.computed_at, building: false, source: 'cache' })
      }
      throw err
    }
  }

  // Someone else is building today's numbers: wait for them.
  const done = await waitForOther(tenantId, opts.tz)
  if (done && done.payload && new Date(done.computed_at).getTime() > 0) {
    return trim(view, { ...done.payload, computedAt: done.computed_at, building: false, source: 'cache' })
  }
  if (row && row.payload && new Date(row.computed_at).getTime() > 0) {
    // Yesterday's numbers while today's finish building.
    return trim(view, { ...row.payload, computedAt: row.computed_at, building: true, source: 'cache' })
  }
  const empty = await loadPinnacleOverview(tenantId, { breakdowns: false }).catch(() => null)
  return trim(view, {
    ...(empty ?? { allowed: false, configured: false, pinnacleRows: [], statusRows: [], books: [], breakdowns: {}, lastRun: null, tables: [] }),
    computedAt: null,
    building: true,
    source: empty ? 'live' : 'empty',
  })
}

/** When the cached row was last computed, without touching the payload. */
export async function pinnacleComputedAt(tenantId: string): Promise<string | null> {
  if (tableMissing) return null
  const { data } = await supabase.from(TABLE).select('computed_at').eq('tenant_id', tenantId).maybeSingle()
  const at = (data as { computed_at?: string } | null)?.computed_at ?? null
  return at && new Date(at).getTime() > 0 ? at : null
}

/** Every tenant whose rollup the crons keep warm: PINNACLE_VIEWER_REP_IDS, else every executive-suite account. */
export async function pinnacleViewerTenantIds(): Promise<string[]> {
  const env = (process.env.PINNACLE_VIEWER_REP_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (env.length) return env
  const { data } = await supabase.from('reps').select('id').eq('brand', 'cxo')
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}
