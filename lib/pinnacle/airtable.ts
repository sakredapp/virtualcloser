/**
 * Pinnacle Wellness Airtable sync — multi-base.
 *
 * Brad Plummer (Pinnacle CEO) shares us a read-only PAT scoped to three
 * separate Airtable bases:
 *   1. appHyYBfI6kfX6ZuW — Pinnacle Directory + policy data
 *   2. appsClAi9HtW3vaVX — WoW PC Agent List, Rolling BOB, IP trackers
 *   3. appbJ5Wu2U6ZZmbhW — same table schema as base 2 (parallel BoB)
 *
 * Bases 2 + 3 have overlapping table names ("WoW PC Agent List" etc.) so
 * the natural key throughout this module is (base_id, table_name, record_id).
 *
 * Env vars:
 *   PINNACLE_AIRTABLE_TOKEN     Personal access token (pat...) — single PAT
 *                               with access to all configured bases.
 *   PINNACLE_AIRTABLE_BASES     Multi-base config, pipe-separated:
 *                                 baseId:table1,table2,table3|baseId2:t1,t2
 *                               Whitespace tolerated around segments.
 *   PINNACLE_AIRTABLE_BASE_ID   [legacy / single-base fallback]
 *   PINNACLE_AIRTABLE_TABLES    [legacy] comma-separated for the single base.
 *   PINNACLE_FIELD_MAP          Optional JSON override for the snapshot
 *                               field matcher.
 *
 * The legacy single-base envs still work — if BASES isn't set we synthesise
 * one base from BASE_ID + TABLES. That keeps existing Vercel configs alive
 * through this rollout.
 */

import { supabase } from '@/lib/supabase'

const AIRTABLE_API = 'https://api.airtable.com/v0'

type AirtableRecord = {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

type AirtableListResponse = {
  records: AirtableRecord[]
  offset?: string
}

export type BaseConfig = {
  baseId: string
  tables: string[]
}

export type TableSyncResult = {
  fetched: number
  upserted: number
  error?: string
}

export type BaseSyncResult = {
  baseId: string
  tables: Record<string, TableSyncResult>
  snapshot?: SnapshotRow | null
}

export type SnapshotRow = {
  base_id: string
  snapshot_date: string
  revenue_total: number | null
  apps_submitted: number | null
  apps_approved: number | null
  apps_funded: number | null
}

export type SyncResult = {
  ok: boolean
  bases: BaseSyncResult[]
  error?: string
}

function token(): string {
  const t = process.env.PINNACLE_AIRTABLE_TOKEN
  if (!t) throw new Error('PINNACLE_AIRTABLE_TOKEN is not set')
  return t
}

/**
 * Parse the PINNACLE_AIRTABLE_BASES env into a list. Returns [] if neither
 * the multi-base nor the legacy single-base env is set.
 *
 * Format: `baseId:table1,table2,table3|baseId2:t1,t2`. Whitespace around
 * segments and pipes is tolerated.
 */
export function getBases(): BaseConfig[] {
  const raw = process.env.PINNACLE_AIRTABLE_BASES?.trim()
  if (raw) {
    const bases: BaseConfig[] = []
    for (const chunk of raw.split('|')) {
      const trimmed = chunk.trim()
      if (!trimmed) continue
      const colon = trimmed.indexOf(':')
      if (colon === -1) {
        // Bare base id with no tables — caller will skip it (no tables to sync).
        bases.push({ baseId: trimmed, tables: [] })
        continue
      }
      const baseId = trimmed.slice(0, colon).trim()
      const tables = trimmed
        .slice(colon + 1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (baseId) bases.push({ baseId, tables })
    }
    return bases
  }
  // Legacy single-base fallback so existing Vercel configs keep working.
  const legacyBase = process.env.PINNACLE_AIRTABLE_BASE_ID?.trim()
  if (!legacyBase) return []
  const legacyTables = (process.env.PINNACLE_AIRTABLE_TABLES?.trim() ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [{ baseId: legacyBase, tables: legacyTables }]
}

async function airtableFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${AIRTABLE_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token()}`,
    },
  })
}

/**
 * Pull every record from one Airtable table, paginating via `offset`.
 * Airtable returns 100 records per page, so this is at most ceil(rows/100)
 * round trips. Caller catches errors per-table so one bad table doesn't
 * kill the whole sync.
 */
export async function fetchAirtableTable(
  baseId: string,
  tableName: string,
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    const qs = new URLSearchParams({ pageSize: '100' })
    if (offset) qs.set('offset', offset)
    const url = `/${baseId}/${encodeURIComponent(tableName)}?${qs.toString()}`
    const res = await airtableFetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`airtable ${baseId}/${tableName} HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = (await res.json()) as AirtableListResponse
    records.push(...json.records)
    offset = json.offset
  } while (offset)
  return records
}

/**
 * Lightweight schema probe — fetches a single page so we can see what
 * field names actually exist. Used by /api/admin/pinnacle/discover and
 * the CLI script before we hard-code a mapping.
 */
export async function previewAirtableTable(
  baseId: string,
  tableName: string,
  limit = 5,
): Promise<{ fields: string[]; sample: AirtableRecord[] }> {
  const qs = new URLSearchParams({ pageSize: String(Math.min(limit, 100)) })
  const url = `/${baseId}/${encodeURIComponent(tableName)}?${qs.toString()}`
  const res = await airtableFetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`airtable ${baseId}/${tableName} HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as AirtableListResponse
  const fieldSet = new Set<string>()
  for (const r of json.records) for (const k of Object.keys(r.fields)) fieldSet.add(k)
  return { fields: Array.from(fieldSet).sort(), sample: json.records }
}

async function upsertRecords(
  baseId: string,
  tableName: string,
  records: AirtableRecord[],
): Promise<number> {
  if (records.length === 0) return 0
  const CHUNK = 500
  let total = 0
  const now = new Date().toISOString()
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK)
    const rows = slice.map((r) => {
      const lm = r.fields['Last Modified'] ?? r.fields['Last modified'] ?? r.fields['last_modified']
      return {
        base_id: baseId,
        table_name: tableName,
        record_id: r.id,
        fields: r.fields,
        airtable_created: r.createdTime,
        last_modified_at: typeof lm === 'string' ? lm : null,
        fetched_at: now,
      }
    })
    const { error } = await supabase
      .from('pinnacle_airtable_records')
      .upsert(rows, { onConflict: 'base_id,table_name,record_id' })
    if (error) throw new Error(`supabase upsert ${baseId}/${tableName}: ${error.message}`)
    total += slice.length
  }
  return total
}

/**
 * Stream one Airtable table straight into Supabase, page by page, holding at
 * most one 100-record page in memory at a time.
 *
 * This replaces the old fetch-all-then-upsert path. Brad's three bases total
 * ~167K rows whose `fields` JSONB is large; accumulating every record into a
 * single array exhausted the worker's ~2GB V8 heap mid-sync ("FATAL ERROR:
 * Reached heap limit Allocation failed - JavaScript heap out of memory"),
 * killing the process and stalling every worker loop. Upserting each page as it
 * arrives keeps the working set flat regardless of table size.
 */
export async function syncAirtableTableStreaming(
  baseId: string,
  tableName: string,
): Promise<TableSyncResult> {
  let fetched = 0
  let upserted = 0
  let offset: string | undefined
  do {
    const qs = new URLSearchParams({ pageSize: '100' })
    if (offset) qs.set('offset', offset)
    const url = `/${baseId}/${encodeURIComponent(tableName)}?${qs.toString()}`
    const res = await airtableFetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`airtable ${baseId}/${tableName} HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = (await res.json()) as AirtableListResponse
    fetched += json.records.length
    upserted += await upsertRecords(baseId, tableName, json.records)
    offset = json.offset
  } while (offset)
  return { fetched, upserted }
}

// NOTE: The snapshot field-matching logic (which JSONB keys hold revenue and
// status, and which tables are agent/directory rows to skip) now lives in the
// `pinnacle_build_snapshot` Postgres RPC so the rollup runs in a single DB-side
// scan — see buildSnapshotForBase below. The old JS helpers (findField /
// readFieldMap / isAgentTable, driven by PINNACLE_FIELD_MAP) were removed when
// that loop was deleted. The RPC hardcodes the default field map (Annual
// Premium / Summary Status); update the RPC if those field names ever change.

/**
 * Build a snapshot per base. Each base gets its own row keyed by
 * (base_id, snapshot_date) so we can see e.g. base 2 vs base 3 BoB
 * side-by-side on the dashboard.
 *
 * The aggregation runs entirely in Postgres via the pinnacle_build_snapshot()
 * RPC — a single sequential scan over the base's rows. This replaced an older
 * JS loop that paged the entire `fields` JSONB (1.3GB+) into Node with
 * LIMIT/OFFSET; deep OFFSET forced Postgres to re-scan the table for every
 * page (O(n²) disk reads), which on its own exhausted the project's Disk IO
 * budget and made the DB unresponsive. The RPC was verified to produce
 * identical numbers to the old loop on live data — see the migration
 * `pinnacle_build_snapshot_rpc`. It assumes the DEFAULT field map; if
 * PINNACLE_FIELD_MAP is ever overridden, the RPC's hardcoded JSONB keys
 * (Annual Premium / Summary Status) must be updated to match.
 */
export async function buildSnapshotForBase(baseId: string): Promise<SnapshotRow> {
  const { data, error } = await supabase
    .rpc('pinnacle_build_snapshot', { p_base_id: baseId })
    .single()
  if (error) throw error

  // PostgREST returns numeric/bigint columns as strings to avoid precision
  // loss, so coerce explicitly. A null stays null (no status/revenue column).
  const r = (data ?? {}) as {
    total_rows: number | string
    policy_rows: number | string
    skipped_agent_rows: number | string
    revenue_total: number | string | null
    apps_submitted: number | string | null
    apps_approved: number | string | null
    apps_funded: number | string | null
  }
  const num = (v: number | string | null | undefined): number | null =>
    v === null || v === undefined ? null : Number(v)

  const snapshot: SnapshotRow = {
    base_id: baseId,
    snapshot_date: new Date().toISOString().slice(0, 10),
    revenue_total: num(r.revenue_total),
    apps_submitted: num(r.apps_submitted),
    apps_approved: num(r.apps_approved),
    apps_funded: num(r.apps_funded),
  }

  const { error: upErr } = await supabase
    .from('pinnacle_airtable_snapshots')
    .upsert(
      {
        ...snapshot,
        metrics: {
          total_rows: num(r.total_rows),
          policy_rows: num(r.policy_rows),
          skipped_agent_rows: num(r.skipped_agent_rows),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'base_id,snapshot_date' },
    )
  if (upErr) throw upErr
  return snapshot
}

/**
 * Top-level sync. Idempotent — safe to re-run; records upsert in place.
 * Iterates every configured base.
 */
export async function syncPinnacleAirtable(): Promise<SyncResult> {
  const bases = getBases()
  if (bases.length === 0) {
    return {
      ok: false,
      bases: [],
      error: 'no bases configured — set PINNACLE_AIRTABLE_BASES or PINNACLE_AIRTABLE_BASE_ID',
    }
  }

  const result: SyncResult = { ok: true, bases: [] }
  const { data: run } = await supabase
    .from('pinnacle_airtable_sync_runs')
    .insert({ started_at: new Date().toISOString() })
    .select('id')
    .single()

  const finalize = async (ok: boolean, error?: string) => {
    if (!run?.id) return
    await supabase
      .from('pinnacle_airtable_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        ok,
        tables: result.bases.map((b) => ({ baseId: b.baseId, tables: b.tables })),
        error: error ?? null,
      })
      .eq('id', run.id)
  }

  try {
    for (const base of bases) {
      const baseResult: BaseSyncResult = { baseId: base.baseId, tables: {} }
      const tables = base.tables.length > 0 ? base.tables : []
      if (tables.length === 0) {
        baseResult.tables['_meta'] = {
          fetched: 0,
          upserted: 0,
          error: 'no tables configured for this base — add them to PINNACLE_AIRTABLE_BASES',
        }
        result.bases.push(baseResult)
        continue
      }
      for (const name of tables) {
        try {
          // Stream page-by-page — never hold a whole table in memory (see
          // syncAirtableTableStreaming; the fetch-all path OOM'd the worker).
          baseResult.tables[name] = await syncAirtableTableStreaming(base.baseId, name)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          baseResult.tables[name] = { fetched: 0, upserted: 0, error: msg }
        }
      }
      try {
        baseResult.snapshot = await buildSnapshotForBase(base.baseId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        baseResult.snapshot = null
        baseResult.tables['_snapshot'] = { fetched: 0, upserted: 0, error: msg }
      }
      result.bases.push(baseResult)
    }
    // Rebuild the precomputed daily rollups the dashboard reads from, so the
    // analytics RPCs serve indexed lookups instead of full-scanning the raw
    // 188k-row table on every interaction. Best-effort: a rebuild failure
    // shouldn't fail the whole sync (the rollups just serve until next sync).
    {
      const { error } = await supabase.rpc('pinnacle_rebuild_rollups')
      if (error) console.warn('[pinnacle] pinnacle_rebuild_rollups failed', error.message)
    }
    await finalize(true)
    return result
  } catch (err) {
    result.ok = false
    result.error = err instanceof Error ? err.message : String(err)
    await finalize(false, result.error)
    return result
  }
}
