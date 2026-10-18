/**
 * Producer book reads (server only). One shape from either source:
 *   pinnacle -> pinnacle_producer_production (agent rollup, no tenant column;
 *               only for tenants on the Pinnacle allow-list)
 *   tenant   -> cxo_book_producer_production (the tenant's own rows)
 * Both RPCs are service_role only (supabase/cxo_producer_book.sql).
 * Callers check canSeeBook (lib/book/access) before reading.
 */
import { supabase } from '@/lib/supabase'
import { bookSourceFor, type BookSource } from './access'
import type { ProducerRow, Window } from './production'
import { toBreakdownRow, toMaturity, toRetentionRaw, type BreakdownRow, type Maturity, type RetentionRaw } from './retention'

export type BookLine = 'All' | 'Health' | 'Life' | 'Annuity'

export function asBookLine(v: unknown): BookLine {
  const l = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return l === 'health' ? 'Health' : l === 'life' ? 'Life' : l === 'annuity' ? 'Annuity' : 'All'
}

type RawRow = Record<string, unknown>
const num = (v: unknown) => Number(v) || 0
const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : null)

export function toProducerRow(r: RawRow): ProducerRow {
  return {
    name: String(r.label ?? '').trim(),
    team: typeof r.team === 'string' && r.team.trim() ? r.team.trim() : null,
    premium: num(r.premium),
    funded: num(r.funded),
    policies: num(r.policies),
    paid: num(r.paid),
    declined: num(r.declined),
    lapsed: num(r.lapsed),
    pending: num(r.pending),
    firstPolicy: day(r.first_policy),
    contractedAt: day(r.contracted_at),
    status: typeof r.status === 'string' ? r.status : null,
  }
}

/** Producer rows for one window (everyone with business in it; tenant books also list producers contracted in it). */
export async function fetchProducers(tenantId: string, win: Window, opts: { line?: BookLine; name?: string | null } = {}): Promise<ProducerRow[]> {
  const source = bookSourceFor(tenantId)
  const line = opts.line ?? 'All'
  const name = opts.name?.trim() || null
  const fn = source === 'pinnacle' ? 'pinnacle_producer_production' : 'cxo_book_producer_production'
  const params =
    source === 'pinnacle'
      ? { p_line: line, p_start: win.start, p_end: win.end, p_name: name, p_limit: PRODUCER_SQL_LIMIT }
      : { p_rep_id: tenantId, p_line: line, p_start: win.start, p_end: win.end, p_name: name, p_limit: PRODUCER_SQL_LIMIT }
  // PostgREST returns at most 1,000 rows per response, RPCs included. An MTD
  // window has 1,000+ agents writing, so an unpaged read silently dropped the
  // smallest producers and totals came out short of the Revenue card.
  const page = (i: number) =>
    supabase
      .rpc(fn, params)
      .select('*')
      .order('premium', { ascending: false, nullsFirst: false })
      .order('label', { ascending: true })
      .range(i * PRODUCER_PAGE, i * PRODUCER_PAGE + PRODUCER_PAGE - 1)
  const raw = await readAllPages(async (i) => {
    const { data, error } = await page(i)
    if (error) throw new Error(`producer production (${source}): ${error.message}`)
    return (data ?? []) as RawRow[]
  }, PRODUCER_PAGE)
  return raw.map(toProducerRow).filter((r) => r.name)
}

/** PostgREST's per-response row cap. */
export const PRODUCER_PAGE = 1000
/** The SQL clamp on producer rows (supabase/cxo_producer_book.sql), well above any real book. */
export const PRODUCER_SQL_LIMIT = 20000
const MAX_PAGES = 20

/**
 * Read every page: the first alone (most windows fit), then the rest three at
 * a time in parallel, until a short page. Pages are in a stable order.
 */
export async function readAllPages<T>(read: (page: number) => Promise<T[]>, pageSize: number): Promise<T[]> {
  const first = await read(0)
  if (first.length < pageSize) return first
  const out = [...first]
  for (let next = 1; next < MAX_PAGES; next += 3) {
    const batch = await Promise.all([next, next + 1, next + 2].filter((i) => i < MAX_PAGES).map((i) => read(i)))
    let done = false
    for (const rows of batch) {
      if (done) break
      out.push(...rows)
      if (rows.length < pageSize) done = true
    }
    if (done) break
  }
  return out
}

/**
 * Agency totals for the window. Pinnacle: the team dimension, the same rollup
 * and the same query as the dashboard's "Top agencies" card, so figures match
 * to the dollar (a producer's policies can sit under more than one team, so
 * grouping producers by one team does not). Tenant books return null and the
 * caller groups producer rows.
 */
export async function fetchAgencyRows(tenantId: string, win: Window, opts: { line?: BookLine } = {}): Promise<BreakdownRow[] | null> {
  if (bookSourceFor(tenantId) !== 'pinnacle') return null
  const { data, error } = await supabase.rpc('pinnacle_breakdown_v2', { p_dim: 'team', p_line: opts.line ?? 'All', p_start: win.start, p_end: win.end, p_limit: 200 })
  if (error) throw new Error(`agency breakdown: ${error.message}`)
  return ((data ?? []) as RawRow[]).map(toBreakdownRow)
}

export type BookStatus = { source: BookSource; connected: boolean; producers: number | null; data_through: string | null }

/** Is there a book at all for this tenant, and how current is it. */
export async function bookStatus(tenantId: string): Promise<BookStatus> {
  const source = bookSourceFor(tenantId)
  if (source === 'pinnacle') {
    const { data, error } = await supabase.from('pinnacle_dim_rollup').select('d').eq('dim', 'agent').gt('policies', 0).lte('d', new Date().toISOString().slice(0, 10)).order('d', { ascending: false }).limit(1)
    if (error) throw new Error(`book status: ${error.message}`)
    const through = day((data?.[0] as RawRow | undefined)?.d)
    return { source, connected: !!through, producers: null, data_through: through }
  }
  const [prod, last] = await Promise.all([
    supabase.from('cxo_book_producers').select('id', { count: 'exact', head: true }).eq('rep_id', tenantId),
    supabase.from('cxo_book_policies').select('submitted_on').eq('rep_id', tenantId).order('submitted_on', { ascending: false }).limit(1),
  ])
  if (prod.error) throw new Error(`book status: ${prod.error.message}`)
  if (last.error) throw new Error(`book status: ${last.error.message}`)
  const producers = prod.count ?? 0
  const through = day((last.data?.[0] as RawRow | undefined)?.submitted_on)
  return { source, connected: producers > 0 && !!through, producers, data_through: through }
}

// ---------------------------------------------------------------------------
// Retention, placement by carrier/product, pending lag (supabase/cxo_producer_retention.sql).

/** Agent retention for a window vs its prior window (agent page definitions). */
export async function fetchRetention(
  tenantId: string,
  win: Window,
  prior: Window,
  todayIso: string,
  opts: { line?: BookLine; team?: string | null; limit?: number } = {},
): Promise<RetentionRaw> {
  const source = bookSourceFor(tenantId)
  const { data, error } = await supabase.rpc('cxo_producer_retention', {
    p_source: source,
    p_rep_id: tenantId,
    p_line: opts.line ?? 'All',
    p_start: win.start,
    p_end: win.end,
    p_prior_start: prior.start,
    p_prior_end: prior.end,
    p_today: todayIso,
    p_team: opts.team?.trim() || null,
    p_limit: Math.max(1, Math.min(opts.limit ?? 25, 200)),
  })
  if (error) throw new Error(`producer retention (${source}): ${error.message}`)
  return toRetentionRaw(data)
}

export type BreakdownDim = 'carrier' | 'product'

/** Applications and outcomes per carrier or product in a window. */
export async function fetchBookBreakdown(tenantId: string, dim: BreakdownDim, win: Window, opts: { line?: BookLine } = {}): Promise<BreakdownRow[]> {
  const source = bookSourceFor(tenantId)
  const line = opts.line ?? 'All'
  const { data, error } =
    source === 'pinnacle'
      ? await supabase.rpc('pinnacle_breakdown_v2', { p_dim: dim, p_line: line, p_start: win.start, p_end: win.end, p_limit: 200 })
      : await supabase.rpc('cxo_book_breakdown', { p_rep_id: tenantId, p_dim: dim, p_line: line, p_start: win.start, p_end: win.end, p_limit: 200 })
  if (error) throw new Error(`book breakdown (${source}): ${error.message}`)
  return ((data ?? []) as RawRow[]).map(toBreakdownRow)
}

/** How long apps stay pending, by age (and the real median issue lag when the book has issue dates). */
export async function fetchMaturity(tenantId: string, todayIso: string, opts: { line?: BookLine } = {}): Promise<Maturity> {
  const source = bookSourceFor(tenantId)
  const { data, error } = await supabase.rpc('cxo_placement_maturity', { p_source: source, p_rep_id: tenantId, p_line: opts.line ?? 'All', p_today: todayIso, p_weeks: 16 })
  if (error) throw new Error(`placement maturity (${source}): ${error.message}`)
  return toMaturity(data)
}
