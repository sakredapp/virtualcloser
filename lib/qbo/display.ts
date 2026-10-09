/**
 * QuickBooks figures for display and for Mira: pure, no node or server
 * imports, so client components can use it.
 */

export const QBO_NOT_SET_UP = "QuickBooks isn't set up yet"

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-03' → 'Mar 2026' (or 'Mar' with short). */
export function monthLabel(ym: string, short = false): string {
  const m = Number(ym.slice(5, 7))
  const name = MONTH_NAMES[m - 1] ?? ym
  return short ? name : `${name} ${ym.slice(0, 4)}`
}

// ── Display math ─────────────────────────────────────────────────────────

export type QboMonthRow = { month: string; income: number; expenses: number; cogs: number; net_income: number; gross_profit: number; other_income?: number; other_expenses?: number }

/** Total cost = cost of sales + operating expenses + other expenses. */
export const totalCost = (r: QboMonthRow) => r.cogs + r.expenses + (r.other_expenses ?? 0)
/** Net margin %, or null when there is no revenue to divide by. */
export const marginPct = (net: number, income: number): number | null => (income > 0 ? (net / income) * 100 : null)

export type QboPeriod = { label: string; from: string; to: string }

/** Calendar quarter before the one `todayIso` falls in. */
export function lastQuarter(todayIso: string): QboPeriod {
  const y = Number(todayIso.slice(0, 4))
  const m = Number(todayIso.slice(5, 7))
  const q = Math.floor((m - 1) / 3) + 1
  const pq = q === 1 ? 4 : q - 1
  const py = q === 1 ? y - 1 : y
  const fromM = (pq - 1) * 3 + 1
  return { label: `Q${pq} ${py}`, from: `${py}-${String(fromM).padStart(2, '0')}`, to: `${py}-${String(fromM + 2).padStart(2, '0')}` }
}

/** Resolve a spoken period into a month range. Unknown → last full quarter. */
export function resolvePeriod(raw: string, todayIso: string): QboPeriod {
  const s = raw.trim().toLowerCase()
  const y = Number(todayIso.slice(0, 4))
  const m = Number(todayIso.slice(5, 7))
  const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`
  const prev = (yy: number, mm: number, back: number) => {
    const t = yy * 12 + (mm - 1) - back
    return { y: Math.floor(t / 12), m: (t % 12) + 1 }
  }
  if (!s || s === 'last_quarter' || s === 'last quarter') return lastQuarter(todayIso)
  if (s === 'this_quarter' || s === 'this quarter' || s === 'qtd') {
    const q = Math.floor((m - 1) / 3) + 1
    return { label: `Q${q} ${y} to date`, from: ym(y, (q - 1) * 3 + 1), to: ym(y, m) }
  }
  if (s === 'last_month' || s === 'last month') {
    const p = prev(y, m, 1)
    return { label: `${MONTH_NAMES[p.m - 1]} ${p.y}`, from: ym(p.y, p.m), to: ym(p.y, p.m) }
  }
  if (s === 'this_month' || s === 'this month' || s === 'mtd') return { label: `${MONTH_NAMES[m - 1]} ${y} to date`, from: ym(y, m), to: ym(y, m) }
  if (s === 'ytd' || s === 'this_year' || s === 'this year') return { label: `${y} to date`, from: ym(y, 1), to: ym(y, m) }
  if (s === 'last_year' || s === 'last year') return { label: String(y - 1), from: ym(y - 1, 1), to: ym(y - 1, 12) }
  if (s === 'last_12_months' || s === 'ttm' || s === 'last 12 months') {
    const p = prev(y, m, 12)
    const e = prev(y, m, 1)
    return { label: 'Last 12 full months', from: ym(p.y, p.m), to: ym(e.y, e.m) }
  }
  const qm = /^q([1-4])\s*-?\s*(\d{4})$/.exec(s) || /^(\d{4})\s*-?\s*q([1-4])$/.exec(s)
  if (qm) {
    const first = /^q/.test(s)
    const qq = Number(first ? qm[1] : qm[2])
    const yy = Number(first ? qm[2] : qm[1])
    return { label: `Q${qq} ${yy}`, from: ym(yy, (qq - 1) * 3 + 1), to: ym(yy, (qq - 1) * 3 + 3) }
  }
  if (/^\d{4}$/.test(s)) return { label: s, from: `${s}-01`, to: `${s}-12` }
  if (/^\d{4}-\d{2}$/.test(s)) return { label: s, from: s, to: s }
  return lastQuarter(todayIso)
}

export type QboPanelData = {
  configured: boolean
  connected: boolean
  needsReconnect: boolean
  companyName: string | null
  environment: 'sandbox' | 'production' | null
  lastSyncAt: string | null
  lastSyncOk: boolean | null
  months: QboMonthRow[]
  expenseCategories: Array<{ category: string; amount: number }>
  topCustomers: Array<{ name: string; amount: number }>
  classes: Array<{ name: string; amount: number }>
}

/** Totals for a period from synced months. Pure, so Mira and the tests share it. */
export function summarizeQboPeriod(months: QboMonthRow[], period: QboPeriod) {
  const rows = months.filter((r) => r.month >= period.from && r.month <= period.to)
  const sum = (f: (r: QboMonthRow) => number) => Math.round(rows.reduce((a, r) => a + f(r), 0) * 100) / 100
  const revenue = sum((r) => r.income)
  const cogs = sum((r) => r.cogs)
  const grossProfit = sum((r) => r.gross_profit)
  const expenses = sum((r) => r.expenses + (r.other_expenses ?? 0))
  const otherIncome = sum((r) => r.other_income ?? 0)
  const netIncome = sum((r) => r.net_income)
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)
  return {
    period: period.label,
    from: period.from,
    to: period.to,
    monthsCovered: rows.map((r) => r.month),
    revenue,
    costOfSales: cogs,
    grossProfit,
    operatingAndOtherExpenses: expenses,
    otherIncome,
    netIncome,
    grossMarginPct: round1(marginPct(grossProfit, revenue)),
    netMarginPct: round1(marginPct(netIncome, revenue)),
  }
}
