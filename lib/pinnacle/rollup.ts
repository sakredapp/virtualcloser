/**
 * Pinnacle dashboard data layer.
 *
 * One DB round-trip (`pinnacle_premium_daily` RPC) returns the full daily
 * premium series bucketed by base + product line. Everything the dashboard
 * does — timeframe presets, line swatches, growth models — is sliced from
 * this one payload client-side, so toggles are instant and we don't re-hit
 * the 110k-row table on every interaction.
 */

import { unstable_cache } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { pinnacleAllowed } from './access'

export const PINNACLE_BASE_ID = 'appHyYBfI6kfX6ZuW'

/** True if a tenant is allowed to see Pinnacle data. One rule: lib/pinnacle/access.ts. */
export function isPinnacleViewer(tenantId: string): boolean {
  return pinnacleAllowed(tenantId)
}

export type ProductLine = 'Health' | 'Life' | 'Annuity'
export const PRODUCT_LINES: ProductLine[] = ['Health', 'Life', 'Annuity']

/** Theme-independent swatch colors (work in both VC paper + CXO charcoal/vanilla themes). */
export const LINE_COLOR: Record<ProductLine, string> = {
  Health: '#16a34a', // green
  Life: '#2563eb', // blue
  Annuity: '#d97706', // amber
}

/** Raw daily row as returned by the RPC. */
export type DailyRow = {
  d: string // YYYY-MM-DD
  base_id: string
  line: string // 'Health' | 'Life' | 'Annuity' | 'Other'
  premium: number
  policies: number
  funded_premium: number | null
  funded_policies: number
}

export type BookSeries = {
  baseId: string
  label: string
  isPinnacle: boolean
  rows: DailyRow[]
}

/**
 * Friendly labels for each Airtable base. The two agency books-of-business
 * have opaque base ids; override their names without a deploy via
 * PINNACLE_BOOK_LABELS (JSON: {"<baseId>":"Label"}).
 */
function bookLabels(): Record<string, string> {
  const defaults: Record<string, string> = {
    [PINNACLE_BASE_ID]: 'Pinnacle',
    appbJ5Wu2U6ZZmbhW: 'Agency Book A',
    appsClAi9HtW3vaVX: 'Agency Book B',
  }
  const raw = process.env.PINNACLE_BOOK_LABELS
  if (!raw) return defaults
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

export function bookLabel(baseId: string): string {
  return bookLabels()[baseId] ?? `Book · ${baseId.slice(0, 8)}`
}

/** True when the label is a stand-in, not the book's real name. */
export function isGenericBookLabel(label: string): boolean {
  return /^agency book\b/i.test(label) || /^book · /i.test(label)
}

/**
 * Prefer, in order: an explicit PINNACLE_BOOK_LABELS override, the real base
 * name from the Airtable meta API, then the stand-in. The Pinnacle base keeps
 * its short label either way.
 */
export function resolveBookLabel(baseId: string, apiNames: Record<string, string>): string {
  const configured = bookLabel(baseId)
  if (baseId === PINNACLE_BASE_ID) return configured
  if (!isGenericBookLabel(configured)) return configured
  const real = apiNames[baseId]?.trim()
  return real || configured
}

/**
 * PostgREST caps every response at its max-rows setting (1000), RPCs
 * included. The daily rollup is ~2k rows, so a single call silently dropped
 * the newest days and the page said "data through Jun 9" while the book was
 * current. Page through it in a stable order until a short page comes back.
 */
const RPC_PAGE = 1000
const RPC_MAX_PAGES = 50

export async function fetchAllRpcRows<T>(fn: string, order: string[]): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < RPC_MAX_PAGES; page++) {
    let q = supabase.rpc(fn).select('*')
    for (const col of order) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(page * RPC_PAGE, page * RPC_PAGE + RPC_PAGE - 1)
    if (error) throw new Error(`${fn}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < RPC_PAGE) break
  }
  return out
}

export async function fetchPremiumSeries(): Promise<DailyRow[]> {
  return fetchAllRpcRows<DailyRow>('pinnacle_premium_daily', ['d', 'base_id', 'line'])
}

/** Daily disposition counts (Pinnacle base) — powers the Health section. */
export type StatusRow = {
  d: string
  line: string
  total: number
  paid: number
  declined: number
  lapsed: number
  submitted: number
}

export async function fetchStatusSeries(): Promise<StatusRow[]> {
  return fetchAllRpcRows<StatusRow>('pinnacle_status_daily', ['d', 'line'])
}

/** Compact month rollup for the Command Center revenue strip. */
export type MonthSummary = {
  this_month_premium: number
  prev_month_premium: number
  this_month_total: number
  this_month_paid: number
}

// pinnacle_month_summary now reads the rollups (supabase/pinnacle_month_summary_mtd.sql):
// this month = the 1st through today in New York, never future-dated policies.
// Historical note — PERF: pinnacle_month_summary used to full-scan the ~1M-row / 1.5GB raw
// pinnacle_airtable_records table, and the Command Center calls it on EVERY load
// for pinnacle-allowed viewers (Spencer) — which dragged the whole site down
// (4B+ tuples read across 14k seq scans). The underlying data only changes once
// a day (Airtable sync), so cache the result: the scan now runs at most ~once
// per revalidate window instead of per request. Same numbers, no behavior change.
async function _fetchMonthSummaryRaw(): Promise<MonthSummary | null> {
  const { data, error } = await supabase.rpc('pinnacle_month_summary')
  if (error) return null
  const row = (data ?? [])[0] as MonthSummary | undefined
  return row ?? null
}

export const fetchMonthSummary = unstable_cache(
  _fetchMonthSummaryRaw,
  ['pinnacle-month-summary-v2'],
  { revalidate: 900 },
)

/** Premium summary over an arbitrary [start, end] window (Command Center strip). */
export type WindowSummary = {
  premium: number
  policies: number
  funded: number
  paid: number
  total: number
}

export async function fetchWindowSummary(start: string, end: string): Promise<WindowSummary | null> {
  const { data, error } = await supabase.rpc('pinnacle_window_summary', { p_start: start, p_end: end })
  if (error) return null
  const row = (data ?? [])[0] as WindowSummary | undefined
  return row ?? null
}

/** One row of a breakdown table (team/agent/carrier/state/product). */
export type BreakdownRow = {
  label: string
  premium: number
  policies: number
  paid: number
  declined: number
  lapsed: number
  /** Agent rows only: the agency/team the agent writes under (named rollup). */
  team?: string | null
}

export const BREAKDOWN_DIMS = ['team', 'agent', 'carrier', 'state', 'product'] as const
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number]

/** True when PostgREST says the function is not there (migration not run). */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist/i.test(err.message ?? '')
}

/** Memo: the named rollup (supabase/pinnacle_named_rollup.sql) is missing; re-checked every 10 minutes. */
let namedMissingAt = 0

/**
 * Ranked breakdown for one dimension over a window. Reads the precomputed
 * named rollup (`pinnacle_breakdown_v2`: real team and agent names, agent
 * rows carry their team, impossible dates skipped) and falls back to the
 * original raw-scan RPC until that migration has run.
 */
export async function fetchBreakdown(
  dim: BreakdownDim,
  line: string,
  start: string,
  end: string,
  limit = 25,
): Promise<BreakdownRow[]> {
  const args = { p_dim: dim, p_line: line, p_start: start, p_end: end, p_limit: limit }
  if (Date.now() - namedMissingAt > 10 * 60_000) {
    const v2 = await supabase.rpc('pinnacle_breakdown_v2', args)
    if (!v2.error) return ((v2.data ?? []) as BreakdownRow[]).map(numify)
    if (isMissingFunction(v2.error)) namedMissingAt = Date.now()
    else throw new Error(`pinnacle_breakdown_v2: ${v2.error.message}`)
  }
  const { data, error } = await supabase.rpc('pinnacle_breakdown', args)
  if (error) throw new Error(`pinnacle_breakdown: ${error.message}`)
  return ((data ?? []) as BreakdownRow[]).map(numify)
}

/** PostgREST returns numeric/bigint as strings; the UI wants numbers. */
function numify(r: BreakdownRow): BreakdownRow {
  return {
    label: String(r.label ?? ''),
    premium: Number(r.premium) || 0,
    policies: Number(r.policies) || 0,
    paid: Number(r.paid) || 0,
    declined: Number(r.declined) || 0,
    lapsed: Number(r.lapsed) || 0,
    team: r.team ?? null,
  }
}

/** Split the flat RPC payload into one series per base, Pinnacle first. */
export function groupByBook(rows: DailyRow[]): BookSeries[] {
  const byBase = new Map<string, DailyRow[]>()
  for (const r of rows) {
    const arr = byBase.get(r.base_id) ?? []
    arr.push(r)
    byBase.set(r.base_id, arr)
  }
  const books: BookSeries[] = []
  for (const [baseId, baseRows] of byBase) {
    books.push({
      baseId,
      label: bookLabel(baseId),
      isPinnacle: baseId === PINNACLE_BASE_ID,
      rows: baseRows,
    })
  }
  books.sort((a, b) => (a.isPinnacle ? -1 : b.isPinnacle ? 1 : a.label.localeCompare(b.label)))
  return books
}
