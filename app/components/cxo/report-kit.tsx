/**
 * Report kit for Suite CXO / Pinnacle: the visual-first pieces every report
 * surface shares. Numbers, chips and bars come first; each finding is one short
 * line and the reasoning sits behind a tap ("Why").
 *
 * Server-safe: no hooks, the "Why" toggle is a native <details>, so server and
 * client components can both use it. Charts (Sparkline, BarList, Columns…) live
 * in ./charts. Colours are CSS vars only (--ink, --muted, --border-soft, --red,
 * --cx-chart-*); semantic good/bad use --signal-good / --red-deep with fallbacks.
 *
 * Sister kit in crmbuilds: client/src/components/report-kit.tsx (same names).
 */
import type { CSSProperties, ReactNode } from 'react'
import './stat-tile.css'

export type Verdict = 'good' | 'bad' | 'neutral'

const VERDICT_COLOR: Record<Verdict, string> = {
  good: 'var(--signal-good, #15803d)',
  bad: 'var(--red-deep, #dc2626)',
  neutral: 'var(--muted, #6b7280)',
}

/** Split long AI text into a one-line headline + the rest (shown behind "Why"). */
export function splitHeadline(text: string, maxLen = 110): { line: string; why: string } {
  const t = (text || '').trim()
  if (!t) return { line: '', why: '' }
  const m = t.match(/^(.+?[.!?])(\s+|$)/)
  let line = m ? m[1] : t
  if (line.length > maxLen) {
    const cut = line.slice(0, maxLen)
    const sp = cut.lastIndexOf(' ')
    line = `${cut.slice(0, sp > maxLen * 0.6 ? sp : maxLen).trim()}…`
    return { line, why: t }
  }
  return { line, why: t.slice(line.length).trim() }
}

/** Small uppercase label chip (category, kind). */
export function Chip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--muted)', border: '1px solid var(--border-soft)', borderRadius: 999,
        padding: '1px 7px', whiteSpace: 'nowrap', ...style,
      }}
    >
      {children}
    </span>
  )
}

/** Coloured dot chip: "3 high". `color` is a CSS colour/var. */
export function DotChip({ color, children, testId }: { color: string; children: ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
        padding: '2px 8px', borderRadius: 999, alignSelf: 'center', whiteSpace: 'nowrap',
        color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {children}
    </span>
  )
}

/** Big count + unit + a row of dot chips: "7 open · ● 2 high ● 5 normal". */
export function CountStrip({
  count, unit, chips, testId,
}: {
  count: number
  unit: string
  chips: Array<{ key: string; color: string; label: ReactNode }>
  testId?: string
}) {
  return (
    <div data-testid={testId} style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, marginRight: '0.3rem', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: '0.4rem' }}>{unit}</span>
      {chips.map((c) => <DotChip key={c.key} color={c.color}>{c.label}</DotChip>)}
    </div>
  )
}

/** ▲ 12% / ▼ 8% change chip. `goodWhen` says which direction is good. */
export function Delta({ value, suffix = '%', goodWhen = 'up' }: { value: number | null | undefined; suffix?: string; goodWhen?: 'up' | 'down' }) {
  if (value == null || !Number.isFinite(value)) return null
  const flat = Math.abs(value) < 0.5
  const up = value > 0
  const verdict: Verdict = flat ? 'neutral' : (up === (goodWhen === 'up') ? 'good' : 'bad')
  const color = VERDICT_COLOR[verdict]
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {flat ? '–' : up ? '▲' : '▼'} {Math.abs(Math.round(value))}{suffix}
    </span>
  )
}

export type StatSize = 'sm' | 'md' | 'lg' | 'xl'
export type StatLook = 'kit' | 'cx'

/** Columns at each panel width: never a 3 + 1 split (crmbuilds statGridCols). */
export function statRowCols(cols: number): { wide: number; mid: number; narrow: number } {
  if (cols <= 2) return { wide: cols, mid: cols, narrow: cols }
  if (cols === 3) return { wide: 3, mid: 3, narrow: 1 }
  if (cols === 4) return { wide: 4, mid: 2, narrow: 2 }
  if (cols % 3 === 0) return { wide: cols, mid: 3, narrow: 2 }
  return { wide: cols, mid: 3, narrow: 2 }
}

/** A figure counts as empty when there is nothing, or only a dash. */
export function isEmptyFigure(v: ReactNode): boolean {
  return v === null || v === undefined || v === false || v === '' || v === '—' || v === '-' || v === '–'
}

/**
 * ONE stat row for every KPI strip, stat card and summary row in Suite CXO
 * (Nick 2026-10-21: "make sure ... are aligned horizontally"). Equal columns;
 * 4 become 2x2 when the panel is narrow and stack on a phone, measured on the
 * row's own width (container query), not the viewport, so the CIAO side chat
 * squeezing the page re-flows it too. CSS: ./stat-tile.css. Server-safe.
 *
 * Design refs: Stripe Dashboard metric cards, Mercury account summary, Linear
 * Insights, Vercel Analytics KPI row (fixed label line, one figure baseline,
 * one sub line). Sister engine: crmbuilds client/src/components/stat-tile.tsx.
 */
export function StatRow({
  children, cols = 4, mid, narrow, look = 'kit', size, reserveSub, fitChars, gap, noStack, className = '', style, testId,
}: {
  children?: ReactNode
  cols?: number
  /** Columns under 720px / 440px of row width (defaults from statRowCols). */
  mid?: number
  narrow?: number
  /** 'kit' = the report-kit card; 'cx' = Suite CXO panels (cx-eyebrow / cx-kpi-figure / cx-kpi-sub). */
  look?: StatLook
  /** One figure size for the whole row: sm 20, md 24, lg 30, xl 32 (kit 22, cx 30 by default). */
  size?: StatSize
  /** Keep the sub line on every tile even when none has one. */
  reserveSub?: boolean
  /** Longest figure expected, in characters; a narrower column shrinks it. Default 7. */
  fitChars?: number
  gap?: string
  /** Never fall back to one column (a pair nested inside a wide card). */
  noStack?: boolean
  className?: string
  style?: CSSProperties
  testId?: string
}) {
  const d = statRowCols(cols)
  const vars = {
    '--cx-stat-cols-wide': d.wide,
    '--cx-stat-cols-mid': mid ?? d.mid,
    '--cx-stat-cols-narrow': narrow ?? d.narrow,
    ...(gap ? { '--cx-stat-gap': gap } : {}),
    ...(fitChars ? { '--cx-stat-fit-chars': fitChars } : {}),
  } as CSSProperties
  return (
    <div className="cx-stat-wrap">
      <div
        className={`cx-stat-row ${className}`.trim()}
        style={{ ...vars, ...style }}
        data-look={look}
        data-size={size}
        data-cols={cols}
        data-reserve-sub={reserveSub ? '' : undefined}
        data-no-stack={noStack ? '' : undefined}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  )
}

export type StatTileProps = {
  label: ReactNode
  /** Beside the label, never cut off (an (i) tip). */
  labelAside?: ReactNode
  /** The figure. null / undefined / '' / '—' draws `empty` in its slot. */
  value?: ReactNode
  /** Empty state, in the figure's slot. Default "No data yet". */
  empty?: ReactNode
  /** One line under the figure. `hint` is the old name. */
  sub?: ReactNode
  hint?: ReactNode
  delta?: number | null
  goodWhen?: 'up' | 'down'
  verdict?: Verdict
  /** 'cx' adds the Suite CXO type classes; match the row's look. */
  look?: StatLook
  /** Span two columns (a paired card). */
  span?: 2
  /** Tooltip for the label when it is not a plain string. */
  title?: string
  className?: string
  style?: CSSProperties
  testId?: string
  /** Under the aligned block (a bar, a spark, a scope line). */
  children?: ReactNode
}

/** One tile: a fixed label line, the figure, a one-line sub, then anything else. Use inside StatRow. */
export function StatTile({
  label, labelAside, value, empty = 'No data yet', sub, hint, delta, goodWhen, verdict, look = 'kit', span, title, className = '', style, testId, children,
}: StatTileProps) {
  const cx = look === 'cx'
  const s = sub ?? hint
  const hasSub = !isEmptyFigure(s) || s === '—'
  const isEmpty = isEmptyFigure(value)
  const tip = title ?? (typeof label === 'string' ? label : undefined)
  const subTip = typeof s === 'string' ? s : undefined
  return (
    <div
      className={`cx-stat-tile ${className}`.trim()}
      style={style}
      data-span={span}
      data-verdict={verdict && verdict !== 'neutral' ? verdict : undefined}
      data-empty={isEmpty ? '' : undefined}
      data-testid={testId}
    >
      <div className={`cx-stat-label${cx ? ' cx-eyebrow' : ''}`} title={tip} data-testid={testId ? `${testId}-label` : undefined}>
        <span className="cx-stat-label-text">{label}</span>
        {labelAside}
      </div>
      <div className={`cx-stat-value${cx ? ' cx-kpi-figure' : ''}`} data-testid={testId ? `${testId}-value` : undefined}>
        {isEmpty ? <span className="cx-stat-empty">{empty}</span> : <span className="cx-stat-value-text">{value}</span>}
        <Delta value={delta} goodWhen={goodWhen} />
      </div>
      <div
        className={`cx-stat-sub${cx ? ' cx-kpi-sub' : ''}`}
        data-empty={hasSub ? undefined : ''}
        title={subTip}
        data-testid={testId ? `${testId}-sub` : undefined}
      >
        {hasSub ? s : '\u00a0'}
      </div>
      {children}
    </div>
  )
}

/** A Suite CXO tile (cx-eyebrow label, cx-kpi-figure figure, cx-kpi-sub line). */
export function CxStatTile(props: Omit<StatTileProps, 'look'>) {
  return <StatTile {...props} look="cx" />
}

/** Horizontal progress bar with "x of y · z%". */
export function ProgressBar({
  done, total, label, color = 'var(--cx-chart-1, var(--ink))', testId,
}: {
  done: number
  total: number
  label?: ReactNode
  color?: string
  testId?: string
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0
  return (
    <div data-testid={testId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontVariantNumeric: 'tabular-nums' }}>
        <span>{label}</span>
        <span>{done} of {total} · {pct}%</span>
      </div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: 'var(--border-soft)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  )
}

/** "Why" behind a tap: native <details>, works in server components. */
export function WhyDetails({ children, label = 'Why', testId }: { children: ReactNode; label?: string; testId?: string }) {
  return (
    <details data-testid={testId} style={{ marginTop: 4 }}>
      <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--muted)', listStyle: 'revert' }}>{label}</summary>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>{children}</div>
    </details>
  )
}
