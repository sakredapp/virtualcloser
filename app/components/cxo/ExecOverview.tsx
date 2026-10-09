'use client'

/**
 * ExecOverview — the owner's KPI surface, shared by the signed-in Overview
 * (`variant="home"`), the Performance page (`variant="full"`) and the public
 * demo (fed invented rows). Every tile is a KPI with a sparkline and a
 * plain-English delta; every chart carries a one-line takeaway.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { BreakdownDim, BreakdownRow, DailyRow, StatusRow } from '@/lib/pinnacle/rollup'
import type { DashboardKpi, DashboardPrefs, DashboardTile, DashboardTimeframe } from '@/lib/dashboardPrefs'
import {
  TIMEFRAMES,
  deltaWords,
  fmtCount,
  fmtMoney,
  fmtPct,
  funnelFor,
  monthlySeries,
  mostMovedLine,
  parseDay,
  timeframeMonths,
  timeframeWindow,
  todayUTC,
  trendTiles,
  yearPace,
  delta as deltaOf,
  type Delta,
  type MonthPoint,
  type Timeframe,
  DAY,
} from '@/lib/pinnacle/kpis'
import { BarList, INK, INK_TINT, PaceMeter, RED, Sparkline, WaveChart } from './charts'

export type BookInput = { baseId: string; label: string; isPinnacle: boolean; rows: DailyRow[] }
export type BreakdownMap = Partial<Record<BreakdownDim, BreakdownRow[]>>
export type LoadBreakdown = (dim: BreakdownDim, line: string, start: string, end: string) => Promise<BreakdownRow[]>

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
  /** Where the home variant's "See everything" link goes. */
  performanceHref?: string
  /** Saved layout (tiles, timeframe, pinned KPIs, notes). Untouched prefs draw the full default layout. */
  prefs?: DashboardPrefs | null
}

/** Default tile order when nothing has been customised. */
const DEFAULT_ORDER: DashboardTile[] = ['headline', 'premium_trend', 'kpis', 'product_mix', 'status_funnel', 'breakdowns', 'agency_books', 'notes']

/** Dashboard timeframes map onto the chart timeframes the overview can draw. */
function tfFromPref(t: DashboardTimeframe | undefined): Timeframe {
  if (t === 'ytd' || t === '3m' || t === '6m' || t === '12m') return t
  if (t === 'mtd' || t === 'qtd') return '3m'
  return '12m'
}

const LINES = ['Health', 'Life', 'Annuity']
const DIM_LABELS: Record<BreakdownDim, string> = {
  team: 'By team',
  agent: 'Top agents',
  carrier: 'Top carriers',
  state: 'By state',
  product: 'By product',
}

async function defaultLoad(dim: BreakdownDim, line: string, start: string, end: string): Promise<BreakdownRow[]> {
  const r = await fetch(`/api/pinnacle/breakdown?dim=${dim}&line=${line}&start=${start}&end=${end}`, { cache: 'no-store' })
  if (!r.ok) return []
  const j = (await r.json()) as { rows?: BreakdownRow[] }
  return j.rows ?? []
}

function DeltaTag({ d, suffix }: { d: Delta; suffix?: string }) {
  const glyph = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '●'
  return (
    <span className={`cx-delta cx-delta-${d.dir}`}>
      {glyph} {deltaWords(d)}
      {suffix ? ` ${suffix}` : ''}
    </span>
  )
}

function Tile({ eyebrow, figure, d, suffix, spark, color = INK }: { eyebrow: string; figure: string; d: Delta; suffix?: string; spark: number[]; color?: string }) {
  return (
    <div className="cx-panel">
      <div className="cx-eyebrow">{eyebrow}</div>
      <div className="cx-figure">{figure}</div>
      <DeltaTag d={d} suffix={suffix} />
      <Sparkline values={spark} color={color} style={{ marginTop: 10 }} />
    </div>
  )
}

export default function ExecOverview(props: ExecOverviewProps) {
  const { pinnacleRows, statusRows, books, variant, lastSynced, syncError, tables, performanceHref = '/dashboard/pinnacle', prefs } = props
  const now = useMemo(() => (props.now ? new Date(props.now + 'T12:00:00Z') : new Date()), [props.now])
  const [tf, setTf] = useState<Timeframe>(() => tfFromPref(prefs?.updated_at ? prefs.default_timeframe : undefined))
  const [line, setLine] = useState<'All' | string>('All')
  const months = timeframeMonths(tf, now)
  const year = now.getUTCFullYear()

  // 24 trailing months: enough for every timeframe plus its prior period.
  const series24 = useMemo(() => monthlySeries(pinnacleRows, statusRows, 24, now), [pinnacleRows, statusRows, now])
  const lineSeries = useMemo(
    () => Object.fromEntries(LINES.map((l) => [l, monthlySeries(pinnacleRows, statusRows, 24, now, l)])) as Record<string, MonthPoint[]>,
    [pinnacleRows, statusRows, now],
  )
  const cur = series24.slice(-months)
  const prevPeriod = series24.slice(-months * 2, -months)
  const sameLastYear = series24.slice(24 - 12 - months, 24 - 12)

  const sum = (pts: MonthPoint[], pick: (p: MonthPoint) => number) => pts.reduce((s, p) => s + pick(p), 0)
  const premiumCur = sum(cur, (p) => p.premium)
  const premiumLY = sum(sameLastYear, (p) => p.premium)
  const writtenCur = sum(cur, (p) => p.written)
  const issuedCur = sum(cur, (p) => p.issued)
  const fundedCur = sum(cur, (p) => p.funded)
  const funnel = funnelFor(cur)
  const prevFunnel = funnelFor(prevPeriod)
  const pace = useMemo(() => yearPace(pinnacleRows, now), [pinnacleRows, now])
  const trends = useMemo(() => trendTiles(series24, (p) => p.premium), [series24])
  const moved = mostMovedLine(cur, prevPeriod, LINES)

  // Breakdowns: preloaded for 12m/All; anything else is fetched on demand.
  const [bd, setBd] = useState<Record<string, BreakdownMap>>({ '12m|All': props.breakdowns })
  const bdKey = `${tf}|${line}`
  const defaultDims: BreakdownDim[] = variant === 'home' ? ['team', 'agent', 'carrier'] : ['team', 'agent', 'carrier', 'product', 'state']
  const pinnedDims = prefs?.updated_at ? prefs.pinned_breakdowns : []
  const dims: BreakdownDim[] = pinnedDims.length > 0
    ? (variant === 'home' ? pinnedDims : [...pinnedDims, ...defaultDims.filter((d) => !pinnedDims.includes(d))])
    : defaultDims
  useEffect(() => {
    if (bd[bdKey]) return
    const load = props.loadBreakdown ?? defaultLoad
    const { start, end } = timeframeWindow(tf, now)
    let cancelled = false
    Promise.all(dims.map((d) => load(d, line, start, end).catch(() => [] as BreakdownRow[]))).then((lists) => {
      if (cancelled) return
      const map: BreakdownMap = {}
      dims.forEach((d, i) => (map[d] = lists[i]))
      setBd((c) => ({ ...c, [bdKey]: map }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bdKey])
  const breakdowns = bd[bdKey] ?? bd['12m|All'] ?? {}
  const bdLoading = !bd[bdKey]

  // Hero wave: this period vs the same months last year.
  const heroLabels = cur.map((p) => p.label)
  const heroSeries = [
    { key: 'ly', label: `${year - 1}`, values: sameLastYear.map((p) => p.premium), color: INK_TINT, dashed: true, width: 1.5 },
    { key: 'cy', label: `${year}`, values: cur.map((p) => p.premium), color: INK, fill: true, width: 2.25 },
  ]
  const heroDelta = deltaOf(premiumCur, premiumLY)
  const peak = cur.reduce((b, p) => (p.premium > b.premium ? p : b), cur[0])

  // Detail (7d / 30d) — Performance only.
  const detail = useMemo(() => {
    const today = todayUTC(now)
    const win = (days: number) => {
      const s = today - (days - 1) * DAY
      const ps = s - days * DAY
      let p = 0
      let pp = 0
      let pol = 0
      let iss = 0
      let piss = 0
      for (const r of pinnacleRows) {
        const t = parseDay(r.d)
        if (t >= s && t <= today) {
          p += r.premium || 0
          pol += r.policies || 0
        } else if (t >= ps && t < s) pp += r.premium || 0
      }
      for (const r of statusRows) {
        const t = parseDay(r.d)
        if (t >= s && t <= today) iss += r.paid || 0
        else if (t >= ps && t < s) piss += r.paid || 0
      }
      return { premium: p, policies: pol, issued: iss, dPremium: deltaOf(p, pp), dIssued: deltaOf(iss, piss) }
    }
    return { d7: win(7), d30: win(30) }
  }, [pinnacleRows, statusRows, now])

  const agencyBooks = books.filter((b) => !b.isPinnacle)
  const bookSeries = useMemo(
    () => agencyBooks.map((b) => ({ ...b, pts: monthlySeries(b.rows, [], 24, now) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [books, now],
  )

  const tfLabel = TIMEFRAMES.find((t) => t.key === tf)?.label.toLowerCase() ?? ''
  const Seg = (
    <div className="cx-seg" role="tablist" aria-label="Timeframe">
      {TIMEFRAMES.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={tf === t.key} onClick={() => setTf(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  )

  const heroBlock = (
    <>
{/* ── Hero: issued premium, this period vs last year ─────────────── */}
      <section className="cx-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="cx-eyebrow">Issued premium · {tfLabel}</div>
            <div className="cx-figure-hero">{fmtMoney(premiumCur)}</div>
            <DeltaTag d={heroDelta} suffix={`vs the same months in ${year - 1}`} />
          </div>
          {Seg}
        </div>
        <div style={{ marginTop: 18 }}>
          <WaveChart series={heroSeries} labels={heroLabels} height={240} format={fmtMoney} ariaLabel={`Monthly issued premium, ${year} versus ${year - 1}`} />
        </div>
        <ul className="cx-legend">
          <li>
            <i style={{ background: INK }} /> {year}
          </li>
          <li>
            <i className="dashed" style={{ background: INK_TINT }} /> {year - 1}
          </li>
        </ul>
        <p className="cx-takeaway">
          {peak && peak.premium > 0 ? (
            <>
              Best month was <strong>{peak.longLabel}</strong> at {fmtMoney(peak.premium)}. {premiumLY > 0 ? `This period is ${deltaWords(heroDelta)} on last year.` : 'No prior-year months to compare yet.'}
            </>
          ) : (
            'No issued premium in this window yet.'
          )}
        </p>
      </section>
    </>
  )

  const trendBlock = (
    <>
{/* ── Trend tiles ───────────────────────────────────────────────── */}
      <div className="cx-grid cx-grid-3">
        {trends.map((t) => (
          <Tile key={t.key} eyebrow={t.label} figure={fmtMoney(t.current)} d={t.delta} suffix={`on the previous ${t.months} months`} spark={t.spark} />
        ))}
      </div>
    </>
  )

  const policyBlock = (
    <>
{/* ── Policy KPIs ───────────────────────────────────────────────── */}
      <div className="cx-grid cx-grid-4">
        <Tile eyebrow={`Policies written · ${tfLabel}`} figure={fmtCount(writtenCur)} d={deltaOf(writtenCur, prevFunnel.written)} suffix="on the prior period" spark={cur.map((p) => p.written)} />
        <Tile eyebrow={`Policies issued · ${tfLabel}`} figure={fmtCount(issuedCur)} d={deltaOf(issuedCur, prevFunnel.issued)} suffix="on the prior period" spark={cur.map((p) => p.issued)} />
        <Tile
          eyebrow={`Placement rate · ${tfLabel}`}
          figure={fmtPct(funnel.placement)}
          d={deltaOf(funnel.placement ?? 0, prevFunnel.placement ?? 0)}
          suffix="on the prior period"
          spark={cur.map((p) => (p.written ? p.issued / p.written : 0))}
        />
        <Tile eyebrow={`Funded premium · ${tfLabel}`} figure={fmtMoney(fundedCur)} d={deltaOf(fundedCur, sum(prevPeriod, (p) => p.funded))} suffix="on the prior period" spark={cur.map((p) => p.funded)} />
      </div>
    </>
  )

  const mixBlock = (
    <>
{/* ── Pace + product mix ────────────────────────────────────────── */}
      <div className="cx-grid cx-grid-hero">
        <section className="cx-panel">
          <div className="cx-eyebrow">Product mix · {tfLabel}</div>
          <div className="cx-grid cx-grid-3" style={{ marginTop: 12 }}>
            {LINES.map((l) => {
              const pts = lineSeries[l].slice(-months)
              const prev = lineSeries[l].slice(-months * 2, -months)
              const total = sum(pts, (p) => p.premium)
              const d = deltaOf(total, sum(prev, (p) => p.premium))
              const hot = l === moved
              return (
                <div key={l} className={hot ? 'cx-panel cx-panel-tint' : 'cx-panel'} style={{ padding: 14 }}>
                  <div className="cx-eyebrow">{l}</div>
                  <div className="cx-figure" style={{ fontSize: 22 }}>{fmtMoney(total)}</div>
                  <DeltaTag d={d} />
                  <Sparkline values={pts.map((p) => p.premium)} color={hot ? RED : INK} style={{ marginTop: 8 }} />
                </div>
              )
            })}
          </div>
          <p className="cx-takeaway">
            {moved ? (
              <>
                <strong>{moved}</strong> moved the most this period; the red line is the one to look at.
              </>
            ) : (
              'No product-line movement to call out.'
            )}
          </p>
        </section>
        <section className="cx-panel">
          <div className="cx-eyebrow">Pace · {year} vs {year - 1}</div>
          <div className="cx-figure">{fmtMoney(pace.ytd)}</div>
          <DeltaTag d={pace.vsLastYear} suffix={`vs this point in ${year - 1}`} />
          <div style={{ marginTop: 16 }}>
            <PaceMeter sofar={pace.ytd} projected={pace.projected} target={pace.lastYearTotal} format={fmtMoney} />
          </div>
          <p className="cx-takeaway">
            {pace.lastYearTotal > 0 ? (
              pace.projected >= pace.lastYearTotal ? (
                <>
                  On this run-rate {year} finishes <strong>{deltaWords(deltaOf(pace.projected, pace.lastYearTotal))}</strong> above last year.
                </>
              ) : (
                <>
                  On this run-rate {year} lands <strong>{fmtMoney(pace.lastYearTotal - pace.projected)}</strong> short of last year.
                </>
              )
            ) : (
              `${Math.round(pace.elapsed * 100)}% of the year is gone.`
            )}
          </p>
        </section>
      </div>
    </>
  )

  const statusBlock = (
    <>
{/* ── Status funnel (Performance) ───────────────────────────────── */}
      {variant === 'full' && (
        <section className="cx-panel">
          <div className="cx-eyebrow">Where policies stand · {tfLabel}</div>
          <div className="cx-funnel" style={{ marginTop: 12 }}>
            <div>
              <div className="f-n">{fmtCount(funnel.written)}</div>
              <div className="f-l">written</div>
            </div>
            <div>
              <div className="f-n">{fmtCount(funnel.issued)}</div>
              <div className="f-l">issued and paid</div>
            </div>
            <div>
              <div className="f-n">{fmtCount(funnel.pending)}</div>
              <div className="f-l">still pending</div>
            </div>
            <div>
              <div className="f-n">{fmtCount(funnel.declined + funnel.lapsed)}</div>
              <div className="f-l">declined or lapsed</div>
            </div>
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
        </section>
      )}
    </>
  )

  const breakdownsBlock = (
    <>
{/* ── Breakdowns ────────────────────────────────────────────────── */}
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
            const rows = (breakdowns[d] ?? []).slice().sort((a, b) => b.premium - a.premium)
            const lead = rows[0]
            return (
              <div key={d}>
                <div className="cx-title" style={{ marginBottom: 8 }}>{DIM_LABELS[d]}</div>
                <BarList rows={rows.map((r) => ({ label: r.label, value: Number(r.premium), hint: `${fmtCount(Number(r.policies))} policies` }))} format={fmtMoney} />
                {lead && (
                  <p className="cx-takeaway">
                    <strong>{lead.label}</strong> leads with {fmtMoney(Number(lead.premium))}.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )

  const booksBlock = (
    <>
{/* ── Agency books ──────────────────────────────────────────────── */}
      {bookSeries.length > 0 && (
        <section className="cx-panel">
          <div className="cx-eyebrow">Agency books of business · {tfLabel}</div>
          <div className="cx-grid cx-grid-3" style={{ marginTop: 12 }}>
            {bookSeries.map((b) => {
              const pts = b.pts.slice(-months)
              const prev = b.pts.slice(-months * 2, -months)
              const total = sum(pts, (p) => p.premium)
              return (
                <div key={b.baseId} className="cx-panel" style={{ padding: 14 }}>
                  <div className="cx-eyebrow">{b.label}</div>
                  <div className="cx-figure" style={{ fontSize: 22 }}>{fmtMoney(total)}</div>
                  <DeltaTag d={deltaOf(total, sum(prev, (p) => p.premium))} suffix="on the prior period" />
                  <Sparkline values={pts.map((p) => p.premium)} style={{ marginTop: 8 }} />
                  <div className="cx-takeaway">{fmtCount(sum(pts, (p) => p.policies))} policies</div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )

  const detailBlock = (
    <>
{/* ── Detail: last 7 / 30 days (Performance) ────────────────────── */}
      {variant === 'full' && (
        <section className="cx-panel">
          <div className="cx-eyebrow">Detail · recent days</div>
          <div className="cx-grid cx-grid-4" style={{ marginTop: 12 }}>
            {([
              ['Last 7 days', detail.d7],
              ['Last 30 days', detail.d30],
            ] as const).map(([lbl, w]) => (
              <div key={lbl} style={{ display: 'contents' }}>
                <div className="cx-panel" style={{ padding: 14 }}>
                  <div className="cx-eyebrow">{lbl} · premium</div>
                  <div className="cx-figure" style={{ fontSize: 22 }}>{fmtMoney(w.premium)}</div>
                  <DeltaTag d={w.dPremium} suffix="on the days before" />
                </div>
                <div className="cx-panel" style={{ padding: 14 }}>
                  <div className="cx-eyebrow">{lbl} · issued</div>
                  <div className="cx-figure" style={{ fontSize: 22 }}>{fmtCount(w.issued)}</div>
                  <DeltaTag d={w.dIssued} suffix="on the days before" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )

  const footerBlock = (
    <>
{/* ── Footer: sync + data sources ───────────────────────────────── */}
      {syncError && (
        <section className="cx-panel" style={{ borderColor: RED }}>
          <div className="cx-eyebrow" style={{ color: RED }}>Last sync failed</div>
          <p className="cx-takeaway" style={{ whiteSpace: 'pre-wrap' }}>{syncError}</p>
        </section>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p className="cx-takeaway" style={{ margin: 0 }}>
          {lastSynced ? <>Numbers refresh every morning from the book of business. Last synced {lastSynced}.</> : 'Numbers refresh every morning from the book of business.'}
        </p>
        {variant === 'home' && (
          <Link href={performanceHref} className="cx-link">
            See the full performance view →
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
    const last = series24[series24.length - 1]
    const lastLY = series24[series24.length - 13]
    const t3 = trends.find((t) => t.months === 3)
    const t6 = trends.find((t) => t.months === 6)
    const t12 = trends.find((t) => t.months === 12)
    const dom = now.getUTCDate()
    const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
    const prevMonth = series24[series24.length - 2]
    switch (id) {
      case 'ytd_premium':
        return { eyebrow: `Issued premium · ${year} to date`, figure: fmtMoney(pace.ytd), d: pace.vsLastYear, suffix: `on ${year - 1} at this point`, spark: series24.slice(-(now.getUTCMonth() + 1)).map((p) => p.premium) }
      case 'mtd_premium':
        return last ? { eyebrow: 'Issued premium · month to date', figure: fmtMoney(last.premium), d: deltaOf(last.premium, lastLY?.premium ?? 0), suffix: `on ${last.label} last year`, spark: series24.slice(-6).map((p) => p.premium) } : null
      case 'trailing_3m_premium':
        return t3 ? { eyebrow: t3.label, figure: fmtMoney(t3.current), d: t3.delta, suffix: 'on the previous 3 months', spark: t3.spark } : null
      case 'trailing_6m_premium':
        return t6 ? { eyebrow: t6.label, figure: fmtMoney(t6.current), d: t6.delta, suffix: 'on the previous 6 months', spark: t6.spark } : null
      case 'trailing_12m_premium':
        return t12 ? { eyebrow: t12.label, figure: fmtMoney(t12.current), d: t12.delta, suffix: 'on the previous 12 months', spark: t12.spark } : null
      case 'policies_issued':
        return { eyebrow: `Policies issued · ${tfLabel}`, figure: fmtCount(issuedCur), d: deltaOf(issuedCur, prevFunnel.issued), suffix: 'on the prior period', spark: cur.map((p) => p.issued) }
      case 'policies_submitted':
        return { eyebrow: `Policies written · ${tfLabel}`, figure: fmtCount(writtenCur), d: deltaOf(writtenCur, prevFunnel.written), suffix: 'on the prior period', spark: cur.map((p) => p.written) }
      case 'placement_pct':
        return { eyebrow: `Placement rate · ${tfLabel}`, figure: fmtPct(funnel.placement), d: deltaOf(funnel.placement ?? 0, prevFunnel.placement ?? 0), suffix: 'on the prior period', spark: cur.map((p) => (p.written ? p.issued / p.written : 0)) }
      case 'avg_premium_per_policy': {
        const avg = issuedCur > 0 ? premiumCur / issuedCur : 0
        const prevAvg = prevFunnel.issued > 0 ? sum(prevPeriod, (p) => p.premium) / prevFunnel.issued : 0
        return { eyebrow: `Average premium per policy · ${tfLabel}`, figure: fmtMoney(avg), d: deltaOf(avg, prevAvg), suffix: 'on the prior period', spark: cur.map((p) => (p.issued ? p.premium / p.issued : 0)) }
      }
      case 'projected_month_end': {
        if (!last) return null
        const projected = dom > 0 ? (last.premium / dom) * dim : last.premium
        return { eyebrow: 'Projected month end', figure: fmtMoney(projected), d: deltaOf(projected, prevMonth?.premium ?? 0), suffix: 'on last month', spark: [...series24.slice(-6, -1).map((p) => p.premium), projected] }
      }
      default:
        return null
    }
  }

  // ── Layout: the executive's (or their AI's) saved preferences ─────────
  // Untouched prefs (updated_at null) draw the full default layout.
  const customised = !!prefs && prefs.updated_at !== null
  const hidden = new Set(prefs?.hidden_sections ?? [])
  const order: DashboardTile[] = customised ? prefs!.tiles : DEFAULT_ORDER

  const pinnedKpiBlock = customised && prefs!.pinned_kpis.length > 0 ? (
    <div className="cx-grid cx-grid-4">
      {prefs!.pinned_kpis.map((k) => {
        const t = kpi(k)
        return t ? <Tile key={k} eyebrow={t.eyebrow} figure={t.figure} d={t.d} suffix={t.suffix} spark={t.spark} /> : null
      })}
    </div>
  ) : null

  const kpisBlock = pinnedKpiBlock ?? (
    <>
      {!hidden.has('trend_tiles') && trendBlock}
      {!hidden.has('policy_tiles') && policyBlock}
    </>
  )

  const headlineBlock = prefs?.headline_note ? (
    <section className="cx-panel" style={{ borderLeft: `3px solid ${RED}` }}>
      <div className="cx-eyebrow">This week</div>
      <p className="cx-takeaway" style={{ fontSize: 16, color: 'var(--cx-ink, #1C1B1A)', margin: '4px 0 0' }}>{prefs.headline_note}</p>
    </section>
  ) : null

  const notesBlock = prefs && prefs.notes.length > 0 ? (
    <section className="cx-panel">
      <div className="cx-eyebrow">Notes for the team</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
        {prefs.notes.slice().reverse().map((n) => (
          <li key={n.id} style={{ fontSize: 14 }}>
            {n.text}
            <span style={{ color: 'var(--cx-muted)', fontSize: 12, marginLeft: 8 }}>{n.author} · {n.created_at.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </section>
  ) : null

  const blocks: Record<DashboardTile, ReactNode> = {
    headline: headlineBlock,
    kpis: kpisBlock,
    premium_trend: heroBlock,
    product_mix: mixBlock,
    status_funnel: statusBlock,
    breakdowns: breakdownsBlock,
    agency_books: booksBlock,
    meetings: null, // meetings live on the Calendar page; nothing to draw here
    notes: notesBlock,
  }

  return (
    <div className="cx-grid">
      {order.filter((k) => !hidden.has(k)).map((k) => (
        <Fragment key={k}>{blocks[k]}</Fragment>
      ))}
      {!hidden.has('detail') && detailBlock}
      {footerBlock}
    </div>
  )
}
