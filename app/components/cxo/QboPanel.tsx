'use client'

/**
 * "From QuickBooks" (owner 10-09): actual revenue, expenses and margin by
 * month from the org's own books, read-only. Exec team only; the page does
 * not render this at all for anyone else.
 *
 *  - not set up (no QBO_* env)  → one calm line, button reads "QuickBooks isn't set up yet"
 *  - set up, not connected      → one calm line + Connect QuickBooks
 *  - access ended               → one calm line + Reconnect
 *  - connected                  → the figures, with Sync now
 *
 * Black / silver only (--cx-* tokens), light and dark.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarList, Columns, INK, SILVER } from '@/app/components/cxo/charts'
import { fmtMoney } from '@/lib/pinnacle/kpis'
import { QBO_NOT_SET_UP, marginPct, monthLabel, lastQuarter, totalCost, type QboPanelData } from '@/lib/qbo/display'

export type { QboPanelData }


const pctText = (p: number | null) => (p == null ? '—' : `${p.toFixed(1)}%`)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function relTime(iso: string | null): string {
  if (!iso) return 'not yet'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

function CalmLine({ text, button, href, disabled }: { text: string; button: string; href?: string; disabled?: boolean }) {
  return (
    <section className="cx-panel cx-panel-tint cx-qbo cx-qbo-calm" aria-label="From QuickBooks">
      <p className="cx-takeaway" style={{ margin: 0 }}>
        <strong>From QuickBooks.</strong> {text}
      </p>
      {disabled || !href ? (
        <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled aria-disabled="true">
          {button}
        </button>
      ) : (
        <a className="cx-btn cx-btn-sm" href={href}>
          {button}
        </a>
      )}
    </section>
  )
}

export default function QboPanel({ data, returnPath, variant = 'revenue', todayIso }: { data: QboPanelData; returnPath: string; variant?: 'revenue' | 'plan'; todayIso: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const connectHref = `/api/integrations/quickbooks/start?return=${encodeURIComponent(returnPath)}`

  if (!data.configured) {
    return <CalmLine text="Actual revenue, expenses and margin show here once QuickBooks is switched on for this workspace." button={QBO_NOT_SET_UP} disabled />
  }
  if (data.needsReconnect) {
    return <CalmLine text="QuickBooks access ended. Reconnect to keep these numbers current." button="Reconnect QuickBooks" href={connectHref} />
  }
  if (!data.connected) {
    return <CalmLine text="Connect your books to see actual revenue, expenses and margin by month. Read only; nothing is ever changed in QuickBooks." button="Connect QuickBooks" href={connectHref} />
  }

  const syncNow = async () => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/integrations/quickbooks/sync', { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; skipped?: string }
      if (!res.ok || !j.ok) setNote(j.error || 'QuickBooks did not answer. Try again in a minute.')
      else {
        if (j.skipped) setNote(j.skipped)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const months = data.months.slice(-12)
  const syncedLine = `${data.companyName ? `${data.companyName} · ` : ''}${data.environment === 'sandbox' ? 'Sandbox company · ' : ''}Synced ${relTime(data.lastSyncAt)}${data.lastSyncOk === false ? ' (last sync did not finish)' : ''}`
  const head = (
    <div className="cx-qbo-head">
      <div style={{ minWidth: 0 }}>
        <p className="cx-eyebrow">From QuickBooks</p>
        <h2 className="cx-title" style={{ marginTop: 4 }}>{variant === 'plan' ? 'Actual margin' : 'Revenue, expenses and margin'}</h2>
        <p className="cx-scope">{syncedLine}</p>
      </div>
      <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={syncNow} disabled={busy}>
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )

  if (months.length === 0) {
    return (
      <section className="cx-panel cx-qbo" aria-label="From QuickBooks">
        {head}
        <p className="cx-takeaway">No months have come over from QuickBooks yet. Sync now pulls the last two years.</p>
        {note && <p className="cx-scope" role="status">{note}</p>}
      </section>
    )
  }

  const rev12 = sum(months.map((m) => m.income))
  const cost12 = sum(months.map(totalCost))
  const net12 = sum(months.map((m) => m.net_income))
  const gp12 = sum(months.map((m) => m.gross_profit))
  const lq = lastQuarter(todayIso)
  const lqRows = data.months.filter((m) => m.month >= lq.from && m.month <= lq.to)
  const lqMargin = lqRows.length ? marginPct(sum(lqRows.map((m) => m.net_income)), sum(lqRows.map((m) => m.income))) : null
  const span = `${monthLabel(months[0].month)} – ${monthLabel(months[months.length - 1].month)}`

  if (variant === 'plan') {
    return (
      <section className="cx-panel cx-qbo" aria-label="From QuickBooks">
        {head}
        <div className="cx-grid cx-grid-4 cx-qbo-kpis">
          <div>
            <p className="cx-eyebrow">Net margin, 12 months</p>
            <div className="cx-kpi-figure">{pctText(marginPct(net12, rev12))}</div>
            <p className="cx-kpi-sub">{fmtMoney(net12)} on {fmtMoney(rev12)}</p>
          </div>
          <div>
            <p className="cx-eyebrow">Gross margin, 12 months</p>
            <div className="cx-kpi-figure">{pctText(marginPct(gp12, rev12))}</div>
            <p className="cx-kpi-sub">After cost of sales</p>
          </div>
          <div>
            <p className="cx-eyebrow">Net margin, {lq.label}</p>
            <div className="cx-kpi-figure">{pctText(lqMargin)}</div>
            <p className="cx-kpi-sub">Last full quarter</p>
          </div>
          <div>
            <p className="cx-eyebrow">Costs, 12 months</p>
            <div className="cx-kpi-figure">{fmtMoney(cost12)}</div>
            <p className="cx-kpi-sub">{rev12 > 0 ? `${((cost12 / rev12) * 100).toFixed(1)}% of revenue` : '—'}</p>
          </div>
        </div>
        <p className="cx-scope">{span}. What the books actually kept, to set against the projected margin in Unit economics.</p>
        {note && <p className="cx-scope" role="status">{note}</p>}
      </section>
    )
  }

  return (
    <section className="cx-panel cx-qbo" aria-label="From QuickBooks">
      {head}
      <div className="cx-grid cx-grid-4 cx-qbo-kpis">
        <div>
          <p className="cx-eyebrow">Revenue, 12 months</p>
          <div className="cx-kpi-figure">{fmtMoney(rev12)}</div>
        </div>
        <div>
          <p className="cx-eyebrow">Expenses, 12 months</p>
          <div className="cx-kpi-figure">{fmtMoney(cost12)}</div>
        </div>
        <div>
          <p className="cx-eyebrow">Net income, 12 months</p>
          <div className="cx-kpi-figure">{fmtMoney(net12)}</div>
        </div>
        <div>
          <p className="cx-eyebrow">Net margin</p>
          <div className="cx-kpi-figure">{pctText(marginPct(net12, rev12))}</div>
          <p className="cx-kpi-sub">{lq.label}: {pctText(lqMargin)}</p>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <Columns
          labels={months.map((m) => monthLabel(m.month, true))}
          series={[
            { key: 'rev', label: 'Revenue', values: months.map((m) => m.income), color: INK },
            { key: 'cost', label: 'Expenses', values: months.map(totalCost), color: SILVER },
          ]}
          format={fmtMoney}
          ariaLabel="Revenue and expenses by month from QuickBooks"
        />
        <p className="cx-scope">
          <span className="cx-qbo-key" style={{ background: INK }} /> Revenue <span className="cx-qbo-key" style={{ background: SILVER, marginLeft: 10 }} /> Expenses · {span}
        </p>
      </div>

      <div className="cxp-scroll cx-qbo-table">
        <table className="cx-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Revenue</th>
              <th>Expenses</th>
              <th>Net income</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthLabel(m.month)}</th>
                <td>{fmtMoney(m.income)}</td>
                <td>{fmtMoney(totalCost(m))}</td>
                <td>{fmtMoney(m.net_income)}</td>
                <td>{pctText(marginPct(m.net_income, m.income))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data.expenseCategories.length > 0 || data.topCustomers.length > 0 || data.classes.length > 0) && (
        <div className="cx-grid cx-grid-2" style={{ marginTop: 18 }}>
          {data.expenseCategories.length > 0 && (
            <div>
              <p className="cx-eyebrow">Biggest expenses, 12 months</p>
              <BarList rows={data.expenseCategories.map((e) => ({ label: e.category, value: e.amount }))} format={fmtMoney} />
            </div>
          )}
          {data.classes.length > 0 ? (
            <div>
              <p className="cx-eyebrow">Revenue by class, 12 months</p>
              <BarList rows={data.classes.map((c) => ({ label: c.name, value: c.amount }))} format={fmtMoney} />
            </div>
          ) : data.topCustomers.length > 0 ? (
            <div>
              <p className="cx-eyebrow">Revenue by customer, 12 months</p>
              <BarList rows={data.topCustomers.map((c) => ({ label: c.name, value: c.amount }))} format={fmtMoney} />
            </div>
          ) : null}
        </div>
      )}
      {note && <p className="cx-scope" role="status">{note}</p>}
    </section>
  )
}
