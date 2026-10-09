import Link from 'next/link'
import { Sparkline, INK, RED, PaceMeter } from '@/app/components/cxo/charts'
import { DeltaTag } from '@/app/components/cxo/ExecOverview'
import { cumulative, dataThroughOf, delta, fmtCount, fmtMoney, fmtPct, funnelFor, monthlySeries, parseDay, todayUTC, yearHasData, type MonthPoint } from '@/lib/pinnacle/kpis'
import type { DailyRow, StatusRow } from '@/lib/pinnacle/rollup'

/**
 * Reports — the executive read-out: one table per question an owner asks.
 * Period report (this month → last 12 months, each against the prior period
 * and, once the book has it, the same period last year), product lines year
 * to date, and the month-by-month ledger. Labels match the SQL: submitted =
 * every application's annual premium, issued = the part that issue-paid,
 * placement = issued ÷ submitted. Pure presentation over the rollup rows.
 */
const LINES = ['Health', 'Life', 'Annuity']
const SCOPE = 'All teams · Health, Life, Annuity · Pinnacle master book'
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sum(pts: MonthPoint[], pick: (p: MonthPoint) => number): number {
  return pts.reduce((s, p) => s + pick(p), 0)
}
function fmtDay(iso: string | null): string {
  if (!iso) return 'no data yet'
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`
}

export default function CxoReports({
  pinnacleRows,
  statusRows,
  lastSynced,
  now = new Date(),
  dataThrough: dataThroughProp,
  reconciled = false,
}: {
  pinnacleRows: DailyRow[]
  statusRows: StatusRow[]
  lastSynced: string
  now?: Date
  dataThrough?: string | null
  reconciled?: boolean
}) {
  const dataThrough = dataThroughProp ?? dataThroughOf(pinnacleRows)
  // Windows end at the last month with data, never at an empty one.
  const anchor = dataThrough && parseDay(dataThrough) < todayUTC(now) ? new Date(parseDay(dataThrough) + 12 * 3600_000) : now
  const year = now.getUTCFullYear()
  const priorYear = yearHasData(pinnacleRows, year - 1)
  const yoyNote = `No ${year - 1} data in the book yet · year-over-year starts Jan ${year + 1}`
  const s36 = monthlySeries(pinnacleRows, statusRows, 36, anchor)
  const byKey = new Map(s36.map((p) => [p.key, p]))
  const ly = (pts: MonthPoint[]) => pts.map((p) => byKey.get(`${Number(p.key.slice(0, 4)) - 1}${p.key.slice(4)}`)).filter((p): p is MonthPoint => !!p)
  const monthIdx = anchor.getUTCMonth()
  const win = (n: number) => ({ cur: s36.slice(-n), prev: s36.slice(-n * 2, -n) })
  const periods: Array<{ label: string; cur: MonthPoint[]; prev: MonthPoint[] }> = [
    { label: 'This month', ...win(1) },
    { label: 'Last 3 months', ...win(3) },
    { label: 'Last 6 months', ...win(6) },
    { label: 'Year to date', ...win(monthIdx + 1) },
    { label: 'Last 12 months', ...win(12) },
  ]
  const ytd = s36.filter((p) => p.key.startsWith(String(year)))
  const ytdLY = s36.filter((p) => p.key.startsWith(String(year - 1))).slice(0, 12)
  const last12 = s36.slice(-12)
  const best = last12.reduce((a, p) => (p.premium > a.premium ? p : a), last12[0])
  const cumYtd = cumulative(ytd.map((p) => p.premium))
  const ytdTotal = cumYtd[cumYtd.length - 1] ?? 0
  const lyTotal = sum(ytdLY, (p) => p.premium)
  const lySame = sum(ytdLY.slice(0, ytd.length), (p) => p.premium)
  const elapsed = Math.min(1, Math.max(1 / 365, (todayUTC(now) - Date.UTC(year, 0, 1)) / 86_400_000 / 365))

  return (
    <div className="cx-grid" style={{ marginTop: 16 }}>
      {/* Year pace */}
      <section className="cx-panel">
        <div className="cx-eyebrow">{year} so far · submitted premium</div>
        <div className="cx-figure">{fmtMoney(ytdTotal)}</div>
        {priorYear ? <DeltaTag d={delta(ytdTotal, lySame)} suffix={`vs this point in ${year - 1}`} /> : <span className="cx-yoy">{yoyNote}</span>}
        <div style={{ marginTop: 14 }}>
          <PaceMeter sofar={ytdTotal} projected={reconciled ? ytdTotal / elapsed : 0} target={priorYear ? lyTotal : 0} format={fmtMoney} targetLabel={`${year - 1} total`} targetNote={priorYear ? undefined : `${year - 1} total: no data yet`} />
        </div>
        <p className="cx-takeaway">
          {Math.round(elapsed * 100)}% of the year is gone. {reconciled ? `On this run-rate ${year} lands near ${fmtMoney(ytdTotal / elapsed)}.` : 'A run-rate projection appears once the current month reconciles to the book.'}
        </p>
        <div className="cx-scope">
          {SCOPE} · Data through <b>{fmtDay(dataThrough)}</b>
        </div>
      </section>

      {/* Period report */}
      <section className="cx-panel">
        <div className="cx-eyebrow">Period report · submitted, issued and placement, each against the period before it</div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Submitted premium</th>
              <th>Issued premium</th>
              <th>Placement</th>
              <th>vs prior period</th>
              <th>vs same period {year - 1}</th>
              <th>Policies written</th>
              <th>Monthly</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const cur = sum(p.cur, (x) => x.premium)
              const prev = sum(p.prev, (x) => x.premium)
              const iss = sum(p.cur, (x) => x.funded)
              const lyPts = ly(p.cur)
              const lyCur = sum(lyPts, (x) => x.premium)
              return (
                <tr key={p.label}>
                  <th scope="row">{p.label}</th>
                  <td>{fmtMoney(cur)}</td>
                  <td>{fmtMoney(iss)}</td>
                  <td>{fmtPct(cur > 0 ? iss / cur : null)}</td>
                  <td>
                    <DeltaTag d={delta(cur, prev)} />
                  </td>
                  <td>{priorYear && lyPts.length === p.cur.length ? <DeltaTag d={delta(cur, lyCur)} /> : <span className="cx-delta cx-delta-none">—</span>}</td>
                  <td>{fmtCount(sum(p.cur, (x) => x.policies))}</td>
                  <td style={{ width: 110 }}>
                    <Sparkline values={p.cur.length > 1 ? p.cur.map((x) => x.premium) : [0, cur]} color={INK} height={24} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!priorYear && <p className="cx-takeaway">vs same period {year - 1}: {yoyNote}.</p>}
        <div className="cx-scope">
          {SCOPE} · Data through <b>{fmtDay(dataThrough)}</b>
        </div>
      </section>

      {/* Product lines */}
      <section className="cx-panel">
        <div className="cx-eyebrow">Product lines · {year} to date</div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Submitted premium</th>
              <th>Issued premium</th>
              <th>Placement</th>
              <th>Policies written</th>
              <th>Share of book</th>
              <th>vs {year - 1} to date</th>
              <th>12 months</th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => {
              const cur = sum(ytd, (x) => x.byLine[line]?.premium ?? 0)
              const prev = sum(ytdLY.slice(0, ytd.length), (x) => x.byLine[line]?.premium ?? 0)
              const pol = sum(ytd, (x) => x.byLine[line]?.policies ?? 0)
              const total = sum(ytd, (x) => x.premium)
              const issLine = monthlySeries(pinnacleRows, [], 36, anchor, line).filter((p) => p.key.startsWith(String(year)))
              const iss = sum(issLine, (x) => x.funded)
              const spark = last12.map((x) => x.byLine[line]?.premium ?? 0)
              return (
                <tr key={line}>
                  <th scope="row">{line}</th>
                  <td>{fmtMoney(cur)}</td>
                  <td>{fmtMoney(iss)}</td>
                  <td>{fmtPct(cur > 0 ? iss / cur : null)}</td>
                  <td>{fmtCount(pol)}</td>
                  <td>{total > 0 ? fmtPct(cur / total) : '—'}</td>
                  <td>{priorYear ? <DeltaTag d={delta(cur, prev)} /> : <span className="cx-delta cx-delta-none">—</span>}</td>
                  <td style={{ width: 120 }}>
                    <Sparkline values={spark} color={INK} height={26} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="cx-scope">
          {SCOPE} · Data through <b>{fmtDay(dataThrough)}</b>
        </div>
      </section>

      {/* Month ledger */}
      <section className="cx-panel">
        <div className="cx-eyebrow">Month by month · last 12 months</div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Submitted premium</th>
              <th>Issued premium</th>
              <th>Placement</th>
              <th>Written</th>
              <th>Pending</th>
              <th>vs month before</th>
              <th>vs same month {year - 1}</th>
            </tr>
          </thead>
          <tbody>
            {last12
              .slice()
              .reverse()
              .map((m, i) => {
                const idx = s36.length - 1 - i
                const before = s36[idx - 1]
                const lyM = s36[idx - 12]
                const f = funnelFor([m])
                const isBest = best && m.key === best.key
                return (
                  <tr key={m.key}>
                    <th scope="row" style={isBest ? { color: RED } : undefined}>
                      {m.longLabel}
                      {isBest ? ' · best' : ''}
                    </th>
                    <td>{fmtMoney(m.premium)}</td>
                    <td>{fmtMoney(m.funded)}</td>
                    <td>{fmtPct(m.premium > 0 ? m.funded / m.premium : null)}</td>
                    <td>{fmtCount(f.written)}</td>
                    <td>{fmtCount(f.pending)}</td>
                    <td>
                      <DeltaTag d={delta(m.premium, before?.premium ?? 0)} />
                    </td>
                    <td>{priorYear ? <DeltaTag d={delta(m.premium, lyM?.premium ?? 0)} /> : <span className="cx-delta cx-delta-none">—</span>}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
        <p className="cx-takeaway">
          Data through {fmtDay(dataThrough)}. Synced {lastSynced}. Everything here is read straight from the book. <Link href="/dashboard/pinnacle" className="cx-link">See the full performance view →</Link>
        </p>
      </section>
    </div>
  )
}
