'use client'

/**
 * ExecOverview — the owner's KPI surface, shared by the signed-in Overview
 * (`variant="home"`), the Team page (`variant="full"`: named agencies and
 * agents, ranked, plus where policies stand, policies by month and product
 * mix; none of the Overview's KPI cards) and the public demo.
 *
 * Labels match the SQL (owner, 10-08): `premium` is SUBMITTED premium (every
 * application's annual premium, no status filter) and `funded_premium` is
 * ISSUED premium (issue-paid). Placement = issued / submitted.
 *
 * Every card says what it covers and "Data through <date>". Trailing windows
 * end at the last day the book has data for, so a sync gap never shows up as
 * a fake drop. Year-over-year only turns on once the prior year has rows.
 * Nothing projects ("on pace for") unless the month reconciled to Airtable.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { BreakdownDim, BreakdownRow, DailyRow, StatusRow } from '@/lib/pinnacle/rollup'
import type { DashboardKpi, DashboardPrefs, DashboardTile, DashboardTimeframe } from '@/lib/dashboardPrefs'
import {
  TIMEFRAMES,
  cumulative,
  dailyForMonth,
  dataThroughOf,
  deltaWords,
  fmtCount,
  fmtMoney,
  fmtPct,
  funnelFor,
  monthSpanWindow,
  monthlySeries,
  mostMovedLine,
  parseDay,
  sumDays,
  timeframeMonths,
  timeframeWindow,
  todayUTC,
  yearHasData,
  delta as deltaOf,
  type Delta,
  type MonthPoint,
  type Timeframe,
  DAY,
} from '@/lib/pinnacle/kpis'
import { Columns, DayBars, Donut, INK, INK_TINT, INK_TINT_2, PaceMeter, RED, Sparkline, StackedArea, StageBars, WaveChart } from './charts'

export type BookInput = { baseId: string; label: string; isPinnacle: boolean; rows: DailyRow[] }
export type BreakdownMap = Partial<Record<BreakdownDim, BreakdownRow[]>>
export type LoadBreakdown = (dim: BreakdownDim, line: string, start: string, end: string, limit?: number) => Promise<BreakdownRow[]>

export type ExecOverviewProps = {
  pinnacleRows: DailyRow[]
  statusRows: StatusRow[]
  books: BookInput[]
  /** Breakdowns preloaded for the 12-month window (All lines). */
  breakdowns: BreakdownMap
  loadBreakdown?: LoadBreakdown
  variant: 'home' | 'full'
  lastSynced?: string | null
  syncError?: string | null
  tables?: Array<{ label: string; baseId: string; names: string[] }>
  /** ISO date to treat as "today" (the demo pins it). */
  now?: string
  /** Last day the book has data for (ISO). Derived from the rows when omitted. */
  dataThrough?: string | null
  /** True only when the current month reconciled to Airtable within 1%. Unlocks "on pace for". */
  reconciled?: boolean
  /** Where the home variant's "See everything" link goes. */
  performanceHref?: string
  /** Saved layout (tiles, timeframe, pinned KPIs, notes). Untouched prefs draw the full default layout. */
  prefs?: DashboardPrefs | null
}

const SCOPE = 'All teams · Health, Life, Annuity · Pinnacle master book'
const LINES = ['Health', 'Life', 'Annuity']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DIM_LABELS: Record<BreakdownDim, string> = {
  team: 'Top teams',
  agent: 'Top agents',
  carrier: 'Top carriers',
  state: 'Top states',
  product: 'Top products',
}
/** Default tile order when nothing has been customised. */
const DEFAULT_ORDER: DashboardTile[] = ['headline', 'kpis', 'premium_trend', 'product_mix', 'status_funnel', 'breakdowns', 'agency_books', 'notes']

type Tf = Timeframe | 'custom'

function tfFromPref(t: DashboardTimeframe | undefined): Timeframe {
  if (t === 'ytd' || t === '3m' || t === '6m' || t === '12m' || t === 'mtd') return t
  if (t === 'qtd') return '3m'
  return '12m'
}

function fmtDay(iso: string | null): string {
  if (!iso) return 'no data yet'
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`
}
function monthKey(y: number, m0: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}`
}

async function defaultLoad(dim: BreakdownDim, line: string, start: string, end: string, limit = 25): Promise<BreakdownRow[]> {
  const r = await fetch(`/api/pinnacle/breakdown?dim=${dim}&line=${line}&start=${start}&end=${end}&limit=${limit}`, { cache: 'no-store' })
  if (!r.ok) return []
  const j = (await r.json()) as { rows?: BreakdownRow[] }
  return j.rows ?? []
}

/** One glyph, from CSS only: up charcoal, down red, flat muted, none = no prior data. */
export function DeltaTag({ d, suffix }: { d: Delta; suffix?: string }) {
  const cls = d.pct == null ? 'cx-delta cx-delta-none' : `cx-delta cx-delta-${d.dir}`
  return (
    <span className={cls}>
      {deltaWords(d)}
      {suffix ? ` ${suffix}` : ''}
    </span>
  )
}

function Scope({ scope, through }: { scope: string; through: string | null }) {
  return (
    <div className="cx-scope">
      {scope} · Data through <b>{fmtDay(through)}</b>
    </div>
  )
}

function Kpi({ eyebrow, figure, sub, d, suffix, spark, color = INK, scope, through }: { eyebrow: string; figure: string; sub?: string; d: Delta; suffix?: string; spark: number[]; color?: string; scope: string; through: string | null }) {
  return (
    <div className="cx-panel">
      <div className="cx-eyebrow">{eyebrow}</div>
      <div className="cx-kpi-figure">{figure}</div>
      {sub && <div className="cx-kpi-sub">{sub}</div>}
      <div style={{ marginTop: 6 }}>
        <DeltaTag d={d} suffix={suffix} />
      </div>
      <Sparkline values={spark} color={color} style={{ marginTop: 10 }} />
      <Scope scope={scope} through={through} />
    </div>
  )
}

type TopRow = { label: string; premium: number; policies: number; placement: number | null; share: number; d: Delta }

function TopList({ rows, empty = 'Nothing in this window yet.' }: { rows: TopRow[]; empty?: string }) {
  if (rows.length === 0) return <p className="cx-takeaway">{empty}</p>
  const max = Math.max(1, ...rows.map((r) => r.premium))
  return (
    <ol className="cx-barlist">
      {rows.map((r, i) => (
        <li key={r.label}>
          <span className="bl-label">
            {r.label}
            <span className="bl-hint">
              {' '}· {fmtCount(r.policies)} policies · {fmtPct(r.placement)} placed · {fmtPct(r.share)} share
            </span>
          </span>
          <span className="bl-value">{fmtMoney(r.premium)}</span>
          <span className="bl-track">
            <span className="bl-fill cx-widen" style={{ width: `${Math.max(1.5, (r.premium / max) * 100)}%`, display: 'block', background: i === 0 ? RED : 'color-mix(in srgb, #1C1B1A 38%, transparent)' }} />
          </span>
          <span className="bl-hint" style={{ gridColumn: '1 / -1', marginTop: 2 }}>
            <DeltaTag d={r.d} suffix="vs prior period" />
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function ExecOverview(props: ExecOverviewProps) {
  const { pinnacleRows, statusRows, books, variant, lastSynced, syncError, tables, performanceHref = '/dashboard/pinnacle', prefs, reconciled = false } = props
  const now = useMemo(() => (props.now ? new Date(props.now + 'T12:00:00Z') : new Date()), [props.now])
  const year = now.getUTCFullYear()
  const dataThrough = useMemo(() => props.dataThrough ?? dataThroughOf(pinnacleRows), [props.dataThrough, pinnacleRows])
  // Trailing windows end at the last month with data, never at an empty month.
  const anchor = useMemo(() => {
    if (!dataThrough) return now
    const t = parseDay(dataThrough)
    return t < todayUTC(now) ? new Date(t + 12 * 3600_000) : now
  }, [dataThrough, now])
  const gap = anchor.getUTCFullYear() !== year || anchor.getUTCMonth() !== now.getUTCMonth()
  const priorYear = useMemo(() => yearHasData(pinnacleRows, year - 1), [pinnacleRows, year])
  const yoyNote = `vs ${year - 1}: no ${year - 1} data in the book yet · year-over-year starts Jan ${year + 1}`

  const [tf, setTf] = useState<Tf>(() => tfFromPref(prefs?.updated_at ? prefs.default_timeframe : undefined))
  const [custom, setCustom] = useState<{ start: string; end: string }>(() => ({ start: monthKey(year, 0), end: monthKey(anchor.getUTCFullYear(), anchor.getUTCMonth()) }))
  const [line, setLine] = useState<'All' | string>('All')

  // 36 trailing months: every timeframe, its prior period, and last year's twin.
  const series36 = useMemo(() => monthlySeries(pinnacleRows, statusRows, 36, anchor), [pinnacleRows, statusRows, anchor])
  const lineSeries = useMemo(
    () => Object.fromEntries(LINES.map((l) => [l, monthlySeries(pinnacleRows, statusRows, 36, anchor, l)])) as Record<string, MonthPoint[]>,
    [pinnacleRows, statusRows, anchor],
  )
  const byKey = useMemo(() => new Map(series36.map((p) => [p.key, p])), [series36])

  const window = useMemo(() => {
    if (tf === 'custom') {
      const s = custom.start <= custom.end ? custom.start : custom.end
      const e = custom.start <= custom.end ? custom.end : custom.start
      const idx = series36.findIndex((p) => p.key === s)
      const endIdx = series36.findIndex((p) => p.key === e)
      const from = idx < 0 ? 0 : idx
      const to = endIdx < 0 ? series36.length - 1 : endIdx
      const cur = series36.slice(from, to + 1)
      const prev = series36.slice(Math.max(0, from - cur.length), from)
      const { start, end } = monthSpanWindow(s, e, now)
      const ps = series36[Math.max(0, from - cur.length)]
      const prevRange = prev.length ? monthSpanWindow(ps.key, prev[prev.length - 1].key, now) : null
      return { cur, prev, start, end, prevRange, label: cur.length === 1 ? cur[0].longLabel : `${cur[0]?.longLabel ?? ''} – ${cur[cur.length - 1]?.longLabel ?? ''}` }
    }
    const months = timeframeMonths(tf, anchor)
    const cur = series36.slice(-months)
    const prev = series36.slice(-months * 2, -months)
    const { start, end } = timeframeWindow(tf, anchor)
    const prevRange = prev.length ? monthSpanWindow(prev[0].key, prev[prev.length - 1].key, now) : null
    return { cur, prev, start, end, prevRange, label: TIMEFRAMES.find((t) => t.key === tf)?.label.toLowerCase() ?? '' }
  }, [tf, custom, series36, anchor, now])
  const { cur, prev: prevPeriod } = window
  const months = cur.length
  const sameLastYear = useMemo(() => cur.map((p) => byKey.get(`${Number(p.key.slice(0, 4)) - 1}${p.key.slice(4)}`) ?? null), [cur, byKey])
  const scope = line === 'All' ? SCOPE : `All teams · ${line} only · Pinnacle master book`
  const tfLabel = window.label

  const sum = (pts: Array<MonthPoint | null>, pick: (p: MonthPoint) => number) => pts.reduce((s, p) => s + (p ? pick(p) : 0), 0)
  const submittedCur = sum(cur, (p) => p.premium)
  const submittedPrev = sum(prevPeriod, (p) => p.premium)
  const submittedLY = sum(sameLastYear, (p) => p.premium)
  const issuedCur = sum(cur, (p) => p.funded)
  const issuedPrev = sum(prevPeriod, (p) => p.funded)
  const policiesCur = sum(cur, (p) => p.policies)
  const policiesPrev = sum(prevPeriod, (p) => p.policies)
  const placementCur = submittedCur > 0 ? issuedCur / submittedCur : null
  const placementPrev = submittedPrev > 0 ? issuedPrev / submittedPrev : null
  const funnel = funnelFor(cur)
  const moved = mostMovedLine(cur, prevPeriod, LINES)

  // ── Month card (this calendar month, by `now`) ─────────────────────────
  const month = useMemo(() => {
    const y = year
    const m0 = now.getUTCMonth()
    const dim = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
    const dom = now.getUTCDate()
    const daily = dailyForMonth(pinnacleRows, y, m0)
    let through = dom
    if (dataThrough) {
      const [ty, tm] = dataThrough.split('-').map(Number)
      if (ty === y && tm === m0 + 1) through = Math.min(dom, Number(dataThrough.slice(8, 10)))
      else if (ty < y || (ty === y && tm < m0 + 1)) through = 0
    }
    const mtd = sumDays(pinnacleRows, y, m0, through)
    const lm = sumDays(pinnacleRows, m0 === 0 ? y - 1 : y, m0 === 0 ? 11 : m0 - 1, through)
    const ly = sumDays(pinnacleRows, y - 1, m0, through)
    const projected = through > 0 ? (mtd.premium / through) * dim : 0
    return { y, m0, dim, dom, through, daily, mtd, lm, ly, projected, name: `${MONTHS_LONG[m0]} ${y}`, short: MONTHS_SHORT[m0] }
  }, [pinnacleRows, now, year, dataThrough])

  // ── Pace: cumulative YTD this year vs last year ────────────────────────
  const pace = useMemo(() => {
    const ytdPts = series36.filter((p) => p.key.startsWith(String(year)))
    const lyPts = series36.filter((p) => p.key.startsWith(String(year - 1))).slice(0, 12)
    const cumYtd = cumulative(ytdPts.map((p) => p.premium))
    const cumLy = cumulative(lyPts.map((p) => p.premium))
    const ytd = cumYtd[cumYtd.length - 1] ?? 0
    const lastYtd = cumLy[ytdPts.length - 1] ?? 0
    const lastYearTotal = cumLy[cumLy.length - 1] ?? 0
    const start = Date.UTC(year, 0, 1)
    const elapsed = Math.min(1, Math.max(1 / 365, (todayUTC(now) - start) / DAY / 365))
    const labels = MONTHS_SHORT.slice(0, Math.max(ytdPts.length, priorYear ? 12 : ytdPts.length))
    return { ytdPts, cumYtd, cumLy, ytd, lastYtd, lastYearTotal, projected: ytd / elapsed, elapsed, labels }
  }, [series36, year, now, priorYear])

  // ── Breakdowns for the current and prior windows ───────────────────────
  const seedKey = useMemo(() => {
    const { start, end } = timeframeWindow('12m', anchor)
    return `${start}|${end}|All`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Team page: the cached top-25 agents are a fallback only; it fetches every agent (up to 200) for the window.
  // Empty cached lists are not seeded, so a day cached while the breakdown
  // read was failing still fetches live names on open.
  const [bd, setBd] = useState<Record<string, BreakdownMap>>(() => {
    const seed: BreakdownMap = {}
    for (const [k, v] of Object.entries(props.breakdowns) as Array<[BreakdownDim, BreakdownRow[] | undefined]>) {
      if (v && v.length > 0 && (variant !== 'full' || k === 'team')) seed[k] = v
    }
    return { [seedKey]: seed }
  })
  const pinnedDims = prefs?.updated_at ? prefs.pinned_breakdowns : []
  const dims: BreakdownDim[] = variant === 'full' ? ['team', 'agent'] : pinnedDims.length > 0 ? pinnedDims : ['team', 'agent', 'carrier']
  const limitFor = (d: BreakdownDim) => (variant === 'full' ? (d === 'agent' ? 200 : 100) : 25)
  const curKey = `${window.start}|${window.end}|${line}`
  const prevKey = window.prevRange ? `${window.prevRange.start}|${window.prevRange.end}|${line}` : null
  useEffect(() => {
    const load = props.loadBreakdown ?? defaultLoad
    const want = [[curKey, window.start, window.end] as const, ...(prevKey && window.prevRange ? [[prevKey, window.prevRange.start, window.prevRange.end] as const] : [])].filter(([k]) => !bd[k] || dims.some((d) => !bd[k][d]))
    if (want.length === 0) return
    let cancelled = false
    Promise.all(
      want.map(async ([k, s, e]) => {
        const lists = await Promise.all(dims.map((d) => load(d, line, s, e, limitFor(d)).catch(() => [] as BreakdownRow[])))
        const map: BreakdownMap = {}
        dims.forEach((d, i) => (map[d] = lists[i]))
        return [k, map] as const
      }),
    ).then((pairs) => {
      if (cancelled) return
      setBd((c) => {
        const next = { ...c }
        for (const [k, map] of pairs) next[k] = { ...(next[k] ?? {}), ...map }
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey, prevKey, dims.join(',')])
  const bdCur = bd[curKey]
  const bdPrev = prevKey ? bd[prevKey] : undefined
  const bdLoading = !bdCur || dims.some((d) => !bdCur[d])
  const topRows = (dim: BreakdownDim, n = 5): TopRow[] => {
    const rows = (bdCur?.[dim] ?? []).slice().sort((a, b) => Number(b.premium) - Number(a.premium))
    const total = rows.reduce((s, r) => s + Number(r.premium), 0)
    const prevMap = new Map((bdPrev?.[dim] ?? []).map((r) => [r.label, Number(r.premium)]))
    return rows.slice(0, n).map((r) => {
      const premium = Number(r.premium)
      const policies = Number(r.policies)
      return { label: r.label, premium, policies, placement: policies > 0 ? Number(r.paid) / policies : null, share: total > 0 ? premium / total : 0, d: deltaOf(premium, prevMap.get(r.label) ?? 0) }
    })
  }
  const whatMoved = (rows: TopRow[]): string | null => {
    const withPrior = rows.filter((r) => r.d.pct != null)
    if (withPrior.length === 0) return null
    const top = withPrior.reduce((a, r) => (Math.abs(r.d.pct!) > Math.abs(a.d.pct!) ? r : a), withPrior[0])
    return `What moved: ${top.label} ${deltaWords(top.d)} vs the prior period.`
  }

  // Agency books: only those with a real name (generic "Agency Book A/B" labels stay hidden).
  const agencyBooks = books.filter((b) => !b.isPinnacle && !/^agency book\b/i.test(b.label) && !/^book · /i.test(b.label))
  const bookSeries = useMemo(
    () => agencyBooks.map((b) => ({ ...b, pts: monthlySeries(b.rows, [], 36, anchor) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [books, anchor],
  )

  // ── Controls ───────────────────────────────────────────────────────────
  const Seg = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div className="cx-seg" role="tablist" aria-label="Timeframe">
        {TIMEFRAMES.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tf === t.key} onClick={() => setTf(t.key)}>
            {t.label}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={tf === 'custom'} onClick={() => setTf('custom')}>
          Custom
        </button>
      </div>
      {tf === 'custom' && (
        <label className="cx-month-range">
          <input type="month" value={custom.start} min={series36[0]?.key} max={series36[series36.length - 1]?.key} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value || c.start }))} aria-label="From month" />
          to
          <input type="month" value={custom.end} min={series36[0]?.key} max={series36[series36.length - 1]?.key} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value || c.end }))} aria-label="To month" />
        </label>
      )}
    </div>
  )

  const gapNotice = gap && (
    <section className="cx-panel cx-panel-tint" style={{ padding: '12px 16px' }}>
      <p className="cx-takeaway" style={{ margin: 0 }}>
        <strong>Data through {fmtDay(dataThrough)}.</strong> The book has nothing dated after that yet, so every window below ends there and nothing is compared against an empty month.
      </p>
    </section>
  )

  // ── Month card ─────────────────────────────────────────────────────────
  // Month to date is only shown once the month reconciled to Airtable
  // (owner 10-09: an unreconciled "$29K in 9 days" reads as wrong).
  const monthBlock = !reconciled ? (
    <section className="cx-panel cx-panel-tint" style={{ padding: '14px 18px' }}>
      <div className="cx-eyebrow">{month.name}</div>
      <p className="cx-takeaway" style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--cx-ink, #1C1B1A)' }}>
        {MONTHS_LONG[month.m0]} data still syncing · data through {fmtDay(dataThrough)}
      </p>
      <p className="cx-takeaway" style={{ margin: '4px 0 0' }}>Month-to-date figures appear here once {MONTHS_LONG[month.m0]} matches the book of business.</p>
    </section>
  ) : (
    <section className="cx-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="cx-eyebrow">{month.name}</div>
          <div className="cx-kpi-sub" style={{ marginTop: 2 }}>
            {month.through > 0 ? `${month.short} 1 – ${month.short} ${month.through} · ${month.through} of ${month.dim} days` : `No ${month.short} rows in the book yet`}
          </div>
          <div className="cx-figure-hero" style={{ marginTop: 8 }}>{fmtMoney(month.mtd.premium)}</div>
          <div className="cx-kpi-sub">submitted month to date · <b style={{ fontWeight: 500, color: 'var(--cx-ink, #1C1B1A)' }}>{fmtMoney(month.mtd.funded)}</b> issued · {fmtCount(month.mtd.policies)} policies</div>
          <div className="cx-days" aria-hidden>
            <i style={{ width: `${(month.through / month.dim) * 100}%` }} />
          </div>
          <div className="cx-chips">
            <DeltaTag d={deltaOf(month.mtd.premium, month.lm.premium)} suffix={`vs the same ${month.through} days last month`} />
            {priorYear ? <DeltaTag d={deltaOf(month.mtd.premium, month.ly.premium)} suffix={`vs the same days in ${month.short} ${year - 1}`} /> : <span className="cx-delta cx-delta-none">{yoyNote}</span>}
          </div>
          {reconciled && month.through > 0 && <div className="cx-kpi-sub" style={{ marginTop: 10 }}>On pace for <b style={{ fontWeight: 500, color: 'var(--cx-ink, #1C1B1A)' }}>{fmtMoney(month.projected)}</b> if the rest of the month runs like the first {month.through} days.</div>}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 240, alignSelf: 'flex-end' }}>
          <DayBars values={month.daily.map((d) => d.premium)} through={month.through} height={72} format={fmtMoney} labels={month.daily.map((d) => `${month.short} ${d.day}`)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--cx-faint)', marginTop: 4 }}>
            <span>{month.short} 1</span>
            <span>{month.short} {month.dim}</span>
          </div>
        </div>
      </div>
      <Scope scope={`${SCOPE} · daily submitted premium`} through={dataThrough} />
    </section>
  )

  // ── Hero: submitted vs issued over the window ──────────────────────────
  const heroSeries = [
    { key: 'sub', label: 'Submitted', values: cur.map((p) => p.premium), color: INK, fill: true, width: 2.25 },
    { key: 'iss', label: 'Issued', values: cur.map((p) => p.funded), color: RED, width: 2 },
  ]
  const peak = cur.reduce((b, p) => (p.premium > (b?.premium ?? -1) ? p : b), cur[0] as MonthPoint | undefined)
  const heroBlock = (
    <section className="cx-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="cx-eyebrow">Submitted vs issued premium · {tfLabel}</div>
          <div className="cx-figure-hero">{fmtMoney(submittedCur)}</div>
          <div className="cx-kpi-sub">
            submitted · <b style={{ fontWeight: 500, color: 'var(--cx-ink, #1C1B1A)' }}>{fmtMoney(issuedCur)}</b> issued · {fmtPct(placementCur)} placed
          </div>
          <div className="cx-chips" style={{ marginTop: 8 }}>
            <DeltaTag d={deltaOf(submittedCur, submittedPrev)} suffix="vs the prior period" />
            {priorYear ? <DeltaTag d={deltaOf(submittedCur, submittedLY)} suffix={`vs the same months in ${year - 1}`} /> : <span className="cx-delta cx-delta-none">{yoyNote}</span>}
          </div>
        </div>
        {Seg}
      </div>
      <div style={{ marginTop: 18 }}>
        <WaveChart series={heroSeries} labels={cur.map((p) => (months > 12 ? p.longLabel : p.label))} height={240} format={fmtMoney} ariaLabel={`Monthly submitted and issued premium, ${tfLabel}`} />
      </div>
      <ul className="cx-legend">
        <li>
          <i style={{ background: INK }} /> Submitted
        </li>
        <li>
          <i style={{ background: RED }} /> Issued
        </li>
      </ul>
      <p className="cx-takeaway">
        {peak && peak.premium > 0 ? (
          <>
            Best month was <strong>{peak.longLabel}</strong> at {fmtMoney(peak.premium)} submitted. {submittedPrev > 0 ? `This period is ${deltaWords(deltaOf(submittedCur, submittedPrev))} on the period before it.` : 'No prior period to compare against yet.'}
          </>
        ) : (
          'No premium in this window yet.'
        )}
      </p>
      <Scope scope={scope} through={dataThrough} />
    </section>
  )

  // ── Four KPI cards ─────────────────────────────────────────────────────
  const kpiBlock = (
    <div className="cx-grid cx-grid-4">
      <Kpi eyebrow={`Submitted premium · ${tfLabel}`} figure={fmtMoney(submittedCur)} d={deltaOf(submittedCur, submittedPrev)} suffix="vs prior period" spark={cur.map((p) => p.premium)} scope={scope} through={dataThrough} />
      <Kpi eyebrow={`Issued premium · ${tfLabel}`} figure={fmtMoney(issuedCur)} d={deltaOf(issuedCur, issuedPrev)} suffix="vs prior period" spark={cur.map((p) => p.funded)} scope={scope} through={dataThrough} />
      <Kpi eyebrow={`Placement rate · ${tfLabel}`} figure={fmtPct(placementCur)} sub="issued ÷ submitted premium" d={deltaOf(placementCur ?? 0, placementPrev ?? 0)} suffix="vs prior period" spark={cur.map((p) => (p.premium ? p.funded / p.premium : 0))} scope={scope} through={dataThrough} />
      <Kpi eyebrow={`Policies written · ${tfLabel}`} figure={fmtCount(policiesCur)} d={deltaOf(policiesCur, policiesPrev)} suffix="vs prior period" spark={cur.map((p) => p.policies)} scope={scope} through={dataThrough} />
    </div>
  )

  // ── Pace + product mix ─────────────────────────────────────────────────
  const paceSeries = [
    ...(priorYear ? [{ key: 'ly', label: `${year - 1}`, values: pace.cumLy, color: INK_TINT, dashed: true, width: 1.5 }] : []),
    { key: 'cy', label: `${year}`, values: pace.cumYtd, color: INK, fill: true, width: 2.25 },
  ]
  const paceBlock = (
    <section className="cx-panel">
      <div className="cx-eyebrow">Pace · {year} cumulative submitted premium</div>
      <div className="cx-figure">{fmtMoney(pace.ytd)}</div>
      {priorYear ? <DeltaTag d={deltaOf(pace.ytd, pace.lastYtd)} suffix={`vs this point in ${year - 1}`} /> : <span className="cx-yoy">{yoyNote}</span>}
      <div style={{ marginTop: 14 }}>
        <WaveChart series={paceSeries} labels={pace.labels} height={150} format={fmtMoney} ariaLabel={`Cumulative submitted premium, ${year}${priorYear ? ` versus ${year - 1}` : ''}`} />
      </div>
      {priorYear && (
        <ul className="cx-legend">
          <li>
            <i style={{ background: INK }} /> {year}
          </li>
          <li>
            <i className="dashed" style={{ background: INK_TINT }} /> {year - 1}
          </li>
        </ul>
      )}
      <div style={{ marginTop: 12 }}>
        <PaceMeter sofar={pace.ytd} projected={reconciled ? pace.projected : 0} target={priorYear ? pace.lastYearTotal : 0} format={fmtMoney} targetLabel={`${year - 1} total`} targetNote={priorYear ? undefined : `${year - 1} total: no data yet`} />
      </div>
      <p className="cx-takeaway">
        {Math.round(pace.elapsed * 100)}% of the year is gone.{' '}
        {reconciled ? `On this run-rate ${year} lands near ${fmtMoney(pace.projected)}.` : 'A run-rate projection appears once the current month reconciles to the book.'}
      </p>
      <Scope scope={SCOPE} through={dataThrough} />
    </section>
  )

  const mixSlices = LINES.map((l, i) => ({ key: l, label: l, value: sum(lineSeries[l].slice(-months), (p) => p.premium), color: l === moved ? RED : i === 0 ? INK : i === 1 ? INK_TINT : INK_TINT_2 }))
  const mixBlock = (
    <section className="cx-panel">
      <div className="cx-eyebrow">Product mix · {tfLabel}</div>
      <div style={{ marginTop: 12 }}>
        <Donut slices={mixSlices} format={fmtMoney} centerValue={fmtMoney(submittedCur)} centerLabel="submitted" />
      </div>
      <div className="cx-grid cx-grid-3" style={{ marginTop: 12 }}>
        {LINES.map((l) => {
          const pts = lineSeries[l].slice(-months)
          const prevPts = lineSeries[l].slice(-months * 2, -months)
          const hot = l === moved
          return (
            <div key={l}>
              <div className="cx-eyebrow" style={{ fontSize: 11 }}>{l}</div>
              <DeltaTag d={deltaOf(sum(pts, (p) => p.premium), sum(prevPts, (p) => p.premium))} />
              <Sparkline values={pts.map((p) => p.premium)} color={hot ? RED : INK} style={{ marginTop: 6 }} />
            </div>
          )
        })}
      </div>
      <p className="cx-takeaway">
        {moved ? (
          <>
            <strong>{moved}</strong> moved the most this period; the red slice is the one to look at.
          </>
        ) : (
          'No product-line movement to call out.'
        )}
      </p>
      <Scope scope={SCOPE} through={dataThrough} />
    </section>
  )

  // ── Status funnel (Performance) ────────────────────────────────────────
  const statusBlock = (
    <section className="cx-panel">
      <div className="cx-eyebrow">Where policies stand · {tfLabel}</div>
      <div style={{ marginTop: 12 }}>
        <StageBars
          format={fmtCount}
          stages={[
            { key: 'written', label: 'Written', value: funnel.written, color: INK },
            { key: 'pending', label: 'Still pending', value: funnel.pending },
            { key: 'issued', label: 'Issued and paid', value: funnel.issued, color: RED, hint: fmtPct(funnel.placement) },
            { key: 'out', label: 'Declined or lapsed', value: funnel.declined + funnel.lapsed, hint: fmtPct(funnel.written ? (funnel.declined + funnel.lapsed) / funnel.written : null) },
          ]}
        />
      </div>
      <p className="cx-takeaway">
        {funnel.written > 0 ? (
          <>
            <strong>{fmtPct(funnel.placement)}</strong> of what was written got issued and paid; {fmtPct(funnel.written ? (funnel.declined + funnel.lapsed) / funnel.written : null)} fell out.
          </>
        ) : (
          'No policies in this window.'
        )}
      </p>
      <Scope scope={`${scope} · policy counts by status`} through={dataThrough} />
    </section>
  )

  // ── Monthly policies (Performance) ─────────────────────────────────────
  const policiesBlock = (
    <section className="cx-panel">
      <div className="cx-eyebrow">Policies by month · {tfLabel}</div>
      <div style={{ marginTop: 12 }}>
        <Columns labels={cur.map((p) => (months > 12 ? p.longLabel : p.label))} series={[{ key: 'w', label: 'Written', values: cur.map((p) => p.policies), color: INK }, { key: 'i', label: 'Issued', values: cur.map((p) => p.fundedPolicies), color: RED }]} format={fmtCount} ariaLabel="Policies written and issued by month" />
      </div>
      <ul className="cx-legend">
        <li>
          <i style={{ background: INK }} /> Written
        </li>
        <li>
          <i style={{ background: RED }} /> Issued
        </li>
      </ul>
      <Scope scope={scope} through={dataThrough} />
    </section>
  )

  // ── Top teams / agents / carriers ──────────────────────────────────────
  const breakdownsBlock = (
    <section className="cx-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="cx-eyebrow">Who and what is driving it · {tfLabel}</div>
        <div className="cx-seg" role="tablist" aria-label="Product line">
          {['All', ...LINES].map((l) => (
            <button key={l} type="button" role="tab" aria-selected={line === l} onClick={() => setLine(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="cx-grid cx-grid-3" style={{ marginTop: 14, opacity: bdLoading ? 0.6 : 1, transition: 'opacity .2s' }}>
        {dims.map((d) => {
          const rows = topRows(d)
          const mv = whatMoved(rows)
          return (
            <div key={d}>
              <div className="cx-title" style={{ marginBottom: 8 }}>{DIM_LABELS[d]}</div>
              <TopList rows={rows} empty={bdLoading ? 'Loading…' : undefined} />
              {rows[0] && (
                <p className="cx-takeaway">
                  <strong>{rows[0].label}</strong> leads with {fmtMoney(rows[0].premium)} ({fmtPct(rows[0].share)} of the window). {mv ?? 'No prior period to compare yet.'}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <Scope scope={`${scope} · submitted premium, ranked`} through={dataThrough} />
    </section>
  )

  // ── Team: named agencies → agents, ranked (Team page) ─────────────────
  const [openTeams, setOpenTeams] = useState<Set<string>>(() => new Set())
  const toggleTeam = (t: string) =>
    setOpenTeams((c) => {
      const n = new Set(c)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
  type RankRow = { label: string; team: string | null; premium: number; issued: number | null; policies: number; paid: number; placement: number | null; d: Delta }
  const rankRows = (dim: BreakdownDim): RankRow[] => {
    let rows = bdCur?.[dim] ?? []
    if (rows.length === 0 && curKey === seedKey && dim === 'agent') rows = props.breakdowns.agent ?? []
    const prevMap = new Map((bdPrev?.[dim] ?? []).map((r) => [`${r.team ?? ''}|${r.label}`, Number(r.premium)]))
    return rows
      .map((r) => {
        const premium = Number(r.premium)
        const policies = Number(r.policies)
        const paid = Number(r.paid)
        const funded = (r as BreakdownRow & { funded?: number | null }).funded
        return { label: r.label, team: r.team ?? null, premium, issued: funded == null ? null : Number(funded), policies, paid, placement: policies > 0 ? paid / policies : null, d: deltaOf(premium, prevMap.get(`${r.team ?? ''}|${r.label}`) ?? 0) }
      })
      .sort((a, b) => b.premium - a.premium)
  }
  const teamRanks = rankRows('team')
  const agentRanks = rankRows('agent')
  const agentsByTeam = new Map<string, RankRow[]>()
  for (const a of agentRanks) if (a.team) agentsByTeam.set(a.team, [...(agentsByTeam.get(a.team) ?? []), a])
  const nested = agentsByTeam.size > 0
  const issuedCell = (r: RankRow) => (r.issued != null ? fmtMoney(r.issued) : fmtCount(r.paid))
  const issuedHead = agentRanks.some((r) => r.issued != null) || teamRanks.some((r) => r.issued != null) ? 'Issued' : 'Issued policies'
  const rankHead = (first: string) => (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col">Submitted</th>
        <th scope="col">{issuedHead}</th>
        <th scope="col">Placement</th>
        <th scope="col">Policies</th>
        <th scope="col">Trend</th>
      </tr>
    </thead>
  )
  const rankCells = (r: RankRow) => (
    <>
      <td>{fmtMoney(r.premium)}</td>
      <td>{issuedCell(r)}</td>
      <td>{fmtPct(r.placement)}</td>
      <td>{fmtCount(r.policies)}</td>
      <td className="cx-delta-cell">
        <DeltaTag d={r.d} />
      </td>
    </>
  )
  const teamBlock = (
    <section className="cx-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="cx-eyebrow">Agencies and agents · {tfLabel}</div>
          <div className="cx-kpi-sub" style={{ marginTop: 2 }}>Ranked by submitted premium. Trend is against the period before.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {Seg}
          <div className="cx-seg" role="tablist" aria-label="Product line">
            {['All', ...LINES].map((l) => (
              <button key={l} type="button" role="tab" aria-selected={line === l} onClick={() => setLine(l)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ opacity: bdLoading ? 0.6 : 1, transition: 'opacity .2s' }}>
        {teamRanks.length === 0 && agentRanks.length === 0 ? (
          <p className="cx-takeaway">{bdLoading ? 'Loading…' : 'No named agencies or agents for this period yet. They fill in as the book syncs.'}</p>
        ) : (
          <>
            {teamRanks.length > 0 && (
              <table className="cx-table cx-rank">
                {rankHead('Agency')}
                <tbody>
                  {teamRanks.map((t, i) => {
                    const kids = agentsByTeam.get(t.label) ?? []
                    const open = openTeams.has(t.label)
                    return (
                      <Fragment key={t.label}>
                        <tr className={i === 0 ? 'cx-rank-top' : undefined}>
                          <th scope="row">
                            {kids.length > 0 ? (
                              <button type="button" className="cx-rank-toggle" aria-expanded={open} onClick={() => toggleTeam(t.label)}>
                                <span className="cx-rank-chev" aria-hidden>›</span>
                                {t.label}
                                <span className="cx-rank-count">{kids.length} {kids.length === 1 ? 'agent' : 'agents'}</span>
                              </button>
                            ) : (
                              t.label
                            )}
                          </th>
                          {rankCells(t)}
                        </tr>
                        {open &&
                          kids.map((a) => (
                            <tr key={`${t.label}|${a.label}`} className="cx-rank-child">
                              <th scope="row">{a.label}</th>
                              {rankCells(a)}
                            </tr>
                          ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
            {!nested && agentRanks.length > 0 && (
              <table className="cx-table cx-rank" style={{ marginTop: teamRanks.length > 0 ? 18 : 10 }}>
                {rankHead('Agent')}
                <tbody>
                  {agentRanks.map((a, i) => (
                    <tr key={a.label} className={i === 0 ? 'cx-rank-top' : undefined}>
                      <th scope="row">{a.label}</th>
                      {rankCells(a)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      <Scope scope={`${scope} · names from Team (Parsed) and Agent`} through={dataThrough} />
    </section>
  )

  // ── Agency books (stacked) ─────────────────────────────────────────────
  const bookTints = [INK, INK_TINT, INK_TINT_2, 'rgba(28,27,26,0.1)']
  const booksBlock =
    bookSeries.length > 0 ? (
      <section className="cx-panel">
        <div className="cx-eyebrow">Agency books of business · {tfLabel}</div>
        <div style={{ marginTop: 12 }}>
          <StackedArea labels={cur.map((p) => (months > 12 ? p.longLabel : p.label))} series={bookSeries.map((b, i) => ({ key: b.baseId, label: b.label, values: b.pts.slice(-months).map((p) => p.premium), color: bookTints[i % bookTints.length] }))} format={fmtMoney} ariaLabel="Submitted premium by agency book, stacked" />
        </div>
        <ul className="cx-legend">
          {bookSeries.map((b, i) => (
            <li key={b.baseId}>
              <i style={{ background: bookTints[i % bookTints.length] }} /> {b.label} · {fmtMoney(sum(b.pts.slice(-months), (p) => p.premium))}
              {' '}
              <DeltaTag d={deltaOf(sum(b.pts.slice(-months), (p) => p.premium), sum(b.pts.slice(-months * 2, -months), (p) => p.premium))} />
            </li>
          ))}
        </ul>
        <Scope scope="Agency books · all lines · submitted premium" through={dataThrough} />
      </section>
    ) : null

  const footerBlock = (
    <>
      {syncError && (
        <section className="cx-panel" style={{ borderColor: RED }}>
          <div className="cx-eyebrow" style={{ color: RED }}>Last sync failed</div>
          <p className="cx-takeaway" style={{ whiteSpace: 'pre-wrap' }}>{syncError}</p>
        </section>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p className="cx-takeaway" style={{ margin: 0 }}>
          Data through {fmtDay(dataThrough)}.{lastSynced ? ` Last synced ${lastSynced}.` : ''} Numbers refresh every morning from the book of business.
        </p>
        {variant === 'home' && (
          <Link href={performanceHref} className="cx-link">
            See agencies and agents →
          </Link>
        )}
      </div>
      {variant === 'full' && tables && tables.length > 0 && (
        <details className="cx-details">
          <summary>Data sources</summary>
          <div className="cx-details-body">
            {tables.map((t) => (
              <div key={t.baseId} style={{ marginBottom: 10 }}>
                <strong>{t.label}</strong> <span style={{ color: 'var(--cx-muted)' }}>({t.baseId})</span>
                <div style={{ color: 'var(--cx-muted)', fontSize: 13 }}>{t.names.join(' · ')}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  )

  // ── Pinned KPI catalog (ids from lib/dashboardPrefs) ──────────────────
  function kpi(id: DashboardKpi): { eyebrow: string; figure: string; d: Delta; suffix: string; spark: number[] } | null {
    const last = series36[series36.length - 1]
    const lastLY = series36[series36.length - 13]
    const t = (n: number) => ({ cur: series36.slice(-n), prev: series36.slice(-n * 2, -n) })
    const ytdPts = series36.filter((p) => p.key.startsWith(String(year)))
    switch (id) {
      case 'ytd_premium':
        return { eyebrow: `Submitted premium · ${year} to date`, figure: fmtMoney(pace.ytd), d: priorYear ? deltaOf(pace.ytd, pace.lastYtd) : { pct: null, dir: 'flat' }, suffix: priorYear ? `on ${year - 1} at this point` : `· ${yoyNote}`, spark: ytdPts.map((p) => p.premium) }
      case 'mtd_premium':
        if (!reconciled) return null
        return { eyebrow: `Submitted premium · ${month.name}`, figure: fmtMoney(month.mtd.premium), d: deltaOf(month.mtd.premium, month.lm.premium), suffix: `vs the same ${month.through} days last month`, spark: month.daily.slice(0, month.through).map((d) => d.premium) }
      case 'trailing_3m_premium':
      case 'trailing_6m_premium':
      case 'trailing_12m_premium': {
        const n = id === 'trailing_3m_premium' ? 3 : id === 'trailing_6m_premium' ? 6 : 12
        const w = t(n)
        return { eyebrow: `Submitted premium · last ${n} months`, figure: fmtMoney(sum(w.cur, (p) => p.premium)), d: deltaOf(sum(w.cur, (p) => p.premium), sum(w.prev, (p) => p.premium)), suffix: `on the previous ${n} months`, spark: w.cur.map((p) => p.premium) }
      }
      case 'policies_issued':
        return { eyebrow: `Policies issued · ${tfLabel}`, figure: fmtCount(sum(cur, (p) => p.fundedPolicies)), d: deltaOf(sum(cur, (p) => p.fundedPolicies), sum(prevPeriod, (p) => p.fundedPolicies)), suffix: 'on the prior period', spark: cur.map((p) => p.fundedPolicies) }
      case 'policies_submitted':
        return { eyebrow: `Policies written · ${tfLabel}`, figure: fmtCount(policiesCur), d: deltaOf(policiesCur, policiesPrev), suffix: 'on the prior period', spark: cur.map((p) => p.policies) }
      case 'placement_pct':
        return { eyebrow: `Placement rate · ${tfLabel}`, figure: fmtPct(placementCur), d: deltaOf(placementCur ?? 0, placementPrev ?? 0), suffix: 'on the prior period', spark: cur.map((p) => (p.premium ? p.funded / p.premium : 0)) }
      case 'avg_premium_per_policy': {
        const avg = policiesCur > 0 ? submittedCur / policiesCur : 0
        const prevAvg = policiesPrev > 0 ? submittedPrev / policiesPrev : 0
        return { eyebrow: `Average premium per policy · ${tfLabel}`, figure: fmtMoney(avg), d: deltaOf(avg, prevAvg), suffix: 'on the prior period', spark: cur.map((p) => (p.policies ? p.premium / p.policies : 0)) }
      }
      case 'projected_month_end': {
        if (!reconciled || !last) return null
        const prevMonth = series36[series36.length - 2]
        return { eyebrow: 'Projected month end', figure: fmtMoney(month.projected), d: deltaOf(month.projected, prevMonth?.premium ?? 0), suffix: 'on last month', spark: [...series36.slice(-6, -1).map((p) => p.premium), month.projected] }
      }
      default:
        void lastLY
        return null
    }
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  const customised = !!prefs && prefs.updated_at !== null
  const hidden = new Set(prefs?.hidden_sections ?? [])
  const order: DashboardTile[] = customised ? prefs!.tiles : DEFAULT_ORDER

  const pinnedKpiBlock =
    customised && prefs!.pinned_kpis.length > 0 ? (
      <div className="cx-grid cx-grid-4">
        {prefs!.pinned_kpis.map((k) => {
          const t = kpi(k)
          return t ? <Kpi key={k} eyebrow={t.eyebrow} figure={t.figure} d={t.d} suffix={t.suffix} spark={t.spark} scope={scope} through={dataThrough} /> : null
        })}
      </div>
    ) : null

  const headlineBlock = prefs?.headline_note ? (
    <section className="cx-panel" style={{ borderLeft: `3px solid ${RED}` }}>
      <div className="cx-eyebrow">This week</div>
      <p className="cx-takeaway" style={{ fontSize: 16, color: 'var(--cx-ink, #1C1B1A)', margin: '4px 0 0' }}>{prefs.headline_note}</p>
    </section>
  ) : null

  const notesBlock =
    prefs && prefs.notes.length > 0 ? (
      <section className="cx-panel">
        <div className="cx-eyebrow">Notes for the team</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
          {prefs.notes
            .slice()
            .reverse()
            .map((n) => (
              <li key={n.id} style={{ fontSize: 14 }}>
                {n.text}
                <span style={{ color: 'var(--cx-muted)', fontSize: 12, marginLeft: 8 }}>
                  {n.author} · {n.created_at.slice(0, 10)}
                </span>
              </li>
            ))}
        </ul>
      </section>
    ) : null

  // Overview: the month, the wave, four KPIs, pace + mix, the top five.
  // Performance: the wave, four KPIs, funnel, every top list, policies by
  // month, the agency books stacked, recent days, data sources. The two
  // pages share only the wave and the KPI row.
  const home = variant === 'home'
  const blocks: Record<DashboardTile, ReactNode> = {
    headline: headlineBlock,
    kpis: (
      <>
        {home && monthBlock}
        {pinnedKpiBlock ?? kpiBlock}
      </>
    ),
    premium_trend: heroBlock,
    product_mix: home ? (
      <div className="cx-grid cx-grid-hero">
        {mixBlock}
        {paceBlock}
      </div>
    ) : null,
    status_funnel: home ? null : (
      <div className="cx-grid cx-grid-hero">
        {statusBlock}
        {policiesBlock}
      </div>
    ),
    breakdowns: breakdownsBlock,
    agency_books: home ? null : booksBlock,
    meetings: null, // meetings live on the Meetings page; nothing to draw here
    notes: notesBlock,
  }

  if (!home) {
    return (
      <div className="cx-grid">
        {gapNotice}
        {teamBlock}
        <div className="cx-grid cx-grid-hero">
          {statusBlock}
          {policiesBlock}
        </div>
        {mixBlock}
        {booksBlock}
        {footerBlock}
      </div>
    )
  }

  return (
    <div className="cx-grid">
      {gapNotice}
      {order
        .filter((k) => !hidden.has(k))
        .map((k) => (
          <Fragment key={k}>{blocks[k]}</Fragment>
        ))}
      {footerBlock}
    </div>
  )
}
