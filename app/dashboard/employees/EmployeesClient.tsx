'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import { DialogProvider, useDialog } from '@/app/components/cxo/AppDialog'
import { AttainBar, BonusBar, MiniColumns, PtoBar, QuotaCard, Ring, StatusPill, TimeOffStrip, pctOf, usd } from '@/app/components/cxo/EmployeeVisuals'
import type { EmployeesData } from '@/lib/employees/data'
import type { ReviewItem } from '@/lib/employees/ingestShared'
import {
  PAYOUT_STATUS_WORDS,
  PERIODS,
  PERIOD_WORDS,
  QUOTA_TYPES,
  TIME_OFF_KINDS,
  employeeSnapshot,
  fmtKpiValue,
  latestReview,
  monthKey,
  orgByDepartment,
  payoutsForAll,
  periodKeyFor,
  periodLabel,
  ptoSummary,
  quarterKey,
  quotaTypeInfo,
  rankEmployees,
  weightedAttainment,
  type CompTier,
  type Employee,
  type EmployeeSnapshot,
  type Kpi,
  type OrgNode,
  type Period,
  type QuotaType,
  type RankRow,
  type Review,
  type TimeOffKind,
} from '@/lib/employees/shared'
import '@/app/components/cxo/cxo-plan.css'

type Tab = 'people' | 'payouts' | 'reviews' | 'ranking'

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; id?: string; added?: number; updated?: number; skipped?: number; email?: string; linkedExisting?: boolean }> {
  const res = await fetch('/api/employees', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json.error || 'Could not save. Try again.' }
  return json
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
const FREQ_WORDS: Record<Employee['pay_frequency'], string> = { weekly: 'Weekly', biweekly: 'Every two weeks', semimonthly: 'Twice a month', monthly: 'Monthly' }
const KIND_WORDS: Record<TimeOffKind, string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', other: 'Other' }
const X = () => <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>

export default function EmployeesClient(props: { data: EmployeesData; today: string; comp: boolean; canInvite?: boolean }) {
  return (
    <DialogProvider>
      <EmployeesInner {...props} />
    </DialogProvider>
  )
}

function EmployeesInner({ data, today, comp, canInvite = false }: { data: EmployeesData; today: string; comp: boolean; canInvite?: boolean }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('people')
  const [openId, setOpenId] = useState<string | 'new' | null>(null)
  const [miraOpen, setMiraOpen] = useState(false)
  const refresh = () => router.refresh()

  const snaps = useMemo(() => new Map(data.employees.map((e) => [e.id, employeeSnapshot(e, data, today)])), [data, today])
  const attById = useMemo(() => new Map([...snaps].map(([id, s]) => [id, s.att])), [snaps])

  const empty = data.employees.length === 0
  const departments = Array.from(new Set(data.employees.map((e) => e.department || 'No department'))).sort()
  const all = [...snaps.values()]
  const withQuota = all.filter((s) => s.status !== 'no_quota')
  const good = withQuota.filter((s) => s.status === 'met' || s.status === 'on_pace').length
  const avgAtt = weightedAttainment(all.map((s) => ({ weight: 1, att: s.att })))
  const earned = all.reduce((s, x) => s + x.bonusEarned, 0)
  const possible = all.reduce((s, x) => s + x.bonusPossible, 0)

  const actions = (
    <span className="cxp-hero-actions">
      <button type="button" className="cx-btn cx-btn-sm" onClick={() => setMiraOpen(true)}>Give it to Mira</button>
      {!empty && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setOpenId('new')}>Add one</button>}
    </span>
  )

  return (
    <main className="wrap">
      <PageHeader title="Employees" subtitle="Who reports to whom, how each is tracking, and their bonus." actions={actions} />
      <div className="cxp">
        {empty ? (
          <section className="cx-panel cxp-empty">
            <p>No employees yet. Give Mira your roster, quota sheet or bonus plan (a spreadsheet, PDF, Google Sheets link or pasted text) and she sets everyone up for you to check.</p>
            <span className="cxp-bar">
              <button type="button" className="cx-btn cx-btn-sm" onClick={() => setMiraOpen(true)}>Give it to Mira</button>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setOpenId('new')}>Add one by hand</button>
            </span>
          </section>
        ) : (
          <>
            <div className="cx-grid cx-grid-4">
              <section className="cx-panel cxp-kpi cxe-kpiring">
                <p className="cx-eyebrow">Average to quota</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <Ring value={avgAtt} size={60} stroke={6} />
                  <div className="cx-kpi-sub" style={{ margin: 0 }}>Across every quota, this period</div>
                </div>
              </section>
              <section className="cx-panel cxp-kpi">
                <p className="cx-eyebrow">Hit or on pace</p>
                <div className="cx-kpi-figure">{withQuota.length ? `${good} of ${withQuota.length}` : '—'}</div>
                {withQuota.length > 0 ? <AttainBar att={good / withQuota.length} /> : <div className="cx-kpi-sub">No quotas set yet</div>}
              </section>
              {comp ? (
                <section className="cx-panel cxp-kpi">
                  <p className="cx-eyebrow">Bonus earned</p>
                  <div className="cx-kpi-figure">{usd(earned)}</div>
                  {possible > 0 ? <BonusBar earned={earned} possible={possible} /> : <div className="cx-kpi-sub">No bonus plans set yet</div>}
                </section>
              ) : (
                <Kpi label="Reviews this year" figure={String(data.reviews.filter((r) => r.created_at.startsWith(today.slice(0, 4))).length)} sub="Written so far" />
              )}
              <Kpi label="Employees" figure={String(data.employees.length)} sub={`${departments.length} ${departments.length === 1 ? 'department' : 'departments'}`} />
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

            {tab === 'people' && <PeopleView data={data} snaps={snaps} comp={comp} onOpen={setOpenId} />}
            {tab === 'payouts' && <PayoutsView data={data} comp={comp} today={today} onChanged={refresh} />}
            {tab === 'reviews' && <ReviewsView data={data} today={today} onChanged={refresh} />}
            {tab === 'ranking' && <RankingView data={data} attById={attById} snaps={snaps} comp={comp} onOpen={setOpenId} />}
          </>
        )}
      </div>

      <datalist id="cxp-departments">{departments.filter((d) => d !== 'No department').map((d) => <option key={d} value={d} />)}</datalist>

      {openId && (
        <EmployeeModal
          key={openId}
          data={data}
          employee={openId === 'new' ? null : data.employees.find((e) => e.id === openId) ?? null}
          snap={openId === 'new' ? null : snaps.get(openId) ?? null}
          comp={comp}
          canInvite={canInvite}
          today={today}
          onClose={() => setOpenId(null)}
          onSaved={(id) => {
            if (id) setOpenId(id)
            refresh()
          }}
        />
      )}
      {miraOpen && <MiraIngestModal comp={comp} onClose={() => setMiraOpen(false)} onDone={() => { setMiraOpen(false); refresh() }} />}
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

// ── People: visual list + org chart ─────────────────────────────────────

function PeopleView({ data, snaps, comp, onOpen }: { data: EmployeesData; snaps: Map<string, EmployeeSnapshot>; comp: boolean; onOpen: (id: string) => void }) {
  const [view, setView] = useState<'list' | 'org'>('list')
  const [sort, setSort] = useState<'name' | 'att' | 'behind'>('att')
  const org = useMemo(() => orgByDepartment(data.employees), [data.employees])
  const showBonus = comp && [...snaps.values()].some((s) => s.bonusPossible > 0)
  const people = [...data.employees].sort((a, b) => {
    const sa = snaps.get(a.id)
    const sb = snaps.get(b.id)
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'behind') {
      const rank = (s?: EmployeeSnapshot) => (s?.status === 'behind' ? 0 : s?.status === 'on_pace' ? 1 : s?.status === 'met' ? 2 : 3)
      return rank(sa) - rank(sb) || (sa?.att ?? 9) - (sb?.att ?? 9)
    }
    return (sb?.att ?? -1) - (sa?.att ?? -1) || a.name.localeCompare(b.name)
  })

  const Node = ({ n }: { n: OrgNode }) => {
    const s = snaps.get(n.emp.id)
    return (
      <li>
        <button type="button" className="cxp-person" onClick={() => onOpen(n.emp.id)}>
          <span className="cxp-avatar" aria-hidden>{initials(n.emp.name)}</span>
          <span className="who">
            <b>{n.emp.name}</b>
            <small>{n.emp.title || 'No title'}{n.reports.length ? ` · ${n.reports.length} ${n.reports.length === 1 ? 'report' : 'reports'}` : ''}</small>
          </span>
          {s?.att != null && <span className="cxp-pctcell att">{pctOf(s.att)}<Track value={s.att} /></span>}
        </button>
        {n.reports.length > 0 && (
          <ul className="cxp-tree">
            {n.reports.map((r) => <Node key={r.emp.id} n={r} />)}
          </ul>
        )}
      </li>
    )
  }

  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>{view === 'list' ? 'Everyone' : 'Org chart'}</h2>
          <p>Tap anyone for their quotas{comp ? ', bonus' : ''} and time off.</p>
        </div>
        <span className="cxp-bar">
          {view === 'list' && (
            <select className="cxp-input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="att">Highest to quota</option>
              <option value="behind">Behind first</option>
              <option value="name">Name</option>
            </select>
          )}
          <span className="cx-seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
            <button type="button" aria-pressed={view === 'org'} onClick={() => setView('org')}>Org chart</button>
          </span>
        </span>
      </div>
      {view === 'list' ? (
        <div className="cxe-list">
          <div className={`cxe-listhead${showBonus ? '' : ' no-bonus'}`} aria-hidden>
            <span>Person</span>
            <span>To quota</span>
            {showBonus && <span>Bonus earned of possible</span>}
            <span>Status</span>
          </div>
          {people.map((e) => {
            const s = snaps.get(e.id)!
            const first = s.quotas[0]
            return (
              <button key={e.id} type="button" className={`cxe-row${showBonus ? '' : ' no-bonus'}`} onClick={() => onOpen(e.id)}>
                <span className="who">
                  <span className="cxp-avatar" aria-hidden>{initials(e.name)}</span>
                  <span>
                    <b>{e.name}</b>
                    <small>{[e.title, e.department].filter(Boolean).join(' · ') || 'No title'}</small>
                  </span>
                </span>
                <span className="att">
                  <span className="lbl">Quota</span>
                  <AttainBar att={s.att} projected={first?.projectedAtt ?? null} wide />
                  <b>{pctOf(s.att)}</b>
                </span>
                {showBonus && (
                  <span className="bonus" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="lbl">Bonus</span>
                    <span style={{ flex: 1, minWidth: 0 }}><BonusBar earned={s.bonusEarned} possible={s.bonusPossible} /></span>
                  </span>
                )}
                <span className="pill"><StatusPill status={s.status} /></span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="cxp-org" style={{ marginTop: 12 }}>
          {org.map((d) => {
            const atts = data.employees.filter((e) => (e.department || 'No department') === d.department).map((e) => snaps.get(e.id)?.att ?? null)
            const avg = weightedAttainment(atts.map((a) => ({ weight: 1, att: a })))
            const payroll = comp ? data.employees.filter((e) => (e.department || 'No department') === d.department).reduce((s, e) => s + (e.base_salary ?? 0), 0) : 0
            return (
              <article key={d.department} className="cxp-dept">
                <h3>{d.department}</h3>
                <div className="meta">
                  <span>{d.count} {d.count === 1 ? 'person' : 'people'}</span>
                  <span>{avg == null ? 'No quotas yet' : `${pctOf(avg)} to quota`}</span>
                  {comp && payroll > 0 && <span>{usd(payroll)} base pay</span>}
                </div>
                <ul className="cxp-tree">
                  {d.roots.map((r) => <Node key={r.emp.id} n={r} />)}
                </ul>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Payouts ─────────────────────────────────────────────────────────────

function PayoutsView({ data, comp, today, onChanged }: { data: EmployeesData; comp: boolean; today: string; onChanged: () => void }) {
  const dialog = useDialog()
  const first = PERIODS.find((p) => data.kpis.some((k) => k.period === p)) ?? 'month'
  const [period, setPeriod] = useState<Period>(first)
  const [err, setErr] = useState<string | null>(null)
  const key = periodKeyFor(period, today)
  const lock = data.locks.find((l) => l.period_key === key) ?? null
  const live = payoutsForAll(data, key, today).filter((p) => p.kpis.length > 0 || p.status !== 'no_plan')
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
            {PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{PERIOD_WORDS[p]}</button>
            ))}
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
        <p className="cxp-note" style={{ marginTop: 10 }}>No one has a {period === 'month' ? 'monthly' : period === 'quarter' ? 'quarterly' : 'yearly'} quota yet. Open a person to add quotas and bonus tiers, or give Mira your plan.</p>
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

function RankingView({ data, attById, snaps, comp, onOpen }: { data: EmployeesData; attById: Map<string, number | null>; snaps: Map<string, EmployeeSnapshot>; comp: boolean; onOpen: (id: string) => void }) {
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
      bonus: snaps.get(e.id)?.bonusEarned ?? 0,
    }))
  const ranked = rankEmployees(rows, by)
  return (
    <section className="cx-panel">
      <div className="cxp-head">
        <div>
          <h2>Ranking</h2>
          <p>{by === 'attainment' ? 'By how close each person is to quota this period.' : 'By their latest review rating.'}</p>
        </div>
        <span className="cxp-bar">
          <select className="cxp-input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="cx-seg" role="group" aria-label="Rank by">
            <button type="button" aria-pressed={by === 'attainment'} onClick={() => setBy('attainment')}>Quota</button>
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
              <th>To quota</th>
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
                <td><span className="cxp-pctcell">{pctOf(r.att)}<AttainBar att={r.att} /></span></td>
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
            At % of quota
            <input inputMode="decimal" value={r.a} onChange={(e) => { setSaved(false); setRows((rs) => rs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x))) }} />
          </label>
          <label className="cxp-field" style={{ flex: '0 1 130px' }}>
            Bonus $
            <input inputMode="decimal" value={r.b} onChange={(e) => { setSaved(false); setRows((rs) => rs.map((x, j) => (j === i ? { ...x, b: e.target.value } : x))) }} />
          </label>
          <button type="button" className="cxp-iconbtn" aria-label="Remove tier" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            <X />
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


// ── One employee: quotas first, then HR, then details ───────────────────

function QuotaEditor({ employeeId, kpi, bookLinked, hasBookMatch, sort, onDone, onCancel }: { employeeId: string; kpi: Kpi | null; bookLinked: boolean; hasBookMatch: boolean; sort: number; onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState({
    type: (kpi?.quota_type ?? 'policies') as QuotaType,
    name: kpi?.quota_type === 'custom' ? kpi.name : '',
    target: kpi ? String(kpi.target) : '',
    period: (kpi?.period ?? 'month') as Period,
    book: kpi ? kpi.actual_source === 'book' : bookLinked,
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const info = quotaTypeInfo(q.type)
  const canBook = info.bookable && bookLinked
  const save = async () => {
    if (q.type === 'custom' && !q.name.trim()) return setErr('Name the custom quota.')
    if (!(Number(q.target.replace(/[$,\s]/g, '')) > 0)) return setErr('Give it a target above zero.')
    setBusy(true)
    const res = await post({
      action: 'save_kpi',
      id: kpi?.id,
      employee_id: employeeId,
      quota_type: q.type,
      name: q.type === 'custom' ? q.name : kpi && kpi.quota_type === q.type ? kpi.name : '',
      target: q.target.replace(/[$,\s]/g, ''),
      period: q.period,
      actual_source: canBook && q.book ? 'book' : 'manual',
      sort: kpi?.sort ?? sort,
    })
    setBusy(false)
    if (res.error) setErr(res.error)
    else onDone()
  }
  return (
    <div className="cx-panel" style={{ marginTop: 10, padding: 12 }}>
      <div className="cxp-form">
        <label className="cxp-field" style={{ flex: '1 1 190px' }}>
          Quota type
          <select value={q.type} onChange={(e) => setQ((x) => ({ ...x, type: e.target.value as QuotaType }))}>
            {QUOTA_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </label>
        {q.type === 'custom' && (
          <label className="cxp-field" style={{ flex: '1 1 170px' }}>Name<input value={q.name} onChange={(e) => setQ((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Contracts processed" maxLength={120} /></label>
        )}
        <label className="cxp-field" style={{ flex: '0 1 120px' }}>
          Target{info.unit === 'usd' ? ' $' : ''}
          <input inputMode="decimal" value={q.target} onChange={(e) => setQ((x) => ({ ...x, target: e.target.value }))} />
        </label>
        <label className="cxp-field">
          Every
          <select value={q.period} onChange={(e) => setQ((x) => ({ ...x, period: e.target.value as Period }))}>
            {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_WORDS[p]}</option>)}
          </select>
        </label>
      </div>
      {canBook && (
        <label className="cxp-check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={q.book} onChange={(e) => setQ((x) => ({ ...x, book: e.target.checked }))} />
          Fill progress from the book{hasBookMatch ? '' : ' (set their name in the book under Details)'}
        </label>
      )}
      {err && <p className="cxp-error" role="alert">{err}</p>}
      <div className="cxp-bar" style={{ marginTop: 10 }}>
        <button type="button" className="cx-btn cx-btn-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : kpi ? 'Save quota' : 'Add quota'}</button>
        <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function TimeOffForm({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const [t, setT] = useState({ start: '', end: '', kind: 'vacation' as TimeOffKind, days: '' })
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    if (!t.start) return setErr('Pick the first day off.')
    const res = await post({ action: 'add_time_off', employee_id: employeeId, start_date: t.start, end_date: t.end || t.start, kind: t.kind, days: t.days || null })
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setT({ start: '', end: '', kind: 'vacation', days: '' })
      onDone()
    }
  }
  return (
    <>
      <div className="cxp-form" style={{ marginTop: 8 }}>
        <label className="cxp-field">From<input type="date" value={t.start} onChange={(e) => setT((x) => ({ ...x, start: e.target.value }))} /></label>
        <label className="cxp-field">To<input type="date" value={t.end} onChange={(e) => setT((x) => ({ ...x, end: e.target.value }))} /></label>
        <label className="cxp-field">
          Type
          <select value={t.kind} onChange={(e) => setT((x) => ({ ...x, kind: e.target.value as TimeOffKind }))}>
            {TIME_OFF_KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
          </select>
        </label>
        <label className="cxp-field" style={{ flex: '0 1 90px' }}>Days<input inputMode="decimal" value={t.days} onChange={(e) => setT((x) => ({ ...x, days: e.target.value }))} placeholder="Auto" /></label>
        <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={save}>Log time off</button>
      </div>
      {err && <p className="cxp-error" role="alert">{err}</p>}
    </>
  )
}

function EmployeeModal({ data, employee, snap, comp, canInvite, today, onClose, onSaved }: { data: EmployeesData; employee: Employee | null; snap: EmployeeSnapshot | null; comp: boolean; canInvite: boolean; today: string; onClose: () => void; onSaved: (id?: string) => void }) {
  const dialog = useDialog()
  const id = employee?.id ?? null
  const num = (v: number | null | undefined) => (v == null ? '' : String(v))
  const [f, setF] = useState({
    name: employee?.name ?? '',
    title: employee?.title ?? '',
    department: employee?.department ?? '',
    manager_id: employee?.manager_id ?? '',
    start_date: employee?.start_date ?? '',
    email: employee?.email ?? '',
    base_salary: num(employee?.base_salary),
    hourly_rate: num(employee?.hourly_rate),
    pay_frequency: employee?.pay_frequency ?? 'biweekly',
    hours_per_week: num(employee?.hours_per_week),
    pto_allowed_days: num(employee?.pto_allowed_days),
    pto_balance_days: num(employee?.pto_balance_days),
    book_match: employee?.book_match ?? '',
    book_dim: employee?.book_dim ?? 'agent',
  })
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [inviteEmail, setInviteEmail] = useState(employee?.email ?? '')
  const kpis = id ? data.kpis.filter((k) => k.employee_id === id).sort((a, b) => a.sort - b.sort) : []
  const tiers = id ? data.tiers.filter((t) => t.employee_id === id) : []
  const reviews = id ? data.reviews.filter((r) => r.employee_id === id) : []
  const locked = new Set(data.locks.map((l) => l.period_key))
  const year = today.slice(0, 4)
  const pto = id ? ptoSummary(data.timeOff.filter((t) => t.employee_id === id), year, employee?.pto_allowed_days ?? null, employee?.pto_balance_days ?? null) : null
  const qbo = id ? data.qbo[id] ?? null : null
  const manager = employee?.manager_id ? data.employees.find((e) => e.id === employee.manager_id)?.name ?? null : null

  const saveDetails = async () => {
    if (!f.name.trim()) return setErr('Add a name.')
    setBusy(true)
    const body: Record<string, unknown> = {
      action: 'save_employee',
      id,
      name: f.name,
      title: f.title,
      department: f.department,
      manager_id: f.manager_id || null,
      start_date: f.start_date || null,
      email: f.email,
      hours_per_week: f.hours_per_week,
      pto_allowed_days: f.pto_allowed_days,
      pto_balance_days: f.pto_balance_days,
      book_match: f.book_match,
      book_dim: f.book_dim,
    }
    if (comp) {
      body.base_salary = f.base_salary
      body.hourly_rate = f.hourly_rate
      body.pay_frequency = f.pay_frequency
    }
    const res = await post(body)
    setBusy(false)
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setOk(id ? 'Saved.' : 'Added. Now give them a quota.')
      onSaved(res.id)
    }
  }
  const removeKpi = async (k: Kpi) => {
    if (!(await dialog.confirm({ title: `Remove ${k.name}?`, body: 'Its progress and bonus tiers go with it.', confirmLabel: 'Remove' }))) return
    const res = await post({ action: 'remove_kpi', id: k.id })
    if (res.error) setErr(res.error)
    else onSaved()
  }
  const saveActual = async (k: Kpi, raw: string) => {
    const res = await post({ action: 'save_actual', kpi_id: k.id, period_key: periodKeyFor(k.period, today), actual: raw.trim() === '' ? null : raw.replace(/[$,\s]/g, '') })
    if (res.error) setErr(res.error)
    else onSaved()
  }
  const remove = async () => {
    if (!id || !(await dialog.confirm({ title: `Remove ${employee?.name}?`, body: 'Their quotas, bonus tiers, time off and reviews are removed too. Approved payouts keep their copy.', confirmLabel: 'Remove' }))) return
    const res = await post({ action: 'remove_employee', id })
    if (res.error) setErr(res.error)
    else {
      onClose()
      onSaved()
    }
  }
  const invite = async () => {
    if (!id) return
    if (!inviteEmail.trim()) return setErr('Add their email to invite them.')
    if (!(await dialog.confirm({ title: `Invite ${employee?.name}?`, body: `They get a login at ${inviteEmail.trim()} that opens only their own page: their quotas, bonus and time off. They never see anyone else or company numbers.`, confirmLabel: 'Send invite' }))) return
    const res = await post({ action: 'invite_employee', employee_id: id, email: inviteEmail.trim() })
    if (res.error) setErr(res.error)
    else {
      setErr(null)
      setOk(res.linkedExisting ? 'Linked to their existing login.' : `Invite sent to ${res.email ?? inviteEmail.trim()}.`)
      onSaved()
    }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const facts: Array<{ label: string; value: string; sub?: string }> = []
  if (employee) {
    if (comp && employee.base_salary != null) facts.push({ label: 'Base pay', value: usd(employee.base_salary), sub: `a year · ${FREQ_WORDS[employee.pay_frequency].toLowerCase()}` })
    if (comp && employee.hourly_rate != null) facts.push({ label: 'Pay rate', value: `$${employee.hourly_rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, sub: 'an hour' })
    if (employee.hours_per_week != null) facts.push({ label: 'Hours', value: String(employee.hours_per_week), sub: 'a week' })
    if (qbo) facts.push({ label: 'Hours this month', value: qbo.hoursThisMonth.toLocaleString('en-US', { maximumFractionDigits: 1 }), sub: 'from QuickBooks' })
    if (comp && qbo?.costRate != null && employee.hourly_rate == null) facts.push({ label: 'QuickBooks rate', value: `$${qbo.costRate.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, sub: 'an hour' })
    if (employee.start_date) facts.push({ label: 'Started', value: employee.start_date })
    if (manager) facts.push({ label: 'Reports to', value: manager })
  }
  const showPto = !!pto && (pto.used > 0 || pto.allowed != null || pto.left != null)

  return (
    <div className="cx-dialog-scrim cxp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cx-dialog cxp-modal cxe-detail" role="dialog" aria-modal="true" aria-labelledby="cxp-emp-title">
        <div className="cxp-head">
          <div>
            <h2 id="cxp-emp-title" style={{ margin: 0 }}>{employee ? employee.name : 'Add an employee'}</h2>
            {employee && <p>{[employee.title, employee.department].filter(Boolean).join(' · ') || 'No title yet'}</p>}
          </div>
          <button type="button" className="cxp-iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        </div>

        {employee && snap && (
          <div className="hero">
            <Ring value={snap.att} size={92} stroke={8} sub="to quota" />
            <div className="facts">
              <StatusPill status={snap.status} />
              {comp && snap.bonusPossible > 0 && <BonusBar earned={snap.bonusEarned} possible={snap.bonusPossible} />}
              {employee.member_id ? <span className="cxe-muted">Has their own login</span> : null}
            </div>
          </div>
        )}

        {id && (
          <section>
            <div className="cxp-head">
              <h3 style={{ margin: '18px 0 0' }}>Quotas</h3>
              {editing !== 'new' && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setEditing('new')}>Add quota</button>}
            </div>
            {kpis.length === 0 && editing !== 'new' && <p className="cxp-note" style={{ marginTop: 4 }}>No quota yet. Add one, or give Mira their plan from the main page.</p>}
            {editing === 'new' && (
              <QuotaEditor employeeId={id} kpi={null} bookLinked={data.bookLinked} hasBookMatch={!!employee?.book_match} sort={kpis.length} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); onSaved() }} />
            )}
            <div className="cxe-quotas">
              {(snap?.quotas ?? []).map((line) => {
                const k = line.kpi
                const isLocked = locked.has(line.periodKey)
                return (
                  <div key={k.id}>
                    <QuotaCard line={line} showBonus={comp}>
                      <span className="cxe-quota-edit">
                        <button type="button" className="cx-link" onClick={() => setEditing(editing === k.id ? null : k.id)}>Edit</button>
                        <button type="button" className="cxp-iconbtn" aria-label={`Remove ${k.name}`} onClick={() => removeKpi(k)}><X /></button>
                      </span>
                    </QuotaCard>
                    {k.actual_source !== 'book' && !isLocked && (
                      <label className="cxp-field" style={{ marginTop: 6 }}>
                        Progress so far
                        <ActualInput key={`${k.id}-${line.actual ?? ''}`} initial={line.actual == null ? '' : String(line.actual)} label={`${k.name} progress`} onCommit={(raw) => saveActual(k, raw)} />
                      </label>
                    )}
                    {editing === k.id && (
                      <>
                        <QuotaEditor employeeId={id} kpi={k} bookLinked={data.bookLinked} hasBookMatch={!!employee?.book_match} sort={k.sort} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); onSaved() }} />
                        {comp && (
                          <TierEditor
                            key={`${k.id}-${tiers.filter((t) => t.kpi_id === k.id).length}`}
                            label="Bonus tiers. The highest tier reached pays; tiers do not add up. 100% means quota was hit."
                            tiers={tiers.filter((t) => t.kpi_id === k.id).sort((a, b) => a.attain_pct - b.attain_pct)}
                            onSave={async (rows) => {
                              const res = await post({ action: 'save_tiers', employee_id: id, kpi_id: k.id, period: k.period, tiers: rows })
                              if (res.error) setErr(res.error)
                              else onSaved()
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            {comp && kpis.length > 1 && (
              <details className="cxe-details">
                <summary>Bonus on the overall score</summary>
                {PERIODS.filter((p) => kpis.some((k) => k.period === p)).map((p) => (
                  <TierEditor
                    key={`overall-${p}-${tiers.filter((t) => t.kpi_id == null && t.period === p).length}`}
                    label={`${PERIOD_WORDS[p]}ly score, the weighted average of every ${p}ly quota`}
                    tiers={tiers.filter((t) => t.kpi_id == null && t.period === p).sort((a, b) => a.attain_pct - b.attain_pct)}
                    onSave={async (rows) => {
                      const res = await post({ action: 'save_tiers', employee_id: id, kpi_id: null, period: p, tiers: rows })
                      if (res.error) setErr(res.error)
                      else onSaved()
                    }}
                  />
                ))}
              </details>
            )}
          </section>
        )}

        {employee && facts.length > 0 && (
          <section>
            <h3>Pay and hours</h3>
            <div className="cxe-facts">
              {facts.map((x) => (
                <div key={x.label} className="cxe-fact">
                  <p>{x.label}</p>
                  <b>{x.value}</b>
                  {x.sub && <small>{x.sub}</small>}
                </div>
              ))}
            </div>
            {qbo && qbo.hoursByMonth.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <p className="cxe-muted" style={{ margin: '0 0 4px' }}>Hours by month, from QuickBooks</p>
                <MiniColumns items={qbo.hoursByMonth.map((h) => ({ label: periodLabel(h.month).slice(0, 3), value: h.hours }))} format={(n) => `${Math.round(n)} h`} />
              </div>
            )}
          </section>
        )}

        {id && (
          <section>
            <h3>Time off</h3>
            {showPto && pto && <PtoBar used={pto.used} byKind={pto.byKind} allowed={pto.allowed} left={pto.left} />}
            {pto && pto.entries.length > 0 && (
              <>
                <TimeOffStrip entries={pto.entries} year={year} today={today} />
                <ul className="cxe-toff">
                  {pto.entries.slice(0, 8).map((t) => (
                    <li key={t.id}>
                      <span className="d">{t.start_date === t.end_date ? t.start_date : `${t.start_date} to ${t.end_date}`} · {KIND_WORDS[t.kind]}</span>
                      <span className="n">{t.days} {t.days === 1 ? 'day' : 'days'}</span>
                      <button
                        type="button"
                        className="cxp-iconbtn"
                        aria-label="Remove this time off"
                        onClick={async () => {
                          const res = await post({ action: 'remove_time_off', id: t.id })
                          if (res.error) setErr(res.error)
                          else onSaved()
                        }}
                      >
                        <X />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <TimeOffForm employeeId={id} onDone={() => onSaved()} />
          </section>
        )}

        {id && canInvite && !employee?.member_id && (
          <section>
            <h3>Their own page</h3>
            <p className="cxp-note" style={{ marginTop: 0 }}>Give {employee?.name.split(' ')[0]} a login that shows only their quotas, bonus and time off.</p>
            <div className="cxp-form">
              <label className="cxp-field" style={{ flex: '1 1 220px' }}>Email<input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} maxLength={200} /></label>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={invite}>Invite to their page</button>
            </div>
          </section>
        )}

        <details className="cxe-details" open={!id}>
          <summary>{id ? 'Details' : 'Their details'}</summary>
          <div className="cxp-grid2" style={{ marginTop: 8 }}>
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
                <label className="cxp-field">Salary (per year, optional)<input inputMode="decimal" value={f.base_salary} onChange={set('base_salary')} placeholder="$" /></label>
                <label className="cxp-field">Pay rate (per hour, optional)<input inputMode="decimal" value={f.hourly_rate} onChange={set('hourly_rate')} placeholder="$" /></label>
                <label className="cxp-field">
                  Paid
                  <select value={f.pay_frequency} onChange={set('pay_frequency')}>
                    {(Object.keys(FREQ_WORDS) as Employee['pay_frequency'][]).map((k) => <option key={k} value={k}>{FREQ_WORDS[k]}</option>)}
                  </select>
                </label>
              </>
            )}
            <label className="cxp-field">Hours a week (optional)<input inputMode="decimal" value={f.hours_per_week} onChange={set('hours_per_week')} /></label>
            <label className="cxp-field">PTO days a year (optional)<input inputMode="decimal" value={f.pto_allowed_days} onChange={set('pto_allowed_days')} /></label>
            <label className="cxp-field">PTO days left (optional)<input inputMode="decimal" value={f.pto_balance_days} onChange={set('pto_balance_days')} placeholder="Worked out from the log" /></label>
            {data.bookLinked && (
              <>
                <label className="cxp-field">Name in the book (optional)<input value={f.book_match} onChange={set('book_match')} maxLength={120} placeholder="As it appears on policies" /></label>
                <label className="cxp-field">
                  That name is
                  <select value={f.book_dim} onChange={set('book_dim')}>
                    <option value="agent">An agent</option>
                    <option value="team">A team</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <div className="cxp-bar" style={{ marginTop: 12 }}>
            <button type="button" className="cx-btn cx-btn-sm" onClick={saveDetails} disabled={busy}>{busy ? 'Saving…' : id ? 'Save details' : 'Add employee'}</button>
            {id && <span className="cxp-spacer" />}
            {id && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={remove}>Remove employee</button>}
          </div>
        </details>
        {err && <p className="cxp-error" role="alert">{err}</p>}
        {ok && !err && <p className="cxp-ok">{ok}</p>}

        {id && (
          <details className="cxe-details">
            <summary>Reviews{reviews.length ? ` (${reviews.length})` : ''}</summary>
            <ReviewForm data={data} today={today} employeeId={id} onSaved={() => onSaved()} />
            <div style={{ marginTop: 12 }}>
              <ReviewList reviews={reviews} data={data} onChanged={() => onSaved()} />
            </div>
          </details>
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


// ── Give it to Mira: upload / link / paste → review → save ──────────────

type IngestResult = { items: ReviewItem[]; unreadable: string[]; costUsd: number; source: string }
type ApplyResult = { added: number; updated: number; quotas: number; actuals: number; timeOff: number; skipped: number; problems: string[] }

function toRaw(p: ReviewItem['person']): Record<string, unknown> {
  return {
    ...p,
    quotas: p.quotas.map((q) => ({ type: q.quota_type, name: q.name, target: q.target, period: q.period, period_key: q.period_key, actual: q.actual, tiers: q.tiers })),
  }
}

function MiraIngestModal({ comp, onClose, onDone }: { comp: boolean; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'file' | 'link' | 'paste'>('file')
  const [over, setOver] = useState(false)
  const [link, setLink] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<IngestResult | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<ApplyResult | null>(null)

  const read = async (init: RequestInit, label: string) => {
    setErr(null)
    setBusy(label)
    try {
      const r = await fetch('/api/employees/ingest', init)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Mira could not read that. Try another file.')
      const out = j as IngestResult
      setRes(out)
      const p: Record<string, string> = {}
      const s: Record<string, boolean> = {}
      for (const it of out.items) {
        p[it.key] = it.match?.id ?? (it.status === 'ambiguous' || it.candidates.length > 0 ? '' : 'new')
        s[it.key] = it.status === 'problem'
      }
      setPick(p)
      setSkip(s)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Mira could not read that.')
    } finally {
      setBusy(null)
    }
  }
  const onFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > 4_000_000) return setErr('That file is over 4 MB. Split it or paste the part that matters.')
    const fd = new FormData()
    fd.append('file', file)
    void read({ method: 'POST', body: fd }, `Reading ${file.name}…`)
  }
  const sendJson = (body: Record<string, unknown>, label: string) => read({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, label)

  const items = res?.items ?? []
  const keep = items.filter((it) => !skip[it.key])
  const unresolved = keep.filter((it) => !pick[it.key])
  const save = async () => {
    if (unresolved.length) return setErr(`Pick who ${unresolved.length === 1 ? 'this row is' : 'these rows are'} for, or skip ${unresolved.length === 1 ? 'it' : 'them'}.`)
    setBusy('Saving…')
    setErr(null)
    const decisions = items.map((it) => ({ key: it.key, skip: !!skip[it.key], employee_id: pick[it.key] === 'new' ? 'new' : pick[it.key] || null, person: toRaw(it.person) }))
    const r = await fetch('/api/employees/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', decisions }) })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) return setErr(j.error || 'Could not save. Nothing was changed.')
    setDone(j as ApplyResult)
  }

  const TAG: Record<ReviewItem['status'], string> = { matched: 'Updates', new: 'New', ambiguous: 'Who is this?', problem: 'Check' }

  return (
    <div className="cx-dialog-scrim cxp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cx-dialog cxp-modal" role="dialog" aria-modal="true" aria-labelledby="cxe-mira-title">
        <div className="cxp-head">
          <h2 id="cxe-mira-title" style={{ margin: 0 }}>{done ? 'Saved' : res ? 'Check before saving' : 'Give it to Mira'}</h2>
          <button type="button" className="cxp-iconbtn" onClick={onClose} aria-label="Close" disabled={!!busy}><X /></button>
        </div>

        {done ? (
          <>
            <div className="cxe-facts">
              {[
                ['Added', done.added],
                ['Updated', done.updated],
                ['Quotas', done.quotas],
                ['Progress', done.actuals],
                ['Time off', done.timeOff],
              ].map(([l, v]) => (
                <div key={String(l)} className="cxe-fact"><p>{l}</p><b>{v}</b></div>
              ))}
            </div>
            {done.problems.length > 0 && <ul className="cxe-muted" style={{ marginTop: 10 }}>{done.problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>}
            <footer><button type="button" className="cx-btn cx-btn-sm" onClick={onDone}>Done</button></footer>
          </>
        ) : !res ? (
          <div className="cxe-drop">
            <p className="cx-dialog-body" style={{ margin: 0 }}>
              Your roster, quota sheet, bonus plan or PTO log, in any layout. Mira reads it and shows you who she matched before anything is saved.{comp ? '' : ' Pay and bonus columns are left out for you.'}
            </p>
            <span className="cx-seg" role="tablist" aria-label="How">
              <button type="button" role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>File</button>
              <button type="button" role="tab" aria-selected={mode === 'link'} onClick={() => setMode('link')}>Google Sheets link</button>
              <button type="button" role="tab" aria-selected={mode === 'paste'} onClick={() => setMode('paste')}>Paste</button>
            </span>
            {mode === 'file' && (
              <label
                className={`cxe-dropzone${over ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]) }}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf,.docx" onChange={(e) => onFile(e.target.files?.[0])} />
                <b>Drop a file here</b> or tap to choose
                <div style={{ fontSize: 12.5, marginTop: 4 }}>Excel, CSV, PDF or Word, up to 4 MB</div>
              </label>
            )}
            {mode === 'link' && (
              <div className="cxp-form">
                <label className="cxp-field" style={{ flex: '1 1 100%' }}>
                  Link (shared so anyone with the link can view)
                  <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/…" />
                </label>
                <button type="button" className="cx-btn cx-btn-sm" disabled={!!busy || !link.trim()} onClick={() => sendJson({ link }, 'Reading the sheet…')}>Read it</button>
              </div>
            )}
            {mode === 'paste' && (
              <div className="cxp-form">
                <label className="cxp-field" style={{ flex: '1 1 100%' }}>
                  Paste rows or notes
                  <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'e.g. Sample Person: 40 policies a quarter, $500 at 100%, $900 at 120%'} spellCheck={false} />
                </label>
                <button type="button" className="cx-btn cx-btn-sm" disabled={!!busy || !text.trim()} onClick={() => sendJson({ text }, 'Reading…')}>Read it</button>
              </div>
            )}
            {busy && <p className="cxp-note" role="status">{busy} This takes up to a minute.</p>}
          </div>
        ) : (
          <>
            <div className="cxe-sum">
              <span>{items.length} {items.length === 1 ? 'person' : 'people'} from {res.source}</span>
              <span>{items.filter((i) => i.status === 'matched').length} matched</span>
              <span>{items.filter((i) => i.status === 'new').length} new</span>
              {items.some((i) => i.status === 'ambiguous' || i.status === 'problem') && <span>{items.filter((i) => i.status === 'ambiguous' || i.status === 'problem').length} to check</span>}
            </div>
            {res.unreadable.length > 0 && <p className="cxe-muted">Not used: {res.unreadable.slice(0, 5).join(' · ')}</p>}
            <div className="cxe-review">
              {items.length === 0 && <p className="cxp-note">Mira found no people in that. Try a sheet with a name column.</p>}
              {items.map((it) => {
                const skipped = !!skip[it.key]
                return (
                  <div key={it.key} className={`cxe-ritem${skipped ? ' is-skip' : ''}`}>
                    <div className="top">
                      <span className={`cxe-tag is-${it.status}`}>{TAG[it.status]}</span>
                      <b>{it.person?.name ?? 'No name'}{it.match && it.match.name !== it.person?.name ? ` → ${it.match.name}` : ''}</b>
                      {(it.status === 'ambiguous' || it.status === 'matched' || it.candidates.length > 0) && !skipped && (
                        <select className="cxp-input" value={pick[it.key] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [it.key]: e.target.value }))} aria-label="Who this is">
                          <option value="">Pick who…</option>
                          {[...(it.match ? [it.match] : []), ...it.candidates.filter((c) => c.id !== it.match?.id)].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          <option value="new">Someone new</option>
                        </select>
                      )}
                      <button type="button" className="cx-link" onClick={() => setSkip((s) => ({ ...s, [it.key]: !skipped }))}>{skipped ? 'Include' : 'Skip'}</button>
                    </div>
                    {!skipped && it.changes.length > 0 && <ul>{it.changes.slice(0, 8).map((c, i) => <li key={i}>{c}</li>)}</ul>}
                    {!skipped && it.problems.length > 0 && <p className="probs">{it.problems.join(' ')}</p>}
                  </div>
                )
              })}
            </div>
            {err && <p className="cxp-error" role="alert">{err}</p>}
            <footer>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => { setRes(null); setErr(null) }} disabled={!!busy}>Start over</button>
              <button type="button" className="cx-btn cx-btn-sm" onClick={save} disabled={!!busy || keep.length === 0}>{busy ?? `Save ${keep.length} ${keep.length === 1 ? 'person' : 'people'}`}</button>
            </footer>
          </>
        )}
        {!res && err && <p className="cxp-error" role="alert">{err}</p>}
      </div>
    </div>
  )
}
