'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Todo, PartnerSuggestion, TodoKind, TodoPriority } from '@/lib/today'
import type { AssignedCard } from '@/lib/boards'
import type { LoopInbox } from '@/lib/meetingLoop'
import type { DraftTodo } from '@/lib/todayMira'
import CreateTask from './today/CreateTask'
import { KIND_LABEL, KIND_SHORT, KindIcon, PRIORITY_LABEL, type AnyKind } from './today/kinds'

async function post<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/today', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j as { error?: string }).error || 'That did not save.')
  return j as T
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function shortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function dueLabel(due: string | null, today: string): string | null {
  if (!due) return null
  if (due === today) return 'Today'
  const tomorrow = ymd(new Date(Date.now() + 86_400_000))
  if (due === tomorrow) return 'Tomorrow'
  return shortDate(due)
}
const PRANK: Record<TodoPriority, number> = { high: 0, normal: 1, low: 2 }

/** One row shape for to-dos and board cards. */
type Row =
  | { type: 'todo'; id: string; title: string; kind: AnyKind; priority: TodoPriority; due: string | null; done: boolean; todo: Todo }
  | { type: 'card'; id: string; title: string; kind: AnyKind; priority: TodoPriority; due: string | null; done: boolean; card: AssignedCard }

type EmailResult = { subject: string; body: string; to: string | null; gmail: boolean; partner?: string; mailto?: string | null }

export default function TodayList({ initialTodos, initialCards, ownerName }: { initialTodos: Todo[]; initialCards: AssignedCard[]; ownerName?: string | null }) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos)
  const [cards, setCards] = useState<AssignedCard[]>(initialCards)
  const [suggestions, setSuggestions] = useState<PartnerSuggestion[] | null | undefined>(undefined)
  const [inbox, setInbox] = useState<LoopInbox | null>(null)
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [email, setEmail] = useState<EmailResult | null>(null)
  const [drafts, setDrafts] = useState<DraftTodo[] | null>(null)
  const [lookedAt, setLookedAt] = useState<string[]>([])
  const [building, setBuilding] = useState(false)
  const started = useRef(false)

  const reload = useCallback(async (partners = false) => {
    const res = await fetch(`/api/today${partners ? '?partners=1' : ''}`, { cache: 'no-store' })
    const j = (await res.json().catch(() => ({}))) as { todos?: Todo[]; cards?: AssignedCard[]; suggestions?: PartnerSuggestion[] | null; inbox?: LoopInbox | null }
    if (j.todos) setTodos(j.todos)
    if (j.cards) setCards(j.cards)
    if (j.inbox !== undefined) setInbox(j.inbox)
    if (partners) setSuggestions(j.suggestions ?? null)
  }, [])

  // A message added to the to-dos (Messages card) shows up here right away.
  useEffect(() => {
    const on = () => void reload().catch(() => {})
    window.addEventListener('cxo:todos', on)
    return () => window.removeEventListener('cxo:todos', on)
  }, [reload])

  // New meeting notes are read into the loop a few at a time until caught up.
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      reload(true).catch(() => setSuggestions(null))
      setScanning(true)
      try {
        for (let i = 0; i < 4; i++) {
          const r = await post<{ scanned: number; added: number; pending: number }>({ op: 'scan' })
          if (r.scanned) await reload()
          if (!r.pending) break
        }
      } catch {
        // Quiet: the list still works without new extractions.
      }
      setScanning(false)
    })()
  }, [reload])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest('.cx-todo-pop, .cx-todo-kind') && setMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null)
    try {
      await fn()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'That did not save.')
    }
    await reload()
  }

  const today = ymd(new Date())
  const rows: Row[] = [
    ...todos.map((t): Row => ({ type: 'todo', id: t.id, title: t.body, kind: t.kind ?? 'task', priority: t.priority ?? 'normal', due: t.due_date, done: !!t.done_at, todo: t })),
    ...cards.map((c): Row => ({ type: 'card', id: c.id, title: c.title, kind: 'project', priority: c.urgency === 'now' ? 'high' : c.urgency === 'later' ? 'low' : 'normal', due: c.due_date, done: false, card: c })),
  ]
  const sort = (a: Row, b: Row) => PRANK[a.priority] - PRANK[b.priority] || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title)
  const open = rows.filter((r) => !r.done)
  const overdue = open.filter((r) => r.due && r.due < today).sort(sort)
  const now = open.filter((r) => !r.due || r.due === today).sort(sort)
  const upcoming = open.filter((r) => r.due && r.due > today).sort(sort)
  const doneToday = rows.filter((r) => r.done)

  const toggle = (r: Row) => {
    if (r.type === 'card') {
      setCards((xs) => xs.filter((x) => x.id !== r.id))
      return act(() => post({ op: 'cardDone', id: r.id }))
    }
    setTodos((xs) => xs.map((x) => (x.id === r.id ? { ...x, done_at: x.done_at ? null : new Date().toISOString() } : x)))
    act(() => post({ op: 'set', id: r.id, done: !r.done }))
  }
  const setField = (r: Row, patch: { kind?: TodoKind; priority?: TodoPriority }) => {
    setMenu(null)
    setTodos((xs) => xs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)))
    act(() => post({ op: 'set', id: r.id, ...patch }))
  }
  const remove = (r: Row) => {
    setMenu(null)
    setTodos((xs) => xs.filter((x) => x.id !== r.id))
    act(() => post({ op: 'delete', id: r.id }))
  }
  const toCard = (r: Row) => {
    setMenu(null)
    setTodos((xs) => xs.filter((x) => x.id !== r.id))
    act(() => post({ op: 'toCard', id: r.id }))
  }
  const cardToTodo = (r: Row) => {
    setMenu(null)
    setCards((xs) => xs.filter((x) => x.id !== r.id))
    act(() => post({ op: 'cardToTodo', id: r.id }))
  }
  const draftEmail = async (r: Row) => {
    setBusy(r.id)
    setMsg(null)
    try {
      setEmail(await post<EmailResult>({ op: 'draftEmail', id: r.id }))
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'That did not save.')
    }
    setBusy(null)
  }
  const keepPartner = (s: PartnerSuggestion) => {
    setSuggestions((xs) => (xs ? xs.filter((x) => x.thread_id !== s.thread_id) : xs))
    act(() => post({ op: 'fromPartner', partnerId: s.partner_id, partnerName: s.partner_name, threadId: s.thread_id, body: `Reply to ${s.partner_name.split(/\s+/)[0]}: ${s.subject || s.snippet.slice(0, 80)}` }))
  }
  const buildList = async () => {
    setBuilding(true)
    setMsg(null)
    try {
      const r = await post<{ drafts: DraftTodo[]; looked_at: string[] }>({ op: 'draftList' })
      setDrafts(r.drafts)
      setLookedAt(r.looked_at)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Mira could not build the list.')
    }
    setBuilding(false)
  }
  const addDraft = (d: DraftTodo) => {
    setDrafts((xs) => (xs ? xs.filter((x) => x.key !== d.key) : xs))
    const { key: _key, ...rest } = d
    void _key
    act(() => post({ op: 'add', source: 'mira', ...rest }))
  }
  const dismissDraft = (d: DraftTodo) => setDrafts((xs) => (xs ? xs.filter((x) => x.key !== d.key) : xs))

  const askMira = () => {
    const lines = open.map((r) => `- ${r.title}${r.priority === 'high' ? ' (high priority)' : ''}${r.due ? ` (due ${r.due})` : ''}${r.type === 'card' ? ` (board: ${r.card.board_name})` : ''}`)
    const text = lines.length ? `Here is my to-do list for today:\n${lines.join('\n')}\n\nWhat should I do first, and what can you take off my plate?` : 'My to-do list is empty. What should be on it today?'
    window.dispatchEvent(new CustomEvent('mira:ask', { detail: { text } }))
  }

  const action = (r: Row) => {
    if (r.type === 'card')
      return (
        <Link className="cx-todo-act" href={`/dashboard/boards?board=${r.card.board_id}`}>
          Open board
        </Link>
      )
    const t = r.todo
    if (t.kind === 'email')
      return (
        <button type="button" className="cx-todo-act" onClick={() => draftEmail(r)} disabled={busy === r.id}>
          {busy === r.id ? 'Drafting…' : 'Draft email'}
        </button>
      )
    if (t.kind === 'call' && t.link_phone)
      return (
        <a className="cx-todo-act" href={`tel:${t.link_phone.replace(/[^\d+]/g, '')}`}>
          Call
        </a>
      )
    if (t.kind === 'prep') {
      // The event itself when known, else the meeting's notes, else the calendar.
      const href = t.link_url || (t.note_id ? `/dashboard/meetings?note=${t.note_id}#note-${t.note_id}` : '/dashboard/calendar')
      return href.startsWith('/') ? (
        <Link className="cx-todo-act" href={href}>
          Open event
        </Link>
      ) : (
        <a className="cx-todo-act" href={href} target="_blank" rel="noreferrer">
          Open event
        </a>
      )
    }
    if (t.kind === 'team')
      return (
        <Link className="cx-todo-act" href={t.link_url && t.link_url.startsWith('/') ? t.link_url : '/dashboard/pinnacle'}>
          Open Team
        </Link>
      )
    return null
  }

  const renderRow = (r: Row) => {
    const right = [r.due ? dueLabel(r.due, today) : null, r.type === 'todo' ? r.todo.assignee_name : null].filter(Boolean).join(' · ')
    const late = !r.done && r.due && r.due < today
    return (
      <li key={`${r.type}:${r.id}`} className={`cx-todo-row${r.done ? ' is-done' : ''}`}>
        <input type="checkbox" checked={r.done} onChange={() => toggle(r)} aria-label={`${r.done ? 'Not done' : 'Done'}: ${r.title}`} />
        <button
          type="button"
          className="cx-todo-kind"
          aria-label={`${KIND_LABEL[r.kind]}, ${PRIORITY_LABEL[r.priority]} priority. Change`}
          aria-expanded={menu === r.id}
          onClick={() => setMenu(menu === r.id ? null : r.id)}
        >
          <KindIcon kind={r.kind} />
        </button>
        <div className="cx-todo-main">
          <p className="cx-todo-title">
            {r.priority === 'high' && !r.done && <i className="cx-dot" aria-label="High priority" />}
            {r.title}
          </p>
          <Source r={r} ownerName={ownerName ?? null} />
        </div>
        <div className="cx-todo-side">
          {right && <span className={`cx-todo-due${late ? ' is-late' : ''}`}>{right}</span>}
          {!r.done && action(r)}
        </div>
        {menu === r.id && (
          <div className="cx-todo-pop" role="menu">
            {r.type === 'todo' ? (
              <>
                <p className="cx-todo-pop-h">Type</p>
                <div className="cx-todo-pop-chips">
                  {(['task', 'email', 'call', 'prep', 'team', 'personal'] as TodoKind[]).map((k) => (
                    <button key={k} type="button" className={r.kind === k ? 'is-on' : ''} onClick={() => setField(r, { kind: k })}>
                      <KindIcon kind={k} size={13} />
                      {KIND_SHORT[k]}
                    </button>
                  ))}
                </div>
                <p className="cx-todo-pop-h">Priority</p>
                <div className="cx-todo-pop-chips">
                  {(['high', 'normal', 'low'] as TodoPriority[]).map((p) => (
                    <button key={p} type="button" className={r.priority === p ? 'is-on' : ''} onClick={() => setField(r, { priority: p })}>
                      {PRIORITY_LABEL[p]}
                    </button>
                  ))}
                </div>
                <div className="cx-todo-pop-foot">
                  <button type="button" onClick={() => toCard(r)}>Move to board</button>
                  <button type="button" onClick={() => remove(r)}>Delete</button>
                </div>
              </>
            ) : (
              <div className="cx-todo-pop-foot">
                <button type="button" onClick={() => cardToTodo(r)}>Make it a to-do</button>
                <Link href={`/dashboard/boards?board=${r.card.board_id}`}>Open board</Link>
              </div>
            )}
          </div>
        )}
      </li>
    )
  }

  const total = open.length
  const empty = total === 0
  const followups = inbox?.followups ?? []
  const doneAsks = inbox?.doneAsks ?? []
  const ticked = inbox?.ticked ?? []

  return (
    <section className="cx-todo" aria-labelledby="today-todo">
      <header className="cx-todo-head">
        <h2 id="today-todo">
          To do <span>{total}</span>
        </h2>
        <div className="cx-todo-head-actions">
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={askMira}>
            Ask Mira
          </button>
          <button type="button" className="cx-btn cx-btn-ink cx-btn-sm" onClick={() => setCreating(true)}>
            <span aria-hidden>+</span> Create task
          </button>
        </div>
      </header>

      {msg && <p className="cx-notice" role="status">{msg}</p>}

      {overdue.length > 0 && (
        <div className="cx-todo-group">
          <p className="cx-todo-group-h">Overdue</p>
          <ul className="cx-todo-rows">{overdue.map(renderRow)}</ul>
        </div>
      )}
      {now.length > 0 && (
        <div className="cx-todo-group">
          {(overdue.length > 0 || upcoming.length > 0) && <p className="cx-todo-group-h">Today</p>}
          <ul className="cx-todo-rows">{now.map(renderRow)}</ul>
        </div>
      )}
      {upcoming.length > 0 && (
        <details className="cx-todo-group cx-todo-fold">
          <summary>Upcoming ({upcoming.length})</summary>
          <ul className="cx-todo-rows">{upcoming.map(renderRow)}</ul>
        </details>
      )}

      {empty && !drafts?.length && (
        <div className="cx-todo-mira">
          <div>
            <p className="cx-todo-mira-h">Have Mira build today&rsquo;s list</p>
            <p className="cx-todo-mira-b">
              {scanning
                ? 'Reading your latest meeting notes first…'
                : drafts && drafts.length === 0
                  ? `Nothing stood out${lookedAt.length ? ` (looked at ${lookedAt.join(', ')})` : ''}. Add one with Create task.`
                  : 'She reads today’s and yesterday’s meetings, your open cards, partners you have not reached in two weeks and agents who are slipping, then suggests 3 to 6 to-dos. You pick which to keep.'}
            </p>
          </div>
          <button type="button" className="cx-btn cx-btn-sm" onClick={buildList} disabled={building}>
            {building ? 'Building…' : drafts ? 'Try again' : 'Build my list'}
          </button>
        </div>
      )}

      {drafts && drafts.length > 0 && (
        <div className="cx-todo-group">
          <p className="cx-todo-group-h">Mira suggests</p>
          <ul className="cx-todo-rows">
            {drafts.map((d) => (
              <li key={d.key} className="cx-todo-row is-draft">
                <span className="cx-todo-kind is-static" aria-label={KIND_LABEL[d.kind]}>
                  <KindIcon kind={d.kind} />
                </span>
                <div className="cx-todo-main">
                  <p className="cx-todo-title">
                    {d.priority === 'high' && <i className="cx-dot" aria-label="High priority" />}
                    {d.body}
                  </p>
                  <p className="cx-todo-src">from: {d.source_label}</p>
                </div>
                <div className="cx-todo-side">
                  <button type="button" className="cx-todo-act" onClick={() => addDraft(d)}>
                    Add
                  </button>
                  <button type="button" className="cx-todo-act is-quiet" onClick={() => dismissDraft(d)}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(followups.length > 0 || doneAsks.length > 0 || ticked.length > 0) && (
        <div className="cx-todo-group cx-todo-loop">
          <p className="cx-todo-group-h">From your meetings</p>
          <ul className="cx-todo-rows">
            {followups.map((f) => (
              <li key={`f:${f.note_id}:${f.idx}`} className="cx-todo-row is-draft">
                <span className="cx-todo-kind is-static" aria-hidden>
                  <KindIcon kind="email" />
                </span>
                <div className="cx-todo-main">
                  <p className="cx-todo-title">
                    Email {f.partner_name}: {f.about}
                  </p>
                  <p className="cx-todo-src">from: {f.meeting}</p>
                </div>
                <div className="cx-todo-side">
                  <button
                    type="button"
                    className="cx-todo-act"
                    disabled={busy === `f:${f.note_id}:${f.idx}`}
                    onClick={async () => {
                      setBusy(`f:${f.note_id}:${f.idx}`)
                      try {
                        setEmail(await post<EmailResult>({ op: 'draftFollowup', noteId: f.note_id, idx: f.idx }))
                      } catch (err) {
                        setMsg(err instanceof Error ? err.message : 'That did not save.')
                      }
                      setBusy(null)
                      reload()
                    }}
                  >
                    {busy === `f:${f.note_id}:${f.idx}` ? 'Drafting…' : 'Draft email'}
                  </button>
                  <button type="button" className="cx-todo-act is-quiet" onClick={() => act(() => post({ op: 'dismissFollowup', noteId: f.note_id, idx: f.idx }))}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
            {doneAsks.map((d) => (
              <li key={`d:${d.note_id}:${d.idx}`} className="cx-todo-row is-draft">
                <span className="cx-todo-kind is-static" aria-hidden>
                  <KindIcon kind="task" />
                </span>
                <div className="cx-todo-main">
                  <p className="cx-todo-title">Done? {d.text}</p>
                  <p className="cx-todo-src">
                    from: {d.meeting}
                    {d.evidence ? ` · “${d.evidence}”` : ''}
                  </p>
                </div>
                <div className="cx-todo-side">
                  <button type="button" className="cx-todo-act" onClick={() => act(() => post({ op: 'confirmDone', noteId: d.note_id, idx: d.idx, yes: true }))}>
                    Yes, done
                  </button>
                  <button type="button" className="cx-todo-act is-quiet" onClick={() => act(() => post({ op: 'confirmDone', noteId: d.note_id, idx: d.idx, yes: false }))}>
                    Not yet
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {ticked.length > 0 && (
            <p className="cx-todo-src cx-todo-ticked">
              Mira ticked off {ticked.length === 1 ? `“${ticked[0].text}”` : `${ticked.length} items`} because {ticked.length === 1 ? `${ticked[0].meeting} says it is done` : 'your meetings say they are done'}. Untick under Done today if that is wrong.
            </p>
          )}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="cx-todo-group">
          <p className="cx-todo-group-h">From partners</p>
          <ul className="cx-todo-rows">
            {suggestions.map((s) => (
              <li key={s.thread_id} className="cx-todo-row is-draft">
                <span className="cx-todo-kind is-static" aria-hidden>
                  <KindIcon kind="email" />
                </span>
                <div className="cx-todo-main">
                  <p className="cx-todo-title">{s.subject || s.snippet}</p>
                  <p className="cx-todo-src">from: {s.partner_name}</p>
                </div>
                <div className="cx-todo-side">
                  <button type="button" className="cx-todo-act" onClick={() => keepPartner(s)}>
                    Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doneToday.length > 0 && (
        <details className="cx-todo-group cx-todo-fold">
          <summary>Done today ({doneToday.length})</summary>
          <ul className="cx-todo-rows">{doneToday.map(renderRow)}</ul>
        </details>
      )}

      {creating && (
        <CreateTask
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            await post(body)
            await reload()
          }}
        />
      )}
      {email && (
        <div className="cx-dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && setEmail(null)}>
          <div className="cx-dialog cx-task-dialog" role="dialog" aria-modal="true" aria-labelledby="cx-email-title">
            <h2 id="cx-email-title">Draft ready</h2>
            <p className="cx-dialog-body">
              {email.gmail
                ? `Saved in your Gmail Drafts${email.to ? ` to ${email.to}` : ''}. Nothing was sent.`
                : email.mailto
                  ? 'Mira wrote this. Open it in your email app to send it yourself.'
                  : email.partner
                    ? `Saved as a draft on ${email.partner} in Partners. Nothing was sent.`
                    : 'Mira wrote this. Nothing was sent.'}
            </p>
            <p className="cx-email-subj">{email.subject}</p>
            <pre className="cx-email-body">{email.body}</pre>
            <footer>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setEmail(null)}>
                Close
              </button>
              {email.gmail ? (
                <a className="cx-btn cx-btn-sm" href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                  Open Gmail Drafts
                </a>
              ) : email.mailto ? (
                <a className="cx-btn cx-btn-sm" href={email.mailto}>
                  Open in email
                </a>
              ) : email.partner ? (
                <Link className="cx-btn cx-btn-sm" href="/dashboard/partners">
                  Open Partners
                </Link>
              ) : null}
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}

function Source({ r, ownerName }: { r: Row; ownerName: string | null }) {
  if (r.type === 'card') return <p className="cx-todo-src">{r.card.board_name} board{r.card.list_title ? ` · ${r.card.list_title}` : ''}</p>
  const t = r.todo
  const bits: React.ReactNode[] = []
  if (t.source === 'meeting' && t.meeting_title)
    bits.push(
      <Link key="m" href={t.note_id ? `/dashboard/meetings?note=${t.note_id}#note-${t.note_id}` : '/dashboard/meetings'}>
        from: {t.meeting_title}
        {t.meeting_at ? `, ${shortDate(t.meeting_at)}` : ''}
        {t.mentions > 1 ? ` · raised ${t.mentions} times` : ''}
        {' · Mira'}
      </Link>,
    )
  else if (t.source === 'partner' && t.partner_name) bits.push(<span key="p">from: {t.partner_name}</span>)
  else if (t.source_label) bits.push(<span key="s">from: {t.source_label}</span>)
  else if (t.source === 'mira') bits.push(<span key="s">from: Mira</span>)
  if (t.acted_by_name) bits.push(<span key="a" className="cx-by">{actingWords(t.acted_by_name, ownerName)}</span>)
  if (t.link_label && !(t.source === 'meeting' && t.link_kind === 'meeting'))
    bits.push(
      t.link_url && t.link_url.startsWith('/') ? (
        <Link key="l" href={t.link_url}>
          {t.link_label}
        </Link>
      ) : (
        <span key="l">{t.link_label}</span>
      ),
    )
  if (!bits.length) return null
  return (
    <p className="cx-todo-src">
      {bits.map((b, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {b}
        </span>
      ))}
    </p>
  )
}

/** "by Pat for Mike" on anything an executive assistant added. */
function actingWords(by: string, owner: string | null) {
  const f = (n: string) => n.trim().split(/\s+/)[0]
  return owner ? `by ${f(by)} for ${f(owner)}` : `by ${f(by)}`
}
