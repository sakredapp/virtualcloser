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
  const { data, error } =
    source === 'pinnacle'
      ? await supabase.rpc('pinnacle_producer_production', { p_line: line, p_start: win.start, p_end: win.end, p_name: name, p_limit: 2000 })
      : await supabase.rpc('cxo_book_producer_production', { p_rep_id: tenantId, p_line: line, p_start: win.start, p_end: win.end, p_name: name, p_limit: 2000 })
  if (error) throw new Error(`producer production (${source}): ${error.message}`)
  return ((data ?? []) as RawRow[]).map(toProducerRow).filter((r) => r.name)
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
