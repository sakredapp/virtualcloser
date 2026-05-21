'use client'

import { useMemo, useState } from 'react'
import {
  type DailyRow,
  type ProductLine,
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

function buildBuckets(rows: DailyRow[], preset: Preset): Bucket[] {
  const now = Date.now()
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  let startT: number
  let endT: number
  if (preset.spanDays === null) {
    const y = new Date(now).getUTCFullYear()
    startT = Date.UTC(y, 0, 1)
    endT = Date.UTC(y, 11, 31)
  } else {
    endT = today
    startT = today - (preset.spanDays - 1) * DAY
    if (preset.grain === 'month') startT = startOfMonthUTC(startT)
    if (preset.grain === 'week') startT = startOfWeekUTC(startT)
  }

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
              background: active ? 'var(--ink, #0f0f0f)' : 'transparent',
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

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export default function PinnacleDashboard({ pinnacleRows }: { pinnacleRows: DailyRow[] }) {
  const [presetKey, setPresetKey] = useState('monthly')
  const [line, setLine] = useState<LineFilter>('All')
  const [model, setModel] = useState<Model>('blend')

  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[2]

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
