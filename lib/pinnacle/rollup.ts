/**
 * Pinnacle dashboard data layer.
 *
 * One DB round-trip (`pinnacle_premium_daily` RPC) returns the full daily
 * premium series bucketed by base + product line. Everything the dashboard
 * does — timeframe presets, line swatches, growth models — is sliced from
 * this one payload client-side, so toggles are instant and we don't re-hit
 * the 110k-row table on every interaction.
 */

import { supabase } from '@/lib/supabase'

export const PINNACLE_BASE_ID = 'appHyYBfI6kfX6ZuW'

export type ProductLine = 'Health' | 'Life' | 'Annuity'
export const PRODUCT_LINES: ProductLine[] = ['Health', 'Life', 'Annuity']

/** Theme-independent swatch colors (work in both paper + cxo espresso themes). */
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

export async function fetchPremiumSeries(): Promise<DailyRow[]> {
  const { data, error } = await supabase.rpc('pinnacle_premium_daily')
  if (error) throw new Error(`pinnacle_premium_daily: ${error.message}`)
  return (data ?? []) as DailyRow[]
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
  const { data, error } = await supabase.rpc('pinnacle_status_daily')
  if (error) throw new Error(`pinnacle_status_daily: ${error.message}`)
  return (data ?? []) as StatusRow[]
}

/** Compact month rollup for the Command Center revenue strip. */
export type MonthSummary = {
  this_month_premium: number
  prev_month_premium: number
  this_month_total: number
  this_month_paid: number
}

export async function fetchMonthSummary(): Promise<MonthSummary | null> {
  const { data, error } = await supabase.rpc('pinnacle_month_summary')
  if (error) return null
  const row = (data ?? [])[0] as MonthSummary | undefined
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
}

export const BREAKDOWN_DIMS = ['team', 'agent', 'carrier', 'state', 'product'] as const
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number]

export async function fetchBreakdown(
  dim: BreakdownDim,
  line: string,
  start: string,
  end: string,
  limit = 25,
): Promise<BreakdownRow[]> {
  const { data, error } = await supabase.rpc('pinnacle_breakdown', {
    p_dim: dim,
    p_line: line,
    p_start: start,
    p_end: end,
    p_limit: limit,
  })
  if (error) throw new Error(`pinnacle_breakdown: ${error.message}`)
  return (data ?? []) as BreakdownRow[]
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
