/**
 * Pinnacle Life Group Airtable sync (Pinnacle Wellness is their health brand) — multi-base.
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
/** Strip stray backticks/quotes an env editor can leave around a name. */
function cleanName(v: string): string {
  return v.trim().replace(/^[`'"\s]+|[`'"\s]+$/g, '').trim()
}

/**
 * Tables the Pinnacle token cannot read (Airtable answers 403
 * INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND). Skipped instead of failing every
 * run; take one out once Pinnacle shares it with the token.
 */
const SKIP_TABLES = new Set<string>(['appHyYBfI6kfX6ZuW\u0000Pinnacle Annuity Policies'])

const STALE_RUN_MS = 30 * 60_000

export function getBases(): BaseConfig[] {
  const raw = process.env.PINNACLE_AIRTABLE_BASES?.trim()
  if (raw) {
    const bases: BaseConfig[] = []
    for (const chunk of raw.split('|')) {
      const trimmed = cleanName(chunk)
      if (!trimmed) continue
      const colon = trimmed.indexOf(':')
      if (colon === -1) {
        // Bare base id with no tables — caller will skip it (no tables to sync).
        bases.push({ baseId: trimmed, tables: [] })
        continue
      }
      const baseId = cleanName(trimmed.slice(0, colon))
      const tables = trimmed
        .slice(colon + 1)
        .split(',')
        .map(cleanName)
        .filter((t) => t && !SKIP_TABLES.has(`${baseId}\u0000${t}`))
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
 * Real base names from the Airtable meta API (GET /meta/bases), so the two
 * agency books show their own names instead of "Agency Book A/B". Needs the
 * `schema.bases:read` scope on the PAT; without it (403) or on any failure
 * this resolves to {} and the caller keeps its fallback. Memoised an hour per
 * server instance: names change rarely and the sync runs once a day.
 */
let baseNamesCache: { at: number; names: Record<string, string> } | null = null
const BASE_NAMES_TTL_MS = 60 * 60 * 1000

export async function fetchBaseNames(): Promise<Record<string, string>> {
  if (baseNamesCache && Date.now() - baseNamesCache.at < BASE_NAMES_TTL_MS) return baseNamesCache.names
  const names: Record<string, string> = {}
  try {
    let offset: string | undefined
    do {
      const res = await airtableFetch(`/meta/bases${offset ? `?offset=${encodeURIComponent(offset)}` : ''}`, { cache: 'no-store' })
      if (!res.ok) break
      const json = (await res.json()) as { bases?: Array<{ id: string; name: string }>; offset?: string }
      for (const b of json.bases ?? []) if (b.id && b.name) names[b.id] = b.name
      offset = json.offset
    } while (offset)
  } catch {
    /* fall through: no names */
  }
  if (Object.keys(names).length > 0) baseNamesCache = { at: Date.now(), names }
  return names
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
  opts: { fields?: string[] } = {},
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    const qs = new URLSearchParams({ pageSize: '100' })
    for (const f of opts.fields ?? []) qs.append('fields[]', f)
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
        // Trimmed to the used fields by the pinnacle_trim_fields trigger
        // (supabase/pinnacle_fields_whitelist.sql).
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

type CursorRow = {
  base_id: string
  table_name: string
  run_start: string | null
  airtable_offset: string | null
  fetched: number
  completed_at: string | null
  last_full_at: string | null
  run_since: string | null
}

/** A table is pulled once a day; a complete pull younger than this is current. */
const TABLE_FRESH_MS = 20 * 60 * 60 * 1000
/**
 * Storage (owner 10-09): daily pulls fetch only rows Airtable reports as
 * created or modified since the last pull (filterByFormula on
 * LAST_MODIFIED_TIME / CREATED_TIME, with an hour of overlap). A full rescan
 * plus sweep runs at most weekly, or straight after an incremental pull that
 * looks like a re-import (over half the table came back), since a re-import
 * gives every record a new id and only a full pass can sweep the old copies.
 * LAST_MODIFIED_TIME ignores computed-field changes; the weekly rescan
 * catches those.
 */
const FULL_RESCAN_MS = 7 * 24 * 60 * 60 * 1000
const INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function saveCursor(baseId: string, tableName: string, patch: Partial<CursorRow> & { last_error?: string | null }) {
  const { error } = await supabase
    .from('pinnacle_sync_cursor')
    .upsert({ base_id: baseId, table_name: tableName, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'base_id,table_name' })
  if (error) throw new Error(`pinnacle cursor save ${baseId}/${tableName}: ${error.message}`)
}

/**
 * Pull one Airtable table into Supabase page by page, saving the Airtable
 * offset after every page in pinnacle_sync_cursor. Stops (without finishing)
 * once `deadlineAt` passes; the next call resumes from the saved offset.
 *
 * Idempotency: rows upsert on record_id and are stamped fetched_at >= the
 * pull's run_start. When the pull COMPLETES it is recorded in
 * pinnacle_sync_table_runs, and pinnacle_post_sync() (pg_cron, every 20 min,
 * runs as postgres so it is not bound by PostgREST's 8s timeout) deletes every
 * row of that table older than run_start, i.e. rows the latest full pull did
 * not see. Airtable re-imports the policy tables weekly with new record ids,
 * so without that sweep the mirror kept every weekly copy; with it the table
 * holds exactly one copy after each sync.
 *
 * Holds at most one 100-record page in memory (the fetch-all path OOM'd).
 */
export async function syncAirtableTableStreaming(
  baseId: string,
  tableName: string,
  opts: { cursor?: CursorRow | null; deadlineAt?: number; since?: string | null } = {},
): Promise<TableSyncResult & { complete: boolean }> {
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY
  const resume = opts.cursor?.run_start && opts.cursor.airtable_offset ? opts.cursor : null
  // A resumed pull keeps the mode it started in.
  const since = resume ? resume.run_since : opts.since ?? null
  const formula = since
    ? `OR(IS_AFTER(LAST_MODIFIED_TIME(),'${since}'),IS_AFTER(CREATED_TIME(),'${since}'))`
    : null
  let runStart = resume?.run_start ?? new Date(Date.now() - 1000).toISOString()
  let offset: string | undefined = resume?.airtable_offset ?? undefined
  let fetched = resume?.fetched ?? 0
  let upserted = 0
  if (!resume) await saveCursor(baseId, tableName, { run_start: runStart, run_since: since, airtable_offset: null, fetched: 0, last_error: null })
  let retried429 = false
  // for(;;) not do/while: the retry paths `continue` with offset unset.
  for (;;) {
    if (Date.now() > deadlineAt) {
      return { fetched, upserted, complete: false }
    }
    const qs = new URLSearchParams({ pageSize: '100' })
    if (formula) qs.set('filterByFormula', formula)
    if (offset) qs.set('offset', offset)
    const res = await airtableFetch(`/${baseId}/${encodeURIComponent(tableName)}?${qs.toString()}`, { cache: 'no-store' })
    if (res.status === 429 && !retried429) {
      // Airtable asks for a 30s back-off after a rate-limit hit.
      retried429 = true
      await sleep(30_000)
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (offset && (res.status === 422 || /ITERATOR|OFFSET/i.test(body))) {
        // The saved Airtable offset expired between ticks: restart this table.
        runStart = new Date(Date.now() - 1000).toISOString()
        offset = undefined
        fetched = 0
        await saveCursor(baseId, tableName, { run_start: runStart, run_since: since, airtable_offset: null, fetched: 0 })
        continue
      }
      throw new Error(`airtable ${baseId}/${tableName} HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    retried429 = false
    const json = (await res.json()) as AirtableListResponse
    fetched += json.records.length
    upserted += await upsertRecords(baseId, tableName, json.records)
    offset = json.offset
    if (!offset) break
    await saveCursor(baseId, tableName, { run_start: runStart, run_since: since, airtable_offset: offset, fetched })
  }
  // Complete: hand the sweep (full pulls only) + rollup rebuild + day-cache
  // expiry to the DB. An incremental pull with nothing new records nothing.
  if (!since || fetched > 0) {
    const { error } = await supabase
      .from('pinnacle_sync_table_runs')
      .insert({ base_id: baseId, table_name: tableName, started_at: runStart, fetched, incremental: !!since })
    if (error) throw new Error(`pinnacle table-run record ${baseId}/${tableName}: ${error.message}`)
  }
  let reimport = false
  if (since && fetched > 500) {
    const { count } = await supabase
      .from('pinnacle_airtable_records')
      .select('record_id', { count: 'estimated', head: true })
      .eq('base_id', baseId)
      .eq('table_name', tableName)
    reimport = fetched * 2 > (count ?? 0)
  }
  const doneAt = new Date().toISOString()
  await saveCursor(baseId, tableName, {
    run_start: null,
    run_since: null,
    airtable_offset: null,
    fetched,
    completed_at: doneAt,
    last_error: null,
    // A full pass resets the weekly clock; a re-import seen incrementally
    // clears it so the next tick does a full pass and sweeps the old copies.
    ...(since ? (reimport ? { last_full_at: null } : {}) : { last_full_at: doneAt }),
  })
  return { fetched, upserted, complete: true }
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
 * Top-level sync, one tick. Works through every configured table that is due
 * (never pulled, mid-pull, or last complete pull older than 20h), one table
 * at a time, until `deadlineAt`. Daily pulls are incremental; a full rescan
 * (which sweeps rows Airtable no longer has) runs at most weekly. A table cut off by the deadline resumes from
 * its saved cursor on the next tick. `force` treats tables completed more than
 * 30 minutes ago as due (manual full refresh).
 */
export async function syncPinnacleAirtable(
  opts: { baseIds?: string[]; deadlineAt?: number; force?: boolean } = {},
): Promise<SyncResult & { pending: number }> {
  const only = opts.baseIds?.filter(Boolean) ?? []
  const bases = getBases().filter((b) => only.length === 0 || only.includes(b.baseId))
  if (bases.length === 0) {
    return {
      ok: false,
      bases: [],
      pending: 0,
      error: 'no bases configured — set PINNACLE_AIRTABLE_BASES or PINNACLE_AIRTABLE_BASE_ID',
    }
  }
  const deadlineAt = opts.deadlineAt ?? Date.now() + 10 * 60_000

  const { data: cursorRows, error: curErr } = await supabase
    .from('pinnacle_sync_cursor')
    .select('base_id, table_name, run_start, airtable_offset, fetched, completed_at, last_full_at, run_since')
  if (curErr) return { ok: false, bases: [], pending: 0, error: `cursor read: ${curErr.message}` }
  const cursors = new Map<string, CursorRow>()
  for (const c of (cursorRows ?? []) as CursorRow[]) cursors.set(`${c.base_id}\u0000${c.table_name}`, c)

  const freshMs = opts.force ? 30 * 60_000 : TABLE_FRESH_MS
  const now = Date.now()
  type Job = { baseId: string; table: string; cursor: CursorRow | null; rank: number; since: string | null }
  const jobs: Job[] = []
  for (const base of bases) {
    for (const table of base.tables) {
      const c = cursors.get(`${base.baseId}\u0000${table}`) ?? null
      const inProgress = !!c?.run_start
      const stale = !c?.completed_at || now - new Date(c.completed_at).getTime() > freshMs
      if (!inProgress && !stale) continue
      // Mid-pull tables first, then never-pulled, then oldest pull.
      const rank = inProgress ? 0 : c?.completed_at ? new Date(c.completed_at).getTime() : 1
      // Full rescan when forced, never fully pulled, or the last full pass is
      // a week old; otherwise only what changed since the last pull.
      const fullDue = opts.force || !c?.last_full_at || now - new Date(c.last_full_at).getTime() > FULL_RESCAN_MS || !c?.completed_at
      const since = fullDue ? null : new Date(new Date(c!.completed_at!).getTime() - INCREMENTAL_OVERLAP_MS).toISOString()
      jobs.push({ baseId: base.baseId, table, cursor: c, rank, since })
    }
  }
  jobs.sort((a, b) => a.rank - b.rank)

  const result: SyncResult & { pending: number } = { ok: true, bases: [], pending: 0 }
  if (jobs.length === 0) return result

  // A run that never finished (process killed at a time limit) is closed out
  // after 30 minutes so it can never read as "still running" or hold anything up.
  await supabase
    .from('pinnacle_airtable_sync_runs')
    .update({ finished_at: new Date().toISOString(), ok: false, error: 'stale: never finished (the process was stopped mid-run)' })
    .is('finished_at', null)
    .lt('started_at', new Date(Date.now() - STALE_RUN_MS).toISOString())
    .then(() => undefined, () => undefined)

  const { data: run } = await supabase
    .from('pinnacle_airtable_sync_runs')
    .insert({ started_at: new Date().toISOString() })
    .select('id')
    .single()

  const byBase = new Map<string, BaseSyncResult>()
  const baseResult = (id: string) => {
    let b = byBase.get(id)
    if (!b) {
      b = { baseId: id, tables: {} }
      byBase.set(id, b)
      result.bases.push(b)
    }
    return b
  }
  const completedBases = new Set<string>()

  for (const job of jobs) {
    // Don't open a fresh table in the last minute; a mid-pull one keeps going
    // until the deadline and saves its cursor.
    if (Date.now() > deadlineAt - (job.cursor?.run_start ? 0 : 60_000)) {
      result.pending++
      continue
    }
    try {
      const r = await syncAirtableTableStreaming(job.baseId, job.table, { cursor: job.cursor, deadlineAt, since: job.since })
      baseResult(job.baseId).tables[job.table] = { fetched: r.fetched, upserted: r.upserted }
      if (r.complete) completedBases.add(job.baseId)
      else result.pending++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      baseResult(job.baseId).tables[job.table] = { fetched: 0, upserted: 0, error: msg }
      result.ok = false
      // Drop the half pull and back off until tomorrow's pass (completed_at
      // marks the attempt; no table-run is recorded, so nothing is swept).
      await saveCursor(job.baseId, job.table, { run_start: null, airtable_offset: null, completed_at: new Date().toISOString(), last_error: msg.slice(0, 500) }).catch(() => {})
    }
  }

  for (const baseId of completedBases) {
    if (Date.now() > deadlineAt + 60_000) break
    try {
      baseResult(baseId).snapshot = await buildSnapshotForBase(baseId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      baseResult(baseId).tables['_snapshot'] = { fetched: 0, upserted: 0, error: msg }
    }
  }

  if (run?.id) {
    await supabase
      .from('pinnacle_airtable_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        ok: result.ok,
        tables: result.bases.map((b) => ({ baseId: b.baseId, tables: b.tables, pending: result.pending })),
        error: result.ok ? null : 'one or more tables failed',
      })
      .eq('id', run.id)
  }
  // Rollups (daily, status, named dims) are rebuilt and the day cache expired
  // by pinnacle_post_sync() in the database once it sees the completed table
  // pulls recorded above. The rebuild RPCs exceed PostgREST's 8s timeout.
  return result
}
