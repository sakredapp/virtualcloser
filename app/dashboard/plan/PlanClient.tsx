'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import { Columns, PaceMeter, INK, SILVER } from '@/app/components/cxo/charts'
import { fmtMoney, fmtCount, fmtPct } from '@/lib/pinnacle/kpis'
import type { PlanPageData } from '@/lib/plan/data'
import {
  MONTHS,
  STATUS_WORDS,
  allowanceStatus,
  asOfDay,
  breakdownVsPlan,
  econTable,
  matchActual,
  pacing,
  parseAmount,
  parsePlanText,
  periodElapsed,
  planByMonth,
  quarterOf,
  sum,
  type AllowanceTier,
  type BreakdownLine,
  type EconLine,
  type PlanTarget,
} from '@/lib/plan/shared'
import { DialogProvider, useDialog } from '@/app/components/cxo/AppDialog'
import '@/app/components/cxo/cxo-plan.css'

type Measure = 'premium' | 'policies'

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; saved?: number }> {
  const res = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json.error || 'Could not save. Try again.' }
  return json
}

const rowKey = (p: string, c: string) => `${p}\u0000${c}`

export default function PlanClient(props: { data: PlanPageData; years: number[] }) {
  return (
    <DialogProvider>
      <PlanInner {...props} />
    </DialogProvider>
  )
}

function PlanInner({ data, years }: { data: PlanPageData; years: number[] }) {
  const router = useRouter()
  const { year, today, actuals } = data
  const [importOpen, setImportOpen] = useState(false)
  const hasPlan = data.targets.length > 0
  const thisYear = Number(today.slice(0, 4))
  const future = year > thisYear

  const asOf = asOfDay(year, today, actuals.through)
  const planMonthly = useMemo(() => planByMonth(data.targets), [data.targets])
  const pace = useMemo(() => pacing(planMonthly, actuals.monthly, year, asOf), [planMonthly, actuals.monthly, year, asOf])
  const byCarrier = useMemo(() => breakdownVsPlan(data.targets, 'carrier', { rows: actuals.byCarrier }, year, asOf), [data.targets, actuals.byCarrier, year, asOf])
  const byProduct = useMemo(() => breakdownVsPlan(data.targets, 'product', { rows: actuals.byProduct, lines: actuals.byLine }, year, asOf), [data.targets, actuals.byProduct, actuals.byLine, year, asOf])

  const templateHref = `/api/plan?template=1&year=${year}`
  const actions = (
    <span className="cxp-hero-actions">
      <span className="cx-seg" role="group" aria-label="Plan year">
        {years.map((y) => (
          <Link key={y} href={`/dashboard/plan?year=${y}`} aria-selected={y === year} scroll={false}>
            {y}
          </Link>
        ))}
      </span>
      {hasPlan && (
        <>
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setImportOpen(true)}>Import plan</button>
          <a className="cx-btn cx-btn-ghost cx-btn-sm" href={templateHref}>Download template</a>
        </>
      )}
    </span>
  )

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Sales Plan"
        title={`${year} Sales Plan`}
        subtitle={hasPlan ? 'The plan by month, product and carrier, against what the book shows.' : undefined}
        actions={actions}
      />
      <div className="cxp">
        {!hasPlan && (
          <section className="cx-panel cxp-empty">
            <p>No {year} plan yet. Bring it in from a spreadsheet, or type it in below.</p>
            <span className="cxp-bar">
              <button type="button" className="cx-btn cx-btn-sm" onClick={() => setImportOpen(true)}>Import plan</button>
              <a className="cx-btn cx-btn-ghost cx-btn-sm" href={templateHref}>Download template</a>
            </span>
          </section>
        )}

        {hasPlan && (
          <>
            <div className="cx-grid cx-grid-4">
              <Kpi label={`${year} plan`} figure={fmtMoney(pace.planTotal)} sub={`${fmtCount(sum(planByMonth(data.targets, 'policies')))} policies planned`} />
              <Kpi
                label="Plan so far"
                figure={future ? '—' : fmtMoney(pace.planToDate)}
                sub={future ? `Starts Jan 1, ${year}` : `Actual ${fmtMoney(pace.actualToDate)}`}
              />
              <Kpi
                label="Percent of plan"
                figure={future || pace.pctOfPlanToDate == null ? '—' : fmtPct(pace.pctOfPlanToDate)}
                sub={<Status status={pace.status} />}
              />
              <Kpi
                label="On pace for"
                figure={future || pace.elapsed === 0 ? '—' : fmtMoney(pace.projected)}
                sub={future || pace.projectedPct == null ? 'Once the year starts' : `${fmtPct(pace.projectedPct)} of the year's plan`}
              />
            </div>

            <section className="cx-panel">
              <div className="cxp-head">
                <div>
                  <h2>Plan vs actual by month</h2>
                  <p>{actuals.through ? `Premium written, through ${fmtDay(actuals.through)}.` : future ? `Actuals start once ${year} begins.` : 'Connect the book of business to see actuals.'}</p>
                </div>
                <ul className="cx-legend">
                  <li><i style={{ background: INK, height: 10, width: 10, borderRadius: 2 }} />Actual</li>
                  <li><i style={{ background: SILVER, height: 10, width: 10, borderRadius: 2 }} />Plan</li>
                </ul>
              </div>
              <Columns
                labels={[...MONTHS]}
                series={[
                  { key: 'actual', label: 'Actual', values: actuals.monthly, color: INK },
                  { key: 'plan', label: 'Plan', values: planMonthly, color: SILVER },
                ]}
                height={200}
                format={fmtMoney}
                everyLabel
              />
              {!future && (
                <div style={{ marginTop: 14 }}>
                  <PaceMeter sofar={pace.actualToDate} projected={pace.elapsed > 0 ? pace.projected : 0} target={pace.planTotal} format={fmtMoney} targetLabel="Plan" />
                </div>
              )}
            </section>

            <div className="cx-grid cx-grid-2">
              <BreakdownPanel title="By carrier" rows={byCarrier} future={future} />
              <BreakdownPanel title="By product" rows={byProduct} future={future} />
            </div>
          </>
        )}

        <PlanGrid data={data} onImport={() => setImportOpen(true)} onSaved={() => router.refresh()} />
        {hasPlan && <EconPanel data={data} onSaved={() => router.refresh()} />}
        <AllowancePanel data={data} onSaved={() => router.refresh()} />
      </div>

      <datalist id="cxp-carriers">{data.carrierNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="cxp-products">{data.productNames.map((n) => <option key={n} value={n} />)}</datalist>

      {importOpen && (
        <ImportModal
          year={year}
          hasPlan={hasPlan}
          templateHref={templateHref}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false)
            router.refresh()
          }}
        />
      )}
    </main>
  )
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function Kpi({ label, figure, sub }: { label: string; figure: string; sub?: ReactNode }) {
  return (
    <section className="cx-panel cxp-kpi">
      <p className="cx-eyebrow">{label}</p>
      <div className="cx-kpi-figure">{figure}</div>
      {sub && <div className="cx-kpi-sub">{sub}</div>}
    </section>
  )
}

function Status({ status }: { status: keyof typeof STATUS_WORDS }) {
  const cls = status === 'ahead' || status === 'on_track' ? 'is-good' : status === 'behind' ? 'is-behind' : ''
  return (
    <span className={`cxp-status ${cls}`} style={{ marginTop: 0 }}>
      <i />
      {STATUS_WORDS[status]}
    </span>
  )
}

function Track({ value, max = 1 }: { value: number; max?: number }) {
  const w = Math.max(0, Math.min(100, (value / Math.max(1e-9, max)) * 100))
  return (
    <span className="cxp-track" aria-hidden>
      <span style={{ width: `${w}%` }} />
    </span>
  )
}

function BreakdownPanel({ title, rows, future }: { title: string; rows: BreakdownLine[]; future: boolean }) {
  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <h2>{title}</h2>
      </div>
      <div className="cxp-scroll">
        <table className="cx-table">
          <thead>
            <tr>
              <th className="l">{title.replace('By ', '')}</th>
              <th>{future ? 'Year plan' : 'Plan so far'}</th>
              <th>Actual</th>
              <th>Of plan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row" title={r.matched.length ? `Counted: ${r.matched.slice(0, 8).join(', ')}${r.matched.length > 8 ? '…' : ''}` : 'No match in the book yet'}>
                  {r.name}
                </th>
                <td>{fmtMoney(future ? r.planYear : r.planToDate)}</td>
                <td className={r.matched.length ? undefined : 'muted'}>{future ? '—' : r.matched.length ? fmtMoney(r.actual) : 'No match'}</td>
                <td>
                  {future || r.pct == null ? (
                    '—'
                  ) : (
                    <span className="cxp-pctcell">
                      {fmtPct(r.pct)}
                      <Track value={r.pct} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Plan grid (edit inline) ─────────────────────────────────────────────

type GridRow = { product: string; carrier: string; cells: Record<number, { premium: number; policies: number | null }> }

function toRows(targets: PlanTarget[]): GridRow[] {
  const map = new Map<string, GridRow>()
  for (const t of targets) {
    const k = rowKey(t.product, t.carrier)
    const r = map.get(k) ?? { product: t.product, carrier: t.carrier, cells: {} }
    r.cells[t.month] = { premium: t.premium, policies: t.policies }
    map.set(k, r)
  }
  return Array.from(map.values()).sort((a, b) => a.product.localeCompare(b.product) || a.carrier.localeCompare(b.carrier))
}

function PlanGrid({ data, onImport, onSaved }: { data: PlanPageData; onImport: () => void; onSaved: () => void }) {
  const [measure, setMeasure] = useState<Measure>('premium')
  const [rows, setRows] = useState<GridRow[]>(() => toRows(data.targets))
  const [adding, setAdding] = useState(data.targets.length === 0)
  const [np, setNp] = useState('')
  const [nc, setNc] = useState('')
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const dialog = useDialog()
  const [seen, setSeen] = useState(data.targets)
  if (seen !== data.targets) {
    // Fresh numbers from the server; keep rows added here that have no months yet.
    const next = toRows(data.targets)
    const blank = rows.filter((r) => Object.keys(r.cells).length === 0 && !next.some((n) => n.product === r.product && n.carrier === r.carrier))
    setSeen(data.targets)
    setRows([...next, ...blank])
  }

  const saveCell = async (r: GridRow, month: number, raw: string) => {
    const v = raw.trim() === '' ? null : parseAmount(raw)
    if (raw.trim() !== '' && v == null) {
      setMsg({ error: `"${raw}" is not a number.` })
      return
    }
    const cur = r.cells[month] ?? { premium: 0, policies: null }
    const next = measure === 'premium' ? { ...cur, premium: v ?? 0 } : { ...cur, policies: v == null ? null : Math.round(v) }
    if (next.premium === cur.premium && next.policies === cur.policies) return
    setRows((rs) => rs.map((x) => (x === r ? { ...x, cells: { ...x.cells, [month]: next } } : x)))
    const res = await post({ action: 'save_cells', year: data.year, cells: [{ month, product: r.product, carrier: r.carrier, premium: next.premium, policies: next.policies }] })
    if (res.error) setMsg({ error: res.error })
    else {
      setMsg(null)
      onSaved()
    }
  }

  const addRow = async () => {
    const product = np.trim()
    const carrier = nc.trim()
    if (!product && !carrier) {
      setMsg({ error: 'Add a product, a carrier, or both.' })
      return
    }
    if (rows.some((r) => r.product === product && r.carrier === carrier)) {
      setMsg({ error: 'That row is already in the plan.' })
      return
    }
    setRows((rs) => [...rs, { product, carrier, cells: {} }])
    setNp('')
    setNc('')
    setMsg({ ok: 'Row added. Type each month’s number; it saves as you go.' })
  }

  const removeRow = async (r: GridRow) => {
    if (!(await dialog.confirm({ title: 'Remove this row?', body: `${[r.product, r.carrier].filter(Boolean).join(' · ')} comes out of the ${data.year} plan, every month.`, confirmLabel: 'Remove' }))) return
    setBusy(true)
    const res = await post({ action: 'delete_row', year: data.year, product: r.product, carrier: r.carrier })
    setBusy(false)
    if (res.error) setMsg({ error: res.error })
    else {
      setRows((rs) => rs.filter((x) => x !== r))
      onSaved()
    }
  }

  const colTotals = MONTHS.map((_, i) => rows.reduce((s, r) => s + ((measure === 'premium' ? r.cells[i + 1]?.premium : r.cells[i + 1]?.policies) || 0), 0))
  const fmt = measure === 'premium' ? fmtMoney : fmtCount
  const empty = rows.length === 0

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>The plan</h2>
          <p>{empty ? 'Type it in by product and carrier, one month at a time.' : 'Click any month to change it. Saves as you go.'}</p>
        </div>
        <span className="cxp-bar">
          <span className="cx-seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={measure === 'premium'} onClick={() => setMeasure('premium')}>Premium</button>
            <button type="button" aria-pressed={measure === 'policies'} onClick={() => setMeasure('policies')}>Policies</button>
          </span>
          {!adding && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setAdding(true)}>Add a row</button>}
          {!empty && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onImport}>Import</button>}
        </span>
      </div>
      {adding && (
        <div className="cxp-form" style={{ marginTop: 12 }}>
          <label className="cxp-field" style={{ flex: '1 1 180px' }}>
            Product
            <input list="cxp-products" value={np} onChange={(e) => setNp(e.target.value)} placeholder="e.g. Final Expense, or Life" />
          </label>
          <label className="cxp-field" style={{ flex: '1 1 180px' }}>
            Carrier
            <input list="cxp-carriers" value={nc} onChange={(e) => setNc(e.target.value)} placeholder="e.g. Mutual of Omaha" />
          </label>
          <button type="button" className="cx-btn cx-btn-sm" onClick={addRow}>Add row</button>
          {!empty && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setAdding(false)}>Done</button>}
        </div>
      )}
      {msg?.error && <p className="cxp-error" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="cxp-ok">{msg.ok}</p>}
      {!empty && (
        <div className="cxp-scroll">
          <table className="cx-table">
            <thead>
              <tr>
                <th className="l cxp-sticky">Product · Carrier</th>
                {MONTHS.map((m) => <th key={m}>{m}</th>)}
                <th>Year</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vals = MONTHS.map((_, i) => (measure === 'premium' ? r.cells[i + 1]?.premium : r.cells[i + 1]?.policies) ?? null)
                return (
                  <tr key={rowKey(r.product, r.carrier)}>
                    <th scope="row" className="l cxp-sticky" style={{ whiteSpace: 'normal', minWidth: 150 }}>
                      {r.product || <span style={{ color: 'var(--cx-muted)' }}>Any product</span>}
                      <div style={{ fontSize: 12, color: 'var(--cx-muted)', fontWeight: 400 }}>{r.carrier || 'Any carrier'}</div>
                    </th>
                    {vals.map((v, i) => (
                      <td key={i} style={{ padding: '4px 3px' }}>
                        <CellInput
                          key={`${measure}-${v}`}
                          initial={v == null || (measure === 'premium' && v === 0) ? '' : String(v)}
                          label={`${MONTHS[i]} ${measure} for ${r.product} ${r.carrier}`}
                          onCommit={(raw) => saveCell(r, i + 1, raw)}
                        />
                      </td>
                    ))}
                    <td>{fmt(sum(vals.map((v) => v ?? 0)))}</td>
                    <td style={{ padding: '4px' }}>
                      <button type="button" className="cxp-iconbtn" disabled={busy} onClick={() => removeRow(r)} aria-label={`Remove ${r.product} ${r.carrier}`} title="Remove row">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="l cxp-sticky">Total</th>
                {colTotals.map((t, i) => <td key={i}>{fmt(t)}</td>)}
                <td>{fmt(sum(colTotals))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function CellInput({ initial, label, onCommit, wide }: { initial: string; label: string; onCommit: (raw: string) => void; wide?: boolean }) {
  const [v, setV] = useState(initial)
  return (
    <input
      className={`cxp-cell${wide ? ' is-wide' : ''}${v !== initial ? ' is-dirty' : ''}`}
      inputMode="decimal"
      value={v}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== initial && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(initial)
      }}
    />
  )
}

// ── Unit economics ──────────────────────────────────────────────────────

function EconPanel({ data, onSaved }: { data: PlanPageData; onSaved: () => void }) {
  const lines = useMemo(() => econTable(data.targets, data.econ, data.year), [data.targets, data.econ, data.year])
  const [err, setErr] = useState<string | null>(null)
  const totalMargin = lines.reduce((s, l) => s + (l.projectedMargin ?? 0), 0)
  const anyMargin = lines.some((l) => l.projectedMargin != null)

  const save = async (l: EconLine, field: 'commission_pct' | 'avg_premium' | 'override_pct' | 'acquisition_cost', raw: string) => {
    const v = raw.trim() === '' ? null : parseAmount(raw)
    if (raw.trim() !== '' && v == null) {
      setErr(`"${raw}" is not a number.`)
      return
    }
    const res = await post({
      action: 'save_econ',
      year: data.year,
      product: l.product,
      carrier: l.carrier,
      commission_pct: l.commission_pct,
      avg_premium: l.avg_premium,
      override_pct: l.override_pct,
      acquisition_cost: l.acquisition_cost,
      [field]: v,
    })
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      onSaved()
    }
  }
  const cell = (l: EconLine, field: 'commission_pct' | 'avg_premium' | 'override_pct' | 'acquisition_cost', label: string) => (
    <td style={{ padding: '4px 3px' }}>
      <CellInput key={`${field}-${l[field]}`} initial={l[field] == null ? '' : String(l[field])} label={`${label} for ${l.product} ${l.carrier}`} onCommit={(raw) => save(l, field, raw)} />
    </td>
  )

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Unit economics</h2>
          <p>What each policy earns and keeps. Fill the four columns on the left; the rest works itself out.</p>
        </div>
        {anyMargin && (
          <div style={{ textAlign: 'right' }}>
            <p className="cx-eyebrow">Projected margin on the plan</p>
            <div className="cx-kpi-figure" style={{ fontSize: 24 }}>{fmtMoney(totalMargin)}</div>
          </div>
        )}
      </div>
      {err && <p className="cxp-error" role="alert">{err}</p>}
      <div className="cxp-scroll">
        <table className="cx-table">
          <thead>
            <tr>
              <th className="l cxp-sticky">Product · Carrier</th>
              <th title="Commission the carrier pays, as a % of premium">Commission %</th>
              <th title="Average annual premium per policy">Avg premium</th>
              <th title="What Pinnacle keeps after paying the agent, as a % of premium">Override %</th>
              <th title="Lead, marketing and other cost to place one policy">Cost per policy</th>
              <th title="Avg premium × commission %">Revenue / policy</th>
              <th title="Avg premium × override % − cost per policy">Margin / policy</th>
              <th title="Planned policies, or plan premium ÷ avg premium">Plan policies</th>
              <th>Projected margin</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={rowKey(l.product, l.carrier)}>
                <th scope="row" className="l cxp-sticky" style={{ whiteSpace: 'normal', minWidth: 150 }}>
                  {l.product || 'Any product'}
                  <div style={{ fontSize: 12, color: 'var(--cx-muted)', fontWeight: 400 }}>{l.carrier || 'Any carrier'}</div>
                </th>
                {cell(l, 'commission_pct', 'Commission %')}
                {cell(l, 'avg_premium', 'Average premium')}
                {cell(l, 'override_pct', 'Override %')}
                {cell(l, 'acquisition_cost', 'Cost per policy')}
                <td>{l.revenuePerPolicy == null ? '—' : fmtMoney(l.revenuePerPolicy)}</td>
                <td>{l.marginPerPolicy == null ? '—' : fmtMoney(l.marginPerPolicy)}</td>
                <td>{l.planPolicies == null ? '—' : fmtCount(l.planPolicies)}</td>
                <td>{l.projectedMargin == null ? '—' : fmtMoney(l.projectedMargin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Marketing allowance ─────────────────────────────────────────────────

function AllowancePanel({ data, onSaved }: { data: PlanPageData; onSaved: () => void }) {
  const { year, today, tiers, actuals } = data
  const [carrier, setCarrier] = useState('')
  const [period, setPeriod] = useState<'month' | 'quarter'>('quarter')
  const [threshold, setThreshold] = useState('')
  const [unlocks, setUnlocks] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dialog = useDialog()
  const thisYear = Number(today.slice(0, 4))
  const current = year === thisYear
  const tm = Number(today.slice(5, 7))

  const groups = useMemo(() => {
    const keys = new Map<string, { carrier: string; period: 'month' | 'quarter' }>()
    for (const t of tiers) keys.set(`${t.carrier.toLowerCase()}\u0000${t.period}`, { carrier: t.carrier, period: t.period })
    return Array.from(keys.values()).map((g) => {
      const rows = g.period === 'month' ? actuals.carrierThisMonth : actuals.carrierThisQuarter
      const actual = current ? matchActual(g.carrier, rows).premium : 0
      const label = current ? (g.period === 'month' ? `${MONTHS[tm - 1]} ${year}` : `Q${quarterOf(tm)} ${year}`) : year > thisYear ? `Starts ${g.period === 'month' ? 'Jan' : 'Q1'} ${year}` : `${year}`
      return allowanceStatus(g.carrier, g.period, tiers, actual, current ? periodElapsed(g.period, today) : 0, label)
    })
  }, [tiers, actuals, current, tm, year, thisYear, today])

  const add = async () => {
    const th = parseAmount(threshold)
    if (!carrier.trim() || th == null || th <= 0 || !unlocks.trim()) {
      setErr('Add the carrier, the dollar threshold and what it unlocks.')
      return
    }
    const res = await post({ action: 'add_tier', year, carrier: carrier.trim(), period, threshold: th, unlocks: unlocks.trim() })
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setThreshold('')
      setUnlocks('')
      onSaved()
    }
  }
  const remove = async (t: AllowanceTier) => {
    if (!t.id || !(await dialog.confirm({ title: 'Remove this tier?', body: `${fmtMoney(t.threshold)} for ${t.carrier}: ${t.unlocks}`, confirmLabel: 'Remove' }))) return
    const res = await post({ action: 'delete_tier', year, id: t.id })
    if (res.error) setErr(res.error)
    else onSaved()
  }

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Marketing allowance</h2>
          <p>Each carrier’s premium tiers and what they unlock. Progress counts premium written this {groups.some((g) => g.period === 'quarter') ? 'quarter or month' : 'month'}.</p>
        </div>
        {!open && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setOpen(true)}>Add a tier</button>}
      </div>
      {open && (
        <div className="cxp-form" style={{ marginTop: 12 }}>
          <label className="cxp-field" style={{ flex: '1 1 180px' }}>
            Carrier
            <input list="cxp-carriers" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. Mutual of Omaha" />
          </label>
          <label className="cxp-field">
            Every
            <select value={period} onChange={(e) => setPeriod(e.target.value === 'month' ? 'month' : 'quarter')}>
              <option value="quarter">Quarter</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label className="cxp-field" style={{ flex: '0 1 140px' }}>
            Premium of
            <input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="$250,000" />
          </label>
          <label className="cxp-field" style={{ flex: '2 1 220px' }}>
            Unlocks
            <input value={unlocks} onChange={(e) => setUnlocks(e.target.value)} placeholder="e.g. $5,000 marketing allowance" maxLength={300} />
          </label>
          <button type="button" className="cx-btn cx-btn-sm" onClick={add}>Add tier</button>
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
      {err && <p className="cxp-error" role="alert">{err}</p>}
      {groups.length === 0 ? (
        <p className="cxp-note" style={{ marginTop: 10 }}>No allowance tiers yet. Add each carrier’s tiers and this shows how close you are to the next one.</p>
      ) : (
        <div className="cxp-cards" style={{ marginTop: 12 }}>
          {groups.map((g) => (
            <article key={`${g.carrier}-${g.period}`} className="cxp-card">
              <h3>{g.carrier}</h3>
              <div className="sub">{g.period === 'quarter' ? 'Quarterly' : 'Monthly'} tiers · {g.periodLabel}</div>
              <div className="big">{fmtMoney(g.actual)}</div>
              <Track value={g.next ? g.actual : 1} max={g.next ? g.next.threshold : 1} />
              <p className="say">
                {!current
                  ? `Tracking starts when ${year} does.`
                  : g.next
                    ? <>
                        <b>{fmtMoney(g.toNext)}</b> more to unlock {g.next.unlocks}.
                        {g.projected > g.actual && g.projectedTier && g.projectedTier !== g.reached ? ` On pace to reach the ${fmtMoney(g.projectedTier.threshold)} tier.` : ''}
                      </>
                    : `Every tier reached this ${g.period}.`}
              </p>
              <ul>
                {g.tiers.map((t) => {
                  const hit = current && g.actual >= t.threshold
                  return (
                    <li key={t.id ?? `${t.threshold}`} className={hit ? 'is-hit' : undefined}>
                      <span className="cxp-tick" aria-label={hit ? 'Reached' : 'Not yet'}>
                        {hit && <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 5.2l2 2L8 3" /></svg>}
                      </span>
                      <span className="t">{fmtMoney(t.threshold)}</span>
                      <span className="u">{t.unlocks}</span>
                      <button type="button" className="cxp-iconbtn" onClick={() => remove(t)} aria-label={`Remove ${fmtMoney(t.threshold)} tier`} title="Remove tier">
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Import (CSV file or pasted Google Sheets rows) ───────────────────────

function ImportModal({ year, hasPlan, templateHref, onClose, onDone }: { year: number; hasPlan: boolean; templateHref: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const parsed = useMemo(() => (text.trim() ? parsePlanText(text, year) : null), [text, year])
  const total = parsed ? parsed.targets.reduce((s, t) => s + t.premium, 0) : 0
  const pairs = parsed ? new Set(parsed.targets.map((t) => rowKey(t.product, t.carrier))).size : 0

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 2_000_000) {
      setErr('That file is over 2 MB. Save just the plan tab as CSV.')
      return
    }
    setText(await f.text())
  }
  const go = async () => {
    if (!parsed || parsed.targets.length === 0) return
    setBusy(true)
    const res = await post({ action: 'import', year, replace, cells: parsed.targets })
    setBusy(false)
    if (res.error) setErr(res.error)
    else onDone()
  }

  return (
    <div className="cx-dialog-scrim cxp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cx-dialog cxp-modal" role="dialog" aria-modal="true" aria-labelledby="cxp-import-title">
        <h2 id="cxp-import-title">Import the {year} plan</h2>
        <div className="cx-dialog-body">
          Upload a CSV, or copy the rows in Google Sheets and paste them here. Months across the top (Jan … Dec), one row per product and carrier.{' '}
          <a href={templateHref} style={{ color: 'var(--cx-ink)' }}>Download the template</a>.
        </div>
        <div className="cxp-form">
          <label className="cxp-field" style={{ flex: '1 1 100%' }}>
            CSV file
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <label className="cxp-field" style={{ flex: '1 1 100%' }}>
            Or paste from Google Sheets
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Product\tCarrier\tMeasure\tJan\tFeb\t…'} spellCheck={false} />
          </label>
        </div>
        {parsed && parsed.problems.length > 0 && <p className="cxp-error" role="alert">{parsed.problems.join(' ')}</p>}
        {parsed && parsed.targets.length > 0 && (
          <p className="cxp-ok">
            Ready: {pairs} {pairs === 1 ? 'row' : 'rows'}, {parsed.targets.length} months filled, {fmtMoney(total)} premium in total.
            {parsed.skipped > 0 ? ` ${parsed.skipped} blank or unreadable ${parsed.skipped === 1 ? 'row' : 'rows'} skipped.` : ''}
          </p>
        )}
        {hasPlan && (
          <label className="cxp-check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace the whole {year} plan (otherwise these rows update or add to it)
          </label>
        )}
        {err && <p className="cxp-error" role="alert">{err}</p>}
        <footer>
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="cx-btn cx-btn-sm" disabled={busy || !parsed || parsed.targets.length === 0} onClick={go}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  )
}
