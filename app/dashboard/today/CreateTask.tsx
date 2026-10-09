'use client'

import { useEffect, useRef, useState } from 'react'
import type { TodoPriority } from '@/lib/today'
import type { Pickers } from '@/lib/todayMira'
import { KIND_LABEL, KindIcon, type AnyKind } from './kinds'

type LinkKind = 'partner' | 'agent' | 'meeting' | 'card'
type Agent = { name: string; team: string | null; phone: string | null; email: string | null }

const KINDS: AnyKind[] = ['email', 'call', 'prep', 'team', 'project', 'personal']
/** The link each type needs for its one-tap action. */
const LINK_FOR: Partial<Record<AnyKind, LinkKind>> = { email: 'partner', call: 'partner', prep: 'meeting', team: 'agent' }

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dueChoices() {
  const t = new Date()
  const tomorrow = new Date(t.getTime() + 86_400_000)
  const friday = new Date(t)
  friday.setDate(t.getDate() + ((5 - t.getDay() + 7) % 7 || 7))
  return { today: ymd(t), tomorrow: ymd(tomorrow), week: ymd(friday) }
}

export default function CreateTask({ onClose, onCreate }: { onClose: () => void; onCreate: (body: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<AnyKind>('task')
  const [priority, setPriority] = useState<TodoPriority>('normal')
  const [due, setDue] = useState<string>('')
  const [dueMode, setDueMode] = useState<'none' | 'today' | 'tomorrow' | 'week' | 'date'>('none')
  const [assignee, setAssignee] = useState('')
  const [linkKind, setLinkKind] = useState<LinkKind | ''>('')
  const [linkId, setLinkId] = useState('')
  const [agentQ, setAgentQ] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [agent, setAgent] = useState<Agent | null>(null)
  const [pick, setPick] = useState<Pickers | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    fetch('/api/today?pickers=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setPick(j as Pickers))
      .catch(() => setPick({ partners: [], meetings: [], cards: [] }))
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  useEffect(() => {
    if (linkKind !== 'agent' || agentQ.trim().length < 2) return setAgents([])
    const t = setTimeout(() => {
      fetch(`/api/today?agents=${encodeURIComponent(agentQ.trim())}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => setAgents((j as { agents?: Agent[] }).agents ?? []))
        .catch(() => setAgents([]))
    }, 220)
    return () => clearTimeout(t)
  }, [agentQ, linkKind])

  const chooseKind = (k: AnyKind) => {
    setKind(k)
    const want = LINK_FOR[k]
    if (want && !linkKind) setLinkKind(want)
  }
  const chooseDue = (m: typeof dueMode) => {
    setDueMode(m)
    const c = dueChoices()
    setDue(m === 'today' ? c.today : m === 'tomorrow' ? c.tomorrow : m === 'week' ? c.week : m === 'none' ? '' : due)
  }

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setErr(null)
    const body: Record<string, unknown> = { op: 'add', body: title.trim(), kind, priority, due_date: due || null }
    const partner = pick?.partners.find((p) => p.id === assignee)
    if (partner) Object.assign(body, { assignee_partner_id: partner.id, assignee_name: partner.name })
    if (linkKind === 'partner') {
      const p = pick?.partners.find((x) => x.id === linkId)
      if (p) Object.assign(body, { link_kind: 'partner', link_id: p.id, link_label: p.name, link_phone: p.phone, link_email: p.email })
    } else if (linkKind === 'agent' && agent) {
      Object.assign(body, { link_kind: 'agent', link_id: agent.name, link_label: agent.name, link_phone: agent.phone, link_email: agent.email, link_url: '/dashboard/pinnacle' })
    } else if (linkKind === 'meeting') {
      const m = pick?.meetings.find((x) => x.id === linkId)
      if (m) Object.assign(body, { link_kind: 'meeting', link_id: m.id, link_label: m.title, link_url: m.url })
    } else if (linkKind === 'card') {
      const c = pick?.cards.find((x) => x.id === linkId)
      if (c) Object.assign(body, { link_kind: 'card', link_id: c.id, link_label: c.title, link_url: c.url })
    }
    if (kind === 'team' && !body.link_url) body.link_url = '/dashboard/pinnacle'
    try {
      await onCreate(body)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not save.')
      setSaving(false)
    }
  }

  const when = (iso: string, allDay: boolean) =>
    new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleString('en-US', allDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="cx-dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cx-dialog cx-task-dialog" role="dialog" aria-modal="true" aria-labelledby="cx-task-title">
        <h2 id="cx-task-title">Create task</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="cx-dialog-field">
            Title
            <input ref={inputRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send Dustin the Q4 numbers" />
          </label>

          <fieldset className="cx-task-field">
            <legend>Type</legend>
            <div className="cx-task-chips">
              {KINDS.map((k) => (
                <button key={k} type="button" className={`cx-task-chip${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => chooseKind(kind === k ? 'task' : k)}>
                  <KindIcon kind={k} size={14} />
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {kind === 'project' && <p className="cx-task-hint">Goes on your To-do board as a card.</p>}
          </fieldset>

          <div className="cx-task-row">
            <fieldset className="cx-task-field">
              <legend>Priority</legend>
              <div className="cx-task-seg">
                {(['high', 'normal', 'low'] as const).map((p) => (
                  <button key={p} type="button" className={priority === p ? 'is-on' : ''} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                    {p === 'high' && <i className="cx-dot" aria-hidden />}
                    {p[0].toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </fieldset>
            {kind !== 'project' && (
              <fieldset className="cx-task-field">
                <legend>Due</legend>
                <div className="cx-task-seg">
                  {(['today', 'tomorrow', 'week'] as const).map((m) => (
                    <button key={m} type="button" className={dueMode === m ? 'is-on' : ''} aria-pressed={dueMode === m} onClick={() => chooseDue(dueMode === m ? 'none' : m)}>
                      {m === 'week' ? 'This week' : m[0].toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                  <input
                    type="date"
                    aria-label="Due date"
                    value={dueMode === 'date' ? due : ''}
                    onChange={(e) => {
                      setDueMode(e.target.value ? 'date' : 'none')
                      setDue(e.target.value)
                    }}
                  />
                </div>
              </fieldset>
            )}
          </div>

          <div className="cx-task-row">
            <label className="cx-dialog-field">
              Assignee
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Me</option>
                {pick?.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.org ? ` · ${p.org}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {kind !== 'project' && (
              <label className="cx-dialog-field">
                Link to
                <select
                  value={linkKind}
                  onChange={(e) => {
                    setLinkKind(e.target.value as LinkKind | '')
                    setLinkId('')
                    setAgent(null)
                  }}
                >
                  <option value="">Nothing</option>
                  <option value="partner">A partner</option>
                  <option value="agent">An agent</option>
                  <option value="meeting">A meeting</option>
                  <option value="card">A board card</option>
                </select>
              </label>
            )}
          </div>

          {kind !== 'project' && linkKind === 'partner' && (
            <label className="cx-dialog-field">
              Partner
              <select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                <option value="">Pick a partner</option>
                {pick?.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.org ? ` · ${p.org}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind !== 'project' && linkKind === 'meeting' && (
            <label className="cx-dialog-field">
              Meeting
              <select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                <option value="">{pick && !pick.meetings.length ? 'No meetings this week' : 'Pick a meeting'}</option>
                {pick?.meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {when(m.start, m.allDay)} · {m.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind !== 'project' && linkKind === 'card' && (
            <label className="cx-dialog-field">
              Board card
              <select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                <option value="">{pick && !pick.cards.length ? 'No open cards' : 'Pick a card'}</option>
                {pick?.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.board}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind !== 'project' && linkKind === 'agent' && (
            <div className="cx-dialog-field">
              <label htmlFor="cx-task-agent">Agent</label>
              {agent ? (
                <p className="cx-task-picked">
                  {agent.name}
                  {agent.team ? ` · ${agent.team}` : ''}
                  <button type="button" className="cx-link-quiet" onClick={() => setAgent(null)}>
                    Change
                  </button>
                </p>
              ) : (
                <>
                  <input id="cx-task-agent" value={agentQ} onChange={(e) => setAgentQ(e.target.value)} placeholder="Type an agent's name" autoComplete="off" />
                  {agents.length > 0 && (
                    <ul className="cx-task-results">
                      {agents.map((a) => (
                        <li key={a.name}>
                          <button type="button" onClick={() => setAgent(a)}>
                            {a.name}
                            {a.team && <small>{a.team}</small>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {err && <p className="cx-notice" role="alert">{err}</p>}
          <footer>
            <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cx-btn cx-btn-sm" disabled={!title.trim() || saving}>
              {saving ? 'Saving…' : kind === 'project' ? 'Add to board' : 'Create task'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
