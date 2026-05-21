'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type DailyRow,
  type StatusRow,
  type BreakdownRow,
  type BreakdownDim,
  type ProductLine,
  BREAKDOWN_DIMS,
  PRODUCT_LINES,
  LINE_COLOR,
} from '@/lib/pinnacle/rollup'

/* ------------------------------------------------------------------ */
/* Time / money helpers                                                */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
function parseDay(s: string): number {
  // 'YYYY-MM-DD' parsed as UTC midnight for stable, TZ-free bucketing.
  return Date.parse(`${s}T00:00:00Z`)
}
function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtMoneyFull(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}

/* ------------------------------------------------------------------ */
/* Timeframe presets                                                   */
/* ------------------------------------------------------------------ */

type Grain = 'day' | 'week' | 'month'
type Preset = {
  key: string
  label: string
  grain: Grain
  /** window length in days back from today; null = current calendar year */
  spanDays: number | null
}
const PRESETS: Preset[] = [
  { key: 'daily', label: 'Daily', grain: 'day', spanDays: 30 },
  { key: 'weekly', label: 'Weekly', grain: 'week', spanDays: 7 * 12 },
  { key: 'monthly', label: 'Monthly', grain: 'month', spanDays: 365 },
  { key: '3m', label: '3-Month', grain: 'week', spanDays: 92 },
  { key: '6m', label: '6-Month', grain: 'month', spanDays: 183 },
  { key: 'yearly', label: 'Yearly', grain: 'month', spanDays: null },
]
const PERIODS_PER_YEAR: Record<Grain, number> = { day: 365, week: 52, month: 12 }

type LineFilter = 'All' | ProductLine

type Bucket = {
  key: string
  label: string
  start: number
  end: number // exclusive
  byLine: Record<ProductLine, number>
  premium: number
  policies: number
  fundedPremium: number
  complete: boolean
}

function startOfWeekUTC(t: number): number {
  const d = new Date(t)
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  return t - dow * DAY
}
function startOfMonthUTC(t: number): number {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

function bucketBoundaries(startT: number, endT: number, grain: Grain): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let cur =
    grain === 'day' ? startT : grain === 'week' ? startOfWeekUTC(startT) : startOfMonthUTC(startT)
  while (cur <= endT) {
    let next: number
    if (grain === 'day') next = cur + DAY
    else if (grain === 'week') next = cur + 7 * DAY
    else {
      const d = new Date(cur)
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    }
    out.push({ start: cur, end: next })
    cur = next
  }
  return out
}

function bucketLabel(start: number, grain: Grain): string {
  const d = new Date(start)
  if (grain === 'month')
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  if (grain === 'week')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
}

/* ------------------------------------------------------------------ */
/* Bucketing                                                           */
/* ------------------------------------------------------------------ */

function todayUTC(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** Resolve a preset to its [start, end] window (ms, UTC midnight). */
function presetWindow(preset: Preset): { startT: number; endT: number } {
  const today = todayUTC()
  if (preset.spanDays === null) {
    const y = new Date().getUTCFullYear()
    return { startT: Date.UTC(y, 0, 1), endT: Date.UTC(y, 11, 31) }
  }
  let startT = today - (preset.spanDays - 1) * DAY
  if (preset.grain === 'month') startT = startOfMonthUTC(startT)
  if (preset.grain === 'week') startT = startOfWeekUTC(startT)
  return { startT, endT: today }
}

function toISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

function buildBuckets(rows: DailyRow[], preset: Preset): Bucket[] {
  const today = todayUTC()
  const { startT, endT } = presetWindow(preset)

  const boundaries = bucketBoundaries(startT, endT, preset.grain)
  const buckets: Bucket[] = boundaries.map((b) => ({
    key: String(b.start),
    label: bucketLabel(b.start, preset.grain),
    start: b.start,
    end: b.end,
    byLine: { Health: 0, Life: 0, Annuity: 0 },
    premium: 0,
    policies: 0,
    fundedPremium: 0,
    complete: b.end <= today,
  }))
  if (buckets.length === 0) return buckets

  const firstStart = buckets[0].start
  const lastEnd = buckets[buckets.length - 1].end
  for (const r of rows) {
    const t = parseDay(r.d)
    if (t < firstStart || t >= lastEnd) continue
    // locate bucket (small N, linear is fine)
    const idx = buckets.findIndex((b) => t >= b.start && t < b.end)
    if (idx === -1) continue
    const bk = buckets[idx]
    if (r.line === 'Health' || r.line === 'Life' || r.line === 'Annuity') {
      bk.byLine[r.line] += r.premium
    }
    bk.premium += r.premium
    bk.policies += r.policies
    bk.fundedPremium += r.funded_premium ?? 0
  }
  return buckets
}

function lineValue(b: Bucket, line: LineFilter): number {
  return line === 'All' ? b.premium : b.byLine[line]
}

/* ------------------------------------------------------------------ */
/* Growth + projection models                                          */
/* ------------------------------------------------------------------ */

type Model = 'runrate' | 'blend' | 'compound'
const MODELS: { key: Model; label: string; blurb: string }[] = [
  { key: 'runrate', label: 'Run-rate', blurb: 'Last full period × periods/yr. No growth assumed.' },
  { key: 'blend', label: 'Trend blend', blurb: 'Average of run-rate and compounded trend.' },
  { key: 'compound', label: 'Compounding', blurb: 'Trailing growth % compounded forward.' },
]

type Projection = {
  growth: number // trailing avg period-over-period growth
  lastComplete: number
  nextPeriod: number
  annualized: number
  hasData: boolean
}

function project(buckets: Bucket[], line: LineFilter, grain: Grain, model: Model): Projection {
  const complete = buckets.filter((b) => b.complete).map((b) => lineValue(b, line))
  // trailing growth over the last (up to) 6 complete periods
  const tail = complete.slice(-7)
  const deltas: number[] = []
  for (let i = 1; i < tail.length; i++) {
    if (tail[i - 1] > 0) deltas.push(tail[i] / tail[i - 1] - 1)
  }
  const growth = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0
  const lastComplete = complete.length ? complete[complete.length - 1] : 0
  const ppy = PERIODS_PER_YEAR[grain]

  const runrateAnnual = lastComplete * ppy
  let compoundAnnual = 0
  for (let k = 1; k <= ppy; k++) compoundAnnual += lastComplete * Math.pow(1 + growth, k)

  let annualized: number
  let nextPeriod: number
  if (model === 'runrate') {
    annualized = runrateAnnual
    nextPeriod = lastComplete
  } else if (model === 'compound') {
    annualized = compoundAnnual
    nextPeriod = lastComplete * (1 + growth)
  } else {
    annualized = (runrateAnnual + compoundAnnual) / 2
    nextPeriod = lastComplete * (1 + growth)
  }
  return { growth, lastComplete, nextPeriod, annualized, hasData: complete.length >= 2 }
}

/* ------------------------------------------------------------------ */
/* Insurance health (disposition) metrics                              */
/* ------------------------------------------------------------------ */

type StatusBucket = {
  key: string
  label: string
  start: number
  end: number
  complete: boolean
  total: number
  paid: number
  declined: number
  lapsed: number
  submitted: number
}

function buildStatusBuckets(rows: StatusRow[], preset: Preset, line: LineFilter): StatusBucket[] {
  const today = todayUTC()
  const { startT, endT } = presetWindow(preset)
  const boundaries = bucketBoundaries(startT, endT, preset.grain)
  const buckets: StatusBucket[] = boundaries.map((b) => ({
    key: String(b.start),
    label: bucketLabel(b.start, preset.grain),
    start: b.start,
    end: b.end,
    complete: b.end <= today,
    total: 0,
    paid: 0,
    declined: 0,
    lapsed: 0,
    submitted: 0,
  }))
  if (buckets.length === 0) return buckets
  const firstStart = buckets[0].start
  const lastEnd = buckets[buckets.length - 1].end
  for (const r of rows) {
    if (line !== 'All' && r.line !== line) continue
    const t = parseDay(r.d)
    if (t < firstStart || t >= lastEnd) continue
    const bk = buckets.find((b) => t >= b.start && t < b.end)
    if (!bk) continue
    bk.total += r.total
    bk.paid += r.paid
    bk.declined += r.declined
    bk.lapsed += r.lapsed
    bk.submitted += r.submitted
  }
  return buckets
}

type HealthSummary = {
  total: number
  paid: number
  declined: number
  lapsed: number
  submitted: number
  placement: number // paid / total
  decline: number // declined / total
  lapse: number // lapsed / (paid + lapsed)
  inProgress: number // submitted / total
  placementDelta: number | null // last vs prior complete bucket
  placementProjected: number | null // next-period placement, trend-extrapolated
}

function summarizeHealth(buckets: StatusBucket[]): HealthSummary {
  const total = buckets.reduce((s, b) => s + b.total, 0)
  const paid = buckets.reduce((s, b) => s + b.paid, 0)
  const declined = buckets.reduce((s, b) => s + b.declined, 0)
  const lapsed = buckets.reduce((s, b) => s + b.lapsed, 0)
  const submitted = buckets.reduce((s, b) => s + b.submitted, 0)

  const rate = (num: number, den: number) => (den > 0 ? num / den : 0)
  const complete = buckets.filter((b) => b.complete && b.total > 0)
  const placeSeries = complete.map((b) => rate(b.paid, b.total))

  let placementDelta: number | null = null
  if (placeSeries.length >= 2) {
    placementDelta = placeSeries[placeSeries.length - 1] - placeSeries[placeSeries.length - 2]
  }
  let placementProjected: number | null = null
  if (placeSeries.length >= 2) {
    const tail = placeSeries.slice(-4)
    const deltas: number[] = []
    for (let i = 1; i < tail.length; i++) deltas.push(tail[i] - tail[i - 1])
    const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length)
    placementProjected = Math.min(1, Math.max(0, placeSeries[placeSeries.length - 1] + avg))
  }

  return {
    total,
    paid,
    declined,
    lapsed,
    submitted,
    placement: rate(paid, total),
    decline: rate(declined, total),
    lapse: rate(lapsed, paid + lapsed),
    inProgress: rate(submitted, total),
    placementDelta,
    placementProjected,
  }
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ */
/* UI bits                                                             */
/* ------------------------------------------------------------------ */

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string; color?: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        gap: 4,
        background: 'var(--paper-2, #f1efe9)',
        border: '1px solid var(--border-soft)',
        borderRadius: 10,
        padding: 4,
      }}
    >
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              cursor: 'pointer',
              borderRadius: 7,
              padding: '7px 13px',
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              color: active ? 'var(--text-inv, #fff)' : 'var(--text)',
              background: active ? 'var(--ink)' : 'transparent',
              transition: 'background 120ms ease',
            }}
          >
            {o.color && (
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: o.color,
                  display: 'inline-block',
                }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  accent?: string
}) {
  return (
    <div
      className="card"
      style={{ padding: 16, borderTop: accent ? `3px solid ${accent}` : undefined }}
    >
      <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

/** Stacked bar chart, inline SVG. Stacks Health/Life/Annuity when line=All. */
function BarChart({ buckets, line }: { buckets: Bucket[]; line: LineFilter }) {
  const W = 100 // viewBox units; scales to container
  const H = 34
  const n = buckets.length
  if (n === 0) return null
  const max = Math.max(1, ...buckets.map((b) => lineValue(b, line)))
  const gap = 0.18
  const bw = (W / n) * (1 - gap)
  const stackLines: ProductLine[] = line === 'All' ? PRODUCT_LINES : [line as ProductLine]

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 140, display: 'block' }}>
        {buckets.map((b, i) => {
          const x = (W / n) * i + ((W / n) * gap) / 2
          let yCursor = H
          const segs: React.ReactNode[] = []
          for (const ln of stackLines) {
            const v = line === 'All' ? b.byLine[ln] : lineValue(b, line)
            const h = (v / max) * (H - 1)
            if (h <= 0) continue
            yCursor -= h
            segs.push(
              <rect
                key={ln}
                x={x}
                y={yCursor}
                width={bw}
                height={h}
                fill={LINE_COLOR[ln]}
                opacity={b.complete ? 0.95 : 0.4}
                rx={0.5}
              >
                <title>{`${b.label} · ${ln}: ${fmtMoneyFull(v)}`}</title>
              </rect>,
            )
          }
          return <g key={b.key}>{segs}</g>
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {buckets.map((b, i) => (
          <span
            key={b.key}
            style={{
              fontSize: 9.5,
              color: 'var(--muted)',
              flex: 1,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              // thin out labels when crowded
              visibility: n > 16 && i % 2 === 1 ? 'hidden' : 'visible',
            }}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Horizontal disposition mix bar: Paid / Declined / Lapsed / In-progress. */
function DispositionBar({ h }: { h: HealthSummary }) {
  const segs = [
    { label: 'Issue-Paid', n: h.paid, color: 'var(--signal-ok)' },
    { label: 'Lapsed', n: h.lapsed, color: '#d97706' },
    { label: 'Declined', n: h.declined, color: 'var(--red-deep, #c21a00)' },
    { label: 'In-progress', n: h.submitted, color: '#9ca3af' },
  ].filter((s) => s.n > 0)
  const sum = segs.reduce((a, b) => a + b.n, 0) || 1
  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-soft)' }}>
        {segs.map((s) => (
          <div key={s.label} style={{ width: `${(s.n / sum) * 100}%`, background: s.color }} title={`${s.label}: ${fmtNum(s.n)}`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 12 }}>
        {segs.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
            {s.label} · {fmtNum(s.n)} ({((s.n / sum) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
    </div>
  )
}

const DIM_LABEL: Record<BreakdownDim, string> = {
  team: 'Team',
  agent: 'Agent',
  carrier: 'Carrier',
  state: 'State',
  product: 'Product',
}

function Breakdowns({ line, start, end }: { line: LineFilter; start: string; end: string }) {
  const [dim, setDim] = useState<BreakdownDim>('team')
  const [rows, setRows] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ dim, line, start, end })
    fetch(`/api/pinnacle/breakdown?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!cancelled) setRows((json.rows ?? []) as BreakdownRow[])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dim, line, start, end])

  const totalPremium = rows.reduce((s, r) => s + r.premium, 0)

  return (
    <section className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Breakdowns</h2>
        <Segmented
          options={BREAKDOWN_DIMS.map((d) => ({ key: d, label: DIM_LABEL[d] }))}
          value={dim}
          onChange={setDim}
        />
      </header>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>
        Top {DIM_LABEL[dim].toLowerCase()}s by premium · {line === 'All' ? 'all lines' : line} · current timeframe.
      </p>

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        {error ? (
          <p style={{ color: 'var(--red-deep)', fontSize: 13 }}>Couldn’t load breakdown: {error}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, opacity: loading ? 0.5 : 1, transition: 'opacity 120ms' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-soft)', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px', width: 28 }}>#</th>
                <th style={{ padding: '6px 8px' }}>{DIM_LABEL[dim]}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Premium</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Share</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Policies</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Placement</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} style={{ padding: '14px 8px', color: 'var(--muted)' }}>
                    No data in this window.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const placement = r.policies > 0 ? r.paid / r.policies : 0
                const share = totalPremium > 0 ? r.premium / totalPremium : 0
                return (
                  <tr key={r.label} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.label}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoneyFull(r.premium)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted)' }}>{(share * 100).toFixed(1)}%</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtNum(r.policies)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: placement >= 0.6 ? 'var(--signal-ok)' : 'var(--muted)' }}>
                      {(placement * 100).toFixed(0)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 12 }}
          onClick={() =>
            downloadCsv(
              `pinnacle-${dim}-${line}-${start}_${end}.csv`,
              [DIM_LABEL[dim], 'Premium', 'Policies', 'Issue-Paid', 'Declined', 'Lapsed', 'Placement %'],
              rows.map((r) => [
                r.label,
                r.premium,
                r.policies,
                r.paid,
                r.declined,
                r.lapsed,
                r.policies > 0 ? ((r.paid / r.policies) * 100).toFixed(1) : '0',
              ]),
            )
          }
        >
          Export {DIM_LABEL[dim]} CSV
        </button>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export default function PinnacleDashboard({
  pinnacleRows,
  statusRows,
}: {
  pinnacleRows: DailyRow[]
  statusRows: StatusRow[]
}) {
  const [presetKey, setPresetKey] = useState('monthly')
  const [line, setLine] = useState<LineFilter>('All')
  const [model, setModel] = useState<Model>('blend')

  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[2]
  const window = useMemo(() => presetWindow(preset), [preset])
  const windowISO = useMemo(() => ({ start: toISO(window.startT), end: toISO(window.endT) }), [window])

  const health = useMemo(
    () => summarizeHealth(buildStatusBuckets(statusRows, preset, line)),
    [statusRows, preset, line],
  )

  const linesPresent = useMemo(() => {
    const set = new Set<ProductLine>()
    for (const r of pinnacleRows) {
      if ((r.line === 'Health' || r.line === 'Life' || r.line === 'Annuity') && r.premium > 0) {
        set.add(r.line)
      }
    }
    return set
  }, [pinnacleRows])

  const buckets = useMemo(() => buildBuckets(pinnacleRows, preset), [pinnacleRows, preset])

  const totals = useMemo(() => {
    let premium = 0
    let policies = 0
    let funded = 0
    for (const b of buckets) {
      premium += lineValue(b, line)
      if (line === 'All') {
        policies += b.policies
        funded += b.fundedPremium
      } else {
        // policy + funded counts aren't split per line in the payload; show
        // them only for the All view to avoid implying a false split.
      }
    }
    return { premium, policies, funded }
  }, [buckets, line])

  // period-over-period delta: last complete vs prior complete
  const periodDelta = useMemo(() => {
    const complete = buckets.filter((b) => b.complete).map((b) => lineValue(b, line))
    if (complete.length < 2) return null
    const last = complete[complete.length - 1]
    const prev = complete[complete.length - 2]
    if (prev === 0) return null
    return last / prev - 1
  }, [buckets, line])

  const proj = useMemo(() => project(buckets, line, preset.grain, model), [buckets, line, preset.grain, model])

  const grainNoun = preset.grain === 'day' ? 'day' : preset.grain === 'week' ? 'week' : 'month'

  const lineOptions: { key: LineFilter; label: string; color?: string }[] = [
    { key: 'All', label: 'All lines' },
    ...PRODUCT_LINES.map((l) => ({ key: l as LineFilter, label: l, color: LINE_COLOR[l] })),
  ]

  return (
    <>
      {/* Controls */}
      <section
        className="card"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>
            Timeframe
          </span>
          <Segmented options={PRESETS.map((p) => ({ key: p.key, label: p.label }))} value={presetKey} onChange={setPresetKey} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>
            Product line
          </span>
          <Segmented options={lineOptions} value={line} onChange={setLine} />
        </div>
      </section>

      {/* KPI row */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Stat
          label={`${line === 'All' ? 'Total' : line} premium`}
          value={fmtMoney(totals.premium)}
          accent={line === 'All' ? 'var(--ink)' : LINE_COLOR[line]}
          sub={
            periodDelta != null ? (
              <span style={{ color: periodDelta >= 0 ? 'var(--signal-ok)' : 'var(--red-deep)' }}>
                {fmtPct(periodDelta)} vs prior {grainNoun}
              </span>
            ) : (
              'effective-dated premium in window'
            )
          }
        />
        <Stat
          label="Policies"
          value={line === 'All' ? fmtNum(totals.policies) : '—'}
          sub={line === 'All' ? 'issued in window' : 'select All lines'}
        />
        <Stat
          label="Funded (Issue-Paid)"
          value={line === 'All' ? fmtMoney(totals.funded) : '—'}
          sub={line === 'All' ? 'premium with paid status' : 'select All lines'}
          accent="var(--signal-ok)"
        />
        <Stat
          label={`Avg / ${grainNoun}`}
          value={fmtMoney(buckets.filter((b) => b.complete).length ? totals.premium / Math.max(1, buckets.filter((b) => b.complete).length) : 0)}
          sub={`${buckets.length} ${grainNoun}s shown`}
        />
      </section>

      {/* Trend chart */}
      <section className="card">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>
            Premium by {grainNoun} {line !== 'All' && <span style={{ color: LINE_COLOR[line] }}>· {line}</span>}
          </h2>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {line === 'All' && (
              <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                {PRODUCT_LINES.map((l) => (
                  <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--muted)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: LINE_COLOR[l] }} />
                    {l}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                downloadCsv(
                  `pinnacle-premium-${line}-${preset.key}.csv`,
                  ['Period', 'Premium', 'Policies', 'Funded premium', 'Complete'],
                  buckets.map((b) => [b.label, Math.round(lineValue(b, line)), b.policies, Math.round(b.fundedPremium), b.complete ? 'yes' : 'in-progress']),
                )
              }
            >
              Export CSV
            </button>
          </div>
        </header>
        <div style={{ marginTop: 14 }}>
          <BarChart buckets={buckets} line={line} />
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, marginBottom: 0 }}>
          Faded bar = current {grainNoun} in progress. Bucketed by policy Effective Date.
        </p>
      </section>

      {/* Growth + projections */}
      <section className="card" style={{ borderTop: '3px solid var(--signal-info)' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Growth &amp; projection</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Based on the last {Math.min(6, buckets.filter((b) => b.complete).length)} complete {grainNoun}s
              {line !== 'All' ? ` · ${line}` : ''}.
            </p>
          </div>
          <Segmented options={MODELS.map((m) => ({ key: m.key, label: m.label }))} value={model} onChange={setModel} />
        </header>

        {!proj.hasData ? (
          <p style={{ color: 'var(--muted)', marginTop: 14, marginBottom: 0 }}>
            Not enough complete {grainNoun}s in this window to project. Try a wider timeframe.
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 14 }}>
              <Stat
                label={`Trailing growth / ${grainNoun}`}
                value={fmtPct(proj.growth)}
                accent={proj.growth >= 0 ? 'var(--signal-ok)' : 'var(--red-deep)'}
                sub="avg period-over-period"
              />
              <Stat label={`Last full ${grainNoun}`} value={fmtMoneyFull(proj.lastComplete)} sub="actual" />
              <Stat
                label={`Projected next ${grainNoun}`}
                value={fmtMoneyFull(proj.nextPeriod)}
                accent="var(--signal-info)"
                sub={MODELS.find((m) => m.key === model)?.label}
              />
              <Stat
                label="Projected annual"
                value={fmtMoney(proj.annualized)}
                accent="var(--signal-info)"
                sub={`${fmtMoneyFull(proj.annualized)} run-rate`}
              />
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, marginBottom: 0 }}>
              <strong>{MODELS.find((m) => m.key === model)?.label}:</strong>{' '}
              {MODELS.find((m) => m.key === model)?.blurb} Projections are directional, not guaranteed.
            </p>
          </>
        )}
      </section>

      {/* Insurance health */}
      <section className="card" style={{ borderTop: '3px solid var(--signal-ok)' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>
            Insurance health {line !== 'All' && <span style={{ color: LINE_COLOR[line] }}>· {line}</span>}
          </h2>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtNum(health.total)} apps in window</span>
        </header>

        {health.total === 0 ? (
          <p style={{ color: 'var(--muted)', marginTop: 12, marginBottom: 0 }}>No applications in this window.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 14 }}>
              <Stat
                label="Placement rate"
                value={`${(health.placement * 100).toFixed(1)}%`}
                accent="var(--signal-ok)"
                sub={
                  health.placementDelta != null ? (
                    <span style={{ color: health.placementDelta >= 0 ? 'var(--signal-ok)' : 'var(--red-deep)' }}>
                      {fmtPct(health.placementDelta)} pts vs prior {grainNoun}
                    </span>
                  ) : (
                    'paid ÷ total apps'
                  )
                }
              />
              <Stat label="Decline rate" value={`${(health.decline * 100).toFixed(1)}%`} accent="var(--red-deep)" sub="declined ÷ total" />
              <Stat label="Lapse rate" value={`${(health.lapse * 100).toFixed(1)}%`} accent="#d97706" sub="lapsed ÷ (paid + lapsed)" />
              <Stat
                label="Projected placement"
                value={health.placementProjected != null ? `${(health.placementProjected * 100).toFixed(1)}%` : '—'}
                accent="var(--signal-info)"
                sub={`next ${grainNoun}, trend`}
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Disposition mix</div>
              <DispositionBar h={health} />
            </div>
          </>
        )}
      </section>

      {/* Breakdowns */}
      <Breakdowns line={line} start={windowISO.start} end={windowISO.end} />

      {!linesPresent.has('Annuity') && (
        <section className="card" style={{ borderColor: 'var(--signal-warn)' }}>
          <strong>Annuity line not synced yet.</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Health and Life come from the Pinnacle master base. Once the Annuity table is added to the
            Airtable sync, the <span style={{ color: LINE_COLOR.Annuity, fontWeight: 600 }}>Annuity</span>{' '}
            swatch populates automatically — no code change needed.
          </p>
        </section>
      )}
    </>
  )
}
