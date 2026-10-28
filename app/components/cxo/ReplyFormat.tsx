'use client'

/**
 * Ciao's formatted answers: the layouts the reply formatting step
 * (lib/agent/replyFormatter, Nick 2026-10-26) picks for a dense answer.
 * Number tiles, a table, bar rows, a line chart, a split, numbered steps and a
 * callout, then the answer as written behind "Full answer".
 *
 * Built from the Suite CXO report kit (./report-kit: StatRow / StatTile,
 * DotChip, WhyDetails) and charts (./charts: Sparkline, BarList), so the
 * colours are the --cx-* tokens and light / dark follow the theme.
 *
 * References (2026-10-20 Mobbin pull for the sister build, crmbuilds PR #4238
 * client/src/components/copilot/format-views.tsx): Shopify Attribution and
 * Unify tables (name first, at most 3 right-aligned figure columns, 5 rows
 * then "Show all"); Shopify bar list and YNAB category bars (label, value
 * right, thin bar, no axis); Steep (one curve, the latest figure big, start and
 * end dates only); Higgsfield segmented bar (one stacked bar, legend below with
 * count and %); Klaviyo / Canny numbered steps; Customer.io / Sprig verdict line
 * (coloured left edge, a one-word chip, one line).
 *
 * Display-only: nothing here is pressable except "Show all" and "Full answer".
 */
import { useState } from 'react'
import { BarList, Sparkline } from './charts'
import { DotChip, StatRow, StatTile, WhyDetails } from './report-kit'
import Markdown from './Markdown'
import { sharedTileWindow } from '@/lib/agent/replyFormatShared'
import type {
  CalloutBlockWire, ChartBlockWire, FormatBlockWire, NumbersBlockWire, ReplyFormatPayload, StepsBlockWire, TableBlockWire, Tone,
} from '@/lib/agent/replyFormatShared'
import './reply-format.css'

/**
 * Semantic verdict colours: good is the report kit's green, watch is the
 * accent (ink), bad is --cx-error (the CXO theme's failure red; the kit's
 * --red-deep is charcoal on CXO, which would leave a "Problem" with no edge).
 */
function toneColor(t?: Tone): string {
  if (t === 'good') return 'var(--signal-good, #15803d)'
  if (t === 'bad') return 'var(--cx-error, #B42318)'
  if (t === 'watch') return 'var(--cx-accent, var(--cx-ink))'
  return 'var(--cx-ink)'
}

function Shell({ kind, heading, caption, children }: { kind: string; heading?: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="cx-rf-card" data-testid={`ciao-format-${kind}`}>
      {heading && <h4 className="cx-rf-heading">{heading}</h4>}
      {children}
      {caption && <p className="cx-rf-caption">{caption}</p>}
    </section>
  )
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

/**
 * Every figure says what span it covers (Nick 2026-10-28: "Leads 0" sat beside
 * "Leads 2" with nothing saying which was today). One shared window becomes the
 * card's heading; mixed windows go on each tile's sub line, before any hint.
 */
export function NumbersView({ block }: { block: NumbersBlockWire }) {
  const n = block.tiles.length
  const shared = sharedTileWindow(block.tiles)
  const heading = block.heading ?? (shared ? cap(shared) : undefined)
  return (
    <div className="cx-rf-numbers" data-testid="ciao-format-numbers">
      {heading && <h4 className="cx-rf-heading" data-testid="ciao-format-numbers-heading">{heading}</h4>}
      <StatRow cols={n} look="kit" size="sm" mid={n >= 4 ? 2 : n} narrow={n === 3 ? 3 : 2} noStack fitChars={8}>
        {block.tiles.map((t, i) => {
          const tw = shared ? undefined : t.window
          const sub = [tw ? cap(tw) : '', t.hint ?? ''].filter(Boolean).join(' · ') || undefined
          return (
            <StatTile
              key={i}
              label={t.label}
              value={t.value}
              sub={sub}
              title={sub ? `${t.label}: ${t.value} (${sub})` : undefined}
              verdict={t.tone === 'good' || t.tone === 'bad' ? t.tone : undefined}
            />
          )
        })}
      </StatRow>
      {block.caption && <p className="cx-rf-caption">{block.caption}</p>}
    </div>
  )
}

export const TABLE_ROWS_SHOWN = 5

export function TableView({ block }: { block: TableBlockWire }) {
  const [all, setAll] = useState(false)
  const rows = all ? block.rows : block.rows.slice(0, TABLE_ROWS_SHOWN)
  return (
    <Shell kind="table" heading={block.heading} caption={block.caption}>
      {/* Its own scroller: the page never scrolls sideways on a phone. */}
      <div className="cx-rf-table-scroll">
        <table className="cx-rf-table">
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th key={i} scope="col" data-num={block.numeric[i] ? '' : undefined}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} data-tone={r.tone && r.tone !== 'neutral' ? r.tone : undefined}>
                {r.cells.map((c, ci) => (
                  <td
                    key={ci}
                    title={ci === 0 ? c : undefined}
                    data-num={block.numeric[ci] ? '' : undefined}
                    style={ci > 0 && ci === r.cells.length - 1 && r.tone && r.tone !== 'neutral' ? { color: toneColor(r.tone) } : undefined}
                  >{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.rows.length > TABLE_ROWS_SHOWN && (
        <button type="button" className="cx-rf-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${block.rows.length}`}
        </button>
      )}
      {block.more && (all || block.rows.length <= TABLE_ROWS_SHOWN) ? <p className="cx-rf-caption">+{block.more} more not listed</p> : null}
    </Shell>
  )
}

function BarChart({ block }: { block: ChartBlockWire }) {
  // BarList formats a number; each bar keeps the figure exactly as the answer wrote it.
  const display = new Map(block.points.map((p) => [p.value, p.display]))
  return (
    <BarList
      rows={block.points.map((p, i) => ({ label: block.points.findIndex((q) => q.label === p.label) === i ? p.label : `${p.label} (${i + 1})`, value: p.value }))}
      format={(n) => display.get(n) ?? String(n)}
      max={8}
    />
  )
}

function LineChart({ block }: { block: ChartBlockWire }) {
  const pts = block.points
  const last = pts[pts.length - 1]
  // Shape only (no axis): lift the floor to just under the lowest point so a
  // dip from $29,800 to $24,100 reads as a dip, not a flat line from zero.
  const vals = pts.map((p) => p.value)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const floor = lo > 0 && hi > lo ? lo - (hi - lo) * 0.35 : 0
  return (
    <div className="cx-rf-line">
      <div className="cx-rf-line-top">
        <span className="cx-rf-line-figure">{last.display}</span>
      </div>
      <Sparkline values={vals.map((v) => Math.max(0, v - floor))} height={64} />
      <div className="cx-rf-line-ends">
        <span>{pts[0].label}</span>
        <span>{last.label}</span>
      </div>
    </div>
  )
}

const SPLIT_COLORS = ['var(--cx-chart-1)', 'var(--cx-chart-2)', 'var(--cx-chart-3)', 'var(--cx-chart-ref)']
const splitColor = (i: number) => SPLIT_COLORS[i] ?? `color-mix(in srgb, var(--cx-chart-1) ${Math.max(14, 50 - i * 8)}%, transparent)`

function SplitChart({ block }: { block: ChartBlockWire }) {
  const total = block.points.reduce((a, p) => a + p.value, 0)
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  return (
    <div className="cx-rf-split">
      <div className="cx-rf-split-bar" role="img" aria-label={block.heading ?? 'Split'}>
        {block.points.map((p, i) => p.value > 0 && <span key={i} style={{ width: `${pct(p.value)}%`, background: splitColor(i) }} />)}
      </div>
      <ul className="cx-rf-legend">
        {block.points.map((p, i) => (
          <li key={i}>
            <span aria-hidden className="cx-rf-dot" style={{ background: splitColor(i) }} />
            <span className="cx-rf-legend-label">{p.label}</span>
            <span className="cx-rf-legend-value">{p.display}</span>
            <span className="cx-rf-legend-pct">{Math.round(pct(p.value))}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChartView({ block }: { block: ChartBlockWire }) {
  return (
    <Shell kind={block.kind} heading={block.heading} caption={block.caption}>
      {block.kind === 'line' ? <LineChart block={block} /> : block.kind === 'split' ? <SplitChart block={block} /> : <BarChart block={block} />}
    </Shell>
  )
}

export function StepsView({ block }: { block: StepsBlockWire }) {
  return (
    <Shell kind="steps" heading={block.heading}>
      <ol className="cx-rf-steps">
        {block.items.map((t, i) => (
          <li key={i}>
            <span aria-hidden className="cx-rf-step-n" data-first={i === 0 ? '' : undefined}>{i + 1}</span>
            <span className="cx-rf-step-text">{t}</span>
          </li>
        ))}
      </ol>
    </Shell>
  )
}

const CALLOUT_CHIP: Record<Exclude<Tone, 'neutral'>, string> = { good: 'Good', watch: 'Watch', bad: 'Problem' }

export function CalloutView({ block }: { block: CalloutBlockWire }) {
  const c = toneColor(block.tone)
  return (
    <div
      className="cx-rf-callout"
      data-testid="ciao-format-callout"
      data-tone={block.tone}
      style={{ borderLeftColor: block.tone === 'neutral' ? 'var(--cx-line-strong)' : c, ...(block.tone !== 'neutral' ? { background: `color-mix(in srgb, ${c} 7%, var(--cx-surface))` } : {}) }}
    >
      {block.tone !== 'neutral' && <DotChip color={c}>{CALLOUT_CHIP[block.tone]}</DotChip>}
      <span className="cx-rf-callout-text">{block.text}</span>
    </div>
  )
}

export function FormatBlock({ block }: { block: FormatBlockWire }) {
  switch (block.type) {
    case 'numbers': return <NumbersView block={block} />
    case 'table': return <TableView block={block} />
    case 'chart': return <ChartView block={block} />
    case 'steps': return <StepsView block={block} />
    case 'callout': return <CalloutView block={block} />
  }
}

/**
 * One formatted answer: the words, the visuals, the takeaway, and the answer
 * exactly as written behind "Full answer" (nothing the answer said is lost).
 */
export default function FormattedAnswer({ format, text }: { format: ReplyFormatPayload; text: string }) {
  return (
    <div className="cx-rf" data-testid="ciao-formatted" data-format={format.format}>
      <p className="cx-rf-say">{format.say}</p>
      {format.blocks.map((b, i) => <FormatBlock key={i} block={b} />)}
      {format.after && <p className="cx-rf-after">{format.after}</p>}
      {text.trim() && (
        <WhyDetails label="Full answer" testId="ciao-format-full">
          <div className="cx-rf-full"><Markdown text={text} /></div>
        </WhyDetails>
      )}
    </div>
  )
}
