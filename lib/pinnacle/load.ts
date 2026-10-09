/**
 * One server-side loader for every executive KPI surface (Overview home,
 * Performance page). Keeps the data layer in rollup.ts; this only bundles
 * the calls the pages share.
 */
import { supabase } from '@/lib/supabase'
import { fetchBaseNames, getBases } from '@/lib/pinnacle/airtable'
import {
  BREAKDOWN_DIMS,
  PINNACLE_BASE_ID,
  fetchBreakdown,
  fetchPremiumSeries,
  fetchStatusSeries,
  groupByBook,
  isPinnacleViewer,
  resolveBookLabel,
  type BookSeries,
  type BreakdownDim,
  type BreakdownRow,
  type DailyRow,
  type StatusRow,
} from '@/lib/pinnacle/rollup'
import { timeframeWindow } from '@/lib/pinnacle/kpis'

export type SyncRun = { started_at: string; finished_at: string | null; ok: boolean | null; error: string | null }

export type PinnacleOverview = {
  allowed: boolean
  configured: boolean
  pinnacleRows: DailyRow[]
  statusRows: StatusRow[]
  books: BookSeries[]
  breakdowns: Partial<Record<BreakdownDim, BreakdownRow[]>>
  lastRun: SyncRun | null
  tables: Array<{ label: string; baseId: string; names: string[] }>
}

export function fmtRel(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minutes ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hours ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export function pinnacleConfigured(): boolean {
  return getBases().length > 0 && Boolean(process.env.PINNACLE_AIRTABLE_TOKEN)
}

export async function loadPinnacleOverview(tenantId: string, opts: { breakdowns?: boolean } = {}): Promise<PinnacleOverview> {
  const allowed = isPinnacleViewer(tenantId)
  const configured = allowed && pinnacleConfigured()
  const empty: PinnacleOverview = { allowed, configured, pinnacleRows: [], statusRows: [], books: [], breakdowns: {}, lastRun: null, tables: [] }
  if (!configured) return empty

  const { start, end } = timeframeWindow('12m')
  const dims: BreakdownDim[] = opts.breakdowns === false ? [] : [...BREAKDOWN_DIMS]

  const baseNamesP: Promise<Record<string, string>> = fetchBaseNames().catch(() => ({}))
  const [series, statusRows, runs, tableCounts, ...bd] = await Promise.all([
    fetchPremiumSeries().catch(() => [] as DailyRow[]),
    fetchStatusSeries().catch(() => [] as StatusRow[]),
    supabase.from('pinnacle_airtable_sync_runs').select('started_at, finished_at, ok, error').order('started_at', { ascending: false }).limit(1),
    supabase.rpc('pinnacle_table_counts'),
    ...dims.map((d) => fetchBreakdown(d, 'All', start, end, 25).catch(() => [] as BreakdownRow[])),
  ])

  const breakdowns: PinnacleOverview['breakdowns'] = {}
  dims.forEach((d, i) => (breakdowns[d] = bd[i] as BreakdownRow[]))
  const baseNames = await baseNamesP

  const tablesByBase = new Map<string, Set<string>>()
  for (const r of ((tableCounts.data ?? []) as Array<{ base_id: string; table_name: string }>)) {
    if (!tablesByBase.has(r.base_id)) tablesByBase.set(r.base_id, new Set())
    tablesByBase.get(r.base_id)!.add(r.table_name)
  }

  return {
    allowed,
    configured,
    pinnacleRows: series.filter((r) => r.base_id === PINNACLE_BASE_ID),
    statusRows,
    books: groupByBook(series).map((b) => ({ ...b, label: resolveBookLabel(b.baseId, baseNames) })),
    breakdowns,
    lastRun: ((runs.data ?? [])[0] as SyncRun | undefined) ?? null,
    tables: Array.from(tablesByBase.entries()).map(([baseId, names]) => ({ baseId, label: resolveBookLabel(baseId, baseNames), names: Array.from(names).sort() })),
  }
}
