'use client'

/**
 * Adoption: who is using the suite. One component for the real page
 * (Settings › Adoption, owner and admins only) and the public demo. All the
 * numbers come ready-made from lib/cxoAdoptionShared; this only draws them.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ACTIVE_DAYS_PER_WEEK,
  GROUP_LABEL,
  STATUS_LABEL,
  STATUS_RULES,
  USAGE_ACTIONS,
  lastSeenWords,
  shortDay,
  type AdoptionData,
  type AdoptionGroup,
  type AdoptionPerson,
  type AdoptionStatus,
  type UsageAction,
} from '@/lib/cxoAdoptionShared'
import { BarList, Columns, INK, SILVER, Sparkline } from './charts'
import { Info } from './TeamRetention'
import './adoption.css'

const count = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

function Status({ status }: { status: AdoptionStatus }) {
  return (
    <span className={`cx-adopt-status s-${status}`}>
      <i aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** The last 7 days as dots, oldest first, and the count. */
function Week({ person }: { person: AdoptionPerson }) {
  const last7 = person.spark.slice(-7)
  return (
    <span className="cx-adopt-week" title={`Used on ${person.days7} of the last 7 days`}>
      {last7.map((v, i) => (
        <i key={i} className={v > 0 ? 'on' : undefined} aria-hidden />
      ))}
      <b>{person.days7}</b>
    </span>
  )
}

type GroupFilter = 'all' | AdoptionGroup
type StatusFilter = 'all' | AdoptionStatus
const STATUSES: AdoptionStatus[] = ['not_started', 'slipping', 'active']

export default function AdoptionView({ data, tz = 'UTC' }: { data: AdoptionData; tz?: string }) {
  const [group, setGroup] = useState<GroupFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const groups = useMemo(() => (['exec', 'employee', 'assistant'] as AdoptionGroup[]).filter((g) => data.people.some((p) => p.group === g)), [data.people])
  const inGroup = useMemo(() => data.people.filter((p) => group === 'all' || p.group === group), [data.people, group])
  const shown = inGroup.filter((p) => status === 'all' || p.status === status)
  const open = data.people.find((p) => p.id === openId) ?? null
  const n = (s: AdoptionStatus) => inGroup.filter((p) => p.status === s).length

  const last = data.weeks[data.weeks.length - 1]
  const prev = data.weeks[data.weeks.length - 2]
  const diff = last && prev ? last.active - prev.active : 0
  const labels = data.weeks.map((w) => w.label)

  if (data.total === 0) {
    return (
      <section className="cx-panel">
        <p className="cx-takeaway" style={{ margin: 0 }}>
          No one has a login on this workspace yet. Add people in Settings and they will show up here.
        </p>
      </section>
    )
  }

  return (
    <div className="cx-adopt">
      <div className="cx-grid cx-grid-2">
        <section className="cx-panel">
          <div className="cx-adopt-head">
            <div>
              <div className="cx-eyebrow">Active this week</div>
              <Info text={STATUS_RULES} />
            </div>
          </div>
          <div className="cx-adopt-hero" style={{ marginTop: 8 }}>
            <p className="cx-figure cx-figure-hero">{data.pct}%</p>
            <p className="cx-kpi-sub" style={{ margin: 0 }}>
              {count(data.active)} of {plural(data.total, 'person', 'people')}
              {prev ? (
                <>
                  {' · '}
                  <span className={`cx-delta ${diff > 0 ? 'cx-delta-up' : diff < 0 ? 'cx-delta-down' : 'cx-delta-flat'}`}>
                    {diff === 0 ? 'same as last week' : `${Math.abs(diff)} vs last week`}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="cx-adopt-split" role="img" aria-label={`${data.active} active, ${data.slipping} slipping, ${data.not_started} not started`}>
            {(['active', 'slipping', 'not_started'] as AdoptionStatus[]).map((s) => (data[s] > 0 ? <span key={s} className={`s-${s}`} style={{ flex: data[s] }} /> : null))}
          </div>
          <ul className="cx-adopt-key">
            <li><b>{count(data.active)}</b> active</li>
            <li><b>{count(data.slipping)}</b> slipping</li>
            <li><b>{count(data.not_started)}</b> not started</li>
          </ul>
        </section>

        <section className="cx-panel">
          <div className="cx-adopt-head">
            <div>
              <div className="cx-eyebrow">Active people · by week</div>
              <Info text={`People who used the suite on ${ACTIVE_DAYS_PER_WEEK} or more days in each 7-day stretch. The last bar is the 7 days ending today.`} />
            </div>
          </div>
          <Columns
            labels={labels}
            series={[{ key: 'active', label: 'Active people', values: data.weeks.map((w) => w.active), color: INK }]}
            height={170}
            format={count}
            valueLabels
            ariaLabel="Active people per week, last 12 weeks"
          />
        </section>

        <section className="cx-panel">
          <div className="cx-adopt-head">
            <div className="cx-eyebrow">Mira questions · by week</div>
            <div className="cx-kpi-sub" style={{ margin: 0 }}>{count(last?.mira ?? 0)} this week</div>
          </div>
          <Columns
            labels={labels}
            series={[{ key: 'mira', label: 'Mira questions', values: data.weeks.map((w) => w.mira), color: SILVER }]}
            height={170}
            format={count}
            valueLabels
            ariaLabel="Mira questions per week, last 12 weeks"
          />
        </section>

        <section className="cx-panel">
          <div className="cx-adopt-head">
            <div>
              <div className="cx-eyebrow">Most used pages · last 30 days</div>
              <Info text="Counted once per person per day. One person opening Boards on five days counts five." />
            </div>
          </div>
          <BarList rows={data.top_pages.map((p) => ({ label: p.name, value: p.value }))} format={count} max={6} empty="No pages opened yet." />
        </section>
      </div>

      <section className="cx-panel">
        <div className="cx-adopt-head">
          <div>
            <h2 className="cx-section-title">People</h2>
            <Info text={STATUS_RULES} />
          </div>
          {groups.length > 1 && (
            <span className="cx-seg" role="group" aria-label="Who">
              <button type="button" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>Everyone</button>
              {groups.map((g) => (
                <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{GROUP_LABEL[g]}</button>
              ))}
            </span>
          )}
        </div>
        <div className="cx-adopt-head" style={{ marginTop: 10 }}>
          <span className="cx-seg" role="group" aria-label="Status">
            <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All {inGroup.length}</button>
            {STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]} {n(s)}</button>
            ))}
          </span>
        </div>

        {shown.length === 0 ? (
          <p className="cx-takeaway">No one here.</p>
        ) : (
          <table className="cx-adopt-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th className="c-seen">Last seen</th>
                <th>Last 7 days</th>
                <th className="num c-30">Days of 30</th>
                <th className="num c-mira">Mira</th>
                <th className="c-page">Top page</th>
                <th className="c-spark">30 days</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} onClick={() => setOpenId(p.id)}>
                  <td>
                    <button
                      type="button"
                      className="cx-adopt-who"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenId(p.id)
                      }}
                      aria-label={`${p.name}: day by day`}
                    >
                      <strong>{p.name}</strong>
                      <small>{p.title}</small>
                      <small className="seen">Last seen: {lastSeenWords(p.last_seen, data.today, tz)}</small>
                    </button>
                  </td>
                  <td><Status status={p.status} /></td>
                  <td className="c-seen">{p.last_seen ? lastSeenWords(p.last_seen, data.today, tz) : <span className="cx-adopt-none">Never</span>}</td>
                  <td><Week person={p} /></td>
                  <td className="num c-30">{p.days30}</td>
                  <td className="num c-mira">{count(p.mira30)}</td>
                  <td className="c-page">{p.top_page ?? <span className="cx-adopt-none">None yet</span>}</td>
                  <td className="c-spark">{p.days30 > 0 ? <Sparkline values={p.spark} height={28} color={p.status === 'slipping' ? 'var(--cx-error)' : INK} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open && <Drawer person={open} today={data.today} tz={tz} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Drawer({ person, today, tz, onClose }: { person: AdoptionPerson; today: string; tz: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const peak = Math.max(1, ...person.spark)
  const first = new Date(Date.parse(today + 'T12:00:00Z') - 29 * 86_400_000).toISOString().slice(0, 10)

  return (
    <div className="cx-adopt-scrim" onClick={onClose}>
      <aside className="cx-adopt-drawer" role="dialog" aria-modal="true" aria-label={`${person.name}: activity`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{person.name}</h2>
            <p>{person.title}</p>
            <Status status={person.status} />
          </div>
          <button type="button" className="cx-adopt-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="cx-adopt-figs">
          <div>
            <div className="cx-kpi-figure">{lastSeenWords(person.last_seen, today, tz)}</div>
            <div className="cx-kpi-sub">last seen</div>
          </div>
          <div>
            <div className="cx-kpi-figure">{person.days7}</div>
            <div className="cx-kpi-sub">days of last 7</div>
          </div>
          <div>
            <div className="cx-kpi-figure">{person.days30}</div>
            <div className="cx-kpi-sub">days of last 30</div>
          </div>
          <div>
            <div className="cx-kpi-figure">{count(person.mira30)}</div>
            <div className="cx-kpi-sub">Mira questions</div>
          </div>
        </div>

        <div className="cx-eyebrow cx-adopt-h">Last 30 days</div>
        <div className="cx-adopt-strip" role="img" aria-label={`Active on ${person.days30} of the last 30 days`}>
          {person.spark.map((v, i) => (
            <span key={i} className={v > 0 ? undefined : 'off'} style={{ height: v > 0 ? `${Math.max(14, (v / peak) * 100)}%` : 2 }} />
          ))}
        </div>
        <div className="cx-adopt-strip-ends">
          <span>{shortDay(first)}</span>
          <span>Today</span>
        </div>

        {person.days30 === 0 ? (
          <p className="cx-takeaway">{person.last_seen ? 'Nothing in the last 30 days.' : 'Has not signed in yet.'}</p>
        ) : (
          <>
            {person.actions.length > 0 && (
              <>
                <div className="cx-eyebrow cx-adopt-h">What they did</div>
                <ul className="cx-adopt-did">
                  {person.actions.map((a) => (
                    <li key={a.key}><b>{count(a.count)}</b> {a.label.toLowerCase()}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="cx-eyebrow cx-adopt-h">Pages · days opened</div>
            <BarList rows={person.pages.map((p) => ({ label: p.name, value: p.days }))} format={count} max={8} empty="No pages opened." />

            <div className="cx-eyebrow cx-adopt-h">Day by day</div>
            <ul className="cx-adopt-days">
              {person.days.map((d) => {
                const did = (Object.keys(d.actions) as UsageAction[])
                  .filter((k) => (d.actions[k] ?? 0) > 0)
                  .map((k) => `${count(d.actions[k] ?? 0)} ${USAGE_ACTIONS[k].toLowerCase()}`)
                const head = [d.sessions > 0 ? plural(d.sessions, 'visit') : d.signed_in ? 'Signed in' : null, d.mira > 0 ? plural(d.mira, 'Mira question') : null, ...did].filter(Boolean)
                return (
                  <li key={d.day}>
                    <time dateTime={d.day}>{d.day === today ? 'Today' : shortDay(d.day)}</time>
                    <div>
                      {head.length ? head.join(' · ') : 'Opened the suite'}
                      {d.pages.length > 0 && <small>{d.pages.join(', ')}</small>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}
