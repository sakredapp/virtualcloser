/**
 * Pinnacle Wellness Airtable sync.
 *
 * Brad Plummer (Pinnacle CEO) granted us a read-only Personal Access Token
 * scoped to the Pinnacle base. We pull the whole base daily so Spencer can
 * see Pinnacle revenue / apps submitted / etc. on /dashboard/pinnacle
 * without logging into Airtable.
 *
 * Env:
 *   PINNACLE_AIRTABLE_TOKEN     Personal access token (pat...)
 *   PINNACLE_AIRTABLE_BASE_ID   Base ID (app...). Brad has this — paste it
 *                               into Vercel env. The PAT does not have
 *                               schema.bases:read, so we can't auto-discover.
 *   PINNACLE_AIRTABLE_TABLES    Optional comma-separated list of table names
 *                               (or IDs) to sync. If unset, we try a small
 *                               built-in list of common names and skip the
 *                               ones that 404. Once Spencer/Brad confirm the
 *                               real names, set this env so we only hit what
 *                               we need.
 *
 * Field mapping (see deriveSnapshot below) is intentionally fuzzy — Airtable
 * column names tend to drift, so we look for any reasonable casing of
 * "revenue", "apps submitted", etc. Override by setting PINNACLE_FIELD_MAP
 * to a JSON object: { "revenue_total": "Revenue YTD", ... }.
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

const DEFAULT_TABLE_GUESSES = [
  // Most common names Brad's team would use. We try each; missing tables
  // just produce a 404 we skip. Once the real names are known set
  // PINNACLE_AIRTABLE_TABLES explicitly.
  'Applications',
  'Apps',
  'Submissions',
  'Revenue',
  'Sales',
  'Leads',
  'Customers',
  'Deals',
  'Pipeline',
]

export type TableSyncResult = {
  fetched: number
  upserted: number
  error?: string
}

export type SyncResult = {
  ok: boolean
  tables: Record<string, TableSyncResult>
  error?: string
  snapshot?: {
    date: string
    revenue_total: number | null
    apps_submitted: number | null
    apps_approved: number | null
    apps_funded: number | null
  }
}

function token(): string {
  const t = process.env.PINNACLE_AIRTABLE_TOKEN
  if (!t) throw new Error('PINNACLE_AIRTABLE_TOKEN is not set')
  return t
}

function baseId(): string {
  const b = process.env.PINNACLE_AIRTABLE_BASE_ID
  if (!b) throw new Error('PINNACLE_AIRTABLE_BASE_ID is not set')
  return b
}

function configuredTables(): string[] | null {
  const raw = process.env.PINNACLE_AIRTABLE_TABLES?.trim()
  if (!raw) return null
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
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
 * round trips. We let the caller catch errors per-table so one bad table
 * doesn't kill the whole sync.
 */
export async function fetchAirtableTable(tableName: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    const qs = new URLSearchParams({ pageSize: '100' })
    if (offset) qs.set('offset', offset)
    const url = `/${baseId()}/${encodeURIComponent(tableName)}?${qs.toString()}`
    const res = await airtableFetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`airtable ${tableName} HTTP ${res.status}: ${body.slice(0, 200)}`)
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
export async function previewAirtableTable(tableName: string, limit = 5): Promise<{
  fields: string[]
  sample: AirtableRecord[]
}> {
  const qs = new URLSearchParams({ pageSize: String(Math.min(limit, 100)) })
  const url = `/${baseId()}/${encodeURIComponent(tableName)}?${qs.toString()}`
  const res = await airtableFetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`airtable ${tableName} HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as AirtableListResponse
  const fieldSet = new Set<string>()
  for (const r of json.records) for (const k of Object.keys(r.fields)) fieldSet.add(k)
  return { fields: Array.from(fieldSet).sort(), sample: json.records }
}

async function upsertRecords(tableName: string, records: AirtableRecord[]): Promise<number> {
  if (records.length === 0) return 0
  // Chunk to keep payloads under PostgREST's default size limit.
  const CHUNK = 500
  let total = 0
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK)
    const rows = slice.map((r) => {
      const lm = r.fields['Last Modified'] ?? r.fields['Last modified'] ?? r.fields['last_modified']
      return {
        table_name: tableName,
        record_id: r.id,
        fields: r.fields,
        airtable_created: r.createdTime,
        last_modified_at: typeof lm === 'string' ? lm : null,
        fetched_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase
      .from('pinnacle_airtable_records')
      .upsert(rows, { onConflict: 'table_name,record_id' })
    if (error) throw new Error(`supabase upsert ${tableName}: ${error.message}`)
    total += slice.length
  }
  return total
}

type FieldMatcher = string[]

/**
 * Match a field by any of a list of case-insensitive substrings. Airtable
 * column names drift ("Revenue", "Total Revenue", "Revenue $") so we hunt
 * by substring rather than exact match.
 */
function findField(fields: Record<string, unknown>, matchers: FieldMatcher): unknown {
  const keys = Object.keys(fields)
  for (const m of matchers) {
    const hit = keys.find((k) => k.toLowerCase().includes(m.toLowerCase()))
    if (hit) return fields[hit]
  }
  return undefined
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function readFieldMap(): Record<string, FieldMatcher> {
  // Allow ops to override the fuzzy match with explicit Airtable column
  // names via env: PINNACLE_FIELD_MAP={"revenue_total":"Revenue YTD",...}.
  // Values can be string or string[].
  const raw = process.env.PINNACLE_FIELD_MAP
  const defaults: Record<string, FieldMatcher> = {
    revenue_total: ['revenue', 'amount', 'total $', 'gross'],
    apps_submitted: ['app submitted', 'application submitted', 'submitted', 'apps submitted'],
    apps_approved: ['approved', 'approval'],
    apps_funded: ['funded', 'funding'],
    status: ['status', 'stage', 'disposition'],
  }
  if (!raw) return defaults
  try {
    const parsed = JSON.parse(raw) as Record<string, string | string[]>
    const merged: Record<string, FieldMatcher> = { ...defaults }
    for (const [k, v] of Object.entries(parsed)) {
      merged[k] = Array.isArray(v) ? v : [v]
    }
    return merged
  } catch {
    return defaults
  }
}

/**
 * Roll the freshly synced rows into a single snapshot row for today. We
 * sum any "revenue" column we can find across all tables, count records
 * by status, etc. This stays loose on purpose — Brad's team can rename
 * columns and we'll still produce *something*, with the option for Spencer
 * to harden the mapping via PINNACLE_FIELD_MAP once he's seen the data.
 */
export async function buildSnapshot(): Promise<SyncResult['snapshot']> {
  const map = readFieldMap()
  const { data, error } = await supabase
    .from('pinnacle_airtable_records')
    .select('table_name, fields')
  if (error) throw error

  let revenue = 0
  let revenueSeen = false
  let appsSubmitted = 0
  let appsApproved = 0
  let appsFunded = 0
  let statusSeen = false

  for (const row of data ?? []) {
    const f = (row.fields ?? {}) as Record<string, unknown>
    const rev = asNumber(findField(f, map.revenue_total))
    if (rev !== null) {
      revenue += rev
      revenueSeen = true
    }
    const sub = findField(f, map.apps_submitted)
    if (sub === true || asNumber(sub) === 1) appsSubmitted++
    const status = findField(f, map.status)
    if (status !== undefined) statusSeen = true
    const s = typeof status === 'string' ? status.toLowerCase() : ''
    if (s.includes('approved')) appsApproved++
    if (s.includes('funded')) appsFunded++
  }

  // If we found no boolean "submitted" flag but a status column existed,
  // treat any row with a status as a submitted app — best-effort fallback.
  if (appsSubmitted === 0 && statusSeen) appsSubmitted = (data ?? []).length

  const snapshot = {
    date: new Date().toISOString().slice(0, 10),
    revenue_total: revenueSeen ? Number(revenue.toFixed(2)) : null,
    apps_submitted: statusSeen || appsSubmitted > 0 ? appsSubmitted : null,
    apps_approved: statusSeen ? appsApproved : null,
    apps_funded: statusSeen ? appsFunded : null,
  }

  const { error: upErr } = await supabase
    .from('pinnacle_airtable_snapshots')
    .upsert(
      {
        snapshot_date: snapshot.date,
        revenue_total: snapshot.revenue_total,
        apps_submitted: snapshot.apps_submitted,
        apps_approved: snapshot.apps_approved,
        apps_funded: snapshot.apps_funded,
        metrics: { built_from_rows: data?.length ?? 0 },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'snapshot_date' },
    )
  if (upErr) throw upErr
  return snapshot
}

/**
 * Top-level sync. Idempotent — safe to re-run; records upsert in place.
 */
export async function syncPinnacleAirtable(): Promise<SyncResult> {
  const result: SyncResult = { ok: true, tables: {} }
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
        tables: result.tables,
        error: error ?? null,
      })
      .eq('id', run.id)
  }

  try {
    const candidates = configuredTables() ?? DEFAULT_TABLE_GUESSES
    for (const name of candidates) {
      try {
        const records = await fetchAirtableTable(name)
        const upserted = await upsertRecords(name, records)
        result.tables[name] = { fetched: records.length, upserted }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // 404 / "could not find" → table doesn't exist under that name.
        // Don't fail the whole sync; just note it and move on.
        result.tables[name] = { fetched: 0, upserted: 0, error: msg }
      }
    }
    result.snapshot = await buildSnapshot()
    await finalize(true)
    return result
  } catch (err) {
    result.ok = false
    result.error = err instanceof Error ? err.message : String(err)
    await finalize(false, result.error)
    return result
  }
}
