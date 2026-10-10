'use client'

import { useMemo, useState } from 'react'
import { Columns, INK, SILVER } from '@/app/components/cxo/charts'
import { fmtMoney, fmtPct } from '@/lib/pinnacle/kpis'
import type { PlanPageData } from '@/lib/plan/data'
import { MONTHS, allowanceStatus, asOfDay, matchActual, periodElapsed, quarterOf } from '@/lib/plan/shared'
import { actualProfitMonthly, allowanceDollars, coverageSummary, profitBreakdown, profitSummary, type ProfitLine } from '@/lib/plan/comp'

const pts = (n: number | null) => (n == null ? '—' : `${Math.round(n * 10) / 10} pts`)
const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** Comp grids: upload only. A compact summary of what's covered, never a big editable table. */
export function CompGridsPanel({ data, onUpload }: { data: PlanPageData; onUpload: () => void }) {
  const comp = data.comp
  const cov = useMemo(() => coverageSummary(comp?.rates ?? []), [comp])
  const [all, setAll] = useState(false)
  if (!comp) return null
  // Grids in use: distinct uploads the current rates came from.
  const gridCount = new Set(comp.rates.map((r) => r.upload_id).filter(Boolean)).size
  const lastComp = comp.uploads.find((u) => u.kind === 'comp') ?? null
  const shown = all ? cov.byCarrier : cov.byCarrier.slice(0, 6)
  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Comp grids</h2>
          <p>
            {cov.rows === 0
              ? 'Upload your carrier contract levels and agent payout levels. The spread between them drives the profit numbers.'
              : `${gridCount > 0 ? `${gridCount} ${gridCount === 1 ? 'grid' : 'grids'} loaded · ` : ''}${cov.carriers} ${cov.carriers === 1 ? 'carrier' : 'carriers'} × ${cov.products} ${cov.products === 1 ? 'product' : 'products'} covered.${lastComp ? ` Last upload ${fmtDate(lastComp.created_at)}${lastComp.member_name ? ` by ${lastComp.member_name}` : ''}.` : ''}`}
          </p>
        </div>
        <button type="button" className={`cx-btn cx-btn-sm${cov.rows ? ' cx-btn-ghost' : ''}`} onClick={onUpload}>Upload comp grid</button>
      </div>
      {cov.rows > 0 && (
        <>
          <ul className="cxu-cov">
            {shown.map((c) => (
              <li key={c.carrier}>
                <b>{c.carrier}</b>
                <span className="p">{c.products.length ? c.products.join(', ') : 'All products'}</span>
                <span className="d">{fmtDate(c.updated_at)}</span>
              </li>
            ))}
          </ul>
          {cov.byCarrier.length > 6 && (
            <button type="button" className="cxu-link-btn" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${cov.byCarrier.length} carriers`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

/** Agency profit: premium × override spread, for the plan and (estimated) for actuals, plus marketing allowance. */
export function ProfitPanel({ data }: { data: PlanPageData }) {
  const { year, today, actuals, targets, tiers } = data
  const rates = useMemo(() => data.comp?.rates ?? [], [data.comp])
  const [dim, setDim] = useState<'carrier' | 'product'>('carrier')
  const thisYear = Number(today.slice(0, 4))
  const future = year > thisYear
  const current = year === thisYear
  const s = useMemo(() => profitSummary(targets, rates), [targets, rates])
  const actualMonthly = useMemo(() => actualProfitMonthly(actuals.monthly, s.blendedSpread), [actuals.monthly, s.blendedSpread])
  const actualToDate = actualMonthly.reduce((a, b) => a + b, 0)
  const asOf = asOfDay(year, today, actuals.through)
  const throughMonth = future ? 0 : year < thisYear ? 12 : Number(asOf.slice(5, 7))
  const planToDate = s.monthly.slice(0, throughMonth).reduce((a, b) => a + b, 0)
  const lines = useMemo(() => profitBreakdown(targets, rates, dim, future ? null : dim === 'carrier' ? actuals.byCarrier : actuals.byProduct), [targets, rates, dim, future, actuals.byCarrier, actuals.byProduct])

  const allowance = useMemo(() => {
    if (!current) return null
    const tm = Number(today.slice(5, 7))
    const keys = new Map<string, { carrier: string; period: 'month' | 'quarter' }>()
    for (const t of tiers) keys.set(`${t.carrier.toLowerCase()}\u0000${t.period}`, { carrier: t.carrier, period: t.period })
    let earned = 0
    let onPace = 0
    let counted = 0
    for (const g of keys.values()) {
      const rows = g.period === 'month' ? actuals.carrierThisMonth : actuals.carrierThisQuarter
      const st = allowanceStatus(g.carrier, g.period, tiers, matchActual(g.carrier, rows).premium, periodElapsed(g.period, today), g.period === 'month' ? MONTHS[tm - 1] : `Q${quarterOf(tm)}`)
      const e = st.reached ? allowanceDollars(st.reached.unlocks) : null
      const p = st.projectedTier ? allowanceDollars(st.projectedTier.unlocks) : null
      if (e != null || p != null) counted++
      earned += e ?? 0
      onPace += p ?? e ?? 0
    }
    return keys.size ? { earned, onPace, counted, groups: keys.size } : null
  }, [current, tiers, actuals.carrierThisMonth, actuals.carrierThisQuarter, today])

  if (!data.comp) return null
  if (rates.length === 0) {
    return (
      <section className="cx-panel">
        <div className="cxp-head">
          <div>
            <h2>Agency profit</h2>
            <p>Upload a comp grid and this shows the override spread on the plan and on what's been written, by month, carrier and product.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Agency profit</h2>
          <p>Premium × override spread (agency comp − agent payout, at the top agent level). Actuals are an estimate: the book splits premium by carrier or by product, not both.</p>
        </div>
      </div>
      <div className="cxu-kpis">
        <div>
          <p className="cx-eyebrow">{year} plan profit</p>
          <div className="cx-kpi-figure">{fmtMoney(s.total)}</div>
          <div className="cx-kpi-sub">on {fmtMoney(s.planPremium)} plan premium</div>
        </div>
        <div>
          <p className="cx-eyebrow">Profit so far (est.)</p>
          <div className="cx-kpi-figure">{future ? '—' : fmtMoney(actualToDate)}</div>
          <div className="cx-kpi-sub">{future ? `Starts Jan 1, ${year}` : `Plan to date ${fmtMoney(planToDate)}`}</div>
        </div>
        <div>
          <p className="cx-eyebrow">Blended spread</p>
          <div className="cx-kpi-figure">{pts(s.blendedSpread)}</div>
          <div className="cx-kpi-sub">{fmtPct(s.coverage)} of plan premium has a comp grid</div>
        </div>
        <div>
          <p className="cx-eyebrow">Marketing allowance</p>
          <div className="cx-kpi-figure">{allowance ? fmtMoney(allowance.earned) : '—'}</div>
          <div className="cx-kpi-sub">{allowance ? `Earned this period; on pace for ${fmtMoney(allowance.onPace)}` : current ? 'No allowance tiers with a dollar amount' : 'Counts in the current year'}</div>
        </div>
      </div>

      <div className="cxp-head" style={{ marginTop: 14 }}>
        <p style={{ margin: 0 }}>Profit by month</p>
        <ul className="cx-legend">
          <li><i style={{ background: INK, height: 10, width: 10, borderRadius: 2 }} />Actual (est.)</li>
          <li><i style={{ background: SILVER, height: 10, width: 10, borderRadius: 2 }} />Plan</li>
        </ul>
      </div>
      <Columns
        labels={[...MONTHS]}
        series={[
          { key: 'actual', label: 'Actual (est.)', values: actualMonthly, color: INK },
          { key: 'plan', label: 'Plan', values: s.monthly, color: SILVER },
        ]}
        height={180}
        format={fmtMoney}
        everyLabel
      />

      <div className="cxp-head" style={{ marginTop: 16 }}>
        <p style={{ margin: 0 }}>By {dim}</p>
        <span className="cx-seg" role="group" aria-label="Break down by">
          <button type="button" aria-pressed={dim === 'carrier'} onClick={() => setDim('carrier')}>Carrier</button>
          <button type="button" aria-pressed={dim === 'product'} onClick={() => setDim('product')}>Product</button>
        </span>
      </div>
      <ProfitTable lines={lines} dim={dim} future={future} />

      {s.uncovered.length > 0 && (
        <p className="cxp-note">
          No comp grid yet for {s.uncovered.slice(0, 4).map((u) => [u.product, u.carrier].filter(Boolean).join(' · ')).join('; ')}
          {s.uncovered.length > 4 ? ` and ${s.uncovered.length - 4} more` : ''} ({fmtMoney(s.planPremium - s.coveredPremium)} plan premium counted at $0 profit).
        </p>
      )}
    </section>
  )
}

function ProfitTable({ lines, dim, future }: { lines: ProfitLine[]; dim: 'carrier' | 'product'; future: boolean }) {
  const shown = lines.filter((l) => l.planPremium > 0 || (l.actualPremium ?? 0) > 0)
  if (!shown.length) return <p className="cxp-note">Nothing to show by {dim} yet.</p>
  return (
    <div className="cxp-scroll">
      <table className="cx-table">
        <thead>
          <tr>
            <th className="l">{dim === 'carrier' ? 'Carrier' : 'Product'}</th>
            <th title="Premium-weighted override spread">Spread</th>
            <th>Plan profit</th>
            <th title="Actual premium × spread">Actual profit (est.)</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, 15).map((l) => (
            <tr key={l.name}>
              <th scope="row" className="l" style={{ whiteSpace: 'normal' }}>{l.name}</th>
              <td className={l.covered ? undefined : 'muted'}>{l.covered ? pts(l.spread) : 'No grid'}</td>
              <td>{fmtMoney(l.planProfit)}</td>
              <td className={l.actualProfit == null ? 'muted' : undefined}>{future ? '—' : l.actualProfit == null ? '—' : fmtMoney(l.actualProfit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
