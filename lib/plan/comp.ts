/**
 * Comp grids and agency profit — pure math shared by the page, the API,
 * Mira's tools and the tests. No server imports.
 *
 * Words: "agency rate" = the agency's contract level from the carrier (% of
 * premium); "agent payout" = what the agency pays its agent; "spread" =
 * agency rate − agent payout, what the agency keeps; "profit" = premium ×
 * spread. Rates are percents (110 = 110%).
 */
import { MONTHS, norm, type LabelActual, type PlanTarget } from './shared'

export type AgentLevel = { level: string; rate: number }

export type CompRate = {
  id?: string
  product: string
  carrier: string
  agency_rate: number
  /** The agent payout the profit math uses. Null → the highest agent level. */
  payout_rate: number | null
  payout_level: string | null
  agent_levels: AgentLevel[]
  upload_id?: string | null
  updated_at?: string | null
}

export type UploadLog = {
  id: string
  kind: 'plan' | 'comp'
  year: number | null
  filename: string
  source: string
  rows_saved: number
  read_by: 'rules' | 'claude'
  ai_cost_usd: number | null
  member_name: string | null
  created_at: string
}

/** The payout used for profit: the saved one, else the highest agent level. */
export function payoutOf(r: Pick<CompRate, 'payout_rate' | 'agent_levels'>): { rate: number | null; level: string | null } {
  if (r.payout_rate != null && Number.isFinite(r.payout_rate)) {
    const lv = r.agent_levels.find((l) => l.rate === r.payout_rate)
    return { rate: r.payout_rate, level: lv?.level ?? null }
  }
  if (!r.agent_levels.length) return { rate: null, level: null }
  const top = r.agent_levels.reduce((a, b) => (b.rate > a.rate ? b : a))
  return { rate: top.rate, level: top.level }
}

/** Spread in points (agency rate − agent payout), or null with no payout. */
export function spreadOf(r: Pick<CompRate, 'agency_rate' | 'payout_rate' | 'agent_levels'>): number | null {
  const p = payoutOf(r).rate
  return p == null ? null : r.agency_rate - p
}

/**
 * The comp row for a product × carrier: same carrier and product; else the
 * same carrier with the product as whole words either way ("IUL" ↔ "IUL Express");
 * else the carrier's catch-all row (blank product).
 */
export function findRate(rates: CompRate[], product: string, carrier: string): CompRate | null {
  const c = norm(carrier)
  const p = norm(product)
  const mine = rates.filter((r) => norm(r.carrier) === c)
  if (!mine.length) return null
  const exact = mine.find((r) => norm(r.product) === p)
  if (exact) return exact
  if (p) {
    const part = mine.find((r) => {
      const rp = norm(r.product)
      return rp && (` ${rp} `.includes(` ${p} `) || ` ${p} `.includes(` ${rp} `))
    })
    if (part) return part
  }
  return mine.find((r) => !norm(r.product)) ?? null
}

export type ProfitCell = { month: number; product: string; carrier: string; premium: number; spread: number | null; profit: number }

/** Each plan cell with its spread and expected agency profit (0 when no comp grid covers it). */
export function profitCells(targets: PlanTarget[], rates: CompRate[]): ProfitCell[] {
  const cache = new Map<string, number | null>()
  return targets.map((t) => {
    const k = `${norm(t.product)}\u0000${norm(t.carrier)}`
    if (!cache.has(k)) {
      const r = findRate(rates, t.product, t.carrier)
      cache.set(k, r ? spreadOf(r) : null)
    }
    const spread = cache.get(k) ?? null
    const premium = t.premium || 0
    return { month: t.month, product: t.product, carrier: t.carrier, premium, spread, profit: spread == null ? 0 : (premium * spread) / 100 }
  })
}

export type ProfitSummary = {
  /** Plan profit per month (index 0 = Jan). */
  monthly: number[]
  total: number
  planPremium: number
  /** Plan premium a comp grid covers, and the share of the plan that is. */
  coveredPremium: number
  coverage: number
  /** Premium-weighted spread across covered plan premium, in points. Null with nothing covered. */
  blendedSpread: number | null
  /** Product × carrier pairs in the plan with no comp grid. */
  uncovered: Array<{ product: string; carrier: string; premium: number }>
}

export function profitSummary(targets: PlanTarget[], rates: CompRate[]): ProfitSummary {
  const cells = profitCells(targets, rates)
  const monthly = new Array(12).fill(0)
  let planPremium = 0
  let coveredPremium = 0
  let total = 0
  const unc = new Map<string, { product: string; carrier: string; premium: number }>()
  for (const c of cells) {
    if (c.month >= 1 && c.month <= 12) monthly[c.month - 1] += c.profit
    planPremium += c.premium
    total += c.profit
    if (c.spread != null) coveredPremium += c.premium
    else {
      const k = `${norm(c.product)}\u0000${norm(c.carrier)}`
      const u = unc.get(k) ?? { product: c.product, carrier: c.carrier, premium: 0 }
      u.premium += c.premium
      unc.set(k, u)
    }
  }
  return {
    monthly,
    total,
    planPremium,
    coveredPremium,
    coverage: planPremium > 0 ? coveredPremium / planPremium : 0,
    blendedSpread: coveredPremium > 0 ? (total / coveredPremium) * 100 : null,
    uncovered: Array.from(unc.values()).sort((a, b) => b.premium - a.premium),
  }
}

/** Plan profit for a set of months (1..12), e.g. Q2 = [4, 5, 6]. */
export function profitForMonths(summary: ProfitSummary, months: number[]): number {
  return months.reduce((s, m) => s + (summary.monthly[m - 1] ?? 0), 0)
}

export type ProfitLine = {
  name: string
  planPremium: number
  planProfit: number
  /** Premium-weighted spread for this carrier/product, in points. */
  spread: number | null
  actualPremium: number | null
  /** Actual premium × this line's blended spread. An estimate: the book does not split carrier and product together. */
  actualProfit: number | null
  covered: boolean
}

/**
 * Plan and estimated actual profit by carrier or product. A line's spread is
 * weighted by its plan premium; with no plan premium it is the plain average
 * of its comp rows.
 */
export function profitBreakdown(targets: PlanTarget[], rates: CompRate[], dim: 'carrier' | 'product', actualRows: LabelActual[] | null): ProfitLine[] {
  const cells = profitCells(targets, rates)
  const by = new Map<string, { name: string; prem: number; profit: number; coveredPrem: number }>()
  for (const c of cells) {
    const name = (dim === 'carrier' ? c.carrier : c.product).trim() || '(none)'
    const k = norm(name)
    const cur = by.get(k) ?? { name, prem: 0, profit: 0, coveredPrem: 0 }
    cur.prem += c.premium
    cur.profit += c.profit
    if (c.spread != null) cur.coveredPrem += c.premium
    by.set(k, cur)
  }
  // Comp-grid names with no plan rows still show, so actual profit is visible for them.
  for (const r of rates) {
    const name = (dim === 'carrier' ? r.carrier : r.product).trim()
    if (name && !by.has(norm(name))) by.set(norm(name), { name, prem: 0, profit: 0, coveredPrem: 0 })
  }
  const out: ProfitLine[] = []
  for (const [k, v] of by) {
    let spread: number | null = v.coveredPrem > 0 ? (v.profit / v.coveredPrem) * 100 : null
    if (spread == null) {
      const mine = rates.filter((r) => norm(dim === 'carrier' ? r.carrier : r.product) === k).map(spreadOf).filter((s): s is number => s != null)
      spread = mine.length ? mine.reduce((a, b) => a + b, 0) / mine.length : null
    }
    let actualPremium: number | null = null
    if (actualRows) {
      const exact = actualRows.filter((r) => norm(r.label) === k)
      const hits = exact.length ? exact : actualRows.filter((r) => ` ${norm(r.label)} `.includes(` ${k} `))
      actualPremium = hits.length ? hits.reduce((s, r) => s + r.premium, 0) : null
    }
    out.push({
      name: v.name,
      planPremium: v.prem,
      planProfit: v.profit,
      spread,
      actualPremium,
      actualProfit: actualPremium != null && spread != null ? (actualPremium * spread) / 100 : null,
      covered: spread != null,
    })
  }
  return out.sort((a, b) => b.planProfit - a.planProfit || b.planPremium - a.planPremium || a.name.localeCompare(b.name))
}

/** Estimated actual profit per month: actual premium × the plan's blended spread. */
export function actualProfitMonthly(actualMonthly: number[], blendedSpread: number | null): number[] {
  return actualMonthly.map((v) => (blendedSpread == null ? 0 : ((v || 0) * blendedSpread) / 100))
}

/** "$5,000 marketing allowance" → 5000. The first dollar figure in the text, or null. */
export function allowanceDollars(unlocks: string): number | null {
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\b/.exec(unlocks || '')
  if (!m) return null
  let n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  if (/k/i.test(m[2] ?? '')) n *= 1_000
  if (/m/i.test(m[2] ?? '')) n *= 1_000_000
  return n
}

/** "Q2" / "q2 2027" / "second quarter" → [4,5,6]; "March" → [3]; "H1" → 1..6; "year"/"" → 1..12. */
export function monthsForPeriod(raw: string): { months: number[]; label: string } {
  const s = norm(raw)
  const q = /\bq([1-4])\b/.exec(s) ?? /\b(first|second|third|fourth) quarter\b/.exec(s)
  if (q) {
    const n = /^\d$/.test(q[1]) ? Number(q[1]) : ['first', 'second', 'third', 'fourth'].indexOf(q[1]) + 1
    return { months: [n * 3 - 2, n * 3 - 1, n * 3], label: `Q${n}` }
  }
  const h = /\bh([12])\b/.exec(s)
  if (h) return h[1] === '1' ? { months: [1, 2, 3, 4, 5, 6], label: 'H1' } : { months: [7, 8, 9, 10, 11, 12], label: 'H2' }
  const mi = MONTHS.findIndex((m) => new RegExp(`\\b${m.toLowerCase()}`).test(s))
  if (mi >= 0) return { months: [mi + 1], label: MONTHS[mi] }
  return { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], label: 'Full year' }
}

/** Carriers × products the comp grids cover, with when each carrier was last uploaded. */
export function coverageSummary(rates: CompRate[]): {
  carriers: number
  products: number
  rows: number
  byCarrier: Array<{ carrier: string; products: string[]; updated_at: string | null; upload_id: string | null }>
} {
  const by = new Map<string, { carrier: string; products: string[]; updated_at: string | null; upload_id: string | null }>()
  const prods = new Set<string>()
  for (const r of rates) {
    const k = norm(r.carrier)
    const cur = by.get(k) ?? { carrier: r.carrier, products: [], updated_at: null, upload_id: null }
    if (r.product) cur.products.push(r.product)
    prods.add(norm(r.product))
    if (r.updated_at && (!cur.updated_at || r.updated_at > cur.updated_at)) {
      cur.updated_at = r.updated_at
      cur.upload_id = r.upload_id ?? null
    }
    by.set(k, cur)
  }
  const byCarrier = Array.from(by.values())
    .map((c) => ({ ...c, products: c.products.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.carrier.localeCompare(b.carrier))
  return { carriers: by.size, products: prods.size, rows: rates.length, byCarrier }
}
