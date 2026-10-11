'use client'

/**
 * Praise, 1:1s and goals (owner 10-11): one hub used by the Employees page
 * (execs), an employee's own page, and /cxo/demo (in memory). It only shows
 * what the server sent for this viewer; every button goes back through
 * `api.act`, which the server re-checks. Black/silver tokens, no new palette.
 */
import { useCallback, useEffect, useState } from 'react'
import { AttainBar, Ring, pctOf } from './EmployeeVisuals'
import {
  CADENCES,
  CADENCE_WORDS,
  GOAL_STATUS_WORDS,
  dayWords,
  fmtGoalValue,
  type Cadence,
  type GoalUnit,
  type GoalView,
  type ItemKind,
  type ItemView,
  type PeopleAction,
  type PeopleApi,
  type PeopleHubData,
  type PersonView,
  type PraiseView,
} from '@/lib/people/shared'
import './cxo-plan.css'
import './cxo-people.css'

/** The live API. The demo passes its own in-memory one. */
export const peopleFetchApi: PeopleApi = {
  async load() {
    const r = await fetch('/api/people', { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) throw new Error(j?.error || 'Could not load that just now.')
    return j as PeopleHubData
  },
  async act(a) {
    const r = await fetch('/api/people', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })
    const j = await r.json().catch(() => null)
    if (!r.ok) throw new Error(j?.error || 'That did not go through.')
    return { note: j?.note as string | undefined }
  },
  async leave(employeeId, body) {
    const r = await fetch('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'send', to_employee: employeeId, body }) })
    const j = await r.json().catch(() => null)
    if (!r.ok) throw new Error(j?.error || 'That did not go through.')
  },
}

type Section = 'people' | 'praise'
type Run = (a: PeopleAction) => Promise<boolean>

export default function PeopleHub({ api = peopleFetchApi, initial = null, show = ['people', 'praise'], hideOwnQuotas = false }: { api?: PeopleApi; initial?: PeopleHubData | null; show?: Section[]; /** The page above already shows the viewer's quotas. */ hideOwnQuotas?: boolean }) {
  const [data, setData] = useState<PeopleHubData | null>(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await api.load())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load that just now.')
    }
  }, [api])
  useEffect(() => {
    setOpenId(null)
    void reload()
  }, [reload])

  const run: Run = async (a) => {
    setBusy(true)
    setErr(null)
    setNote(null)
    try {
      const out = await api.act(a)
      if (out.note) setNote(out.note)
      await reload()
      if (a.action === 'item_add' && a.kind === 'action') window.dispatchEvent(new Event('cxo:todos'))
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not go through.')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="cxh">{err ? <p className="cxp-error">{err}</p> : <p className="cxp-note">Loading…</p>}</div>

  const people = data.people
  const only = people.length === 1 ? people[0] : null
  const open = only ?? people.find((p) => p.id === openId) ?? null
  const overdue = people.filter((p) => p.one_on_one?.overdue).length

  return (
    <div className="cxh" aria-busy={busy}>
      {!data.ready && (
        <section className="cx-panel">
          <p className="cxp-note" style={{ margin: 0 }}>Praise and 1:1s are being switched on for your company. Goals from existing quotas show now; the rest appears here shortly.</p>
        </section>
      )}
      {err && <p className="cxp-error" role="alert">{err}</p>}
      {note && <p className="cxp-ok" role="status">{note}</p>}

      {show.includes('people') &&
        (open ? (
          <PersonPage key={open.id} p={open} data={data} run={run} busy={busy} leave={api.leave} onBack={only ? null : () => setOpenId(null)} hideQuotas={hideOwnQuotas && open.is_self} />
        ) : people.length === 0 ? (
          data.viewer.employee_only ? null : (
            <section className="cx-panel">
              <div className="cxp-head"><h2>1:1s and goals</h2></div>
              <p className="cxp-note">Nobody to show yet. You see yourself and the people who report to you, so your login needs to be linked to your employee record on the People tab.</p>
            </section>
          )
        ) : (
          <section className="cx-panel">
            <div className="cxp-head">
              <h2>{data.viewer.sees_everyone ? 'Everyone' : 'You and your team'}</h2>
              <p>{overdue > 0 ? `${overdue} overdue ${overdue === 1 ? '1:1' : '1:1s'}` : 'No 1:1s overdue'}</p>
            </div>
            <div className="cxh-list">
              <div className="cxh-listhead" aria-hidden>
                <span>Person</span>
                <span>Goals</span>
                <span>Last 1:1</span>
                <span>Next 1:1</span>
                <span className="n">Praise 30d</span>
                <span className="n">Cards</span>
              </div>
              {people.map((p) => (
                <button key={p.id} type="button" className="cxh-row" onClick={() => setOpenId(p.id)}>
                  <span className="who">
                    <b>{p.name}{p.is_self ? ' (you)' : ''}</b>
                    <small>{[p.title, p.department].filter(Boolean).join(' · ') || ' '}</small>
                  </span>
                  <span className="att">
                    <AttainBar att={p.att} />
                    <b>{p.att == null ? '—' : pctOf(p.att)}</b>
                  </span>
                  <span className="when last"><span className="lbl">Last 1:1</span>{p.one_on_one?.last_date ? dayWords(p.one_on_one.last_date) : 'None yet'}</span>
                  <span className="when next">
                    <span className="lbl">Next 1:1</span>
                    {p.one_on_one?.next_date ? dayWords(p.one_on_one.next_date) : 'Not set'}
                    {p.one_on_one?.overdue && <span className="cxh-pill is-solid">Overdue</span>}
                  </span>
                  <span className="n praise"><span className="lbl">Praise 30d</span>{p.praise_30}</span>
                  <span className="n cards"><span className="lbl">Open cards</span>{p.has_login ? p.open_cards : '—'}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

      {show.includes('praise') && <PraisePanel data={data} run={run} busy={busy} />}
    </div>
  )
}

// ── Praise ──────────────────────────────────────────────────────────────────

const ago = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso))

export function PraiseFeed({ rows, empty }: { rows: PraiseView[]; empty: string }) {
  if (!rows.length) return <p className="cxh-empty">{empty}</p>
  return (
    <ul className="cxh-feed">
      {rows.map((r) => (
        <li key={r.id}>
          <p className="meta">
            <span><b>{r.from_name}</b> praised <b>{r.to_name}</b></span>
            {r.value && <span className="cxh-pill is-line">{r.value}</span>}
            <time dateTime={r.created_at}>{ago(r.created_at)}</time>
          </p>
          <p className="body">{r.body}</p>
        </li>
      ))}
    </ul>
  )
}

function PraiseForm({ data, run, busy, to, onDone }: { data: PeopleHubData; run: Run; busy: boolean; to?: PersonView | null; onDone?: () => void }) {
  const others = data.directory.filter((d) => d.id !== data.viewer.employee_id)
  const [who, setWho] = useState(to?.id ?? '')
  const [value, setValue] = useState<string | null>(null)
  const [body, setBody] = useState('')
  async function send() {
    if (!who || !body.trim()) return
    if (await run({ action: 'praise', to_employee_id: who, body, value })) {
      setBody('')
      setValue(null)
      if (!to) setWho('')
      onDone?.()
    }
  }
  return (
    <div className="cxh-praiseform">
      <div className="row">
        {!to && (
          <label className="cxp-field">
            Who
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Pick a colleague</option>
              {others.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.title ? `, ${d.title}` : ''}</option>
              ))}
            </select>
          </label>
        )}
        <label className="cxp-field" style={{ flex: '2 1 280px' }}>
          {to ? `What did ${to.name.split(' ')[0]} do well?` : 'What did they do well?'}
          <textarea value={body} maxLength={600} onChange={(e) => setBody(e.target.value)} placeholder="A sentence or two is plenty." />
        </label>
      </div>
      <div className="row">
        <span className="cxh-values" role="group" aria-label="Company value (optional)">
          {data.values.map((v) => (
            <button key={v} type="button" aria-pressed={value === v} onClick={() => setValue(value === v ? null : v)}>{v}</button>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        {onDone && <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={onDone}>Cancel</button>}
        <button type="button" className="cx-btn cx-btn-sm" disabled={busy || !who || !body.trim()} onClick={() => void send()}>Post praise</button>
      </div>
    </div>
  )
}

function PraisePanel({ data, run, busy }: { data: PeopleHubData; run: Run; busy: boolean }) {
  return (
    <section className="cx-panel" id="praise">
      <div className="cxp-head">
        <h2>Praise</h2>
        <p>The whole company sees this.</p>
      </div>
      {data.ready && data.directory.length > 0 && <PraiseForm data={data} run={run} busy={busy} />}
      <PraiseFeed rows={data.praise} empty="No praise yet. Be the first to call out good work." />
    </section>
  )
}

// ── One person ──────────────────────────────────────────────────────────────

const GOAL_PILL: Record<GoalView['status'], string> = { done: 'is-solid', on_track: 'is-line', behind: 'is-dash', overdue: 'is-dash', no_data: '' }

function GoalCard({ g, canEdit, canProgress, onEdit, onProgress }: { g: GoalView; canEdit: boolean; canProgress: boolean; onEdit: () => void; onProgress: (n: number) => void }) {
  const [val, setVal] = useState<string | null>(null)
  return (
    <article className="cxh-goal">
      <Ring value={g.att} size={54} stroke={6} label={`${g.title}: ${g.att == null ? 'no numbers yet' : pctOf(g.att)}`} />
      <div className="what">
        <h4>{g.title}</h4>
        <p className="nums"><b>{fmtGoalValue(g.unit, g.current)}</b> of {fmtGoalValue(g.unit, g.target)}</p>
        <AttainBar att={g.att} />
        <div className="foot">
          <span className={`cxh-pill ${GOAL_PILL[g.status]}`}>{GOAL_STATUS_WORDS[g.status]}</span>
          {g.due && <span>{g.source === 'quota' ? g.due : `Due ${g.due}`}</span>}
          {g.source === 'quota' && <span>Quota</span>}
          {g.source === 'goal' && canProgress && val == null && <button type="button" className="cxh-link" onClick={() => setVal(String(g.current ?? 0))}>Update</button>}
          {g.source === 'goal' && canEdit && val == null && <button type="button" className="cxh-link" onClick={onEdit}>Edit</button>}
        </div>
        {val != null && (
          <div className="cxh-add">
            <input type="number" inputMode="decimal" value={val} aria-label="Where it stands now" onChange={(e) => setVal(e.target.value)} />
            <button type="button" className="cx-btn cx-btn-sm" onClick={() => { onProgress(Number(val)); setVal(null) }}>Save</button>
          </div>
        )}
      </div>
    </article>
  )
}

type GoalDraft = { id: string | null; title: string; unit: GoalUnit; target: string; current: string; due_date: string }
const blankGoal: GoalDraft = { id: null, title: '', unit: 'count', target: '', current: '0', due_date: '' }

function PersonPage({ p, data, run, busy, leave, onBack, hideQuotas }: { p: PersonView; data: PeopleHubData; run: Run; busy: boolean; leave?: PeopleApi['leave']; onBack: (() => void) | null; hideQuotas: boolean }) {
  const [leaving, setLeaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [leaveNote, setLeaveNote] = useState<string | null>(null)
  async function leaveIt() {
    if (!leave || !msg.trim()) return
    setLeaveNote(null)
    try {
      await leave(p.id, msg.trim())
      setMsg('')
      setLeaving(false)
      setLeaveNote(`Left with Mira for ${p.name.split(' ')[0]}. What happens to it shows under Sent in your Messages.`)
    } catch (e) {
      setLeaveNote(e instanceof Error ? e.message : 'That did not go through.')
    }
  }
  const oo = p.one_on_one
  const first = p.name.split(' ')[0]
  const [praising, setPraising] = useState(false)
  const [setup, setSetup] = useState(false)
  const [cadence, setCadence] = useState<Cadence>(oo?.cadence ?? 'biweekly')
  const [nextDate, setNextDate] = useState(oo?.next_date ?? '')
  const [time, setTime] = useState('10:00')
  const [onCal, setOnCal] = useState(false)
  const [goal, setGoal] = useState<GoalDraft | null>(null)
  const goals = hideQuotas ? p.goals.filter((g) => g.source === 'goal') : p.goals
  const received = data.praise.filter((r) => r.to_employee_id === p.id).slice(0, 5)
  const items = (k: ItemKind) => (oo?.items ?? []).filter((i) => i.kind === k)
  const add = (kind: ItemKind, body: string, owner?: 'employee' | 'manager') => run({ action: 'item_add', employee_id: p.id, kind, body, owner })
  const ready = data.ready

  return (
    <>
      <section className="cx-panel">
        {onBack && <button type="button" className="cxh-link" onClick={onBack} style={{ marginBottom: 10 }}>← Back to the list</button>}
        <div className="cxh-hero">
          <Ring value={p.att} size={84} stroke={8} sub="of goals" label={p.att == null ? 'No numbers yet' : `${pctOf(p.att)} of goals`} />
          <div className="who">
            <h2>{p.is_self ? `${p.name} (you)` : p.name}</h2>
            <p>{[p.title, p.department, p.manager_name ? `reports to ${p.manager_name}` : null].filter(Boolean).join(' · ') || ' '}</p>
          </div>
          {!p.is_self && ready && <button type="button" className="cx-btn cx-btn-sm" onClick={() => setPraising((x) => !x)}>Give praise</button>}
          {!p.is_self && p.has_login && leave && <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={() => setLeaving((x) => !x)}>Leave a message</button>}
        </div>
        {leaving && (
          <div className="cxp-form" style={{ marginTop: 10 }}>
            <label className="cxp-field" style={{ flex: '1 1 260px' }}>
              Message for {first}
              <textarea rows={2} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Mira sorts it for them and tells you what happens to it." />
            </label>
            <button type="button" className="cx-btn cx-btn-sm" disabled={!msg.trim()} onClick={() => void leaveIt()}>Leave it with Mira</button>
          </div>
        )}
        {leaveNote && <p className="cxp-ok" role="status">{leaveNote}</p>}
        {praising && <PraiseForm data={data} run={run} busy={busy} to={p} onDone={() => setPraising(false)} />}

        <div className="cxp-head" style={{ marginTop: 18 }}>
          <h2>Goals</h2>
          {p.can_manage && ready && !goal && <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={() => setGoal(blankGoal)}>Add a goal</button>}
        </div>
        {goals.length === 0 && !goal ? (
          <p className="cxh-empty">{hideQuotas ? 'No extra goals beyond your quotas above.' : p.can_manage ? 'No goals yet. Add one, or set a quota on the People tab.' : 'No goals set yet.'}</p>
        ) : (
          <div className="cxh-goals">
            {goals.map((g) => (
              <GoalCard
                key={g.id}
                g={g}
                canEdit={p.can_manage && ready}
                canProgress={ready}
                onEdit={() => setGoal({ id: g.id, title: g.title, unit: (g.unit === 'usd' || g.unit === 'pct' ? g.unit : 'count') as GoalUnit, target: String(g.target), current: String(g.current ?? 0), due_date: g.due_date ?? '' })}
                onProgress={(n) => void run({ action: 'goal_progress', employee_id: p.id, id: g.id, current: n })}
              />
            ))}
          </div>
        )}
        {goal && (
          <div className="cxp-form" style={{ marginTop: 10 }}>
            <label className="cxp-field" style={{ flex: '2 1 200px' }}>Goal<input value={goal.title} maxLength={200} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="e.g. Contract 12 new agents" /></label>
            <label className="cxp-field" style={{ flex: '0 1 110px' }}>Measured in
              <select value={goal.unit} onChange={(e) => setGoal({ ...goal, unit: e.target.value as GoalUnit })}>
                <option value="count">Number</option>
                <option value="usd">Dollars</option>
                <option value="pct">Percent</option>
              </select>
            </label>
            <label className="cxp-field" style={{ flex: '0 1 100px' }}>Target<input type="number" inputMode="decimal" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} /></label>
            <label className="cxp-field" style={{ flex: '0 1 100px' }}>Now<input type="number" inputMode="decimal" value={goal.current} onChange={(e) => setGoal({ ...goal, current: e.target.value })} /></label>
            <label className="cxp-field" style={{ flex: '0 1 150px' }}>Due<input type="date" value={goal.due_date} onChange={(e) => setGoal({ ...goal, due_date: e.target.value })} /></label>
            <button type="button" className="cx-btn cx-btn-sm" disabled={busy || !goal.title.trim() || !(Number(goal.target) > 0)} onClick={async () => { if (await run({ action: 'goal_save', employee_id: p.id, id: goal.id, title: goal.title, unit: goal.unit, target: Number(goal.target), current: Number(goal.current) || 0, due_date: goal.due_date || null })) setGoal(null) }}>Save goal</button>
            {goal.id && <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled={busy} onClick={async () => { if (await run({ action: 'goal_remove', employee_id: p.id, id: goal.id! })) setGoal(null) }}>Remove</button>}
            <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={() => setGoal(null)}>Cancel</button>
          </div>
        )}
      </section>

      <section className="cx-panel">
        <div className="cxp-head">
          <h2>1:1{p.is_self ? (oo?.manager_name ? ` with ${oo.manager_name}` : '') : ` with ${first}`}</h2>
          <span className="cxp-bar">
            {oo && (p.can_manage || oo.manager_member_id === data.viewer.member_id) && ready && <button type="button" className="cx-btn cx-btn-sm" disabled={busy} onClick={() => void run({ action: 'oo_done', employee_id: p.id })}>Mark this 1:1 done</button>}
            {p.can_manage && ready && <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={() => setSetup((x) => !x)}>{oo ? 'Change' : 'Set up a 1:1'}</button>}
          </span>
        </div>
        {oo ? (
          <div className="cxh-facts">
            <div className="cxh-fact"><p>Next</p><b>{dayWords(oo.next_date)}</b><small>{oo.overdue ? <span className="cxh-pill is-solid">Overdue</span> : oo.on_calendar ? 'On the calendar' : ' '}</small></div>
            <div className="cxh-fact"><p>Last</p><b>{oo.last_date ? dayWords(oo.last_date) : 'None yet'}</b><small> </small></div>
            <div className="cxh-fact"><p>How often</p><b>{CADENCE_WORDS[oo.cadence]}</b><small>{oo.manager_name ? `with ${oo.manager_name}` : ' '}</small></div>
            <div className="cxh-fact"><p>Praise, 30 days</p><b>{p.praise_30}</b><small>received</small></div>
          </div>
        ) : (
          <p className="cxh-empty">{p.can_manage ? `No 1:1 with ${first} yet. Set one up to share an agenda.` : 'No 1:1 set up yet. Your manager sets how often you meet.'}</p>
        )}
        {setup && (
          <div className="cxp-form" style={{ marginTop: 10 }}>
            <label className="cxp-field">How often
              <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_WORDS[c]}</option>)}
              </select>
            </label>
            <label className="cxp-field">Next date<input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></label>
            {data.calendar_ready && (
              <>
                <label className="cxp-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}>
                  <input type="checkbox" checked={onCal} onChange={(e) => setOnCal(e.target.checked)} style={{ width: 16, height: 16, minHeight: 0 }} />
                  Put it on my calendar
                </label>
                {onCal && <label className="cxp-field">Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>}
              </>
            )}
            <button type="button" className="cx-btn cx-btn-sm" disabled={busy} onClick={async () => { if (await run({ action: 'oo_save', employee_id: p.id, cadence, next_date: nextDate || null, time, calendar: onCal && !!nextDate })) setSetup(false) }}>Save</button>
          </div>
        )}

        {oo && (
          <div className="cxh-cols">
            <ItemBlock title="Agenda" hint="Either of you can add a talking point." rows={items('agenda')} placeholder="Add a talking point" checkable ready={ready} run={run} p={p} onAdd={(b) => add('agenda', b)} viewerId={data.viewer.member_id} />
            <ItemBlock
              title="Action items"
              hint="Each one lands in its owner's to-dos."
              rows={items('action')}
              placeholder="Who will do what"
              checkable
              ready={ready}
              run={run}
              p={p}
              owners={[{ key: 'employee', label: first }, { key: 'manager', label: (oo.manager_name ?? 'Manager').split(' ')[0] }]}
              onAdd={(b, o) => add('action', b, o)}
              viewerId={data.viewer.member_id}
            />
            <ItemBlock title="Notes" hint="What was said. Both of you see these." rows={items('note')} placeholder="Add a note" ready={ready} run={run} p={p} onAdd={(b) => add('note', b)} viewerId={data.viewer.member_id} />
            {oo.sees_feedback && (
              <ItemBlock title="Private feedback" hint={`Only ${p.is_self ? 'you' : first}, ${oo.manager_name && oo.manager_member_id !== data.viewer.member_id ? oo.manager_name : p.is_self ? 'your manager' : 'you'} and the company admins see this.`} rows={items('feedback')} placeholder="Add private feedback" ready={ready} run={run} p={p} onAdd={(b) => add('feedback', b)} viewerId={data.viewer.member_id} />
            )}
          </div>
        )}
      </section>

      <section className="cx-panel">
        <div className="cxh-cols" style={{ marginTop: 0 }}>
          <div className="cxh-block">
            <h3>Praise received</h3>
            <PraiseFeed rows={received} empty="None yet." />
          </div>
          <div className="cxh-block">
            <h3>Open project cards</h3>
            {!p.has_login ? (
              <p className="cxh-empty">{first} has no login yet, so no cards are assigned.</p>
            ) : p.cards.length === 0 ? (
              <p className="cxh-empty">Nothing open on the boards.</p>
            ) : (
              <ul className="cxh-items">
                {p.cards.map((c) => (
                  <li key={c.id}>
                    <span className="t">{c.title}<small>{c.board}{c.due_date ? ` · due ${dayWords(c.due_date)}` : ''}</small></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

function ItemBlock({ title, hint, rows, placeholder, checkable, owners, ready, run, p, onAdd, viewerId }: { title: string; hint: string; rows: ItemView[]; placeholder: string; checkable?: boolean; owners?: Array<{ key: 'employee' | 'manager'; label: string }>; ready: boolean; run: Run; p: PersonView; onAdd: (body: string, owner?: 'employee' | 'manager') => Promise<boolean>; viewerId: string }) {
  const [text, setText] = useState('')
  const [owner, setOwner] = useState<'employee' | 'manager'>('employee')
  async function submit() {
    if (!text.trim()) return
    if (await onAdd(text, owners ? owner : undefined)) setText('')
  }
  return (
    <div className="cxh-block">
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      {rows.length > 0 && (
        <ul className="cxh-items">
          {rows.map((i) => (
            <li key={i.id} className={i.done_at ? 'is-done' : ''}>
              {checkable && <input type="checkbox" checked={!!i.done_at} aria-label={`Done: ${i.body}`} onChange={(e) => void run({ action: 'item_toggle', employee_id: p.id, id: i.id, done: e.target.checked })} />}
              <span className="t">
                {i.body}
                <small>{[i.owner_name ? `Owner: ${i.owner_name}` : null, i.author_name ? `added by ${i.author_name}` : null].filter(Boolean).join(' · ')}</small>
              </span>
              {(i.author_member_id === viewerId || p.can_manage) && <button type="button" className="x" aria-label={`Remove: ${i.body}`} onClick={() => void run({ action: 'item_remove', employee_id: p.id, id: i.id })}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {ready && (
        <div className="cxh-add">
          <input value={text} maxLength={2000} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          {owners && (
            <select value={owner} aria-label="Owner" onChange={(e) => setOwner(e.target.value as 'employee' | 'manager')}>
              {owners.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          )}
          <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled={!text.trim()} onClick={() => void submit()}>Add</button>
        </div>
      )}
    </div>
  )
}
