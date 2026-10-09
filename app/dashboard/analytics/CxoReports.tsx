import Link from 'next/link'
import { Sparkline, INK, RED } from '@/app/components/cxo/charts'
import { delta, deltaWords, fmtCount, fmtMoney, fmtPct, funnelFor, monthlySeries, yearPace, type MonthPoint } from '@/lib/pinnacle/kpis'
import type { DailyRow, StatusRow } from '@/lib/pinnacle/rollup'

/**
 * Reports — the executive read-out: one table per question an owner asks.
 * Period report (this month → last 12 months, each against the same period
 * last year), product lines year to date, and the month-by-month ledger.
 * Pure presentation over the rollup rows; no new data layer.
 */
const LINES = ['Health', 'Life', 'Annuity']

function sum(pts: MonthPoint[], pick: (p: MonthPoint) => number): number {
  return pts.reduce((s, p) => s + pick(p), 0)
}

export default function CxoReports({
  pinnacleRows,
  statusRows,
  lastSynced,
  now = new Date(),
}: {
  pinnacleRows: DailyRow[]
  statusRows: StatusRow[]
  lastSynced: string
  now?: Date
}) {
  const s24 = monthlySeries(pinnacleRows, statusRows, 24, now)
  const monthIdx = now.getUTCMonth() // months elapsed this year before the current one
  const periods: Array<{ label: string; cur: MonthPoint[]; prev: MonthPoint[] }> = [
    { label: 'This month', cur: s24.slice(-1), prev: s24.slice(-13, -12) },
    { label: 'Last 3 months', cur: s24.slice(-3), prev: s24.slice(-15, -12) },
    { label: 'Last 6 months', cur: s24.slice(-6), prev: s24.slice(-18, -12) },
    { label: 'Year to date', cur: s24.slice(-(monthIdx + 1)), prev: s24.slice(-(monthIdx + 13), -12) },
    { label: 'Last 12 months', cur: s24.slice(-12), prev: s24.slice(-24, -12) },
  ]
  const pace = yearPace(pinnacleRows, now)
  const ytd = s24.slice(-(monthIdx + 1))
  const ytdLY = s24.slice(-(monthIdx + 13), -12)
  const last12 = s24.slice(-12)
  const best = last12.reduce((a, p) => (p.premium > a.premium ? p : a), last12[0])

  return (
    <div className="cx-grid" style={{ marginTop: 16 }}>
      {/* Period report */}
      <section className="cx-panel">
        <div className="cx-eyebrow">Period report · issued premium against the same period last year</div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Issued premium</th>
              <th>Same period last year</th>
              <th>Change</th>
              <th>Written</th>
              <th>Issued</th>
              <th>Placement</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const cur = sum(p.cur, (x) => x.premium)
              const prev = sum(p.prev, (x) => x.premium)
              const d = delta(cur, prev)
              const f = funnelFor(p.cur)
              return (
                <tr key={p.label}>
                  <th scope="row">{p.label}</th>
                  <td>{fmtMoney(cur)}</td>
                  <td>{fmtMoney(prev)}</td>
                  <td className={`cx-delta cx-delta-${d.dir}`}>{deltaWords(d)}</td>
                  <td>{fmtCount(f.written)}</td>
                  <td>{fmtCount(f.issued)}</td>
                  <td>{fmtPct(f.placement)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="cx-takeaway">
          {pace.vsLastYear.pct === null
            ? `Year to date ${fmtMoney(pace.ytd)} issued.`
            : `Year to date ${fmtMoney(pace.ytd)} issued, ${deltaWords(pace.vsLastYear)} on last year at this point. On pace for ${fmtMoney(pace.projected)} by December against ${fmtMoney(pace.lastYearTotal)} last year.`}
        </p>
      </section>

      {/* Product lines */}
      <section className="cx-panel">
        <div className="cx-eyebrow">Product lines · year to date</div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Issued premium</th>
              <th>Last year to date</th>
              <th>Change</th>
              <th>Policies</th>
              <th>Share of book</th>
              <th>12 months</th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => {
              const cur = sum(ytd, (x) => x.byLine[line]?.premium ?? 0)
              const prev = sum(ytdLY, (x) => x.byLine[line]?.premium ?? 0)
              const pol = sum(ytd, (x) => x.byLine[line]?.policies ?? 0)
              const total = sum(ytd, (x) => x.premium)
              const d = delta(cur, prev)
              const spark = last12.map((x) => x.byLine[line]?.premium ?? 0)
              return (
                <tr key={line}>
                  <th scope="row">{line}</th>
                  <td>{fmtMoney(cur)}</td>
                  <td>{fmtMoney(prev)}</td>
                  <td className={`cx-delta cx-delta-${d.dir}`}>{deltaWords(d)}</td>
                  <td>{fmtCount(pol)}</td>
                  <td>{total > 0 ? fmtPct(cur / total) : '—'}</td>
                  <td style={{ width: 120 }}>
                    <Sparkline values={spark} color={INK} height={26} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Month ledger */}
      <section className="cx-panel">
        <div className="cx-eyebrow">Month by month · last 12 months</div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Issued premium</th>
              <th>Written</th>
              <th>Issued</th>
              <th>Pending</th>
              <th>Placement</th>
              <th>vs same month last year</th>
            </tr>
          </thead>
          <tbody>
            {last12
              .slice()
              .reverse()
              .map((m, i) => {
                const ly = s24[s24.length - 1 - i - 12]
                const d = delta(m.premium, ly?.premium ?? 0)
                const f = funnelFor([m])
                const isBest = best && m.key === best.key
                return (
                  <tr key={m.key}>
                    <th scope="row" style={isBest ? { color: RED } : undefined}>
                      {m.longLabel}
                      {isBest ? ' · best' : ''}
                    </th>
                    <td>{fmtMoney(m.premium)}</td>
                    <td>{fmtCount(f.written)}</td>
                    <td>{fmtCount(f.issued)}</td>
                    <td>{fmtCount(f.pending)}</td>
                    <td>{fmtPct(f.placement)}</td>
                    <td className={`cx-delta cx-delta-${d.dir}`}>{deltaWords(d)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
        <p className="cx-takeaway">
          Synced {lastSynced}. Everything here is read straight from the book. <Link href="/dashboard/pinnacle" className="cx-link">See the full performance view →</Link>
        </p>
      </section>
    </div>
  )
}
