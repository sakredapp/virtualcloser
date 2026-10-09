'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import { DialogProvider, useDialog } from '@/app/components/cxo/AppDialog'
import type { EmployeesData } from '@/lib/employees/data'
import {
  PAYOUT_STATUS_WORDS,
  fmtKpiValue,
  latestReview,
  monthKey,
  orgByDepartment,
  payoutsForAll,
  periodKeyFor,
  periodLabel,
  quarterKey,
  rankEmployees,
  weightedAttainment,
  attainment,
  parseEmployeeRows,
  type CompTier,
  type Employee,
  type Kpi,
  type KpiUnit,
  type OrgNode,
  type PayoutLine,
  type Period,
  type RankRow,
  type Review,
} from '@/lib/employees/shared'
import { readTable } from '@/lib/plan/shared'
import '@/app/components/cxo/cxo-plan.css'

type Tab = 'people' | 'payouts' | 'reviews' | 'ranking'

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; id?: string; added?: number; updated?: number; skipped?: number }> {
  const res = await fetch('/api/employees', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json.error || 'Could not save. Try again.' }
  return json
}

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
const pctOf = (a: number | null | undefined) => (a == null ? '—' : `${Math.round(a * 100)}%`)
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
const FREQ_WORDS: Record<Employee['pay_frequency'], string> = { weekly: 'Weekly', biweekly: 'Every two weeks', semimonthly: 'Twice a month', monthly: 'Monthly' }
const UNIT_WORDS: Record<KpiUnit, string> = { count: 'Count', usd: 'Dollars', pct: 'Percent', days: 'Days', hours: 'Hours' }

export default function EmployeesClient(props: { data: EmployeesData; today: string; comp: boolean }) {
  return (
    <DialogProvider>
      <EmployeesInner {...props} />
    </DialogProvider>
  )
}

function EmployeesInner({ data, today, comp }: { data: EmployeesData; today: string; comp: boolean }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('people')
  const [openId, setOpenId] = useState<string | 'new' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const refresh = () => router.refresh()

  const mKey = monthKey(today)
  const qKey = quarterKey(today)
  const monthPayouts = useMemo(() => payoutsForAll(data, mKey, today), [data, mKey, today])
  const quarterPayouts = useMemo(() => payoutsForAll(data, qKey, today), [data, qKey, today])
  /** Attainment this period: the month's KPIs, or the quarter's for people measured quarterly. */
  const attById = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const e of data.employees) {
      const mp = monthPayouts.find((p) => p.employee_id === e.id)
      const qp = quarterPayouts.find((p) => p.employee_id === e.id)
      m.set(e.id, mp?.overallAtt ?? qp?.overallAtt ?? null)
    }
    return m
  }, [data.employees, monthPayouts, quarterPayouts])

  const empty = data.employees.length === 0
  const departments = Array.from(new Set(data.employees.map((e) => e.department || 'No department'))).sort()
  const avgAtt = weightedAttainment(data.employees.map((e) => ({ weight: 1, att: attById.get(e.id) ?? null })))
  const onTrack = [...monthPayouts, ...quarterPayouts].filter((p) => p.status === 'earned' || p.status === 'on_track')
  const onTrackPeople = new Set(onTrack.map((p) => p.employee_id)).size
  const withPlan = new Set([...monthPayouts, ...quarterPayouts].filter((p) => p.status !== 'no_plan').map((p) => p.employee_id)).size
  const monthBonus = monthPayouts.reduce((s, p) => s + p.total, 0)

  const actions = (
    <span className="cxp-hero-actions">
      {!empty && <button type="button" className="cx-btn cx-btn-sm" onClick={() => setOpenId('new')}>Add employee</button>}
      {!empty && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setImportOpen(true)}>Import</button>}
    </span>
  )

  return (
    <main className="wrap">
      <PageHeader eyebrow="Employees" title="Employees" subtitle={empty ? undefined : 'Who reports to whom, how each person is tracking, and what bonus it pays.'} actions={actions} />
      <div className="cxp">
        {empty ? (
          <section className="cx-panel cxp-empty">
            <p>No employees yet. Add them one at a time, or import a list.</p>
            <span className="cxp-bar">
              <button type="button" className="cx-btn cx-btn-sm" onClick={() => setOpenId('new')}>Add employee</button>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setImportOpen(true)}>Import</button>
              <a className="cx-btn cx-btn-ghost cx-btn-sm" href="/api/employees?template=1">Download template</a>
            </span>
          </section>
        ) : (
          <>
            <div className="cx-grid cx-grid-4">
              <Kpi label="Employees" figure={String(data.employees.length)} sub={`${departments.length} ${departments.length === 1 ? 'department' : 'departments'}`} />
              <Kpi label="Average to goal" figure={pctOf(avgAtt)} sub={`${periodLabel(mKey)}, across every KPI`} />
              <Kpi label="On track for bonus" figure={withPlan ? `${onTrackPeople} of ${withPlan}` : '—'} sub={withPlan ? 'People with a bonus plan' : 'No bonus plans set yet'} />
              {comp ? (
                <Kpi label="Bonus earned so far" figure={usd(monthBonus)} sub={`${periodLabel(mKey)}`} />
              ) : (
                <Kpi label="Reviews this year" figure={String(data.reviews.filter((r) => r.created_at.startsWith(today.slice(0, 4))).length)} sub="Written so far" />
              )}
            </div>

            <div className="cxp-bar">
              <span className="cx-seg" role="tablist" aria-label="View">
                {(['people', 'payouts', 'reviews', 'ranking'] as Tab[]).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                    {t === 'people' ? 'People' : t === 'payouts' ? 'Payouts' : t === 'reviews' ? 'Reviews' : 'Ranking'}
                  </button>
                ))}
              </span>
            </div>

            {tab === 'people' && <PeopleView data={data} attById={attById} comp={comp} onOpen={setOpenId} />}
            {tab === 'payouts' && <PayoutsView data={data} comp={comp} today={today} monthPayouts={monthPayouts} quarterPayouts={quarterPayouts} onChanged={refresh} />}
            {tab === 'reviews' && <ReviewsView data={data} today={today} onChanged={refresh} />}
            {tab === 'ranking' && <RankingView data={data} attById={attById} monthPayouts={monthPayouts} quarterPayouts={quarterPayouts} comp={comp} onOpen={setOpenId} />}
          </>
        )}
      </div>

      <datalist id="cxp-departments">{departments.filter((d) => d !== 'No department').map((d) => <option key={d} value={d} />)}</datalist>

      {openId && (
        <EmployeeModal
          key={openId}
          data={data}
          employee={openId === 'new' ? null : data.employees.find((e) => e.id === openId) ?? null}
          comp={comp}
          today={today}
          onClose={() => setOpenId(null)}
          onSaved={(id) => {
            if (id) setOpenId(id)
            refresh()
          }}
        />
      )}
      {importOpen && <ImportModal comp={comp} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); refresh() }} />}
    </main>
  )
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

function Track({ value }: { value: number | null }) {
  const w = Math.max(0, Math.min(100, (value ?? 0) * 100))
  return (
    <span className="cxp-track" aria-hidden>
      <span style={{ width: `${w}%` }} />
    </span>
  )
}

// ── People: org chart + table ───────────────────────────────────────────

function PeopleView({ data, attById, comp, onOpen }: { data: EmployeesData; attById: Map<string, number | null>; comp: boolean; onOpen: (id: string) => void }) {
  const [view, setView] = useState<'org' | 'table'>('org')
  const org = useMemo(() => orgByDepartment(data.employees), [data.employees])
  const byId = new Map(data.employees.map((e) => [e.id, e]))

  const Node = ({ n }: { n: OrgNode }) => (
    <li>
      <button type="button" className="cxp-person" onClick={() => onOpen(n.emp.id)}>
        <span className="cxp-avatar" aria-hidden>{initials(n.emp.name)}</span>
        <span className="who">
          <b>{n.emp.name}</b>
          <small>{n.emp.title || 'No title'}{n.reports.length ? ` · ${n.reports.length} ${n.reports.length === 1 ? 'report' : 'reports'}` : ''}</small>
        </span>
        <span className="att">{attById.get(n.emp.id) != null ? `${pctOf(attById.get(n.emp.id))} to goal` : ''}</span>
      </button>
      {n.reports.length > 0 && (
        <ul className="cxp-tree">
          {n.reports.map((r) => <Node key={r.emp.id} n={r} />)}
        </ul>
      )}
    </li>
  )

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>{view === 'org' ? 'Org chart' : 'Everyone'}</h2>
          <p>Click anyone to see their KPIs{comp ? ', bonus plan' : ''} and reviews.</p>
        </div>
        <span className="cx-seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === 'org'} onClick={() => setView('org')}>Org chart</button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
        </span>
      </div>
      {view === 'org' ? (
        <div className="cxp-org" style={{ marginTop: 12 }}>
          {org.map((d) => {
            const atts = data.employees.filter((e) => (e.department || 'No department') === d.department).map((e) => attById.get(e.id) ?? null)
            const avg = weightedAttainment(atts.map((a) => ({ weight: 1, att: a })))
            const payroll = comp ? data.employees.filter((e) => (e.department || 'No department') === d.department).reduce((s, e) => s + (e.base_salary ?? 0), 0) : 0
            return (
              <article key={d.department} className="cxp-dept">
                <h3>{d.department}</h3>
                <div className="meta">
                  <span>{d.count} {d.count === 1 ? 'person' : 'people'}</span>
                  <span>{avg == null ? 'No KPIs yet' : `${pctOf(avg)} to goal`}</span>
                  {comp && payroll > 0 && <span>{usd(payroll)} base pay</span>}
                </div>
                <ul className="cxp-tree">
                  {d.roots.map((r) => <Node key={r.emp.id} n={r} />)}
                </ul>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="cxp-scroll">
          <table className="cx-table">
            <thead>
              <tr>
                <th className="l">Name</th>
                <th className="l">Title</th>
                <th className="l">Department</th>
                <th className="l">Manager</th>
                <th>Started</th>
                {comp && <th>Base salary</th>}
                <th>To goal</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <tr key={e.id} onClick={() => onOpen(e.id)} style={{ cursor: 'pointer' }}>
                  <th scope="row">{e.name}</th>
                  <td className="l">{e.title || '—'}</td>
                  <td className="l">{e.department || '—'}</td>
                  <td className="l">{e.manager_id ? byId.get(e.manager_id)?.name ?? '—' : '—'}</td>
                  <td>{e.start_date ?? '—'}</td>
                  {comp && <td>{usd(e.base_salary)}</td>}
                  <td>
                    <span className="cxp-pctcell">{pctOf(attById.get(e.id))}<Track value={attById.get(e.id) ?? null} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Payouts ─────────────────────────────────────────────────────────────

function PayoutsView({ data, comp, today, monthPayouts, quarterPayouts, onChanged }: { data: EmployeesData; comp: boolean; today: string; monthPayouts: PayoutLine[]; quarterPayouts: PayoutLine[]; onChanged: () => void }) {
  const dialog = useDialog()
  const hasQuarter = data.kpis.some((k) => k.period === 'quarter')
  const hasMonth = data.kpis.some((k) => k.period === 'month') || !hasQuarter
  const [period, setPeriod] = useState<Period>(hasMonth ? 'month' : 'quarter')
  const [err, setErr] = useState<string | null>(null)
  const key = periodKeyFor(period, today)
  const lock = data.locks.find((l) => l.period_key === key) ?? null
  const live = (period === 'month' ? monthPayouts : quarterPayouts).filter((p) => p.kpis.length > 0 || p.status !== 'no_plan')
  const lines = lock ? lock.lines : live
  const total = lines.reduce((s, l) => s + l.total, 0)

  if (!comp) {
    return (
      <section className="cx-panel">
        <p className="cx-takeaway" style={{ margin: 0 }}>Bonus payouts are for the exec team only. Ask an owner if you need access.</p>
      </section>
    )
  }

  const approve = async () => {
    if (!(await dialog.confirm({ title: `Approve ${periodLabel(key)}?`, body: `${usd(total)} in bonuses. This locks the period's numbers for payroll; nothing is paid from here.`, confirmLabel: 'Approve' }))) return
    const res = await post({ action: 'approve', period_key: key })
    if (res.error) setErr(res.error)
    else onChanged()
  }
  const unlock = async () => {
    if (!(await dialog.confirm({ title: `Unlock ${periodLabel(key)}?`, body: 'The numbers can be changed again, and it will need approving again.', confirmLabel: 'Unlock' }))) return
    const res = await post({ action: 'unlock', period_key: key })
    if (res.error) setErr(res.error)
    else onChanged()
  }

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Bonus payouts · {periodLabel(key)}</h2>
          <p>{lock ? `Approved ${lock.approved_at.slice(0, 10)}${lock.approved_by_name ? ` by ${lock.approved_by_name}` : ''}. Locked for payroll.` : 'Worked out from each person’s KPIs and bonus tiers. Approve to lock it for payroll.'}</p>
        </div>
        <span className="cxp-bar">
          <span className="cx-seg" role="group" aria-label="Period">
            <button type="button" aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Month</button>
            <button type="button" aria-pressed={period === 'quarter'} onClick={() => setPeriod('quarter')}>Quarter</button>
          </span>
          <a className="cx-btn cx-btn-ghost cx-btn-sm" href={`/api/employees?export=payouts&period=${key}`}>Export CSV</a>
          {lock ? (
            <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={unlock}>Unlock</button>
          ) : (
            <button type="button" className="cx-btn cx-btn-sm" onClick={approve} disabled={lines.length === 0}>Approve</button>
          )}
        </span>
      </div>
      {err && <p className="cxp-error" role="alert">{err}</p>}
      {lines.length === 0 ? (
        <p className="cxp-note" style={{ marginTop: 10 }}>No one has {period === 'month' ? 'monthly' : 'quarterly'} KPIs yet. Open a person to add their KPIs and bonus tiers.</p>
      ) : (
        <div className="cxp-scroll">
          <table className="cx-table">
            <thead>
              <tr>
                <th className="l">Employee</th>
                <th className="l">KPIs</th>
                <th>Overall</th>
                <th className="l">Status</th>
                <th>Bonus</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.employee_id}>
                  <th scope="row" style={{ whiteSpace: 'normal' }}>
                    {l.name}
                    <div style={{ fontSize: 12, color: 'var(--cx-muted)', fontWeight: 400 }}>{l.department || '—'}</div>
                  </th>
                  <td className="l" style={{ whiteSpace: 'normal', minWidth: 220 }}>
                    {l.kpis.map((k) => (
                      <div key={k.kpi_id} style={{ fontSize: 13 }}>
                        {k.name}: {fmtKpiValue(k.unit, k.actual)} of {fmtKpiValue(k.unit, k.target)} <span style={{ color: 'var(--cx-muted)' }}>({pctOf(k.att)}{k.bonus ? `, ${usd(k.bonus)}` : ''})</span>
                      </div>
                    ))}
                  </td>
                  <td>{pctOf(l.overallAtt)}{l.overallBonus ? <div style={{ fontSize: 12, color: 'var(--cx-muted)' }}>{usd(l.overallBonus)}</div> : null}</td>
                  <td className="l">
                    <span className={`cxp-status ${l.status === 'earned' || l.status === 'on_track' ? 'is-good' : l.status === 'behind' ? 'is-behind' : ''}`} style={{ marginTop: 0 }}>
                      <i />
                      {PAYOUT_STATUS_WORDS[l.status]}
                    </span>
                  </td>
                  <td><b>{usd(l.total)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="l">Total</th>
                <td />
                <td />
                <td />
                <td>{usd(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Reviews ─────────────────────────────────────────────────────────────

function periodKeyForReview(type: Review['period_type'], today: string): string {
  return type === 'year' ? today.slice(0, 4) : type === 'quarter' ? quarterKey(today) : monthKey(today)
}

function Stars({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <span className="cxp-stars" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}>
          {n}
        </button>
      ))}
    </span>
  )
}

function ReviewForm({ data, today, employeeId, onSaved }: { data: EmployeesData; today: string; employeeId?: string; onSaved: () => void }) {
  const [emp, setEmp] = useState(employeeId ?? data.employees[0]?.id ?? '')
  const [type, setType] = useState<Review['period_type']>('quarter')
  const [overall, setOverall] = useState<number | null>(null)
  const [ratings, setRatings] = useState<Record<string, number | null>>({})
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const kpis = data.kpis.filter((k) => k.employee_id === emp)
  const save = async () => {
    if (!emp) return
    if (overall == null && !notes.trim()) {
      setErr('Give an overall rating or write a note.')
      return
    }
    setBusy(true)
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(ratings)) if (v != null) clean[k] = v
    const res = await post({ action: 'add_review', employee_id: emp, period_type: type, period_key: periodKeyForReview(type, today), overall, kpi_ratings: clean, notes })
    setBusy(false)
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setOverall(null)
      setRatings({})
      setNotes('')
      onSaved()
    }
  }
  return (
    <div>
      <div className="cxp-form">
        {!employeeId && (
          <label className="cxp-field" style={{ flex: '1 1 200px' }}>
            Employee
            <select value={emp} onChange={(e) => { setEmp(e.target.value); setRatings({}) }}>
              {data.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
        <label className="cxp-field">
          Review for
          <select value={type} onChange={(e) => setType(e.target.value as Review['period_type'])}>
            <option value="month">{periodLabel(monthKey(today))}</option>
            <option value="quarter">{periodLabel(quarterKey(today))}</option>
            <option value="year">{today.slice(0, 4)} (annual)</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <div className="cxp-field">
          Overall (1 = well below, 5 = outstanding)
          <Stars value={overall} onChange={setOverall} label="Overall rating" />
        </div>
        {kpis.map((k) => (
          <div key={k.id} className="cxp-field">
            {k.name}
            <Stars value={ratings[k.id] ?? null} onChange={(v) => setRatings((r) => ({ ...r, [k.id]: v }))} label={`${k.name} rating`} />
          </div>
        ))}
        <label className="cxp-field">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 90, fontFamily: 'var(--cx-sans, Inter, sans-serif)', fontSize: 14 }} maxLength={4000} />
        </label>
      </div>
      {err && <p className="cxp-error" role="alert">{err}</p>}
      <div className="cxp-bar" style={{ marginTop: 10 }}>
        <button type="button" className="cx-btn cx-btn-sm" onClick={save} disabled={busy || !emp}>{busy ? 'Saving…' : 'Save review'}</button>
      </div>
    </div>
  )
}

function ReviewList({ reviews, data, onChanged }: { reviews: Review[]; data: EmployeesData; onChanged: () => void }) {
  const dialog = useDialog()
  const nameOf = new Map(data.employees.map((e) => [e.id, e.name]))
  const kpiName = new Map(data.kpis.map((k) => [k.id, k.name]))
  if (reviews.length === 0) return <p className="cxp-note">No reviews yet.</p>
  return (
    <div>
      {reviews.map((r) => (
        <div key={r.id} className="cxp-review">
          <div className="top">
            <b>{nameOf.get(r.employee_id) ?? 'Former employee'}</b>
            <span>{periodLabel(r.period_key)}{r.period_type === 'year' ? ' annual' : ''} review</span>
            {r.overall != null && <span>Overall {r.overall} / 5</span>}
            <span>{r.reviewer_name ? `by ${r.reviewer_name}, ` : ''}{r.created_at.slice(0, 10)}</span>
            <button
              type="button"
              className="cx-link"
              style={{ color: 'var(--cx-muted)', marginLeft: 'auto' }}
              onClick={async () => {
                if (!(await dialog.confirm({ title: 'Delete this review?', confirmLabel: 'Delete' }))) return
                await post({ action: 'remove_review', id: r.id })
                onChanged()
              }}
            >
              Delete
            </button>
          </div>
          {Object.keys(r.kpi_ratings).length > 0 && (
            <p style={{ color: 'var(--cx-muted)' }}>
              {Object.entries(r.kpi_ratings)
                .map(([k, v]) => `${kpiName.get(k) ?? 'KPI'} ${v}/5`)
                .join(' · ')}
            </p>
          )}
          {r.notes && <p>{r.notes}</p>}
        </div>
      ))}
    </div>
  )
}

function ReviewsView({ data, today, onChanged }: { data: EmployeesData; today: string; onChanged: () => void }) {
  const [who, setWho] = useState('')
  const list = who ? data.reviews.filter((r) => r.employee_id === who) : data.reviews
  return (
    <div className="cx-grid cx-grid-2">
      <section className="cx-panel">
        <div className="cxp-head"><h2>Write a review</h2></div>
        <div style={{ marginTop: 10 }}>
          <ReviewForm data={data} today={today} onSaved={onChanged} />
        </div>
      </section>
      <section className="cx-panel">
        <div className="cxp-head">
          <h2>Review history</h2>
          <select className="cxp-input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by employee">
            <option value="">Everyone</option>
            {data.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 6 }}>
          <ReviewList reviews={list} data={data} onChanged={onChanged} />
        </div>
      </section>
    </div>
  )
}

// ── Ranking ─────────────────────────────────────────────────────────────

function RankingView({ data, attById, monthPayouts, quarterPayouts, comp, onOpen }: { data: EmployeesData; attById: Map<string, number | null>; monthPayouts: PayoutLine[]; quarterPayouts: PayoutLine[]; comp: boolean; onOpen: (id: string) => void }) {
  const [by, setBy] = useState<'attainment' | 'rating'>('attainment')
  const [dept, setDept] = useState('')
  const departments = Array.from(new Set(data.employees.map((e) => e.department).filter(Boolean))).sort()
  const rows: RankRow[] = data.employees
    .filter((e) => !dept || e.department === dept)
    .map((e) => ({
      employee_id: e.id,
      name: e.name,
      department: e.department,
      title: e.title,
      att: attById.get(e.id) ?? null,
      rating: latestReview(data.reviews, e.id)?.overall ?? null,
      bonus: (monthPayouts.find((p) => p.employee_id === e.id)?.total ?? 0) + (quarterPayouts.find((p) => p.employee_id === e.id)?.total ?? 0),
    }))
  const ranked = rankEmployees(rows, by)
  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Ranking</h2>
          <p>{by === 'attainment' ? 'By how close each person is to their KPI goals this period.' : 'By their latest review rating.'}</p>
        </div>
        <span className="cxp-bar">
          <select className="cxp-input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="cx-seg" role="group" aria-label="Rank by">
            <button type="button" aria-pressed={by === 'attainment'} onClick={() => setBy('attainment')}>KPIs</button>
            <button type="button" aria-pressed={by === 'rating'} onClick={() => setBy('rating')}>Reviews</button>
          </span>
        </span>
      </div>
      <div className="cxp-scroll">
        <table className="cx-table">
          <thead>
            <tr>
              <th className="l">#</th>
              <th className="l">Name</th>
              <th className="l">Department</th>
              <th>To goal</th>
              <th>Latest review</th>
              {comp && <th>Bonus so far</th>}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.employee_id} onClick={() => onOpen(r.employee_id)} style={{ cursor: 'pointer' }}>
                <td className="l muted">{i + 1}</td>
                <th scope="row">{r.name}{r.title ? <div style={{ fontSize: 12, color: 'var(--cx-muted)', fontWeight: 400 }}>{r.title}</div> : null}</th>
                <td className="l">{r.department || '—'}</td>
                <td><span className="cxp-pctcell">{pctOf(r.att)}<Track value={r.att} /></span></td>
                <td>{r.rating == null ? '—' : `${r.rating} / 5`}</td>
                {comp && <td>{usd(r.bonus)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── One employee ────────────────────────────────────────────────────────

function TierEditor({ tiers, onSave, label }: { tiers: CompTier[]; onSave: (rows: Array<{ attain_pct: number; bonus: number }>) => Promise<void>; label: string }) {
  const [rows, setRows] = useState(tiers.length ? tiers.map((t) => ({ a: String(t.attain_pct), b: String(t.bonus) })) : [{ a: '100', b: '' }])
  const [saved, setSaved] = useState(false)
  return (
    <div style={{ marginTop: 6 }}>
      <div className="cxp-note" style={{ marginTop: 0 }}>{label}</div>
      {rows.map((r, i) => (
        <div key={i} className="cxp-form" style={{ marginTop: 6 }}>
          <label className="cxp-field" style={{ flex: '0 1 110px' }}>
            At % of goal
            <input inputMode="decimal" value={r.a} onChange={(e) => { setSaved(false); setRows((rs) => rs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x))) }} />
          </label>
          <label className="cxp-field" style={{ flex: '0 1 130px' }}>
            Bonus $
            <input inputMode="decimal" value={r.b} onChange={(e) => { setSaved(false); setRows((rs) => rs.map((x, j) => (j === i ? { ...x, b: e.target.value } : x))) }} />
          </label>
          <button type="button" className="cxp-iconbtn" aria-label="Remove tier" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        </div>
      ))}
      <div className="cxp-bar" style={{ marginTop: 8 }}>
        <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setRows((rs) => [...rs, { a: '', b: '' }])}>Add tier</button>
        <button
          type="button"
          className="cx-btn cx-btn-sm"
          onClick={async () => {
            await onSave(rows.map((r) => ({ attain_pct: Number(r.a.replace(/[%\s]/g, '')), bonus: Number(r.b.replace(/[$,\s]/g, '')) })).filter((r) => r.attain_pct > 0 && Number.isFinite(r.bonus)))
            setSaved(true)
          }}
        >
          Save tiers
        </button>
        {saved && <span className="cxp-ok" style={{ margin: 0 }}>Saved</span>}
      </div>
    </div>
  )
}

function EmployeeModal({ data, employee, comp, today, onClose, onSaved }: { data: EmployeesData; employee: Employee | null; comp: boolean; today: string; onClose: () => void; onSaved: (id?: string) => void }) {
  const dialog = useDialog()
  const [f, setF] = useState({
    name: employee?.name ?? '',
    title: employee?.title ?? '',
    department: employee?.department ?? '',
    manager_id: employee?.manager_id ?? '',
    start_date: employee?.start_date ?? '',
    email: employee?.email ?? '',
    base_salary: employee?.base_salary == null ? '' : String(employee.base_salary),
    pay_frequency: employee?.pay_frequency ?? 'biweekly',
  })
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nk, setNk] = useState({ name: '', target: '', unit: 'count' as KpiUnit, period: 'month' as Period, lower: false })
  const id = employee?.id ?? null
  const kpis = id ? data.kpis.filter((k) => k.employee_id === id).sort((a, b) => a.sort - b.sort) : []
  const tiers = id ? data.tiers.filter((t) => t.employee_id === id) : []
  const reviews = id ? data.reviews.filter((r) => r.employee_id === id) : []
  const locked = new Set(data.locks.map((l) => l.period_key))

  const saveDetails = async () => {
    if (!f.name.trim()) {
      setErr('Add a name.')
      return
    }
    setBusy(true)
    const body: Record<string, unknown> = { action: 'save_employee', id, name: f.name, title: f.title, department: f.department, manager_id: f.manager_id || null, start_date: f.start_date || null, email: f.email }
    if (comp) {
      body.base_salary = f.base_salary
      body.pay_frequency = f.pay_frequency
    }
    const res = await post(body)
    setBusy(false)
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setOk(id ? 'Saved.' : 'Added. Now give them KPIs.')
      onSaved(res.id)
    }
  }
  const addKpi = async () => {
    if (!id || !nk.name.trim() || !nk.target.trim()) {
      setErr('Name the KPI and give it a goal.')
      return
    }
    const res = await post({ action: 'save_kpi', employee_id: id, name: nk.name, target: nk.target, unit: nk.unit, period: nk.period, lower_is_better: nk.lower, sort: kpis.length })
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setNk({ name: '', target: '', unit: 'count', period: 'month', lower: false })
      onSaved()
    }
  }
  const removeKpi = async (k: Kpi) => {
    if (!(await dialog.confirm({ title: `Remove ${k.name}?`, body: 'Its numbers and bonus tiers go with it.', confirmLabel: 'Remove' }))) return
    const res = await post({ action: 'remove_kpi', id: k.id })
    if (res.error) setErr(res.error)
    else onSaved()
  }
  const saveActual = async (k: Kpi, raw: string) => {
    const key = periodKeyFor(k.period, today)
    const res = await post({ action: 'save_actual', kpi_id: k.id, period_key: key, actual: raw.trim() === '' ? null : raw })
    if (res.error) setErr(res.error)
    else onSaved()
  }
  const remove = async () => {
    if (!id || !(await dialog.confirm({ title: `Remove ${employee?.name}?`, body: 'Their KPIs, bonus tiers and reviews are removed too. Approved payouts keep their copy.', confirmLabel: 'Remove' }))) return
    const res = await post({ action: 'remove_employee', id })
    if (res.error) setErr(res.error)
    else {
      onClose()
      onSaved()
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  return (
    <div className="cx-dialog-scrim cxp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cx-dialog cxp-modal" role="dialog" aria-modal="true" aria-labelledby="cxp-emp-title">
        <div className="cxp-head">
          <h2 id="cxp-emp-title" style={{ margin: 0 }}>{employee ? employee.name : 'Add an employee'}</h2>
          <button type="button" className="cxp-iconbtn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        </div>
        <div className="cxp-grid2" style={{ marginTop: 12 }}>
          <label className="cxp-field">Name<input value={f.name} onChange={set('name')} maxLength={120} /></label>
          <label className="cxp-field">Title<input value={f.title} onChange={set('title')} maxLength={120} /></label>
          <label className="cxp-field">Department<input list="cxp-departments" value={f.department} onChange={set('department')} maxLength={80} placeholder="e.g. Contracting" /></label>
          <label className="cxp-field">
            Manager
            <select value={f.manager_id} onChange={set('manager_id')}>
              <option value="">No manager</option>
              {data.employees.filter((e) => e.id !== id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="cxp-field">Start date<input type="date" value={f.start_date} onChange={set('start_date')} /></label>
          <label className="cxp-field">Email<input type="email" value={f.email} onChange={set('email')} maxLength={200} /></label>
          {comp && (
            <>
              <label className="cxp-field">Base salary (per year)<input inputMode="decimal" value={f.base_salary} onChange={set('base_salary')} placeholder="$" /></label>
              <label className="cxp-field">
                Paid
                <select value={f.pay_frequency} onChange={set('pay_frequency')}>
                  {(Object.keys(FREQ_WORDS) as Employee['pay_frequency'][]).map((k) => <option key={k} value={k}>{FREQ_WORDS[k]}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        {err && <p className="cxp-error" role="alert">{err}</p>}
        {ok && !err && <p className="cxp-ok">{ok}</p>}
        <div className="cxp-bar" style={{ marginTop: 12 }}>
          <button type="button" className="cx-btn cx-btn-sm" onClick={saveDetails} disabled={busy}>{busy ? 'Saving…' : id ? 'Save details' : 'Add employee'}</button>
          {id && <span className="cxp-spacer" />}
          {id && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={remove}>Remove employee</button>}
        </div>

        {id && (
          <section>
            <h3>KPIs</h3>
            {kpis.length === 0 && <p className="cxp-note" style={{ marginTop: 0 }}>No KPIs yet. Add what they are measured on, with the goal for each month or quarter.</p>}
            {kpis.length > 0 && (
              <div className="cxp-scroll">
                <table className="cx-table">
                  <thead>
                    <tr>
                      <th className="l">KPI</th>
                      <th>Goal</th>
                      <th>Actual</th>
                      <th>To goal</th>
                      <th aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {kpis.map((k) => {
                      const key = periodKeyFor(k.period, today)
                      const a = data.actuals.find((x) => x.kpi_id === k.id && x.period_key === key)
                      const att = attainment(k, a?.actual)
                      const isLocked = locked.has(key)
                      return (
                        <tr key={k.id}>
                          <th scope="row" style={{ whiteSpace: 'normal' }}>
                            {k.name}
                            <div style={{ fontSize: 12, color: 'var(--cx-muted)', fontWeight: 400 }}>{periodLabel(key)} · {UNIT_WORDS[k.unit]}{k.lower_is_better ? ' · lower is better' : ''}</div>
                          </th>
                          <td>{fmtKpiValue(k.unit, k.target)}</td>
                          <td style={{ padding: '4px 3px' }}>
                            {isLocked ? (
                              <span title="Approved for payroll">{fmtKpiValue(k.unit, a?.actual)}</span>
                            ) : (
                              <ActualInput key={`${k.id}-${a?.actual ?? ''}`} initial={a ? String(a.actual) : ''} label={`${k.name} actual`} onCommit={(raw) => saveActual(k, raw)} />
                            )}
                          </td>
                          <td>{pctOf(att)}</td>
                          <td style={{ padding: 4 }}>
                            <button type="button" className="cxp-iconbtn" aria-label={`Remove ${k.name}`} onClick={() => removeKpi(k)}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="cxp-form" style={{ marginTop: 10 }}>
              <label className="cxp-field" style={{ flex: '2 1 180px' }}>New KPI<input value={nk.name} onChange={(e) => setNk((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Contracts processed" maxLength={120} /></label>
              <label className="cxp-field" style={{ flex: '0 1 100px' }}>Goal<input inputMode="decimal" value={nk.target} onChange={(e) => setNk((x) => ({ ...x, target: e.target.value }))} /></label>
              <label className="cxp-field">
                Unit
                <select value={nk.unit} onChange={(e) => setNk((x) => ({ ...x, unit: e.target.value as KpiUnit }))}>
                  {(Object.keys(UNIT_WORDS) as KpiUnit[]).map((u) => <option key={u} value={u}>{UNIT_WORDS[u]}</option>)}
                </select>
              </label>
              <label className="cxp-field">
                Every
                <select value={nk.period} onChange={(e) => setNk((x) => ({ ...x, period: e.target.value === 'quarter' ? 'quarter' : 'month' }))}>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                </select>
              </label>
              <label className="cxp-check" style={{ minHeight: 32 }}>
                <input type="checkbox" checked={nk.lower} onChange={(e) => setNk((x) => ({ ...x, lower: e.target.checked }))} />
                Lower is better
              </label>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={addKpi}>Add KPI</button>
            </div>
          </section>
        )}

        {id && comp && kpis.length > 0 && (
          <section>
            <h3>Bonus plan</h3>
            <p className="cxp-note" style={{ marginTop: 0 }}>The highest tier reached pays; tiers do not add up. 100% means the goal was hit.</p>
            {kpis.map((k) => (
              <TierEditor
                key={`${k.id}-${tiers.filter((t) => t.kpi_id === k.id).length}`}
                label={`${k.name} (${k.period === 'month' ? 'monthly' : 'quarterly'})`}
                tiers={tiers.filter((t) => t.kpi_id === k.id).sort((a, b) => a.attain_pct - b.attain_pct)}
                onSave={async (rows) => {
                  const res = await post({ action: 'save_tiers', employee_id: id, kpi_id: k.id, period: k.period, tiers: rows })
                  if (res.error) setErr(res.error)
                  else onSaved()
                }}
              />
            ))}
            {(['month', 'quarter'] as Period[])
              .filter((p) => kpis.some((k) => k.period === p))
              .map((p) => (
                <TierEditor
                  key={`overall-${p}-${tiers.filter((t) => t.kpi_id == null && t.period === p).length}`}
                  label={`Overall score, ${p === 'month' ? 'monthly' : 'quarterly'} (the weighted average of every KPI)`}
                  tiers={tiers.filter((t) => t.kpi_id == null && t.period === p).sort((a, b) => a.attain_pct - b.attain_pct)}
                  onSave={async (rows) => {
                    const res = await post({ action: 'save_tiers', employee_id: id, kpi_id: null, period: p, tiers: rows })
                    if (res.error) setErr(res.error)
                    else onSaved()
                  }}
                />
              ))}
          </section>
        )}

        {id && (
          <section>
            <h3>Reviews</h3>
            <ReviewForm data={data} today={today} employeeId={id} onSaved={() => onSaved()} />
            <div style={{ marginTop: 12 }}>
              <ReviewList reviews={reviews} data={data} onChanged={() => onSaved()} />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ActualInput({ initial, label, onCommit }: { initial: string; label: string; onCommit: (raw: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <input
      className={`cxp-cell${v !== initial ? ' is-dirty' : ''}`}
      inputMode="decimal"
      value={v}
      aria-label={label}
      placeholder="Enter"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== initial && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(initial)
      }}
    />
  )
}

// ── Import ──────────────────────────────────────────────────────────────

function ImportModal({ comp, onClose, onDone }: { comp: boolean; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const parsed = useMemo(() => (text.trim() ? parseEmployeeRows(readTable(text)) : null), [text])
  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) {
      setErr('That file is over 2 MB.')
      return
    }
    setText(await file.text())
  }
  const go = async () => {
    setBusy(true)
    const res = await post({ action: 'import', text })
    setBusy(false)
    if (res.error) setErr(res.error)
    else onDone()
  }
  return (
    <div className="cx-dialog-scrim cxp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cx-dialog cxp-modal" role="dialog" aria-modal="true" aria-labelledby="cxp-eimp-title">
        <h2 id="cxp-eimp-title">Import employees</h2>
        <div className="cx-dialog-body">
          Upload a CSV, or paste rows copied from Google Sheets. Columns: Name, Title, Department, Manager, Start date, Email{comp ? ', Base salary, Pay frequency' : ''}. People already here (same name) are updated.{' '}
          <a href="/api/employees?template=1" style={{ color: 'var(--cx-ink)' }}>Download the template</a>.
        </div>
        <div className="cxp-form">
          <label className="cxp-field" style={{ flex: '1 1 100%' }}>
            CSV file
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <label className="cxp-field" style={{ flex: '1 1 100%' }}>
            Or paste from Google Sheets
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Name\tTitle\tDepartment\tManager\t…'} spellCheck={false} />
          </label>
        </div>
        {parsed?.problems.length ? <p className="cxp-error" role="alert">{parsed.problems.join(' ')}</p> : null}
        {parsed && parsed.employees.length > 0 && (
          <p className="cxp-ok">
            Ready: {parsed.employees.length} {parsed.employees.length === 1 ? 'person' : 'people'} in {new Set(parsed.employees.map((e) => e.department || '—')).size} departments.
            {parsed.skipped ? ` ${parsed.skipped} rows without a name skipped.` : ''}
          </p>
        )}
        {err && <p className="cxp-error" role="alert">{err}</p>}
        <footer>
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="cx-btn cx-btn-sm" disabled={busy || !parsed || parsed.employees.length === 0} onClick={go}>{busy ? 'Importing…' : 'Import'}</button>
        </footer>
      </div>
    </div>
  )
}
