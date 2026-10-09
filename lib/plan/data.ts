/**
 * Sales Plan — server reads and writes. Every query is scoped by rep_id (the
 * signed-in org); tables are service-role only (supabase/cxo_plan_employees.sql).
 * Actuals come from the same Pinnacle rollups the Revenue page reads.
 */
import { supabase } from '@/lib/supabase'
import { getPinnacleOverview } from '@/lib/pinnacle/cache'
import { fetchBreakdown, type BreakdownRow } from '@/lib/pinnacle/rollup'
import { bookToday } from '@/lib/pinnacle/kpis'
import {
  EMPTY_ACTUALS,
  quarterOf,
  type AllowanceTier,
  type LabelActual,
  type PlanActuals,
  type PlanTarget,
  type UnitEcon,
} from './shared'
import type { CompRate, UploadLog } from './comp'
import { uniqueNames } from './match'

const n = (v: unknown): number => Number(v) || 0
const nn = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export async function listTargets(repId: string, year: number): Promise<PlanTarget[]> {
  const { data, error } = await supabase
    .from('cxo_plan_targets')
    .select('id, year, month, product, carrier, premium, policies')
    .eq('rep_id', repId)
    .eq('year', year)
    .order('month')
    .limit(5000)
  if (error) throw new Error(`plan targets: ${error.message}`)
  return (data ?? []).map((r) => ({ id: r.id, year: r.year, month: r.month, product: r.product ?? '', carrier: r.carrier ?? '', premium: n(r.premium), policies: r.policies == null ? null : n(r.policies) }))
}

export async function listEcon(repId: string, year: number): Promise<UnitEcon[]> {
  const { data, error } = await supabase
    .from('cxo_plan_unit_econ')
    .select('id, year, product, carrier, commission_pct, avg_premium, override_pct, acquisition_cost')
    .eq('rep_id', repId)
    .eq('year', year)
    .limit(2000)
  if (error) throw new Error(`unit econ: ${error.message}`)
  return (data ?? []).map((r) => ({ id: r.id, year: r.year, product: r.product ?? '', carrier: r.carrier ?? '', commission_pct: nn(r.commission_pct), avg_premium: nn(r.avg_premium), override_pct: nn(r.override_pct), acquisition_cost: nn(r.acquisition_cost) }))
}

export async function listTiers(repId: string, year: number): Promise<AllowanceTier[]> {
  const { data, error } = await supabase
    .from('cxo_allowance_tiers')
    .select('id, year, carrier, period, threshold, unlocks')
    .eq('rep_id', repId)
    .eq('year', year)
    .order('threshold')
    .limit(2000)
  if (error) throw new Error(`allowance tiers: ${error.message}`)
  return (data ?? []).map((r) => ({ id: r.id, year: r.year, carrier: r.carrier, period: r.period === 'quarter' ? 'quarter' : 'month', threshold: n(r.threshold), unlocks: r.unlocks ?? '' }))
}

/** Upsert plan cells. `replaceYear` clears the year first (import with "replace"). Zero premium + no policies deletes the cell. */
export async function saveTargets(repId: string, year: number, cells: PlanTarget[], replaceYear = false): Promise<number> {
  if (replaceYear) {
    const { error } = await supabase.from('cxo_plan_targets').delete().eq('rep_id', repId).eq('year', year)
    if (error) throw new Error(`clear plan: ${error.message}`)
  }
  const now = new Date().toISOString()
  const keep = cells.filter((c) => c.month >= 1 && c.month <= 12 && ((c.premium || 0) !== 0 || c.policies != null))
  const drop = cells.filter((c) => c.month >= 1 && c.month <= 12 && !((c.premium || 0) !== 0 || c.policies != null))
  for (let i = 0; i < keep.length; i += 500) {
    const chunk = keep.slice(i, i + 500).map((c) => ({
      rep_id: repId,
      year,
      month: c.month,
      product: (c.product ?? '').trim().slice(0, 120),
      carrier: (c.carrier ?? '').trim().slice(0, 120),
      premium: Math.round((c.premium || 0) * 100) / 100,
      policies: c.policies == null ? null : Math.round(c.policies),
      updated_at: now,
    }))
    const { error } = await supabase.from('cxo_plan_targets').upsert(chunk, { onConflict: 'rep_id,year,month,product,carrier' })
    if (error) throw new Error(`save plan: ${error.message}`)
  }
  for (const c of drop) {
    await supabase.from('cxo_plan_targets').delete().eq('rep_id', repId).eq('year', year).eq('month', c.month).eq('product', (c.product ?? '').trim()).eq('carrier', (c.carrier ?? '').trim())
  }
  return keep.length
}

/** Remove every month for one product × carrier row of the plan. */
export async function deletePlanRow(repId: string, year: number, product: string, carrier: string): Promise<void> {
  const { error } = await supabase.from('cxo_plan_targets').delete().eq('rep_id', repId).eq('year', year).eq('product', product).eq('carrier', carrier)
  if (error) throw new Error(`delete plan row: ${error.message}`)
  await supabase.from('cxo_plan_unit_econ').delete().eq('rep_id', repId).eq('year', year).eq('product', product).eq('carrier', carrier)
}

export async function saveEcon(repId: string, e: UnitEcon): Promise<void> {
  const row = {
    rep_id: repId,
    year: e.year,
    product: (e.product ?? '').trim().slice(0, 120),
    carrier: (e.carrier ?? '').trim().slice(0, 120),
    commission_pct: e.commission_pct,
    avg_premium: e.avg_premium,
    override_pct: e.override_pct,
    acquisition_cost: e.acquisition_cost,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('cxo_plan_unit_econ').upsert(row, { onConflict: 'rep_id,year,product,carrier' })
  if (error) throw new Error(`save unit econ: ${error.message}`)
}

export async function addTier(repId: string, t: AllowanceTier): Promise<void> {
  const { error } = await supabase.from('cxo_allowance_tiers').insert({
    rep_id: repId,
    year: t.year,
    carrier: t.carrier.trim().slice(0, 120),
    period: t.period === 'quarter' ? 'quarter' : 'month',
    threshold: t.threshold,
    unlocks: t.unlocks.trim().slice(0, 300),
  })
  if (error) throw new Error(`add tier: ${error.message}`)
}

export async function deleteTier(repId: string, id: string): Promise<void> {
  const { error } = await supabase.from('cxo_allowance_tiers').delete().eq('rep_id', repId).eq('id', id)
  if (error) throw new Error(`delete tier: ${error.message}`)
}

function toLabel(rows: BreakdownRow[]): LabelActual[] {
  return rows.filter((r) => r.label).map((r) => ({ label: r.label, premium: r.premium, policies: r.policies }))
}

const safe = <T,>(p: Promise<T>, fallback: T, what: string): Promise<T> =>
  p.catch((err) => {
    console.error(`[plan] ${what}`, err instanceof Error ? err.message : err)
    return fallback
  })

/**
 * Actuals for the plan year, through today. A future year has none (the
 * page says it starts Jan 1). Rows dated after today are policies with a
 * future effective date and are left out, as on Revenue. `through` is the
 * last day the book has rows for, so pacing never counts days with no data yet.
 */
export async function loadActuals(tenantId: string, year: number, tz?: string | null): Promise<PlanActuals> {
  const today = bookToday(new Date(), tz || 'America/New_York')
  const ty = Number(today.slice(0, 4))
  const overview = await safe(getPinnacleOverview(tenantId, { view: 'overview', tz }), null, 'overview')
  const connected = !!overview && overview.configured && overview.pinnacleRows.length > 0
  if (!connected) return { ...EMPTY_ACTUALS }
  if (year > ty) return { ...EMPTY_ACTUALS, connected: true }

  const end = year < ty ? `${year}-12-31` : today
  const start = `${year}-01-01`
  const monthly = new Array(12).fill(0)
  const monthlyPolicies = new Array(12).fill(0)
  const lines = new Map<string, LabelActual>()
  let lastDay: string | null = null
  for (const r of overview!.pinnacleRows) {
    if (r.d < start || r.d > end) continue
    if (!lastDay || r.d > lastDay) lastDay = r.d
    const m = Number(r.d.slice(5, 7)) - 1
    monthly[m] += n(r.premium)
    monthlyPolicies[m] += n(r.policies)
    const l = lines.get(r.line) ?? { label: r.line, premium: 0, policies: 0 }
    l.premium += n(r.premium)
    l.policies += n(r.policies)
    lines.set(r.line, l)
  }

  const isCurrent = year === ty
  const tm = Number(today.slice(5, 7))
  const monthStart = `${today.slice(0, 7)}-01`
  const q = quarterOf(tm)
  const quarterStart = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`
  const [byCarrier, byProduct, carrierThisMonth, carrierThisQuarter] = await Promise.all([
    safe(fetchBreakdown('carrier', 'All', start, end, 500).then(toLabel), [], 'carrier ytd'),
    safe(fetchBreakdown('product', 'All', start, end, 500).then(toLabel), [], 'product ytd'),
    isCurrent ? safe(fetchBreakdown('carrier', 'All', monthStart, today, 500).then(toLabel), [], 'carrier month') : Promise.resolve([]),
    isCurrent ? safe(fetchBreakdown('carrier', 'All', quarterStart, today, 500).then(toLabel), [], 'carrier quarter') : Promise.resolve([]),
  ])
  return { monthly, monthlyPolicies, byCarrier, byProduct, byLine: Array.from(lines.values()), carrierThisMonth, carrierThisQuarter, through: lastDay ?? end, connected: true }
}

export type PlanPageData = {
  year: number
  today: string
  targets: PlanTarget[]
  econ: UnitEcon[]
  tiers: AllowanceTier[]
  actuals: PlanActuals
  /** Real carrier and product names from the book, for suggestions while typing. */
  carrierNames: string[]
  productNames: string[]
  /** Comp grids and upload history. Only loaded for members who may see comp; null otherwise. */
  comp: { rates: CompRate[]; uploads: UploadLog[] } | null
}

export async function loadPlanPage(tenantId: string, year: number, tz?: string | null, opts: { comp?: boolean } = {}): Promise<PlanPageData> {
  const today = bookToday(new Date(), tz || 'America/New_York')
  const [targets, econ, tiers, actuals, comp] = await Promise.all([
    listTargets(tenantId, year),
    listEcon(tenantId, year),
    listTiers(tenantId, year),
    loadActuals(tenantId, year, tz),
    opts.comp ? Promise.all([safe(listCompRates(tenantId), [], 'comp rates'), safe(listUploads(tenantId), [], 'uploads')]).then(([rates, uploads]) => ({ rates, uploads })) : Promise.resolve(null),
  ])
  // Suggestions: this year's labels, or the current year's when planning ahead.
  let names = { c: actuals.byCarrier, p: actuals.byProduct }
  if (names.c.length === 0 && actuals.connected) {
    const ty = Number(today.slice(0, 4))
    const [c, p] = await Promise.all([
      safe(fetchBreakdown('carrier', 'All', `${ty}-01-01`, today, 200).then(toLabel), [], 'carrier names'),
      safe(fetchBreakdown('product', 'All', `${ty}-01-01`, today, 200).then(toLabel), [], 'product names'),
    ])
    names = { c, p }
  }
  const carrierNames = names.c.map((r) => r.label).filter(Boolean).slice(0, 200)
  const productNames = ['Health', 'Life', 'Annuity', ...names.p.map((r) => r.label).filter(Boolean).slice(0, 200)]
  return { year, today, targets, econ, tiers, actuals, carrierNames, productNames, comp }
}

// ── Comp grids and uploads ──────────────────────────────────────────────

const levelsOf = (v: unknown): CompRate['agent_levels'] =>
  Array.isArray(v) ? v.map((l) => ({ level: String((l as { level?: unknown })?.level ?? ''), rate: Number((l as { rate?: unknown })?.rate) })).filter((l) => l.level && Number.isFinite(l.rate)) : []

export async function listCompRates(repId: string): Promise<CompRate[]> {
  const { data, error } = await supabase
    .from('cxo_comp_rates')
    .select('id, product, carrier, agency_rate, payout_rate, payout_level, agent_levels, upload_id, updated_at')
    .eq('rep_id', repId)
    .order('carrier')
    .limit(5000)
  if (error) throw new Error(`comp rates: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    product: r.product ?? '',
    carrier: r.carrier ?? '',
    agency_rate: n(r.agency_rate),
    payout_rate: nn(r.payout_rate),
    payout_level: r.payout_level ?? null,
    agent_levels: levelsOf(r.agent_levels),
    upload_id: r.upload_id ?? null,
    updated_at: r.updated_at ?? null,
  }))
}

export async function listUploads(repId: string, limit = 20): Promise<UploadLog[]> {
  const { data, error } = await supabase
    .from('cxo_plan_uploads')
    .select('id, kind, year, filename, source, rows_saved, read_by, ai_cost_usd, member_name, created_at')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`uploads: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind === 'comp' ? 'comp' : 'plan',
    year: r.year ?? null,
    filename: r.filename ?? '',
    source: r.source ?? 'file',
    rows_saved: n(r.rows_saved),
    read_by: r.read_by === 'claude' ? 'claude' : 'rules',
    ai_cost_usd: nn(r.ai_cost_usd),
    member_name: r.member_name ?? null,
    created_at: r.created_at,
  }))
}

export async function logUpload(
  repId: string,
  u: { kind: 'plan' | 'comp'; year: number | null; filename: string; source: string; rows_saved: number; carriers: number; products: number; read_by: 'rules' | 'claude'; ai_cost_usd: number; member_id: string | null; member_name: string | null },
): Promise<string> {
  const { data, error } = await supabase
    .from('cxo_plan_uploads')
    .insert({ rep_id: repId, ...u, filename: u.filename.slice(0, 200) })
    .select('id')
    .single()
  if (error) throw new Error(`log upload: ${error.message}`)
  return data.id as string
}

/** Upsert comp rows (one per product × carrier). `replaceAll` clears the org's grid first. */
export async function saveCompRates(repId: string, rates: CompRate[], uploadId: string | null, replaceAll = false): Promise<number> {
  if (replaceAll) {
    const { error } = await supabase.from('cxo_comp_rates').delete().eq('rep_id', repId)
    if (error) throw new Error(`clear comp: ${error.message}`)
  }
  const now = new Date().toISOString()
  const rows = rates
    .filter((r) => r.carrier.trim() && Number.isFinite(r.agency_rate) && r.agency_rate >= 0 && r.agency_rate <= 1000)
    .map((r) => ({
      rep_id: repId,
      product: r.product.trim().slice(0, 120),
      carrier: r.carrier.trim().slice(0, 120),
      agency_rate: Math.round(r.agency_rate * 1000) / 1000,
      payout_rate: r.payout_rate,
      payout_level: r.payout_level,
      agent_levels: r.agent_levels.filter((l) => Number.isFinite(l.rate) && l.rate >= 0 && l.rate <= 1000).slice(0, 30).map((l) => ({ level: l.level.slice(0, 60), rate: Math.round(l.rate * 1000) / 1000 })),
      upload_id: uploadId,
      updated_at: now,
    }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('cxo_comp_rates').upsert(rows.slice(i, i + 500), { onConflict: 'rep_id,product,carrier' })
    if (error) throw new Error(`save comp: ${error.message}`)
  }
  return rows.length
}

/** Names an upload is matched against: the book's carriers and products, plus what the plan and comp grids already use. */
export async function knownNames(repId: string, year: number, tz?: string | null): Promise<{ carriers: string[]; products: string[] }> {
  const today = bookToday(new Date(), tz || 'America/New_York')
  const ty = Number(today.slice(0, 4))
  const from = `${Math.min(ty, year) - 1}-01-01`
  const [c, p, targets, rates] = await Promise.all([
    safe(fetchBreakdown('carrier', 'All', from, today, 300).then(toLabel), [], 'carrier names'),
    safe(fetchBreakdown('product', 'All', from, today, 300).then(toLabel), [], 'product names'),
    safe(listTargets(repId, year), [], 'plan names'),
    safe(listCompRates(repId), [], 'comp names'),
  ])
  return {
    carriers: uniqueNames([...c.map((r) => r.label), ...targets.map((t) => t.carrier), ...rates.map((r) => r.carrier)]),
    products: uniqueNames(['Health', 'Life', 'Annuity', ...p.map((r) => r.label), ...targets.map((t) => t.product), ...rates.map((r) => r.product)]),
  }
}
