'use client'

/**
 * Team page, top: the people behind the book. Headcount, onboarding (days
 * to first policy, $5K / $10K milestones), new-agent persistency and
 * retention, from the Pinnacle Directory joined to the master book's
 * policies (lib/pinnacle/people.ts). Charcoal + red only.
 */
import type { PeopleStats } from '@/lib/pinnacle/people'
import { fmtCount, fmtPct } from '@/lib/pinnacle/kpis'
import { Columns, INK, RED } from './charts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mLabel = (k: string) => MONTHS[Number(k.slice(5, 7)) - 1] ?? k
const mLong = (k: string) => `${mLabel(k)} ${k.slice(0, 4)}`
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const days = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)} days`)

function Stat({ label, figure, sub, hot }: { label: string; figure: string; sub?: string; hot?: boolean }) {
  return (
    <div className="cx-panel cx-stat">
      <div className="cx-eyebrow">{label}</div>
      <div className="cx-kpi-figure" style={hot ? { color: RED } : undefined}>{figure}</div>
      {sub && <div className="cx-kpi-sub">{sub}</div>}
    </div>
  )
}

function Foot({ children }: { children: React.ReactNode }) {
  return <div className="cx-scope">{children}</div>
}

export default function TeamPeople({ data, computedAt }: { data: PeopleStats; computedAt: string }) {
  const fp = data.first_policy
  const joins = data.joins_by_month
  const asOf = `as of ${data.today}`
  const activeShare = ratio(data.writing30, data.active)
  // Days-to-first-policy trend: only join months at least 60 days old, so
  // agents still inside their first weeks don't drag the median down.
  const cutoff = new Date(Date.parse(data.today + 'T12:00:00Z') - 60 * 86_400_000).toISOString().slice(0, 7)
  const trend = joins.filter((j) => j.m < cutoff && j.m >= data.book_start.slice(0, 7) && j.median_days != null)
  const spike = joins.reduce((a, j) => (j.inactive > a.inactive ? j : a), joins[0])
  const typicalInactive = joins.map((j) => j.inactive).sort((a, b) => a - b)[Math.floor(joins.length / 2)] ?? 0
  const lines = (['Life', 'Health'] as const).filter((l) => data.persistency6?.[l] && data.persistency6[l].new_total > 0)
  const lastJoin = joins[joins.length - 1]
  const firstJoin = joins[0]

  return (
    <>
      <div className="cx-grid cx-grid-6">
        <Stat label="Agencies" figure={fmtCount(data.agencies)} sub="with active agents" />
        <Stat label="Agents" figure={fmtCount(data.roster)} sub={`${fmtCount(data.active)} active`} />
        <Stat label="Wrote · last 30 days" figure={fmtCount(data.writing30)} sub="agents with a policy" />
        <Stat label="Wrote · last 3 months" figure={fmtCount(data.writing90)} sub="agents with a policy" />
        <Stat label="New · first 30 days" figure={fmtCount(data.new30)} sub="joined in the last 30 days" />
        <Stat label="Active and writing" figure={fmtPct(activeShare)} sub="of active agents wrote in 30 days" hot />
      </div>

      <div className="cx-grid cx-grid-hero">
        <section className="cx-panel">
          <div className="cx-eyebrow">New agents per month · and how many are still active</div>
          <div style={{ marginTop: 12 }}>
            <Columns
              labels={joins.map((j) => mLabel(j.m))}
              series={[
                { key: 'j', label: 'Joined', values: joins.map((j) => j.joined), color: INK },
                { key: 'a', label: 'Still active', values: joins.map((j) => j.still_active), color: RED },
              ]}
              format={fmtCount}
              ariaLabel="New agents per month and how many are still active"
            />
          </div>
          <ul className="cx-legend">
            <li><i style={{ background: INK }} /> Joined</li>
            <li><i style={{ background: RED }} /> Still active today</li>
          </ul>
          <p className="cx-takeaway">
            <strong>{fmtCount(lastJoin?.joined ?? 0)}</strong> joined in {lastJoin ? mLong(lastJoin.m) : 'the latest month'} so far. Of the {fmtCount(firstJoin?.joined ?? 0)} who joined in {firstJoin ? mLong(firstJoin.m) : 'the first month'}, {fmtPct(ratio(firstJoin?.still_active ?? 0, firstJoin?.joined ?? 0))} are still active.
          </p>
          <Foot>Pinnacle Directory · Agent Created On and Agent Status · {asOf}</Foot>
        </section>

        <section className="cx-panel">
          <div className="cx-eyebrow">Agents marked inactive per month</div>
          <div style={{ marginTop: 12 }}>
            <Columns labels={joins.map((j) => mLabel(j.m))} series={[{ key: 'i', label: 'Marked inactive', values: joins.map((j) => j.inactive), color: INK }]} format={fmtCount} ariaLabel="Agents marked inactive per month" />
          </div>
          <p className="cx-takeaway">
            Usually about <strong>{fmtCount(typicalInactive)}</strong> a month.
            {spike && spike.inactive > typicalInactive * 4 ? ` ${mLong(spike.m)} (${fmtCount(spike.inactive)}) was a roster clean-up, not that many agents leaving at once.` : ''}
          </p>
          <Foot>Directory · Last Agent Status Change, agents not active today · {asOf}</Foot>
        </section>
      </div>

      <div className="cx-grid cx-grid-hero">
        <section className="cx-panel">
          <div className="cx-eyebrow">Days to first policy · by join month</div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
            <div>
              <div className="cx-kpi-figure">{days(fp.median_days)}</div>
              <div className="cx-kpi-sub">median, new agent to first policy</div>
            </div>
            {([[30, fp.within30, fp.eligible30], [60, fp.within60, fp.eligible60], [90, fp.within90, fp.eligible90]] as const).map(([d, n, of]) => (
              <div key={d}>
                <div className="cx-kpi-figure">{fmtPct(ratio(n, of))}</div>
                <div className="cx-kpi-sub">wrote within {d} days</div>
              </div>
            ))}
          </div>
          {trend.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Columns labels={trend.map((j) => mLabel(j.m))} series={[{ key: 'd', label: 'Median days to first policy', values: trend.map((j) => Math.round(j.median_days ?? 0)), color: INK }]} format={(n) => `${n} days`} ariaLabel="Median days to first policy by join month" />
            </div>
          )}
          <p className="cx-takeaway">
            Of {fmtCount(fp.joiners)} agents who joined since {mLong(data.book_start.slice(0, 7))}, <strong>{fmtCount(fp.wrote)}</strong> have written a policy. Shares count only agents who have been here at least that long.
          </p>
          <Foot>Directory joined to Life and Health policies (not declined) · join months at least 60 days old · {asOf}</Foot>
        </section>

        <section className="cx-panel">
          <div className="cx-eyebrow">Milestones · new agents</div>
          <div style={{ display: 'grid', gap: 14, marginTop: 10 }}>
            <div>
              <div className="cx-kpi-figure">{days(fp.median5k)}</div>
              <div className="cx-kpi-sub">median to $5K annual premium · {fmtCount(fp.reached5k)} agents got there</div>
            </div>
            <div>
              <div className="cx-kpi-figure">{days(fp.median10k)}</div>
              <div className="cx-kpi-sub">median to $10K annual premium · {fmtCount(fp.reached10k)} agents got there</div>
            </div>
          </div>
          {lines.length > 0 && (
            <>
              <div className="cx-eyebrow" style={{ marginTop: 18 }}>6-month persistency · new agents vs everyone else</div>
              <table className="cx-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: 'left' }}>Line</th>
                    <th scope="col">First 12 months</th>
                    <th scope="col">Everyone else</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const p = data.persistency6![l]
                    return (
                      <tr key={l}>
                        <th scope="row" style={{ textAlign: 'left' }}>{l}</th>
                        <td>{fmtPct(ratio(p.new_paid, p.new_total))}</td>
                        <td>{fmtPct(ratio(p.rest_paid, p.rest_total))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          <Foot>Counted from policies, since joined · persistency = still paid of paid + lapsed, policies effective 6–12 months ago · {asOf}</Foot>
        </section>
      </div>

      <details className="cx-details">
        <summary>How these are counted</summary>
        <div className="cx-details-body" style={{ fontSize: 13, color: 'var(--cx-muted)', display: 'grid', gap: 6, paddingBottom: 14 }}>
          <div>Agents = everyone on the Directory except terminated and released. Active = Active Agent, Team Leader or New Agent. Writing = at least one policy (not declined) dated in the window.</div>
          <div>
            Directory fields filled ({fmtCount(data.fill.directory_rows ?? 0)} rows): Agent Created On {data.fill.created_on}% · Agent Status {data.fill.agent_status}% · Last Agent Status Change {data.fill.last_status_change}% · First Sale {data.fill.first_sale}% · First $5K {data.fill.first_5k}% · First $10K {data.fill.first_10k}% · NPN {data.fill.npn}% · Team {data.fill.team}%. Policies matched to a Directory agent: {data.policies_linked_pct ?? '—'}%.
          </div>
          <div>Milestone dates come from each agent&apos;s own policies. The Directory&apos;s status-change dates were stamped in bulk on a few days, so they can&apos;t time a milestone. 13-month persistency starts once the book (from {mLong(data.book_start.slice(0, 7))}) has policies 13 months old.</div>
          <div>Refreshed after each sync · {computedAt.slice(0, 16).replace('T', ' ')} UTC</div>
        </div>
      </details>
    </>
  )
}
