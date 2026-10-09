'use client'

/**
 * Inline-SVG charts for the executive suite. No chart library: a monotone
 * cubic "wave" line with a soft gradient fill, a sparkline, a horizontal
 * bar list and a pace meter. Colours come from the --cx-chart-* tokens in
 * app/globals.css (Pinnacle black / silver / white, light and dark): black for
 * the primary series and the one thing worth pointing at, silver for
 * comparison series, dashed silver-dark for averages and reference lines.
 * Every colour is a CSS var, applied through `style` so it resolves in SVG.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { fmtMoney, fmtCount } from '@/lib/pinnacle/kpis'

/**
 * Serialisable formatter key. Server components cannot hand a function to a
 * client component (React throws), so a page rendered on the server passes
 * `formatKind` and the chart formats here on the client.
 */
export type FormatKind = 'usd' | 'count' | 'pct'
export function formatterFor(kind: FormatKind | undefined, fallback?: (n: number) => string): (n: number) => string {
  if (fallback) return fallback
  if (kind === 'count') return fmtCount
  if (kind === 'pct') return (n: number) => `${Math.round(n)}%`
  return fmtMoney
}

/** Primary series, and "the one thing to point at" (latest cohort, current month). */
export const INK = 'var(--cx-chart-1)'
export const POINT = INK
/** Comparison series. */
export const SILVER = 'var(--cx-chart-2)'
/** Averages and reference lines: draw dashed. */
export const REF = 'var(--cx-chart-ref)'
/** Gridlines and empty tracks. */
export const GRID = 'var(--cx-chart-grid)'
/** Tints for third and fourth series (donut slices, stacked books). */
export const INK_TINT = SILVER
export const INK_TINT_2 = 'var(--cx-chart-3)'
export const INK_TINT_3 = GRID
/** Real failures only (a sync that failed), never a highlight. */
export const ERROR = 'var(--cx-error)'

type Pt = { x: number; y: number }

/** Fritsch–Carlson monotone cubic: smooth, never overshoots the data. */
export function wavePath(pts: Pt[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const dx: number[] = []
  const dy: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x)
    dy.push(pts[i + 1].y - pts[i].y)
    m.push(dx[i] === 0 ? 0 : dy[i] / dx[i])
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0)
    else t.push((m[i - 1] + m[i]) / 2)
  }
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      t[i] = tau * a * m[i]
      t[i + 1] = tau * b * m[i]
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]
    const c1x = pts[i].x + h / 3
    const c1y = pts[i].y + (t[i] * h) / 3
    const c2x = pts[i + 1].x - h / 3
    const c2y = pts[i + 1].y - (t[i + 1] * h) / 3
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`
  }
  return d
}

export function waveArea(pts: Pt[], baseline: number): string {
  if (pts.length === 0) return ''
  return `${wavePath(pts)} L${pts[pts.length - 1].x.toFixed(2)},${baseline} L${pts[0].x.toFixed(2)},${baseline} Z`
}

export function niceCeil(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / p
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * p
}

function useWidth<T extends HTMLElement>(fallback = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width
      if (cw && cw > 0) setW(cw)
    })
    ro.observe(el)
    setW(el.getBoundingClientRect().width || fallback)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, w]
}

export type WaveSeries = {
  key: string
  label: string
  values: number[]
  color?: string
  dashed?: boolean
  /** Fill under the line (only the highlighted series should). */
  fill?: boolean
  width?: number
}

export function WaveChart({
  series,
  labels,
  height = 220,
  format = (n) => String(n),
  ariaLabel,
  showTicks = true,
  padTop = 14,
  ticks,
  markers,
}: {
  series: WaveSeries[]
  labels: string[]
  height?: number
  format?: (n: number) => string
  ariaLabel?: string
  showTicks?: boolean
  padTop?: number
  /** Label indexes to tick; default first / middle / last. */
  ticks?: number[]
  /** Dashed vertical markers (e.g. the 10-month mark). */
  markers?: Array<{ index: number; label: string }>
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const gid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  const padL = 6
  const padR = 6
  const padB = showTicks ? 22 : 4
  const plotW = Math.max(10, width - padL - padR)
  const plotH = Math.max(10, height - padTop - padB)
  const max = niceCeil(Math.max(1, ...series.flatMap((s) => s.values)))
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yAt = (v: number) => padTop + plotH - (Math.max(0, v) / max) * plotH
  const baseline = padTop + plotH

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left - padL
    const i = n <= 1 ? 0 : Math.round((x / plotW) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  const tickIdx = ticks ?? (n <= 4 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1])

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ display: 'block', overflow: 'visible', touchAction: 'none' }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopOpacity={0.22} style={{ stopColor: s.color ?? INK }} />
              <stop offset="65%" stopOpacity={0.05} style={{ stopColor: s.color ?? INK }} />
              <stop offset="100%" stopOpacity={0} style={{ stopColor: s.color ?? INK }} />
            </linearGradient>
          ))}
        </defs>
        {/* Recessive grid: top rule dashed, base rule solid. */}
        <line x1={padL} x2={padL + plotW} y1={padTop} y2={padTop} strokeDasharray="3 4" style={{ stroke: GRID }} />
        <line x1={padL} x2={padL + plotW} y1={(padTop + baseline) / 2} y2={(padTop + baseline) / 2} strokeDasharray="3 4" style={{ stroke: GRID }} />
        <line x1={padL} x2={padL + plotW} y1={baseline} y2={baseline} strokeOpacity={0.18} style={{ stroke: INK }} />
        {series.map((s) => {
          const pts = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
          return (
            <g key={s.key}>
              {s.fill && <path d={waveArea(pts, baseline)} fill={`url(#${gid}-${s.key})`} className="cx-fade" />}
              <path
                d={wavePath(pts)}
                fill="none"
                strokeWidth={s.width ?? 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? '4 5' : undefined}
                pathLength={s.dashed ? undefined : 1}
                className={s.dashed ? undefined : 'cx-draw'}
                style={{ stroke: s.color ?? INK }}
              />
            </g>
          )
        })}
        {markers?.map((m) => (
          <g key={m.label}>
            <line x1={xAt(m.index)} x2={xAt(m.index)} y1={padTop} y2={baseline} strokeOpacity={0.55} strokeDasharray="4 4" style={{ stroke: INK }} />
            <text x={xAt(m.index) + 5} y={padTop + 11} fontSize={11} fillOpacity={0.7} style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fill: INK }}>
              {m.label}
            </text>
          </g>
        ))}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={padTop} y2={baseline} strokeOpacity={0.25} style={{ stroke: INK }} />
            {series.map((s) =>
              s.values[hover] == null ? null : <circle key={s.key} cx={xAt(hover)} cy={yAt(s.values[hover])} r={4} strokeWidth={2} style={{ fill: s.color ?? INK, stroke: 'var(--cx-surface)' }} />,
            )}
          </g>
        )}
        {showTicks &&
          tickIdx.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 6}
              fontSize={11}
              fillOpacity={0.5}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fill: INK }}
            >
              {labels[i]}
            </text>
          ))}
        {showTicks && (
          <text x={padL + plotW} y={padTop - 4} fontSize={10} fillOpacity={0.45} textAnchor="end" style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fill: INK }}>
            {format(max)}
          </text>
        )}
      </svg>
      {hover != null && (
        <div className="cx-wave-tip" style={{ left: xAt(hover), top: padTop - 8 }}>
          <div style={{ opacity: 0.75 }}>{labels[hover]}</div>
          {series.map((s) =>
            s.values[hover] == null ? null : (
              <div key={s.key}>
                {s.label}: <b>{format(s.values[hover])}</b>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

export function Sparkline({
  values,
  color = INK,
  height = 40,
  fill = true,
  style,
}: {
  values: number[]
  color?: string
  height?: number
  fill?: boolean
  style?: CSSProperties
}) {
  const [ref, width] = useWidth<HTMLDivElement>(160)
  const gid = useId()
  const n = values.length
  const max = Math.max(1, ...values)
  const pad = 3
  const pts = values.map((v, i) => ({
    x: pad + (n <= 1 ? (width - 2 * pad) / 2 : (i / (n - 1)) * (width - 2 * pad)),
    y: pad + (height - 2 * pad) - (Math.max(0, v) / max) * (height - 2 * pad),
  }))
  return (
    <div ref={ref} style={{ width: '100%', ...style }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopOpacity={0.2} style={{ stopColor: color }} />
            <stop offset="100%" stopOpacity={0} style={{ stopColor: color }} />
          </linearGradient>
        </defs>
        {fill && <path d={waveArea(pts, height - pad)} fill={`url(#${gid})`} />}
        <path d={wavePath(pts)} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cx-draw" style={{ stroke: color }} />
        {pts.length > 0 && <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} style={{ fill: color }} />}
      </svg>
    </div>
  )
}

export type BarRow = { label: string; value: number; hint?: string }

export function BarList({
  rows,
  format,
  max = 8,
  empty = 'Nothing in this window yet.',
}: {
  rows: BarRow[]
  format: (n: number) => string
  max?: number
  empty?: string
}) {
  const top = rows.slice(0, max)
  if (top.length === 0) return <p className="cx-takeaway">{empty}</p>
  const peak = Math.max(1, ...top.map((r) => r.value))
  return (
    <ol className="cx-barlist">
      {top.map((r, i) => (
        <li key={r.label} className={i === 0 ? 'is-lead' : undefined}>
          <span className="bl-label">
            {r.label}
            {r.hint && <span className="bl-hint"> · {r.hint}</span>}
          </span>
          <span className="bl-value">{format(r.value)}</span>
          <span className="bl-track">
            <span className="bl-fill" style={{ width: `${Math.max(2, (r.value / peak) * 100)}%`, display: 'block' }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Pace meter: solid = so far, dashed = run-rate projection, black mark = last year. */
export function PaceMeter({
  sofar,
  projected,
  target,
  format: formatFn,
  formatKind,
  targetLabel = 'Last year',
  targetNote,
}: {
  sofar: number
  /** 0 hides the projection (no "on pace" until the month reconciles). */
  projected: number
  /** 0 hides the mark; `targetNote` then explains why. */
  target: number
  /** Client callers only. Server components pass `formatKind`. */
  format?: (n: number) => string
  formatKind?: FormatKind
  targetLabel?: string
  targetNote?: string
}) {
  const format = formatterFor(formatKind, formatFn)
  const scale = Math.max(1, niceCeil(Math.max(sofar, projected, target) * 1.05))
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`
  return (
    <div>
      <div className="cx-meter" role="img" aria-label={`So far ${format(sofar)}${projected > 0 ? `, on pace for ${format(projected)}` : ''}${target > 0 ? `, ${targetLabel.toLowerCase()} ${format(target)}` : ''}`}>
        {projected > 0 && <div className="m-proj" style={{ width: pct(projected) }} />}
        <div className="m-fill cx-widen" style={{ width: pct(sofar) }} />
        {target > 0 && <div className="m-mark" style={{ left: pct(target) }} title={`${targetLabel} ${format(target)}`} />}
      </div>
      <div className="cx-meter-labels">
        <span>So far {format(sofar)}</span>
        {projected > 0 && <span>On pace for {format(projected)}</span>}
        {target > 0 ? <span>{targetLabel} {format(target)}</span> : targetNote ? <span>{targetNote}</span> : null}
      </div>
    </div>
  )
}

/** Vertical columns, one or two series per label (monthly policies). */
export function Columns({
  labels,
  series,
  height = 160,
  format = (n) => String(n),
  ariaLabel,
  valueLabels = false,
  everyLabel = false,
  partialLast,
  line,
}: {
  labels: string[]
  series: Array<{ key: string; label: string; values: number[]; color?: string }>
  height?: number
  format?: (n: number) => string
  ariaLabel?: string
  /** Print each bar's value above it (single-series charts). */
  valueLabels?: boolean
  /** Label every column, never skip one. */
  everyLabel?: boolean
  /** The last column is a month still in progress: hatch it and add this second label line (e.g. "so far"). */
  partialLast?: string
  /** A line drawn over the columns on the same scale (e.g. net change). */
  line?: { label: string; values: number[]; color?: string }
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const pid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  const padB = partialLast ? 32 : 20
  const padT = valueLabels ? 18 : 10
  const plotH = Math.max(10, height - padT - padB)
  const max = niceCeil(Math.max(1, ...series.flatMap((s) => s.values), ...(line?.values ?? [])))
  const slot = n > 0 ? width / n : width
  const gap = Math.min(10, slot * 0.25)
  const barW = Math.max(2, (slot - gap) / Math.max(1, series.length))
  const font = { fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fontVariantNumeric: 'tabular-nums' as const }
  const showLabel = (i: number) => everyLabel || n <= 6 || i % Math.ceil(n / 6) === 0 || i === n - 1
  const linePts = line ? line.values.map((v, i) => ({ x: i * slot + slot / 2, y: padT + plotH - (Math.max(0, v) / max) * plotH })) : []
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ display: 'block', overflow: 'visible' }} onPointerLeave={() => setHover(null)}>
        {partialLast && (
          <defs>
            {series.map((s) => (
              <pattern key={s.key} id={`${pid}-h-${s.key}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={6} height={6} fillOpacity={0.18} style={{ fill: s.color ?? INK }} />
                <line x1={0} y1={0} x2={0} y2={6} strokeWidth={2.5} style={{ stroke: s.color ?? INK }} />
              </pattern>
            ))}
          </defs>
        )}
        <line x1={0} x2={width} y1={padT + plotH} y2={padT + plotH} strokeOpacity={0.18} style={{ stroke: INK }} />
        <line x1={0} x2={width} y1={padT} y2={padT} strokeDasharray="3 4" style={{ stroke: GRID }} />
        {labels.map((l, i) => {
          const partial = !!partialLast && i === n - 1
          return (
            <g key={l + i} onPointerEnter={() => setHover(i)}>
              <rect x={i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              {series.map((s, j) => {
                const v = Math.max(0, s.values[i] ?? 0)
                const h = (v / max) * plotH
                return (
                  <g key={s.key}>
                    <rect
                      className="cx-grow"
                      x={i * slot + gap / 2 + j * barW}
                      y={padT + plotH - h}
                      width={Math.max(1, barW - 1)}
                      height={h}
                      rx={2}
                      strokeWidth={partial ? 1 : undefined}
                      opacity={hover == null || hover === i ? 1 : 0.55}
                      style={{ fill: partial ? `url(#${pid}-h-${s.key})` : s.color ?? INK, stroke: partial ? s.color ?? INK : undefined }}
                    />
                    {valueLabels && (
                      <text x={i * slot + gap / 2 + j * barW + (barW - 1) / 2} y={padT + plotH - h - 4} fontSize={10.5} fillOpacity={0.75} textAnchor="middle" style={{ ...font, fill: INK }}>
                        {format(v)}
                      </text>
                    )}
                  </g>
                )
              })}
              {showLabel(i) && (
                <text x={i * slot + slot / 2} y={padT + plotH + 15} fontSize={11} fillOpacity={0.5} textAnchor="middle" style={{ ...font, fill: INK }}>
                  {l}
                </text>
              )}
              {partial && (
                <text x={i * slot + slot / 2} y={padT + plotH + 28} fontSize={10} fillOpacity={0.5} textAnchor="middle" style={{ ...font, fill: INK }}>
                  {partialLast}
                </text>
              )}
            </g>
          )
        })}
        {line && linePts.length > 1 && (
          <g pointerEvents="none">
            <path d={wavePath(linePts)} fill="none" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" style={{ stroke: line.color ?? INK }} />
            {linePts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={2.5} style={{ fill: line.color ?? INK }} />
            ))}
          </g>
        )}
        {!valueLabels && (
          <text x={width} y={padT - 3} fontSize={10} fillOpacity={0.45} textAnchor="end" style={{ ...font, fill: INK }}>
            {format(max)}
          </text>
        )}
      </svg>
      {hover != null && (
        <div className="cx-wave-tip" style={{ left: hover * slot + slot / 2, top: padT - 8 }}>
          <div style={{ opacity: 0.75 }}>
            {labels[hover]}
            {partialLast && hover === n - 1 ? ` (${partialLast})` : ''}
          </div>
          {series.map((s) => (
            <div key={s.key}>
              {s.label}: <b>{format(s.values[hover] ?? 0)}</b>
            </div>
          ))}
          {line && (
            <div>
              {line.label}: <b>{format(line.values[hover] ?? 0)}</b>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Stacked area: series stack bottom-up (books of business, product lines). */
export function StackedArea({
  labels,
  series,
  height = 200,
  format = (n) => String(n),
  ariaLabel,
}: {
  labels: string[]
  series: Array<{ key: string; label: string; values: number[]; color: string }>
  height?: number
  format?: (n: number) => string
  ariaLabel?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  const padT = 14
  const padB = 22
  const plotH = Math.max(10, height - padT - padB)
  const tops: number[][] = []
  let running = new Array(n).fill(0)
  for (const s of series) {
    running = running.map((v, i) => v + Math.max(0, s.values[i] ?? 0))
    tops.push(running.slice())
  }
  const max = niceCeil(Math.max(1, ...running))
  const xAt = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width)
  const yAt = (v: number) => padT + plotH - (v / max) * plotH
  const baseline = padT + plotH
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = n <= 1 ? 0 : Math.round(((e.clientX - rect.left) / width) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }
  const tickIdx = n <= 4 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1]
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible', touchAction: 'none' }}>
        <line x1={0} x2={width} y1={baseline} y2={baseline} strokeOpacity={0.18} style={{ stroke: INK }} />
        {series.map((s, j) => {
          const top = tops[j].map((v, i) => ({ x: xAt(i), y: yAt(v) }))
          const bottom = (j === 0 ? new Array(n).fill(0) : tops[j - 1]).map((v, i) => ({ x: xAt(i), y: yAt(v) }))
          const d = `${wavePath(top)} L ${bottom[n - 1]?.x ?? 0} ${bottom[n - 1]?.y ?? baseline} ${wavePath(bottom.slice().reverse()).replace(/^M/, 'L')} Z`
          return (
            <g key={s.key}>
              <path d={d} fillOpacity={0.9} className="cx-fade" style={{ fill: s.color }} />
              <path d={wavePath(top)} fill="none" strokeWidth={1} strokeOpacity={0.8} style={{ stroke: 'var(--cx-surface)' }} />
            </g>
          )
        })}
        {hover != null && <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={baseline} strokeOpacity={0.3} style={{ stroke: INK }} />}
        {tickIdx.map((i) => (
          <text key={i} x={xAt(i)} y={height - 6} fontSize={11} fillOpacity={0.5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fill: INK }}>
            {labels[i]}
          </text>
        ))}
        <text x={width} y={padT - 4} fontSize={10} fillOpacity={0.45} textAnchor="end" style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fill: INK }}>
          {format(max)}
        </text>
      </svg>
      {hover != null && (
        <div className="cx-wave-tip" style={{ left: xAt(hover), top: padT - 8 }}>
          <div style={{ opacity: 0.75 }}>{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key}>
              {s.label}: <b>{format(s.values[hover] ?? 0)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Donut: share of a whole. Tints of silver; the `hot` slice in black. */
export function Donut({
  slices,
  size = 150,
  format,
  centerLabel,
  centerValue,
}: {
  slices: Array<{ key: string; label: string; value: number; color: string }>
  size?: number
  format: (n: number) => string
  centerLabel?: string
  centerValue?: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = size / 2
  const stroke = Math.max(10, size * 0.14)
  const radius = r - stroke / 2
  const circ = 2 * Math.PI * radius
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={slices.map((s) => `${s.label} ${format(s.value)}`).join(', ')} style={{ flex: 'none' }}>
        <circle cx={r} cy={r} r={radius} fill="none" strokeWidth={stroke} style={{ stroke: GRID }} />
        {total > 0 &&
          slices.map((s) => {
            const frac = Math.max(0, s.value) / total
            const len = frac * circ
            const el = (
              <circle
                key={s.key}
                cx={r}
                cy={r}
                r={radius}
                fill="none"
                strokeWidth={hover === s.key ? stroke + 3 : stroke}
                strokeDasharray={`${Math.max(0, len - 2)} ${circ}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${r} ${r})`}
                className="cx-fade"
                onPointerEnter={() => setHover(s.key)}
                onPointerLeave={() => setHover(null)}
                style={{ transition: 'stroke-width .15s', stroke: s.color }}
              />
            )
            offset += len
            return el
          })}
        {centerValue && (
          <text x={r} y={r + 1} textAnchor="middle" fontSize={size * 0.13} style={{ fontFamily: 'var(--cx-serif, Lora, serif)', fill: INK }}>
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text x={r} y={r + size * 0.13} textAnchor="middle" fontSize={10} fillOpacity={0.55} style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)', fill: INK }}>
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="cx-legend" style={{ flexDirection: 'column', gap: 8 }}>
        {slices.map((s) => (
          <li key={s.key} style={{ opacity: hover && hover !== s.key ? 0.5 : 1 }}>
            <i style={{ background: s.color, width: 10, height: 10, borderRadius: 3 }} />
            <span style={{ color: INK }}>{s.label}</span>
            <b style={{ fontWeight: 500, color: INK, marginLeft: 4 }}>{total > 0 ? `${Math.round((Math.max(0, s.value) / total) * 100)}%` : '—'}</b>
            <span style={{ marginLeft: 2 }}>{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Horizontal stage bars (status funnel): each stage as a share of the first. */
export function StageBars({ stages, format }: { stages: Array<{ key: string; label: string; value: number; color?: string; hint?: string }>; format: (n: number) => string }) {
  const peak = Math.max(1, ...stages.map((s) => s.value))
  return (
    <ol className="cx-barlist" style={{ gap: 11 }}>
      {stages.map((s) => (
        <li key={s.key}>
          <span className="bl-label">
            {s.label}
            {s.hint && <span className="bl-hint"> · {s.hint}</span>}
          </span>
          <span className="bl-value">{format(s.value)}</span>
          <span className="bl-track" style={{ height: 9 }}>
            <span className="bl-fill cx-widen" style={{ width: `${Math.max(1.5, (s.value / peak) * 100)}%`, display: 'block', background: s.color ?? SILVER }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Thin daily bars for one month; days after `through` are drawn empty. */
export function DayBars({ values, through, height = 56, format, labels }: { values: number[]; through: number; height?: number; format: (n: number) => string; labels?: string[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...values)
  return (
    <div style={{ position: 'relative' }} onPointerLeave={() => setHover(null)}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))`, gap: 2, alignItems: 'end', height }} role="img" aria-label="Daily premium this month">
        {values.map((v, i) => {
          const past = i < through
          const h = past ? Math.max(2, (v / max) * height) : 2
          return (
            <span
              key={i}
              onPointerEnter={() => setHover(i)}
              className={past ? 'cx-grow-css' : undefined}
              style={{
                display: 'block',
                height: h,
                borderRadius: 2,
                background: past ? (i === through - 1 ? POINT : SILVER) : GRID,
                opacity: hover == null || hover === i ? 1 : 0.6,
              }}
            />
          )
        })}
      </div>
      {hover != null && (
        <div className="cx-wave-tip" style={{ left: `${((hover + 0.5) / values.length) * 100}%`, top: -8 }}>
          <div style={{ opacity: 0.75 }}>{labels?.[hover] ?? `Day ${hover + 1}`}</div>
          <div>{hover < through ? <b>{format(values[hover])}</b> : 'not yet'}</div>
        </div>
      )}
    </div>
  )
}

