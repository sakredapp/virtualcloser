'use client'

/**
 * Inline-SVG charts for the executive suite. No chart library: a monotone
 * cubic "wave" line with a soft gradient fill, a sparkline, a horizontal
 * bar list and a pace meter. Colours are the Virtual Closer brand: charcoal
 * ink, cream/charcoal tints for comparison series, red reserved for the one
 * series worth pointing at.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'

export const INK = '#1C1B1A'
export const RED = '#FF2800'
export const INK_TINT = 'rgba(28, 27, 26, 0.32)'
export const INK_TINT_2 = 'rgba(28, 27, 26, 0.18)'

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
}: {
  series: WaveSeries[]
  labels: string[]
  height?: number
  format?: (n: number) => string
  ariaLabel?: string
  showTicks?: boolean
  padTop?: number
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

  const tickIdx = n <= 4 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1]

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
              <stop offset="0%" stopColor={s.color ?? INK} stopOpacity={0.22} />
              <stop offset="65%" stopColor={s.color ?? INK} stopOpacity={0.05} />
              <stop offset="100%" stopColor={s.color ?? INK} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {/* Recessive grid: top rule dashed, base rule solid. */}
        <line x1={padL} x2={padL + plotW} y1={padTop} y2={padTop} stroke={INK} strokeOpacity={0.12} strokeDasharray="3 4" />
        <line x1={padL} x2={padL + plotW} y1={(padTop + baseline) / 2} y2={(padTop + baseline) / 2} stroke={INK} strokeOpacity={0.07} strokeDasharray="3 4" />
        <line x1={padL} x2={padL + plotW} y1={baseline} y2={baseline} stroke={INK} strokeOpacity={0.18} />
        {series.map((s) => {
          const pts = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
          return (
            <g key={s.key}>
              {s.fill && <path d={waveArea(pts, baseline)} fill={`url(#${gid}-${s.key})`} />}
              <path
                d={wavePath(pts)}
                fill="none"
                stroke={s.color ?? INK}
                strokeWidth={s.width ?? 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? '4 5' : undefined}
              />
            </g>
          )
        })}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={padTop} y2={baseline} stroke={INK} strokeOpacity={0.25} />
            {series.map((s) => (
              <circle key={s.key} cx={xAt(hover)} cy={yAt(s.values[hover] ?? 0)} r={4} fill={s.color ?? INK} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
        {showTicks &&
          tickIdx.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 6}
              fontSize={11}
              fill={INK}
              fillOpacity={0.5}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)' }}
            >
              {labels[i]}
            </text>
          ))}
        {showTicks && (
          <text x={padL + plotW} y={padTop - 4} fontSize={10} fill={INK} fillOpacity={0.45} textAnchor="end" style={{ fontFamily: 'var(--cx-sans, Inter, system-ui, sans-serif)' }}>
            {format(max)}
          </text>
        )}
      </svg>
      {hover != null && (
        <div className="cx-wave-tip" style={{ left: xAt(hover), top: padTop - 8 }}>
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
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {fill && <path d={waveArea(pts, height - pad)} fill={`url(#${gid})`} />}
        <path d={wavePath(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {pts.length > 0 && <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill={color} />}
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

/** Pace meter: solid = so far, dashed = run-rate projection, red mark = last year. */
export function PaceMeter({ sofar, projected, target, format }: { sofar: number; projected: number; target: number; format: (n: number) => string }) {
  const scale = Math.max(1, niceCeil(Math.max(sofar, projected, target) * 1.05))
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`
  return (
    <div>
      <div className="cx-meter" role="img" aria-label={`So far ${format(sofar)}, projected ${format(projected)}, last year ${format(target)}`}>
        <div className="m-proj" style={{ width: pct(projected) }} />
        <div className="m-fill" style={{ width: pct(sofar) }} />
        {target > 0 && <div className="m-mark" style={{ left: pct(target) }} title={`Last year ${format(target)}`} />}
      </div>
      <div className="cx-meter-labels">
        <span>So far {format(sofar)}</span>
        <span>On pace for {format(projected)}</span>
        <span>Last year {format(target)}</span>
      </div>
    </div>
  )
}
