'use client'

/**
 * Sales Plan overview: KPI tiles with progress bars, plan vs actual by month,
 * the pacing chart, the labelled forecast, and the empty states. All numbers
 * come from lib/plan/visuals.ts (pure, tested); this file only draws them.
 * Suite CXO black/silver tokens only (--cx-*), never an accent fill.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Columns, PaceMeter, WaveChart, INK, SILVER, REF } from '@/app/components/cxo/charts'
import { fmtMoney, fmtCount } from '@/lib/pinnacle/kpis'
import { MONTHS, planByMonth, sum, type PlanTarget } from '@/lib/plan/shared'
import { PACE_WORDS, barWidth, pctLabel, type MonthCell, type PaceStatus, type PlanVisuals, type TierRail } from '@/lib/plan/visuals'

const pctW = (v: number) => `${(barWidth(v) * 100).toFixed(2)}%`

/** One empty state: a line of what is missing and ONE next action. */
export function EmptyCard({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <section className="cx-panel cxp-emptycard">
      <span className="cxp-emptyicon" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 16.5h14M5.5 13.5V9.5M10 13.5V5.5M14.5 13.5v-2.5" />
        </svg>
      </span>
      <div className="cxp-emptytxt">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action && <div className="cxp-emptyact">{action}</div>}
    </section>
  )
}

/** Label, a % and a bar; optional marker (e.g. plan due by now). */
export function ProgressRow({ label, value, figure, sub, marker, markerLabel, tone = 'ink' }: { label: string; value: number | null; figure: string; sub?: ReactNode; marker?: number | null; markerLabel?: string; tone?: 'ink' | 'silver' }) {
  return (
    <div className="cxp-prog">
      <div className="cxp-prog-top">
        <span>{label}</span>
        <b>{figure}</b>
      </div>
      <span className={`cxp-prog-bar${tone === 'silver' ? ' is-silver' : ''}`} role="img" aria-label={`${label}: ${figure}`}>
        <span className="fill cx-widen" style={{ width: pctW(value ?? 0) }} />
        {marker != null && marker > 0 && <i className="mark" style={{ left: pctW(marker) }} title={markerLabel} />}
      </span>
      {sub && <div className="cxp-prog-sub">{sub}</div>}
    </div>
  )
}

function Tile({ label, figure, children }: { label: string; figure: string; children?: ReactNode }) {
  return (
    <section className="cx-panel cxp-kpi">
      <p className="cx-eyebrow">{label}</p>
      <div className="cx-kpi-figure">{figure}</div>
      {children && <div className="cx-kpi-sub">{children}</div>}
    </section>
  )
}

function MiniBar({ value }: { value: number | null }) {
  return (
    <span className="cxp-track cxp-tile-track" aria-hidden>
      <span style={{ width: pctW(value ?? 0) }} />
    </span>
  )
}

export function StatusDot({ status }: { status: PaceStatus }) {
  const cls = status === 'ahead' || status === 'on_track' ? 'is-good' : status === 'behind' ? 'is-behind' : ''
  return (
    <span className={`cxp-status ${cls}`} style={{ marginTop: 0 }}>
      <i />
      {PACE_WORDS[status]}
    </span>
  )
}

/** 12 cells: each month's % of plan with a small bar (6 × 2 on a phone). */
export function MonthStrip({ months }: { months: MonthCell[] }) {
  return (
    <ol className="cxp-months" aria-label="Percent of plan by month">
      {months.map((m) => (
        <li key={m.month} className={`is-${m.state}${m.pct != null && m.pct >= 1 ? ' is-hit' : ''}`} title={m.state === 'future' ? `${m.label}: plan ${fmtMoney(m.plan)}` : `${m.label}: ${fmtMoney(m.actual)} of ${fmtMoney(m.plan)} plan`}>
          <em>{m.label}</em>
          <b>{m.words}</b>
          <span className="cxp-track" aria-hidden>
            <span style={{ width: pctW(m.bar) }} />
          </span>
          {m.state === 'partial' && <small>so far</small>}
        </li>
      ))}
    </ol>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="cx-legend">
      {items.map((i) => (
        <li key={i.label}>
          <i style={i.dashed ? { height: 0, width: 14, borderTop: `2px dashed ${i.color}`, background: 'transparent' } : { background: i.color, height: 10, width: 10, borderRadius: 2 }} />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** Everything above the plan grid, by view. */
export function PlanOverview({ v, targets, through, years, thisYear, onUpload }: { v: PlanVisuals; targets: PlanTarget[]; through: string | null; years: number[]; thisYear: number; onUpload: () => void }) {
  const { year } = v
  const uploadBtn = (
    <button type="button" className="cx-btn cx-btn-sm" onClick={onUpload}>
      Upload the {year} plan
    </button>
  )

  if (v.view === 'no_plan') {
    return (
      <>
        <EmptyCard
          title={`No ${year} plan yet`}
          body={<>Upload it in whatever layout you have (Excel, CSV, PDF or a Google Sheets link) and it is set against the book month by month, with pace and allowance progress.</>}
          action={uploadBtn}
        />
        {v.actualsOnly && (
          <section className="cx-panel">
            <div className="cxp-head">
              <div>
                <h2>What the book shows for {year}</h2>
                <p>{fmtMoney(v.actualYtd)} premium written{through ? `, through ${fmtDay(through)}` : ''}. Upload the plan to see it against target.</p>
              </div>
              <Legend items={[{ label: 'Actual', color: INK }]} />
            </div>
            <Columns labels={[...MONTHS]} series={[{ key: 'actual', label: 'Actual', values: v.months.map((m) => m.actual), color: INK }]} height={180} format={fmtMoney} everyLabel ariaLabel={`Premium written by month in ${year}`} />
          </section>
        )}
      </>
    )
  }

  const policies = sum(planByMonth(targets, 'policies'))
  const planMonthly = v.months.map((m) => m.plan)
  const peak = v.months.reduce((b, m) => (m.plan > b.plan ? m : b), v.months[0])

  if (v.view === 'future') {
    const carriers = new Set(targets.map((t) => t.carrier.trim().toLowerCase()).filter(Boolean)).size
    return (
      <>
        <div className="cx-grid cx-grid-4">
          <Tile label={`${year} plan`} figure={fmtMoney(v.planTotal)}>{policies > 0 ? `${fmtCount(policies)} policies planned` : 'Premium target for the year'}</Tile>
          <Tile label="Biggest month" figure={peak.plan > 0 ? peak.label : '—'}>{peak.plan > 0 ? `${fmtMoney(peak.plan)} planned` : ''}</Tile>
          <Tile label="Carriers in the plan" figure={carriers ? String(carriers) : '—'}>{carriers ? 'Each one tracked below' : 'Plan has no carrier split'}</Tile>
          <Tile label="Tracking starts" figure={`Jan 1`}>{`Actuals and pace from ${year}`}</Tile>
        </div>
        {years.includes(thisYear) && (
          <EmptyCard
            title={`${year} has not started`}
            body={`Plan vs actual, pace and the forecast start on Jan 1, ${year}. The ${thisYear} numbers are live now.`}
            action={
              <Link className="cx-btn cx-btn-sm cx-btn-ghost" href={`/dashboard/plan?year=${thisYear}`} scroll={false}>
                See {thisYear} so far
              </Link>
            }
          />
        )}
        <section className="cx-panel">
          <div className="cxp-head">
            <div>
              <h2>The plan by month</h2>
              <p>Premium target each month, and the running total to {fmtMoney(v.planTotal)}.</p>
            </div>
            <Legend items={[{ label: 'Plan', color: SILVER }, { label: 'Running total', color: REF, dashed: true }]} />
          </div>
          <Columns labels={[...MONTHS]} series={[{ key: 'plan', label: 'Plan', values: planMonthly, color: SILVER }]} height={180} format={fmtMoney} everyLabel ariaLabel={`${year} plan by month`} />
          <div style={{ marginTop: 14 }}>
            <WaveChart labels={[...MONTHS]} series={[{ key: 'cum', label: 'Plan, running total', values: v.cumPlan, color: REF, dashed: true }]} height={150} format={fmtMoney} ticks={[0, 3, 6, 9, 11]} ariaLabel={`${year} plan running total`} />
          </div>
        </section>
      </>
    )
  }

  // Current or past year with a plan.
  const cur = v.current
  const closed = v.complete >= 12
  const notConnected = v.view === 'not_connected'
  const fc = v.forecast

  return (
    <>
      {notConnected && (
        <EmptyCard
          title="The book of business is not connected"
          body="Actuals come from the book. Connect it and every month, carrier and allowance tier is set against the plan."
          action={
            <Link className="cx-btn cx-btn-sm" href="/dashboard/integrations">
              Connect the book
            </Link>
          }
        />
      )}
      {v.view === 'no_actuals' && (
        <p className="cxu-flash" role="status" style={{ padding: '8px 14px' }}>
          No premium written in {year} yet. Actuals fill in here as the book syncs.
        </p>
      )}

      <div className="cx-grid cx-grid-4">
        <Tile label={`${year} plan`} figure={fmtMoney(v.planTotal)}>{policies > 0 ? `${fmtCount(policies)} policies planned` : 'Premium target for the year'}</Tile>
        <Tile label={closed ? 'Written in the year' : 'Written so far'} figure={notConnected ? '—' : fmtMoney(v.actualYtd)}>
          {!notConnected && (
            <>
              <MiniBar value={v.pctOfYearPlan} />
              {pctLabel(v.pctOfYearPlan)} of the year&apos;s plan
            </>
          )}
        </Tile>
        <Tile label={v.completeLabel ? `Pace, ${v.completeLabel}` : 'Pace'} figure={notConnected || v.pace == null ? '—' : pctLabel(v.pace)}>
          {notConnected ? 'Needs the book' : <StatusDot status={v.status} />}
        </Tile>
        {cur ? (
          <Tile label={`${cur.label} so far`} figure={notConnected ? '—' : fmtMoney(cur.actual)}>
            {notConnected ? (
              'Needs the book'
            ) : cur.plan > 0 ? (
              <>
                <MiniBar value={cur.pct} />
                {pctLabel(cur.pct)} of {fmtMoney(cur.plan)} · {cur.day > 0 ? `day ${cur.day} of ${cur.daysInMonth}` : 'no data yet this month'}
              </>
            ) : (
              'No plan this month'
            )}
          </Tile>
        ) : (
          <Tile label="Year result" figure={notConnected ? '—' : pctLabel(v.pctOfYearPlan)}>{notConnected ? 'Needs the book' : 'Of the plan, final'}</Tile>
        )}
      </div>

      <section className="cx-panel">
        <div className="cxp-head">
          <div>
            <h2>Plan vs actual by month</h2>
            <p>{notConnected ? 'Plan only until the book is connected.' : through ? `Premium written, through ${fmtDay(through)}.${cur ? ` ${cur.label} is still in progress.` : ''}` : 'Premium written each month.'}</p>
          </div>
          <Legend items={[{ label: 'Actual', color: INK }, { label: 'Plan', color: SILVER }]} />
        </div>
        <Columns
          labels={[...MONTHS]}
          series={[
            { key: 'actual', label: 'Actual', values: v.months.map((m) => m.actual), color: INK },
            { key: 'plan', label: 'Plan', values: planMonthly, color: SILVER },
          ]}
          height={200}
          format={fmtMoney}
          everyLabel
          ariaLabel={`Plan vs actual by month, ${year}`}
        />
        {!notConnected && <MonthStrip months={v.months} />}
      </section>

      {!notConnected && (
        <section className="cx-panel">
          <div className="cxp-head">
            <div>
              <h2>Pacing</h2>
              <p>Running total of premium against the plan&apos;s running total.</p>
            </div>
            <Legend items={[{ label: 'Actual', color: INK }, { label: 'Plan', color: REF, dashed: true }]} />
          </div>
          <div className="cxp-pacing">
            <div className="cxp-pacing-chart">
              <WaveChart
                labels={[...MONTHS]}
                series={[
                  { key: 'plan', label: 'Plan', values: v.cumPlan, color: REF, dashed: true },
                  { key: 'actual', label: 'Actual', values: v.cumActual, color: INK, fill: true },
                ]}
                height={210}
                format={fmtMoney}
                ticks={[0, 3, 6, 9, 11]}
                ariaLabel={`Running total vs plan, ${year}`}
              />
            </div>
            <div className="cxp-pacing-side">
              <ProgressRow
                label="Plan achieved"
                value={v.pctOfYearPlan}
                figure={pctLabel(v.pctOfYearPlan)}
                marker={v.complete > 0 && !closed ? v.planDueShare : null}
                markerLabel={v.completeLabel ? `Plan due by the end of ${MONTHS[v.complete - 1]}` : undefined}
                sub={
                  <>
                    {fmtMoney(v.actualYtd)} of {fmtMoney(v.planTotal)}
                    {v.complete > 0 && !closed && v.planDueShare != null ? ` · ${pctLabel(v.planDueShare)} was due by the end of ${MONTHS[v.complete - 1]} (tick)` : ''}
                  </>
                }
              />
              <ProgressRow label="Year elapsed" value={v.yearElapsed} figure={pctLabel(v.yearElapsed)} tone="silver" sub={closed ? 'The year is closed' : `${pctLabel(v.yearElapsed)} of ${year} gone`} />
              <div className="cxp-forecast">
                <p className="cx-eyebrow">Year-end forecast</p>
                {fc.value != null ? (
                  <>
                    <div className="cx-kpi-figure" style={{ fontSize: 24 }}>
                      {fmtMoney(fc.value)} <small>{pctLabel(fc.pctOfPlan)} of plan</small>
                    </div>
                    <PaceMeter sofar={v.actualYtd} projected={fc.value} target={v.planTotal} format={fmtMoney} targetLabel="Plan" />
                    <p className="cxp-note">How: {fc.basis}</p>
                  </>
                ) : (
                  <p className="cxp-note" style={{ marginTop: 4 }}>{fc.reason}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

/** Allowance tiers on one rail, a tick per tier (hit ticks filled). */
export function TierRailView({ rail, label }: { rail: TierRail; label: string }) {
  return (
    <div className="cxp-rail" role="img" aria-label={label}>
      <span className="fill cx-widen" style={{ width: pctW(rail.fill) }} />
      {rail.ticks.map((t) => (
        <i key={t.threshold} className={t.hit ? 'is-hit' : undefined} style={{ left: pctW(t.at) }} title={fmtMoney(t.threshold)} />
      ))}
    </div>
  )
}
