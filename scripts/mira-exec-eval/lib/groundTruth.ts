/**
 * Resolves a question's ground_truth spec into a concrete value, using the
 * same data layer Mira's pinnacle_revenue tool and the MCP server read
 * (lib/mcp/data.ts) so the grader and the dashboard agree.
 *
 * In --mock mode the same shapes are produced deterministically from the
 * question id so grade.ts can be exercised end to end without a database.
 */
import type { GroundTruth, LineFilter, WindowInput } from './types'
import { rng } from './util'

export type GTValue =
  | { kind: 'number'; value: number; unit: 'usd' | 'count' | 'pct'; label: string; window?: { start: string; end: string }; empty: boolean; extra?: Record<string, unknown> }
  | { kind: 'ranking'; names: string[]; rows: Array<{ name: string; premium: number; policies: number }>; top_n: number; label: string; empty: boolean }
  | { kind: 'compare'; a: number; b: number; a_label: string; b_label: string; delta_pct: number | null; b_empty: boolean; a_empty: boolean; unit: 'usd' | 'count' | 'pct' }
  | { kind: 'lines'; values: Record<string, number>; total: number; label: string; unit: 'usd' | 'count'; empty: boolean }
  | { kind: 'trend'; months: Array<{ month: string; premium: number; policies: number }>; label: string; empty: boolean }
  | { kind: 'entity'; found: boolean; name: string; value: number; rank: number | null; suggestions: string[]; label: string }
  | { kind: 'freshness'; last_sync: string | null; earliest: string | null; latest: string | null; has_2025: boolean }
  | { kind: 'none'; reason: string }
  | { kind: 'unavailable'; reason: string }

type DataModule = typeof import('@/lib/mcp/data')
type LoaderT = InstanceType<DataModule['Loader']>

export type GTContext = { mock: true; seed: number } | { mock: false; data: DataModule; L: LoaderT; lastSync: () => Promise<string | null> }

const cache = new Map<string, Promise<GTValue>>()
export function resolveGroundTruth(gt: GroundTruth | undefined, qid: string, ctx: GTContext): Promise<GTValue> {
  if (!gt) return Promise.resolve({ kind: 'none', reason: 'no ground truth' })
  if (gt.fn === 'none') return Promise.resolve({ kind: 'none', reason: gt.reason })
  const key = ctx.mock ? `${qid}:${JSON.stringify(gt)}` : JSON.stringify(gt)
  let p = cache.get(key)
  if (!p) {
    p = (ctx.mock ? Promise.resolve(mockGroundTruth(gt, qid, ctx.seed)) : realGroundTruth(gt, ctx)).catch((e) => ({ kind: 'unavailable', reason: String(e?.message ?? e) }) as GTValue)
    cache.set(key, p)
  }
  return p
}

const isMissingWindow = (w: WindowInput, today: string) => {
  if (w === 'last_year') return true
  if (typeof w === 'object') return w.end < `${today.slice(0, 4)}-01-01`
  return false
}

/** Equal-length window immediately before `w` (for movers), ignoring the YoY prior data.ts uses. */
function previousWindow(data: DataModule, w: WindowInput, today: string): { start: string; end: string; label: string } {
  const r = data.resolveWindow(w, today)
  if (w === 'mtd') {
    const start = data.addMonths(r.start, -1)
    const end = data.addMonths(today, -1)
    return { start, end, label: 'same days last month' }
  }
  if (w === 'qtd') return { start: data.addMonths(r.start, -3), end: data.addMonths(today, -3), label: 'same days last quarter' }
  if (w === 'ytd') return { start: r.start, end: r.end, label: 'n/a' }
  if (r.prior && !/last year/.test(r.prior.label)) return r.prior
  const len = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000) + 1
  return { start: data.addDays(r.start, -len), end: data.addDays(r.start, -1), label: `the ${len} days before` }
}

async function realGroundTruth(gt: GroundTruth, ctx: Extract<GTContext, { mock: false }>): Promise<GTValue> {
  const { data, L } = ctx
  const today = L.today
  const isNC = (x: unknown) => !!x && typeof x === 'object' && 'error' in (x as object)
  switch (gt.fn) {
    case 'period': {
      const rows = await L.series()
      const w = data.resolveWindow(gt.window, today)
      const t = data.sumRows(rows, w.start, w.end, gt.line)
      const empty = t.policies === 0 && t.premium === 0
      const value = gt.metric === 'premium' ? t.premium : gt.metric === 'policies' ? t.policies : gt.metric === 'funded_premium' ? t.funded_premium : t.policies ? t.premium / t.policies : 0
      return { kind: 'number', value: Math.round(value), unit: gt.metric === 'policies' ? 'count' : 'usd', label: w.label, window: { start: w.start, end: w.end }, empty: empty || isMissingWindow(gt.window, today) }
    }
    case 'funnel': {
      const st = await L.statuses()
      const w = data.resolveWindow(gt.window, today)
      const f = data.funnel(st, w, gt.line)
      const v = f[gt.metric]
      return { kind: 'number', value: v, unit: /_pct$/.test(gt.metric) ? 'pct' : 'count', label: w.label, window: { start: w.start, end: w.end }, empty: f.applications === 0, extra: { applications: f.applications, paid: f.paid, declined: f.declined, lapsed: f.lapsed, submitted: f.submitted, placement_pct: f.placement_pct } }
    }
    case 'breakdown': {
      const w = data.resolveWindow(gt.window, today)
      const res = await data.getBreakdown(L, { dim: gt.dim, window: gt.window, line: gt.line, limit: gt.order === 'bottom' ? 100 : Math.max(gt.top_n, 5) })
      if (isNC(res) || !('rows' in res)) return { kind: 'unavailable', reason: 'pinnacle not allowed for tenant' }
      let rows = res.rows.map((r) => ({ name: r.name, premium: r.issued_premium, policies: r.policies }))
      if (gt.order === 'bottom') rows = rows.filter((r) => r.premium > 0).sort((a, b) => a.premium - b.premium)
      rows = rows.slice(0, gt.top_n)
      return { kind: 'ranking', names: rows.map((r) => r.name), rows, top_n: gt.top_n, label: w.label, empty: rows.length === 0 }
    }
    case 'compare': {
      const res = await data.comparePeriods(L, { a: gt.a, b: gt.b, line: gt.line })
      if (isNC(res) || !('a' in res)) return { kind: 'unavailable', reason: 'pinnacle not allowed for tenant' }
      const pickv = (s: typeof res.a) => (gt.metric === 'premium' ? s.issued_premium : gt.metric === 'policies' ? s.policies_issued : s.placement_pct)
      const a = pickv(res.a)
      const b = pickv(res.b)
      const bEmpty = res.b.issued_premium === 0 && res.b.applications === 0
      const aEmpty = res.a.issued_premium === 0 && res.a.applications === 0
      return { kind: 'compare', a, b, a_label: res.a.window.label, b_label: res.b.window.label, delta_pct: bEmpty ? null : data.deltaPct(a, b), b_empty: bEmpty || isMissingWindow(gt.b, today), a_empty: aEmpty, unit: gt.metric === 'premium' ? 'usd' : gt.metric === 'policies' ? 'count' : 'pct' }
    }
    case 'line_compare': {
      const rows = await L.series()
      const w = data.resolveWindow(gt.window, today)
      const values: Record<string, number> = {}
      for (const line of ['Health', 'Life', 'Annuity'] as LineFilter[]) {
        const t = data.sumRows(rows, w.start, w.end, line)
        values[line] = gt.metric === 'premium' ? Math.round(t.premium) : t.policies
      }
      const total = Object.values(values).reduce((s, v) => s + v, 0)
      return { kind: 'lines', values, total, label: w.label, unit: gt.metric === 'premium' ? 'usd' : 'count', empty: total === 0 }
    }
    case 'trend': {
      const res = await data.getTrend(L, { window: gt.window, grain: 'month', line: gt.line })
      if (isNC(res) || !('buckets' in res)) return { kind: 'unavailable', reason: 'pinnacle not allowed for tenant' }
      const buckets = (res as { buckets: Array<{ bucket?: string; period?: string; issued_premium?: number; premium?: number; policies_issued?: number; policies?: number }> }).buckets
      const months = buckets.map((b) => ({ month: String(b.bucket ?? b.period ?? ''), premium: Number(b.issued_premium ?? b.premium ?? 0), policies: Number(b.policies_issued ?? b.policies ?? 0) }))
      return { kind: 'trend', months, label: (res as { window?: { label?: string } }).window?.label ?? '', empty: months.every((m) => m.premium === 0) }
    }
    case 'entity': {
      const res = await data.getEntity(L, { dim: gt.dim, name: gt.name, window: gt.window })
      if (isNC(res) || !('found' in res)) return { kind: 'unavailable', reason: 'pinnacle not allowed for tenant' }
      if (!res.found) return { kind: 'entity', found: false, name: gt.name, value: 0, rank: null, suggestions: (res as { suggestions?: string[] }).suggestions ?? [], label: '' }
      const r = res as { name?: string; issued_premium?: number; rank?: number; window?: { label?: string } }
      return { kind: 'entity', found: true, name: r.name ?? gt.name, value: r.issued_premium ?? 0, rank: r.rank ?? null, suggestions: [], label: r.window?.label ?? '' }
    }
    case 'movers': {
      const w = data.resolveWindow(gt.window, today)
      const prev = previousWindow(data, gt.window, today)
      const { fetchBreakdown } = await import('@/lib/pinnacle/rollup')
      const [now, before] = await Promise.all([fetchBreakdown(gt.dim, gt.line, w.start, w.end, 500), fetchBreakdown(gt.dim, gt.line, prev.start, prev.end, 500)])
      const bm = new Map(before.map((b) => [b.label, b.premium]))
      const deltas = now.map((n) => ({ name: n.label, premium: n.premium, policies: n.policies, delta: n.premium - (bm.get(n.label) ?? 0) }))
      for (const b of before) if (!now.find((n) => n.label === b.label)) deltas.push({ name: b.label, premium: 0, policies: 0, delta: -b.premium })
      deltas.sort((x, y) => (gt.direction === 'up' ? y.delta - x.delta : x.delta - y.delta))
      const top = deltas.filter((d) => (gt.direction === 'up' ? d.delta > 0 : d.delta < 0)).slice(0, 5)
      return { kind: 'ranking', names: top.map((t) => t.name), rows: top.map((t) => ({ name: t.name, premium: t.delta, policies: t.policies })), top_n: 5, label: `${w.label} vs ${prev.label}`, empty: top.length === 0 }
    }
    case 'pace': {
      const rows = await L.series()
      if (gt.horizon === 'month') {
        const w = data.resolveWindow('mtd', today)
        const mtd = data.sumRows(rows, w.start, w.end, gt.line).premium
        const day = Number(today.slice(8, 10))
        const dim = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
        const lm = data.resolveWindow('last_month', today)
        const last = data.sumRows(rows, lm.start, lm.end, gt.line).premium
        return { kind: 'number', value: Math.round((mtd / day) * dim), unit: 'usd', label: 'month to date', window: { start: w.start, end: w.end }, empty: mtd === 0, extra: { mtd: Math.round(mtd), day, days_in_month: dim, last_month: Math.round(last) } }
      }
      const w = data.resolveWindow('ytd', today)
      const ytd = data.sumRows(rows, w.start, w.end, gt.line).premium
      const doy = Math.round((Date.parse(today) - Date.parse(w.start)) / 86400000) + 1
      return { kind: 'number', value: Math.round((ytd / doy) * 365), unit: 'usd', label: 'year to date', window: { start: w.start, end: w.end }, empty: ytd === 0, extra: { ytd: Math.round(ytd), day_of_year: doy } }
    }
    case 'freshness': {
      const rows = await L.series()
      const dates = rows.map((r) => r.d).sort()
      return { kind: 'freshness', last_sync: await ctx.lastSync(), earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null, has_2025: dates.some((d) => d.startsWith('2025')) }
    }
  }
  return { kind: 'unavailable', reason: 'unknown fn' }
}

// ── mock ───────────────────────────────────────────────────────────────────

const MOCK_NAMES: Record<string, string[]> = {
  team: ['East Team', 'West Team', 'Summit Group', 'Legacy Partners', 'North Star Agency', 'Coastal Financial'],
  agent: ['Jordan Blake', 'Priya Natarajan', 'Marcus Reed', 'Alyssa Chen', 'Derek Holloway', 'Samantha Ortiz', 'Tyler Brooks', 'Nina Patel', 'Chris Dunham', 'Olivia Marsh', 'Ben Alvarez', 'Grace Kim', 'Victor Lane', 'Hannah Cole', 'Isaac Moreno'],
  carrier: ['Transamerica', 'Mutual of Omaha', 'Foresters', 'Americo', 'Aetna', 'Athene', 'Ethos', 'Nationwide', 'F&G'],
  state: ['Texas', 'Florida', 'California', 'Georgia', 'Arizona', 'North Carolina', 'Ohio', 'Tennessee', 'Nevada', 'Michigan'],
  product: ['IUL', 'Term', 'Whole Life', 'Final Expense', 'Fixed Index Annuity', 'Medicare Supplement', 'MYGA', 'Hospital Indemnity'],
}
const MOCK_TODAY = '2026-10-08'
const MOCK_MONTH_PREMIUM: Record<string, number> = { '2026-01': 24_100_000, '2026-02': 26_800_000, '2026-03': 31_400_000, '2026-04': 29_900_000, '2026-05': 33_200_000, '2026-06': 35_600_000, '2026-07': 28_300_000, '2026-08': 26_700_000, '2026-09': 20_400_000, '2026-10': 3_100_000 }
function mockWindow(w: WindowInput): { start: string; end: string; label: string } {
  const t = MOCK_TODAY
  if (typeof w === 'object') return { ...w, label: `${w.start} to ${w.end}` }
  switch (w) {
    case 'mtd': return { start: '2026-10-01', end: t, label: 'month to date' }
    case 'qtd': return { start: '2026-10-01', end: t, label: 'quarter to date' }
    case 'ytd': return { start: '2026-01-01', end: t, label: 'year to date' }
    case 'last_month': return { start: '2026-09-01', end: '2026-09-30', label: 'last month' }
    case 'last_year': return { start: '2025-01-01', end: '2025-12-31', label: 'calendar 2025' }
    case '3m': return { start: '2026-07-09', end: t, label: 'trailing 3 months' }
    case '6m': return { start: '2026-04-09', end: t, label: 'trailing 6 months' }
    case '12m': return { start: '2025-10-09', end: t, label: 'trailing 12 months' }
    default: return { start: '2026-01-01', end: t, label: 'all time' }
  }
}
function mockPremium(w: WindowInput, line: LineFilter): { premium: number; policies: number } {
  const mw = mockWindow(w)
  let premium = 0
  for (const [m, v] of Object.entries(MOCK_MONTH_PREMIUM)) {
    const ms = `${m}-01`
    const me = `${m}-31`
    if (me < mw.start || ms > mw.end) continue
    // partial-month proration
    const dayStart = ms < mw.start ? Number(mw.start.slice(8, 10)) : 1
    const dayEnd = me > mw.end && mw.end.startsWith(m) ? Number(mw.end.slice(8, 10)) : 30
    premium += v * Math.max(0, dayEnd - dayStart + 1) / 30
  }
  const lineShare = line === 'All' ? 1 : line === 'Life' ? 0.62 : line === 'Health' ? 0.26 : 0.12
  premium *= lineShare
  const policies = Math.round(premium / (line === 'Annuity' ? 48_000 : line === 'Health' ? 2_100 : 3_400))
  return { premium: Math.round(premium), policies }
}

export function mockGroundTruth(gt: GroundTruth, qid: string, seed: number): GTValue {
  const r = rng(seed + [...qid].reduce((s, c) => s + c.charCodeAt(0), 0))
  switch (gt.fn) {
    case 'period': {
      const mw = mockWindow(gt.window)
      const t = mockPremium(gt.window, gt.line)
      const empty = mw.end < '2026-01-01' || t.premium === 0
      const value = gt.metric === 'premium' ? t.premium : gt.metric === 'policies' ? t.policies : gt.metric === 'funded_premium' ? Math.round(t.premium * 0.71) : t.policies ? Math.round(t.premium / t.policies) : 0
      return { kind: 'number', value: empty ? 0 : value, unit: gt.metric === 'policies' ? 'count' : 'usd', label: mw.label, window: mw, empty }
    }
    case 'funnel': {
      const mw = mockWindow(gt.window)
      const t = mockPremium(gt.window, gt.line)
      const apps = t.policies
      const paid = Math.round(apps * 0.78)
      const declined = Math.round(apps * 0.09)
      const lapsed = Math.round(apps * 0.04)
      const submitted = apps - paid - declined - lapsed
      const f: Record<string, number> = { applications: apps, paid, declined, lapsed, submitted, placement_pct: apps ? Math.round((paid / apps) * 1000) / 10 : 0, decline_pct: apps ? Math.round((declined / apps) * 1000) / 10 : 0, lapse_pct: apps ? Math.round((lapsed / apps) * 1000) / 10 : 0 }
      return { kind: 'number', value: f[gt.metric], unit: /_pct$/.test(gt.metric) ? 'pct' : 'count', label: mw.label, window: mw, empty: apps === 0, extra: f }
    }
    case 'breakdown':
    case 'movers': {
      const mw = mockWindow(gt.window)
      const names = [...MOCK_NAMES[gt.dim]].sort(() => r() - 0.5)
      const total = mockPremium(gt.window, gt.line).premium
      const n = gt.fn === 'breakdown' ? gt.top_n : 5
      const rows = names.slice(0, n).map((name, i) => ({ name, premium: Math.round((total * 0.3) / (i + 1.5)), policies: Math.round(80 / (i + 1)) }))
      return { kind: 'ranking', names: rows.map((x) => x.name), rows, top_n: n, label: mw.label, empty: total === 0 }
    }
    case 'compare': {
      const A = mockPremium(gt.a, gt.line)
      const B = mockPremium(gt.b, gt.line)
      const va = gt.metric === 'premium' ? A.premium : gt.metric === 'policies' ? A.policies : 78.2
      const vb = gt.metric === 'premium' ? B.premium : gt.metric === 'policies' ? B.policies : 76.9
      const bEmpty = mockWindow(gt.b).end < '2026-01-01' || vb === 0
      return { kind: 'compare', a: va, b: bEmpty ? 0 : vb, a_label: mockWindow(gt.a).label, b_label: mockWindow(gt.b).label, delta_pct: bEmpty ? null : Math.round(((va - vb) / vb) * 1000) / 10, b_empty: bEmpty, a_empty: va === 0, unit: gt.metric === 'premium' ? 'usd' : gt.metric === 'policies' ? 'count' : 'pct' }
    }
    case 'line_compare': {
      const values: Record<string, number> = {}
      for (const l of ['Health', 'Life', 'Annuity'] as LineFilter[]) {
        const t = mockPremium(gt.window, l)
        values[l] = gt.metric === 'premium' ? t.premium : t.policies
      }
      const total = Object.values(values).reduce((s, v) => s + v, 0)
      return { kind: 'lines', values, total, label: mockWindow(gt.window).label, unit: gt.metric === 'premium' ? 'usd' : 'count', empty: total === 0 }
    }
    case 'trend': {
      const mw = mockWindow(gt.window)
      const months = Object.entries(MOCK_MONTH_PREMIUM).filter(([m]) => `${m}-31` >= mw.start && `${m}-01` <= mw.end).map(([m, v]) => ({ month: m, premium: Math.round(v * (gt.line === 'All' ? 1 : gt.line === 'Life' ? 0.62 : gt.line === 'Health' ? 0.26 : 0.12)), policies: Math.round(v / 3400) }))
      return { kind: 'trend', months, label: mw.label, empty: months.length === 0 }
    }
    case 'entity': {
      const found = gt.exists === false ? false : true
      const names = MOCK_NAMES[gt.dim]
      return { kind: 'entity', found, name: gt.name, value: found ? Math.round(mockPremium(gt.window, 'All').premium * (0.04 + r() * 0.1)) : 0, rank: found ? 1 + Math.floor(r() * 8) : null, suggestions: found ? [] : names.slice(0, 3), label: mockWindow(gt.window).label }
    }
    case 'pace': {
      if (gt.horizon === 'month') {
        const mtd = mockPremium('mtd', gt.line).premium
        return { kind: 'number', value: Math.round((mtd / 8) * 31), unit: 'usd', label: 'month to date', empty: false, extra: { mtd, day: 8, days_in_month: 31, last_month: mockPremium('last_month', gt.line).premium } }
      }
      const ytd = mockPremium('ytd', gt.line).premium
      return { kind: 'number', value: Math.round((ytd / 281) * 365), unit: 'usd', label: 'year to date', empty: false, extra: { ytd, day_of_year: 281 } }
    }
    case 'freshness':
      return { kind: 'freshness', last_sync: '2026-10-08T05:12:00Z', earliest: '2026-01-02', latest: '2026-10-07', has_2025: false }
    case 'none':
      return { kind: 'none', reason: gt.reason }
  }
}
