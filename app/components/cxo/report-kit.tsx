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

/** One number tile: label, big value, optional delta and hint. */
export function StatTile({
  label, value, delta, goodWhen, hint, verdict, testId,
}: {
  label: string
  value: ReactNode
  delta?: number | null
  goodWhen?: 'up' | 'down'
  hint?: ReactNode
  verdict?: Verdict
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      style={{
        border: '1px solid var(--border-soft)', borderRadius: 10, padding: '0.6rem 0.7rem',
        borderTop: verdict && verdict !== 'neutral' ? `3px solid ${VERDICT_COLOR[verdict]}` : undefined,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        <Delta value={delta} goodWhen={goodWhen} />
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

/** Grid of StatTiles: 2 across on phones, up to 4 on wider screens. */
export function StatRow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
      {children}
    </div>
  )
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
