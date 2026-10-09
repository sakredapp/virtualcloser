'use client'

/**
 * Team page: "Retention & turnover" (owner 10-09). Who is still writing at
 * 3 / 6 / 12 / 24 months, the 10-month mark, annualised turnover, joined vs
 * left by month, early washout, and the agents approaching month 10 whose
 * production dropped. Built in SQL by pinnacle_build_people_stats().
 * Charcoal + red only; red is the latest cohort, leavers, and the one number
 * to look at.
 */
import { useState } from 'react'
import type { PeopleStats, Retention } from '@/lib/pinnacle/people'
import { fmtCount, fmtPct } from '@/lib/pinnacle/kpis'
import { Columns, INK, RED, WaveChart } from './charts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mLabel = (k: string) => MONTHS[Number(k.slice(5, 7)) - 1] ?? k
const mLong = (k: string) => `${mLabel(k)} ${k.slice(0, 4)}`
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const dayLabel = (iso: string | null) => {
  if (!iso) return 'none yet'
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

export function Info({ text }: { text: string }) {
  return (
    <span className="cx-info" tabIndex={0} role="note" aria-label={text}>
      i<span className="cx-info-tip">{text}</span>
    </span>
  )
}

export const TEN_MONTH_COPY = 'Most agents who leave do it in their first 10 months; those who get past it tend to stay.'
export const STILL_WRITING_COPY =
  'Still writing = at least one policy (not declined) in the 90 days before that month mark. Only agents who joined long enough ago to reach the mark count, and only when that 90-day window sits inside the book of business.'

export function milestonePct(r: Retention | undefined, key: 'm3' | 'm6' | 'm10' | 'm12' | 'm24'): number | null {
  const m = r?.milestones?.[key]
  return m ? ratio(m.writing, m.n) : null
}

export function turnoverPct(r: Retention | undefined): number | null {
  const t = r?.turnover
  if (!t || !t.avg_headcount || !t.months) return null
  return (t.left / t.avg_headcount) * (12 / t.months)
}

export default function TeamRetention({ data }: { data: PeopleStats }) {
  const r = data.retention
  const [showAll, setShowAll] = useState(false)
  if (!r) return null
  const asOf = `as of ${data.today}`
  const bookFrom = mLong(data.book_start.slice(0, 7))

  // Retention curve: average of every cohort old enough for each month mark,
  // and the latest quarter of joiners with at least four marks.
  const K = 24
  const labels = Array.from({ length: K }, (_, i) => `Month ${i + 1}`)
  const avg = labels.map((_, i) => {
    const p = r.curve.find((c) => c.k === i + 1)
    return p && p.n > 0 ? (p.writing / p.n) * 100 : 0
  })
  const latest = [...r.cohorts].reverse().find((c) => c.points.length >= 4 && c.points[0]?.k === 1)
  const latestVals = latest ? latest.points.filter((p, i) => p.k === i + 1).map((p) => (p.n > 0 ? (p.writing / p.n) * 100 : 0)) : []
  const pct = (n: number) => `${Math.round(n)}%`

  const flow = r.flow
  const partial = flow.length > 0 && flow[flow.length - 1].partial
  const joinedSum = flow.reduce((a, f) => a + f.joined, 0)
  const leftSum = flow.reduce((a, f) => a + f.left, 0)

  const w = r.washout
  const never = ratio(w.never, w.eligible)
  const stopped = ratio(w.stopped90, w.eligible)
  const early = ratio(w.never + w.stopped90, w.eligible)

  const m10 = milestonePct(r, 'm10')
  const turnover = turnoverPct(r)
  const marks = (['m3', 'm6', 'm12', 'm24'] as const).map((k) => ({ k, label: `${k.slice(1)} months`, v: milestonePct(r, k), n: r.milestones[k]?.n ?? 0 }))

  const list = showAll ? r.approaching : r.approaching.slice(0, 8)
  const askMira = (a: (typeof r.approaching)[number]) => {
    const text =
      `Draft a check-in to ${a.team ? `${a.team}'s` : 'their'} upline about ${a.name}: ${a.months_in} months in, ` +
      `${fmtCount(a.recent_n)} policies in the last 60 days vs ${fmtCount(a.prior_n)} the 60 days before, last policy ${dayLabel(a.last_wrote)}. ` +
      `Most agents who leave do it before month 10, so ask how we can help them get past it.`
    window.dispatchEvent(new CustomEvent('mira:focus', { detail: { text } }))
  }

  return (
    <>
      <section className="cx-panel">
        <div className="cx-retention-head">
          <h2 className="cx-section-title">Retention &amp; turnover</h2>
          <Info text={STILL_WRITING_COPY} />
        </div>
        <div className="cx-retention-figs">
          {marks.map((m) => (
            <div key={m.k}>
              <div className="cx-kpi-figure">{fmtPct(m.v)}</div>
              <div className="cx-kpi-sub">still writing at {m.label} · {fmtCount(m.n)} agents</div>
            </div>
          ))}
          <div>
            <div className="cx-kpi-figure" style={{ color: RED }}>{fmtPct(m10)}</div>
            <div className="cx-kpi-sub">
              make it past month 10 <Info text={TEN_MONTH_COPY} />
            </div>
          </div>
          <div>
            <div className="cx-kpi-figure">{fmtPct(turnover)}</div>
            <div className="cx-kpi-sub">
              turnover, annualised{' '}
              <Info
                text={`Agents who left ÷ average writing headcount, scaled to 12 months. Left = 90 days with no policy after their last one, or moved to inactive, terminated or released while still writing. Counted ${mLong(r.turnover.from.slice(0, 7))} to today (${r.turnover.months.toFixed(1)} months), the stretch the book can see: ${fmtCount(r.turnover.left)} left, average ${fmtCount(Math.round(r.turnover.avg_headcount ?? 0))} writing agents.`}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="cx-grid cx-grid-hero" style={{ alignItems: 'start' }}>
        <section className="cx-panel">
          <div className="cx-eyebrow">Retention curve · % still writing, by months since joining</div>
          <div style={{ marginTop: 12 }}>
            <WaveChart
              labels={labels}
              series={[
                { key: 'avg', label: 'All cohorts', values: avg, color: INK, width: 2 },
                ...(latest ? [{ key: 'latest', label: `Joined ${latest.q}`, values: latestVals, color: RED, width: 2.5 }] : []),
              ]}
              format={pct}
              height={240}
              ticks={[0, 2, 5, 9, 11, 17, 23]}
              markers={[{ index: 9, label: '10-month mark' }]}
              ariaLabel="Share of agents still writing by months since joining"
            />
          </div>
          <ul className="cx-legend">
            <li><i style={{ background: INK }} /> All cohorts</li>
            {latest && <li><i style={{ background: RED }} /> Joined {latest.q} (latest)</li>}
          </ul>
          <p className="cx-takeaway">
            Writing peaks around month 3 at <strong>{fmtPct(milestonePct(r, 'm3'))}</strong>, then <strong>{fmtPct(m10)}</strong> are still writing at month 10 and{' '}
            <strong>{fmtPct(milestonePct(r, 'm12'))}</strong> at month 12.
          </p>
          <div className="cx-scope">
            Joiners since Sep 2024 (the Aug 2024 bulk import has no real join date) · each month mark uses only cohorts old enough to reach it, so the line moves where the mix changes · {asOf}
          </div>
        </section>

        <section className="cx-panel">
          <div className="cx-eyebrow">Joined vs left · per month</div>
          <div style={{ marginTop: 12 }}>
            <Columns
              labels={flow.map((f) => mLabel(f.m))}
              series={[
                { key: 'j', label: 'Joined', values: flow.map((f) => f.joined), color: INK },
                { key: 'l', label: 'Left', values: flow.map((f) => f.left), color: RED },
              ]}
              line={{ label: 'Net change', values: flow.map((f) => f.joined - f.left), color: INK }}
              format={fmtCount}
              height={240}
              everyLabel
              partialLast={partial ? 'so far' : undefined}
              ariaLabel="Agents joined and left per month, with net change"
            />
          </div>
          <ul className="cx-legend">
            <li><i style={{ background: INK }} /> Joined</li>
            <li><i style={{ background: RED }} /> Left</li>
            <li><i className="dashed" style={{ color: INK }} /> Net change</li>
          </ul>
          <p className="cx-takeaway">
            Since {flow[0] ? mLong(flow[0].m) : bookFrom}: <strong>{fmtCount(joinedSum)}</strong> joined, <strong>{fmtCount(leftSum)}</strong> left, net{' '}
            <strong>{joinedSum - leftSum >= 0 ? '+' : ''}{fmtCount(joinedSum - leftSum)}</strong>.
          </p>
          <div className="cx-scope">Joined = Directory join date · left = stopped writing for 90 days, or marked inactive while writing · starts when the book can see 90 days back · {asOf}</div>
        </section>
      </div>

      <div className="cx-grid cx-grid-hero" style={{ alignItems: 'start' }}>
        <section className="cx-panel">
          <div className="cx-eyebrow">Early washout</div>
          <div className="cx-retention-figs" style={{ marginTop: 8 }}>
            <div>
              <div className="cx-kpi-figure" style={{ color: RED }}>{fmtPct(early)}</div>
              <div className="cx-kpi-sub">washed out early</div>
            </div>
            <div>
              <div className="cx-kpi-figure">{fmtPct(never)}</div>
              <div className="cx-kpi-sub">never wrote a policy · {fmtCount(w.never)}</div>
            </div>
            <div>
              <div className="cx-kpi-figure">{fmtPct(stopped)}</div>
              <div className="cx-kpi-sub">wrote, then stopped within 90 days · {fmtCount(w.stopped90)}</div>
            </div>
          </div>
          <p className="cx-takeaway">
            Of <strong>{fmtCount(w.eligible)}</strong> agents who joined since {bookFrom} and have been here at least 6 months.
          </p>
          <div className="cx-scope">Stopped = every policy within 90 days of their first, and none in the last 90 days · {asOf}</div>
        </section>

        <section className="cx-panel">
          <div className="cx-retention-head">
            <div className="cx-eyebrow">Approaching the 10-month mark · production dropped</div>
            <Info text={TEN_MONTH_COPY} />
          </div>
          {r.approaching.length === 0 ? (
            <p className="cx-takeaway">No agent in months 6 to 10 has dropped off in the last 60 days.</p>
          ) : (
            <>
              <table className="cx-table cx-approach">
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: 'left' }}>Agent</th>
                    <th scope="col">Months in</th>
                    <th scope="col">Last policy</th>
                    <th scope="col"><span className="cx-visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id}>
                      <th scope="row" style={{ textAlign: 'left' }}>
                        <div className="cx-approach-name">{a.name}</div>
                        <div className="cx-approach-team">
                          {a.team || 'No agency'} · {fmtCount(a.recent_n)} policies last 60 days, down from {fmtCount(a.prior_n)}
                        </div>
                      </th>
                      <td>{a.months_in}</td>
                      <td>{dayLabel(a.last_wrote)}</td>
                      <td>
                        <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => askMira(a)}>
                          Ask Mira
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.approaching.length > 8 && (
                <button type="button" className="cx-link-quiet" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${fmtCount(r.approaching.length)}`}
                </button>
              )}
            </>
          )}
          <div className="cx-scope">
            {fmtCount(r.approaching_total)} active agents 6 to 10 months in wrote less in the last 60 days than the 60 before · biggest drop first · Ask Mira drafts a check-in to their upline · {asOf}
          </div>
        </section>
      </div>
    </>
  )
}
