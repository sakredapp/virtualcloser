/**
 * Uploads for the Sales Plan (the plan itself, and comp grids): the drafts a
 * file is read into, the rule-based readers for tidy sheets, and the review
 * step (what was understood, what needs fixing, one-click fixes). Pure; no
 * server imports, so the review runs in the browser too and nothing is saved
 * until the executive presses Save.
 */
import { MONTHS, norm, parseAmount, type PlanTarget } from './shared'
import { matchName, uniqueNames } from './match'
import type { AgentLevel, CompRate } from './comp'

export type UploadKind = 'plan' | 'comp'
export type UploadSource = 'xlsx' | 'xls' | 'csv' | 'pdf' | 'sheet'

/** One sheet of a workbook (or the one CSV), as rows of cell text. */
export type Table = { name: string; rows: string[][] }

export type PlanDraftRow = {
  id: number
  /** Year the file put on the row, when it said one. */
  year: number | null
  /** 1..12, or null when the file gave a yearly figure with no month. */
  month: number | null
  product: string
  carrier: string
  premium: number | null
  policies: number | null
  /** Where it came from, for the review ("Plan 2027, row 7"). */
  src: string
}

export type CompDraftRow = {
  id: number
  product: string
  carrier: string
  /** Agency contract level, percent. */
  agency_rate: number | null
  agent_levels: AgentLevel[]
  src: string
}

/** A total the file itself states, so the review can check the rows add up to it. */
export type StatedTotal = {
  label: string
  value: number
  month: number | null
  product: string | null
  carrier: string | null
  src: string
}

type DraftBase = {
  filename: string
  source: UploadSource
  readBy: 'rules' | 'claude'
  /** What reading the file with Claude cost (USD), 0 for the rule reader. */
  costUsd: number
  /** One-line notes on how it was read ("Rates were decimals; read as percents"). */
  notes: string[]
}
export type PlanDraft = DraftBase & { kind: 'plan'; year: number; rows: PlanDraftRow[]; totals: StatedTotal[] }
export type CompDraft = DraftBase & { kind: 'comp'; rows: CompDraftRow[] }
export type Draft = PlanDraft | CompDraft

// ── Months in headers ────────────────────────────────────────────────────

/** "Jan", "January 2027", "Jan-27", "2027-01", "1/2027", "1/1/27" → { month, year }. */
export function parseMonthYear(raw: unknown): { month: number; year: number | null } | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s || s.length > 24) return null
  const yy = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s)
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { month: Number(m[2]), year: Number(m[1]) } : null
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { month: Number(m[1]), year: yy(m[3]) } : null
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { month: Number(m[1]), year: Number(m[2]) } : null
  m = /^([a-z]{3,9})\.?(?:[ ,'’-]+(\d{2}|\d{4}))?$/.exec(s)
  if (m) {
    const i = MONTHS.findIndex((mo) => m![1].startsWith(mo.toLowerCase()))
    const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    if (i < 0 || !full[i].startsWith(m[1])) return null
    return { month: i + 1, year: m[2] ? yy(m[2]) : null }
  }
  if (/^\d{1,2}$/.test(s)) return null // bare numbers in a header row are not months
  return null
}

const isTotalLabel = (s: string) => /^(grand\s+)?(sub)?total\b|^sum\b|\btotals?$/i.test(s.trim())

/** The header row: the first of the top rows that names its columns. */
function findHeader(rows: string[][], test: (cells: string[]) => boolean): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (test(rows[i].map((c) => c.toLowerCase().trim()))) return i
  return -1
}

const colOf = (head: string[], ...names: RegExp[]) => head.findIndex((h) => names.some((re) => re.test(h)))

// ── Rule reader: plan ────────────────────────────────────────────────────

export type RuleRead<T> = { rows: T[]; totals: StatedTotal[]; dataRows: number; usedRows: number; ok: boolean; why?: string }

/**
 * Tidy plan sheets: months across (Product, Carrier, [Measure], Jan … Dec,
 * [Total]) or one row per month (Month, Product, Carrier, Premium, [Policies]).
 * `ok` is false when the layout is not one of those; the caller then asks Claude.
 */
export function readPlanTable(t: Table, idStart = 1): RuleRead<PlanDraftRow> {
  const out: PlanDraftRow[] = []
  const totals: StatedTotal[] = []
  let id = idStart
  const rows = t.rows
  const isProduct = /^(product|line|plan|lob|product line|line of business)\b/
  const isCarrier = /^(carrier|company|insurer|carrier name)\b/
  const h = findHeader(rows, (c) => c.some((x) => isProduct.test(x) || isCarrier.test(x)) && (c.filter((x) => parseMonthYear(x)).length >= 1 || c.some((x) => /^(month|period|date)\b/.test(x))))
  if (h < 0) return { rows: [], totals: [], dataRows: 0, usedRows: 0, ok: false, why: 'no header with product/carrier and months' }
  const head = rows[h].map((x) => x.toLowerCase().trim())
  const iProduct = colOf(head, isProduct)
  const iCarrier = colOf(head, isCarrier)
  const iMeasure = colOf(head, /^(measure|metric|type)\b/)
  const iYear = colOf(head, /^(year|plan year|fy)\b/)
  const iMonth = colOf(head, /^(month|period|date)\b/)
  const monthCols = head
    .map((x, i) => ({ i, my: i === iProduct || i === iCarrier ? null : parseMonthYear(x) }))
    .filter((x) => x.my != null) as Array<{ i: number; my: { month: number; year: number | null } }>
  const iRowTotal = colOf(head, /^(total|year|annual|fy total|full year|ytd total)\b/)
  const label = (r: number) => `${t.name}, row ${r + 1}`
  let dataRows = 0
  let usedRows = 0

  if (monthCols.length >= 1 && iMonth === -1) {
    // Wide: months across.
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r]
      const nums = monthCols.map(({ i }) => parseAmount(row[i]))
      if (nums.every((v) => v == null)) continue
      dataRows++
      const product = iProduct >= 0 ? (row[iProduct] ?? '').trim() : ''
      const carrier = iCarrier >= 0 ? (row[iCarrier] ?? '').trim() : ''
      const measure = (iMeasure >= 0 ? row[iMeasure] ?? '' : '').toLowerCase()
      const field = /polic|count|units?|apps?/.test(measure) ? 'policies' : 'premium'
      if (isTotalLabel(product) || isTotalLabel(carrier) || (!product && !carrier && row.some((c) => isTotalLabel(c)))) {
        if (field === 'premium') {
          const scopeProduct = isTotalLabel(carrier) && product && !isTotalLabel(product) ? product : null
          const scopeCarrier = isTotalLabel(product) && carrier && !isTotalLabel(carrier) ? carrier : null
          monthCols.forEach(({ my }, k) => {
            if (nums[k] != null) totals.push({ label: `${[scopeProduct, scopeCarrier].filter(Boolean).join(' ') || 'Total'} ${MONTHS[my.month - 1]}`, value: nums[k]!, month: my.month, product: scopeProduct, carrier: scopeCarrier, src: label(r) })
          })
        }
        usedRows++
        continue
      }
      if (!product && !carrier) continue
      usedRows++
      monthCols.forEach(({ my }, k) => {
        const v = nums[k]
        if (v == null) return
        out.push({ id: id++, year: my.year ?? (iYear >= 0 ? Number(row[iYear]) || null : null), month: my.month, product, carrier, premium: field === 'premium' ? v : null, policies: field === 'policies' ? v : null, src: label(r) })
      })
      const stated = iRowTotal >= 0 && !monthCols.some((c) => c.i === iRowTotal) ? parseAmount(row[iRowTotal]) : null
      if (stated != null && field === 'premium') totals.push({ label: `${[product, carrier].filter(Boolean).join(' · ')} year total`, value: stated, month: null, product, carrier, src: label(r) })
    }
  } else if (iMonth >= 0) {
    // Long: one row per month.
    const iPremium = colOf(head, /^(premium|annual premium|target premium|ip|target|amount|annualized premium|ap)\b/)
    const iPolicies = colOf(head, /^(policies|policy count|count|units|apps|applications)\b/)
    if (iPremium === -1 && iPolicies === -1) return { rows: [], totals: [], dataRows: 0, usedRows: 0, ok: false, why: 'no premium column' }
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r]
      const prem = iPremium >= 0 ? parseAmount(row[iPremium]) : null
      const pol = iPolicies >= 0 ? parseAmount(row[iPolicies]) : null
      if (prem == null && pol == null) continue
      dataRows++
      const product = iProduct >= 0 ? (row[iProduct] ?? '').trim() : ''
      const carrier = iCarrier >= 0 ? (row[iCarrier] ?? '').trim() : ''
      const rawMonth = row[iMonth] ?? ''
      if (isTotalLabel(rawMonth) || isTotalLabel(product) || isTotalLabel(carrier)) {
        if (prem != null) totals.push({ label: 'Total', value: prem, month: null, product: null, carrier: null, src: label(r) })
        usedRows++
        continue
      }
      if (!product && !carrier) continue
      const my = parseMonthYear(rawMonth) ?? (/^\d{1,2}$/.test(rawMonth.trim()) && Number(rawMonth) >= 1 && Number(rawMonth) <= 12 ? { month: Number(rawMonth), year: null } : null)
      usedRows++
      out.push({ id: id++, year: my?.year ?? (iYear >= 0 ? Number(row[iYear]) || null : null), month: my?.month ?? null, product, carrier, premium: prem, policies: pol, src: label(r) })
    }
  } else {
    return { rows: [], totals: [], dataRows: 0, usedRows: 0, ok: false, why: 'no month columns' }
  }
  const ok = out.length > 0 && usedRows >= Math.max(1, Math.ceil(dataRows * 0.8))
  return { rows: out, totals, dataRows, usedRows, ok, why: ok ? undefined : 'rows did not line up with the header' }
}

/** Merge premium and policy rows for the same cell (wide sheets put them on separate lines). */
export function mergePlanRows(rows: PlanDraftRow[]): PlanDraftRow[] {
  const out: PlanDraftRow[] = []
  const idx = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.year ?? ''}\u0000${r.month ?? ''}\u0000${norm(r.product)}\u0000${norm(r.carrier)}`
    const at = idx.get(k)
    if (at != null) {
      const cur = out[at]
      // A premium-only row meeting a policies-only row is one cell, not a duplicate.
      if (cur.premium == null && r.premium != null && r.policies == null) {
        cur.premium = r.premium
        continue
      }
      if (cur.policies == null && r.policies != null && r.premium == null) {
        cur.policies = r.policies
        continue
      }
    }
    idx.set(k, out.length)
    out.push({ ...r })
  }
  return out
}

// ── Rule reader: comp grid ───────────────────────────────────────────────

/**
 * Tidy comp grids: Carrier, [Product], an agency column (Agency / Contract /
 * Street / Our level / Comp), then one column per agent level. Anything else
 * goes to Claude.
 */
export function readCompTable(t: Table, idStart = 1): RuleRead<CompDraftRow> {
  const rows = t.rows
  const isCarrier = /^(carrier|company|insurer)\b/
  const isAgency = /(agency|contract( level)?|street|our (level|rate|comp)|imo|fmo|gross|total comp|top level)/
  const h = findHeader(rows, (c) => c.some((x) => isCarrier.test(x)) && c.some((x) => isAgency.test(x)))
  if (h < 0) return { rows: [], totals: [], dataRows: 0, usedRows: 0, ok: false, why: 'no header with carrier and agency level' }
  const head = rows[h].map((x) => x.toLowerCase().trim())
  const iCarrier = colOf(head, isCarrier)
  const iProduct = colOf(head, /^(product|plan|line|lob)\b/)
  const iAgency = head.findIndex((x, i) => i !== iCarrier && i !== iProduct && isAgency.test(x))
  const levelCols = head
    .map((x, i) => ({ i, name: rows[h][i].trim() }))
    .filter(({ i, name }) => i !== iCarrier && i !== iProduct && i !== iAgency && name && !/\b(notes?|comments?|effective|date|states?|age|ages|issue|band|chargeback|advance)\b/i.test(name))
  const label = (r: number) => `${t.name}, row ${r + 1}`
  const out: CompDraftRow[] = []
  let id = idStart
  let dataRows = 0
  let usedRows = 0
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r]
    const carrier = (row[iCarrier] ?? '').trim()
    const agency = parseAmount(row[iAgency])
    const levels: AgentLevel[] = []
    for (const c of levelCols) {
      const v = parseAmount(row[c.i])
      if (v != null) levels.push({ level: c.name, rate: v })
    }
    if (agency == null && levels.length === 0) continue
    dataRows++
    if (!carrier || isTotalLabel(carrier)) continue
    usedRows++
    out.push({ id: id++, carrier, product: iProduct >= 0 ? (row[iProduct] ?? '').trim() : '', agency_rate: agency, agent_levels: levels, src: label(r) })
  }
  const ok = out.length > 0 && usedRows >= Math.max(1, Math.ceil(dataRows * 0.8))
  return { rows: out, totals: [], dataRows, usedRows, ok, why: ok ? undefined : 'rows did not line up with the header' }
}

/** Rates written as decimals (1.10 for 110%) across the whole sheet → percents. */
export function normaliseRateScale(rows: CompDraftRow[]): { rows: CompDraftRow[]; scaled: boolean } {
  const all = rows.flatMap((r) => [r.agency_rate, ...r.agent_levels.map((l) => l.rate)]).filter((v): v is number => v != null && v > 0)
  if (all.length === 0 || Math.max(...all) > 3) return { rows, scaled: false }
  const x = (v: number) => Math.round(v * 100 * 1000) / 1000
  return {
    rows: rows.map((r) => ({ ...r, agency_rate: r.agency_rate == null ? null : x(r.agency_rate), agent_levels: r.agent_levels.map((l) => ({ ...l, rate: x(l.rate) })) })),
    scaled: true,
  }
}

// ── Review ───────────────────────────────────────────────────────────────

export type IssueType =
  | 'unknown_carrier'
  | 'unknown_product'
  | 'missing_month'
  | 'other_year'
  | 'rate_high'
  | 'duplicate'
  | 'total_mismatch'
  | 'no_rate'
  | 'no_payout'
  | 'negative_spread'
  | 'missing_name'

export type Fix = { id: string; label: string }

export type Issue = {
  id: string
  type: IssueType
  title: string
  detail: string
  rowIds: number[]
  /** One-click fixes, best first. "skip" is always offered as well. */
  fixes: Fix[]
  skipLabel: string
}

export type NameMatchLine = { field: 'carrier' | 'product'; raw: string; to: string; rows: number }

export type Review = {
  /** Names in the file that were matched to a known name, spelling changed. */
  matched: NameMatchLine[]
  /** Names that already match exactly. */
  exact: { carriers: number; products: number }
  issues: Issue[]
}

export type Known = { carriers: string[]; products: string[] }

const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pctS = (n: number) => `${Math.round(n * 100) / 100}%`

/** Names as they will be saved, after fuzzy matches (unless kept as typed). */
function nameMaps(names: string[], known: string[], field: 'carrier' | 'product', counts: Map<string, number>) {
  const map = new Map<string, string>()
  const matched: NameMatchLine[] = []
  const unknown: Array<{ raw: string; suggestion: string | null }> = []
  let exact = 0
  for (const raw of names) {
    if (!raw.trim()) continue
    const m = matchName(raw, known)
    if (m.kind === 'exact' && m.name && m.name !== raw.trim()) {
      // Same name, other spelling ("HEALTH" → "Health"): saved as the known spelling.
      map.set(raw, m.name)
      matched.push({ field, raw, to: m.name, rows: counts.get(raw) ?? 0 })
    } else if (m.kind === 'exact') {
      exact++
      map.set(raw, m.name ?? raw)
    } else if (m.kind === 'fuzzy' && m.name) {
      map.set(raw, m.name)
      matched.push({ field, raw, to: m.name, rows: counts.get(raw) ?? 0 })
    } else if (known.length > 0) {
      unknown.push({ raw, suggestion: m.name })
    }
  }
  return { map, matched, unknown, exact }
}

function countBy<T>(rows: T[], key: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return m
}

function unknownIssues(field: 'carrier' | 'product', list: Array<{ raw: string; suggestion: string | null }>, rows: Array<{ id: number; carrier: string; product: string }>): Issue[] {
  return list.map(({ raw, suggestion }) => {
    const ids = rows.filter((r) => r[field] === raw).map((r) => r.id)
    const fixes: Fix[] = []
    // "Add as new" first: below the auto-match bar the guess is often a different
    // carrier ("Carrier D" vs "Carrier A"), and merging two carriers' rates is worse than a new name.
    fixes.push({ id: 'new', label: `Add "${raw}" as a new ${field}` })
    if (suggestion) fixes.push({ id: `use:${suggestion}`, label: `It's ${suggestion}` })
    return {
      id: `${field}:${norm(raw)}`,
      type: field === 'carrier' ? 'unknown_carrier' : 'unknown_product',
      title: `Unknown ${field}: ${raw}`,
      detail: `${ids.length} ${ids.length === 1 ? 'row' : 'rows'}. ${suggestion ? `Closest known name is ${suggestion}.` : `Not in the book of business or anything uploaded before.`}`,
      rowIds: ids,
      fixes,
      skipLabel: 'Skip these rows',
    } satisfies Issue
  })
}

/** Build the review for a draft: fuzzy name matches and every problem with its fixes. */
export function buildReview(draft: Draft, known: Known): Review {
  const issues: Issue[] = []
  const rows = draft.rows as Array<PlanDraftRow | CompDraftRow>
  const carriers = uniqueNames(rows.map((r) => r.carrier))
  const products = uniqueNames(rows.map((r) => r.product))
  const rawCarriers = Array.from(new Set(rows.map((r) => r.carrier)))
  const rawProducts = Array.from(new Set(rows.map((r) => r.product)))
  const c = nameMaps(rawCarriers, known.carriers, 'carrier', countBy(rows, (r) => r.carrier))
  const p = nameMaps(rawProducts, known.products, 'product', countBy(rows, (r) => r.product))
  issues.push(...unknownIssues('carrier', c.unknown, rows), ...unknownIssues('product', p.unknown, rows))
  void carriers
  void products

  const finalName = (field: 'carrier' | 'product', raw: string) => (field === 'carrier' ? c.map : p.map).get(raw) ?? raw

  if (draft.kind === 'plan') {
    // Missing month: a yearly figure with no month.
    const noMonth = new Map<string, PlanDraftRow[]>()
    for (const r of draft.rows) {
      if (r.month != null) continue
      const k = `${norm(r.product)}\u0000${norm(r.carrier)}`
      noMonth.set(k, [...(noMonth.get(k) ?? []), r])
    }
    for (const [k, list] of noMonth) {
      const total = list.reduce((s, r) => s + (r.premium ?? 0), 0)
      const name = [list[0].product, list[0].carrier].filter(Boolean).join(' · ') || 'A row'
      issues.push({
        id: `month:${k}`,
        type: 'missing_month',
        title: `No month: ${name}`,
        detail: `${money0(total)} with no month on it (${list[0].src}).`,
        rowIds: list.map((r) => r.id),
        fixes: [{ id: 'spread', label: `Spread over 12 months (${money0(total / 12)} each)` }],
        skipLabel: 'Skip it',
      })
    }
    // Rows for another year.
    const other = draft.rows.filter((r) => r.year != null && r.year !== draft.year)
    if (other.length) {
      const years = Array.from(new Set(other.map((r) => r.year))).sort()
      issues.push({
        id: 'year',
        type: 'other_year',
        title: `${other.length} ${other.length === 1 ? 'row is' : 'rows are'} for ${years.join(', ')}`,
        detail: `You are loading the ${draft.year} plan.`,
        rowIds: other.map((r) => r.id),
        fixes: [{ id: 'use', label: `Count them in ${draft.year}` }],
        skipLabel: 'Leave them out',
      })
    }
    // Duplicates: the same month × product × carrier more than once with different numbers.
    const seen = new Map<string, PlanDraftRow[]>()
    for (const r of draft.rows) {
      if (r.month == null) continue
      const k = `${r.month}\u0000${norm(finalName('product', r.product))}\u0000${norm(finalName('carrier', r.carrier))}`
      seen.set(k, [...(seen.get(k) ?? []), r])
    }
    for (const [k, list] of seen) {
      if (list.length < 2) continue
      const prems = list.map((r) => r.premium ?? 0)
      if (prems.every((v) => v === prems[0]) && list.every((r) => r.policies === list[0].policies)) continue // identical: kept once, quietly
      const name = `${[list[0].product, list[0].carrier].filter(Boolean).join(' · ')}, ${MONTHS[(list[0].month ?? 1) - 1]}`
      issues.push({
        id: `dup:${k}`,
        type: 'duplicate',
        title: `Listed ${list.length} times: ${name}`,
        detail: `${prems.map(money0).join(' and ')} (${list.map((r) => r.src).join('; ')}).`,
        rowIds: list.map((r) => r.id),
        fixes: [
          { id: 'sum', label: `Add them (${money0(prems.reduce((a, b) => a + b, 0))})` },
          { id: 'first', label: `Keep ${money0(prems[0])}` },
          { id: 'last', label: `Keep ${money0(prems[prems.length - 1])}` },
        ],
        skipLabel: 'Skip all of them',
      })
    }
    // Stated totals that the rows don't add up to.
    for (const t of draft.totals) {
      const scope = draft.rows.filter(
        (r) =>
          (t.month == null || r.month === t.month) &&
          (!t.product || norm(r.product) === norm(t.product)) &&
          (!t.carrier || norm(r.carrier) === norm(t.carrier)) &&
          (r.year == null || r.year === draft.year),
      )
      const got = scope.reduce((s, r) => s + (r.premium ?? 0), 0)
      if (Math.abs(got - t.value) <= Math.max(1, Math.abs(t.value) * 0.005)) continue
      issues.push({
        id: `total:${t.src}:${t.label}`,
        type: 'total_mismatch',
        title: `Total doesn't add up: ${t.label}`,
        detail: `The file says ${money0(t.value)}; the rows add to ${money0(got)} (${t.src}).`,
        rowIds: scope.map((r) => r.id),
        fixes: [{ id: 'rows', label: `Use the rows (${money0(got)})` }],
        skipLabel: 'Leave these rows out',
      })
    }
  } else {
    for (const r of draft.rows) {
      const name = [r.carrier, r.product].filter(Boolean).join(' · ')
      if (r.agency_rate == null) {
        issues.push({ id: `norate:${r.id}`, type: 'no_rate', title: `No agency rate: ${name}`, detail: `Only agent levels were found (${r.src}).`, rowIds: [r.id], fixes: [], skipLabel: 'Skip this row' })
        continue
      }
      const high = [{ level: 'Agency', rate: r.agency_rate }, ...r.agent_levels].filter((l) => l.rate > 200)
      for (const l of high) {
        const fixes: Fix[] = []
        if (l.rate / 10 >= 20 && l.rate / 10 <= 200) fixes.push({ id: `div10:${l.level}`, label: `Use ${pctS(l.rate / 10)}` })
        if (l.rate / 100 >= 20 && l.rate / 100 <= 200) fixes.push({ id: `div100:${l.level}`, label: `Use ${pctS(l.rate / 100)}` })
        fixes.push({ id: `keep:${l.level}`, label: `Keep ${pctS(l.rate)}` })
        issues.push({ id: `high:${r.id}:${l.level}`, type: 'rate_high', title: `Rate over 200%: ${name}`, detail: `${l.level} is ${pctS(l.rate)} (${r.src}).`, rowIds: [r.id], fixes, skipLabel: 'Skip this row' })
      }
      if (r.agent_levels.length === 0) {
        issues.push({ id: `nopay:${r.id}`, type: 'no_payout', title: `No agent payout: ${name}`, detail: `Agency ${pctS(r.agency_rate)}, but no agent levels, so there is no spread yet (${r.src}).`, rowIds: [r.id], fixes: [{ id: 'keep', label: 'Keep the agency rate' }], skipLabel: 'Skip this row' })
      } else {
        const top = Math.max(...r.agent_levels.map((l) => l.rate))
        if (top > r.agency_rate && r.agency_rate <= 200) {
          issues.push({ id: `neg:${r.id}`, type: 'negative_spread', title: `Agents paid more than the agency gets: ${name}`, detail: `Agency ${pctS(r.agency_rate)}, top agent level ${pctS(top)} (${r.src}).`, rowIds: [r.id], fixes: [{ id: 'keep', label: 'Keep as is' }], skipLabel: 'Skip this row' })
        }
      }
    }
    const seen = new Map<string, CompDraftRow[]>()
    for (const r of draft.rows) {
      const k = `${norm(finalName('product', r.product))}\u0000${norm(finalName('carrier', r.carrier))}`
      seen.set(k, [...(seen.get(k) ?? []), r])
    }
    for (const [k, list] of seen) {
      if (list.length < 2) continue
      const same = list.every((r) => r.agency_rate === list[0].agency_rate && JSON.stringify(r.agent_levels) === JSON.stringify(list[0].agent_levels))
      if (same) continue
      const name = [list[0].carrier, list[0].product].filter(Boolean).join(' · ')
      issues.push({
        id: `dup:${k}`,
        type: 'duplicate',
        title: `Listed ${list.length} times: ${name}`,
        detail: `Agency ${list.map((r) => (r.agency_rate == null ? '—' : pctS(r.agency_rate))).join(' and ')} (${list.map((r) => r.src).join('; ')}).`,
        rowIds: list.map((r) => r.id),
        fixes: [
          { id: 'first', label: `Keep the first (${list[0].src})` },
          { id: 'last', label: `Keep the last (${list[list.length - 1].src})` },
        ],
        skipLabel: 'Skip all of them',
      })
    }
  }
  return { matched: [...c.matched, ...p.matched], exact: { carriers: c.exact, products: p.exact }, issues }
}

export type Choices = Record<string, string>

export type Applied =
  | { kind: 'plan'; targets: PlanTarget[]; skippedRows: number }
  | { kind: 'comp'; rates: CompRate[]; skippedRows: number }

/**
 * The rows that Save will write, after every choice. `choices[issue.id]` is a
 * fix id or 'skip'; `keepTyped` lists "carrier:raw" / "product:raw" names to
 * keep as typed instead of the fuzzy match. Undecided issues are treated as
 * skip (the page does not allow Save until each is decided).
 */
export function applyReview(draft: Draft, review: Review, choices: Choices, keepTyped: string[] = []): Applied {
  const keep = new Set(keepTyped)
  const rename = new Map<string, string>()
  for (const m of review.matched) if (!keep.has(`${m.field}:${m.raw}`)) rename.set(`${m.field}:${m.raw}`, m.to)
  const drop = new Set<number>()
  for (const is of review.issues) {
    const ch = choices[is.id] ?? 'skip'
    if (ch === 'skip') is.rowIds.forEach((id) => drop.add(id))
    if (ch.startsWith('use:') && (is.type === 'unknown_carrier' || is.type === 'unknown_product')) {
      const field = is.type === 'unknown_carrier' ? 'carrier' : 'product'
      const raw = is.title.replace(/^Unknown (carrier|product): /, '')
      rename.set(`${field}:${raw}`, ch.slice(4))
    }
  }
  const nm = (field: 'carrier' | 'product', raw: string) => rename.get(`${field}:${raw}`) ?? raw

  if (draft.kind === 'plan') {
    const year = draft.year
    const spreadIds = new Set<number>()
    const useYear = (choices['year'] ?? 'skip') === 'use'
    const dupChoice = new Map<number, string>()
    for (const is of review.issues) {
      const ch = choices[is.id] ?? 'skip'
      if (is.type === 'missing_month' && ch === 'spread') is.rowIds.forEach((id) => spreadIds.add(id))
      if (is.type === 'duplicate' && ch !== 'skip') is.rowIds.forEach((id) => dupChoice.set(id, ch))
    }
    const cells = new Map<string, PlanTarget & { _dup?: string }>()
    const put = (month: number, product: string, carrier: string, premium: number | null, policies: number | null, dup: string | undefined) => {
      const k = `${month}\u0000${norm(product)}\u0000${norm(carrier)}`
      const cur = cells.get(k)
      if (!cur) {
        cells.set(k, { year, month, product, carrier, premium: premium ?? 0, policies: policies == null ? null : Math.round(policies), _dup: dup })
        return
      }
      const mode = dup ?? cur._dup ?? 'last'
      if (mode === 'first') return
      if (mode === 'sum') {
        cur.premium += premium ?? 0
        if (policies != null) cur.policies = (cur.policies ?? 0) + Math.round(policies)
      } else {
        // last (and identical repeats)
        if (premium != null) cur.premium = premium
        if (policies != null) cur.policies = Math.round(policies)
      }
    }
    let skipped = 0
    for (const r of draft.rows) {
      if (drop.has(r.id)) {
        skipped++
        continue
      }
      if (r.year != null && r.year !== year && !useYear) {
        skipped++
        continue
      }
      const product = nm('product', r.product)
      const carrier = nm('carrier', r.carrier)
      if (r.month == null) {
        if (!spreadIds.has(r.id)) {
          skipped++
          continue
        }
        for (let m = 1; m <= 12; m++) put(m, product, carrier, r.premium == null ? null : r.premium / 12, r.policies == null ? null : r.policies / 12, undefined)
        continue
      }
      put(r.month, product, carrier, r.premium, r.policies, dupChoice.get(r.id))
    }
    const targets = Array.from(cells.values()).map(({ _dup, ...t }) => {
      void _dup
      return { ...t, premium: Math.round(t.premium * 100) / 100 }
    })
    return { kind: 'plan', targets, skippedRows: skipped }
  }

  // Comp
  const fixByRow = new Map<number, string[]>()
  const dupChoice = new Map<string, { mode: string; ids: number[] }>()
  for (const is of review.issues) {
    const ch = choices[is.id] ?? 'skip'
    if (ch === 'skip') continue
    if (is.type === 'rate_high') is.rowIds.forEach((id) => fixByRow.set(id, [...(fixByRow.get(id) ?? []), ch]))
    if (is.type === 'duplicate') dupChoice.set(is.id, { mode: ch, ids: is.rowIds })
  }
  const pickedDup = new Set<number>()
  const droppedDup = new Set<number>()
  for (const { mode, ids } of dupChoice.values()) {
    const keepId = mode === 'first' ? ids[0] : ids[ids.length - 1]
    pickedDup.add(keepId)
    ids.filter((id) => id !== keepId).forEach((id) => droppedDup.add(id))
  }
  const out = new Map<string, CompRate>()
  let skipped = 0
  for (const r of draft.rows) {
    if (drop.has(r.id) || droppedDup.has(r.id) || r.agency_rate == null) {
      skipped++
      continue
    }
    let agency = r.agency_rate
    let levels = r.agent_levels.map((l) => ({ ...l }))
    for (const f of fixByRow.get(r.id) ?? []) {
      const [op, level] = [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)]
      const div = op === 'div10' ? 10 : op === 'div100' ? 100 : 1
      if (div === 1) continue
      if (level === 'Agency') agency = agency / div
      else levels = levels.map((l) => (l.level === level ? { ...l, rate: l.rate / div } : l))
    }
    const product = nm('product', r.product)
    const carrier = nm('carrier', r.carrier)
    out.set(`${norm(product)}\u0000${norm(carrier)}`, { product, carrier, agency_rate: agency, payout_rate: null, payout_level: null, agent_levels: levels })
  }
  return { kind: 'comp', rates: Array.from(out.values()), skippedRows: skipped }
}

/** One line for the top of the review: what was found. */
export function draftSummary(draft: Draft): { rows: number; carriers: number; products: number; premium: number | null } {
  const rows = draft.rows as Array<PlanDraftRow | CompDraftRow>
  return {
    rows: rows.length,
    carriers: uniqueNames(rows.map((r) => r.carrier)).length,
    products: uniqueNames(rows.map((r) => r.product)).length,
    premium: draft.kind === 'plan' ? draft.rows.reduce((s, r) => s + (r.premium ?? 0), 0) : null,
  }
}
