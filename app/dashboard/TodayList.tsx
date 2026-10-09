'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Todo, PartnerSuggestion } from '@/lib/today'
import type { AssignedCard } from '@/lib/boards'

async function post<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/today', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j as { error?: string }).error || 'That did not save.')
  return j as T
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TodayList({ initialTodos, initialCards }: { initialTodos: Todo[]; initialCards: AssignedCard[] }) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos)
  const [cards, setCards] = useState<AssignedCard[]>(initialCards)
  const [suggestions, setSuggestions] = useState<PartnerSuggestion[] | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const started = useRef(false)

  const reload = useCallback(async (partners = false) => {
    const res = await fetch(`/api/today${partners ? '?partners=1' : ''}`, { cache: 'no-store' })
    const j = (await res.json().catch(() => ({}))) as { todos?: Todo[]; cards?: AssignedCard[]; suggestions?: PartnerSuggestion[] | null }
    if (j.todos) setTodos(j.todos)
    if (j.cards) setCards(j.cards)
    if (partners) setSuggestions(j.suggestions ?? null)
  }, [])

  // New meeting notes become to-dos: read a few at a time until caught up.
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      reload(true).catch(() => setSuggestions(null))
      setScanning(true)
      try {
        for (let i = 0; i < 4; i++) {
          const r = await post<{ scanned: number; added: number; pending: number }>({ op: 'scan' })
          if (r.added) await reload()
          if (!r.pending) break
        }
      } catch {
        // Quiet: the list still works without new extractions.
      }
      setScanning(false)
    })()
  }, [reload])

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null)
    try {
      await fn()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'That did not save.')
    }
    await reload()
  }

  const add = async () => {
    const body = draft.trim()
    if (!body) return
    setDraft('')
    await act(() => post({ op: 'add', body }))
  }

  const toggle = (t: Todo) => {
    setTodos((xs) => xs.map((x) => (x.id === t.id ? { ...x, done_at: x.done_at ? null : new Date().toISOString() } : x)))
    act(() => post({ op: 'set', id: t.id, done: !t.done_at }))
  }
  const remove = (t: Todo) => {
    setTodos((xs) => xs.filter((x) => x.id !== t.id))
    act(() => post({ op: 'delete', id: t.id }))
  }
  const cardDone = (c: AssignedCard) => {
    setCards((xs) => xs.filter((x) => x.id !== c.id))
    act(() => post({ op: 'cardDone', id: c.id }))
  }
  const keepPartner = (s: PartnerSuggestion) => {
    setSuggestions((xs) => (xs ? xs.filter((x) => x.thread_id !== s.thread_id) : xs))
    act(() => post({ op: 'fromPartner', partnerId: s.partner_id, partnerName: s.partner_name, threadId: s.thread_id, body: `Reply to ${s.partner_name.split(/\s+/)[0]}: ${s.subject || s.snippet.slice(0, 80)}` }))
  }

  const open = todos.filter((t) => !t.done_at)
  const done = todos.filter((t) => t.done_at)
  const sortedCards = [...cards].sort((a, b) => (a.urgency === 'now' ? -1 : 0) - (b.urgency === 'now' ? -1 : 0) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))
  const total = open.length + cards.length

  const askMira = () => {
    const lines = [
      ...open.map((t) => `- ${t.body}${t.meeting_title ? ` (from meeting: ${t.meeting_title})` : ''}${t.partner_name ? ` (from ${t.partner_name})` : ''}`),
      ...sortedCards.map((c) => `- ${c.title} (board: ${c.board_name}${c.due_date ? `, due ${c.due_date}` : ''})`),
    ]
    const text = lines.length
      ? `Here is my to-do list for today:\n${lines.join('\n')}\n\nWhat should I do first, and what can you take off my plate?`
      : 'My to-do list is empty. What should be on it today?'
    window.dispatchEvent(new CustomEvent('mira:ask', { detail: { text } }))
  }

  return (
    <section className="cx-panel cx-today-list" aria-labelledby="today-todo">
      <header className="cx-today-list-head">
        <h2 id="today-todo">
          To do <span>{total}</span>
        </h2>
        <button type="button" className="cx-btn cx-btn-sm" onClick={askMira}>Ask Mira about this</button>
      </header>

      <form
        className="cx-today-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a to-do" aria-label="Add a to-do" />
        {draft.trim() && <button type="submit" className="cx-btn cx-btn-sm">Add</button>}
      </form>

      {msg && <p className="cx-notice" role="status">{msg}</p>}

      <ul className="cx-today-items">
        {open.map((t) => (
          <li key={t.id}>
            <input type="checkbox" checked={false} onChange={() => toggle(t)} aria-label={`Done: ${t.body}`} />
            <div className="b">
              <p>{t.body}</p>
              <Tags t={t} />
            </div>
            <button type="button" className="x" aria-label="Delete" onClick={() => remove(t)}>×</button>
          </li>
        ))}
        {sortedCards.map((c) => (
          <li key={c.id}>
            <input type="checkbox" checked={false} onChange={() => cardDone(c)} aria-label={`Done: ${c.title}`} />
            <div className="b">
              <p>{c.title}</p>
              <p className="tags">
                <Link href={`/dashboard/boards?board=${c.board_id}`} className="tag">{c.board_name}</Link>
                {c.urgency === 'now' && <span className="tag is-now">Today</span>}
                {c.due_date && <span className="tag">Due {shortDate(c.due_date)}</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {total === 0 && !scanning && <p className="cx-today-quiet">Nothing on the list. Meeting follow-ups land here on their own once your note-taker is connected.</p>}
      {scanning && <p className="cx-today-quiet">Reading your latest meeting notes…</p>}

      {suggestions && suggestions.length > 0 && (
        <div className="cx-today-suggest">
          <p className="cx-board-label">From partners</p>
          <ul>
            {suggestions.map((s) => (
              <li key={s.thread_id}>
                <span className="b">
                  <b>{s.partner_name}</b> {s.subject || s.snippet}
                </span>
                <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => keepPartner(s)}>Add to list</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done.length > 0 && (
        <details className="cx-today-done">
          <summary>Done today ({done.length})</summary>
          <ul className="cx-today-items">
            {done.map((t) => (
              <li key={t.id} className="is-done">
                <input type="checkbox" checked onChange={() => toggle(t)} aria-label={`Not done: ${t.body}`} />
                <div className="b">
                  <p>{t.body}</p>
                </div>
                <button type="button" className="x" aria-label="Delete" onClick={() => remove(t)}>×</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function Tags({ t }: { t: Todo }) {
  if (t.source === 'meeting' && t.meeting_title)
    return (
      <p className="tags">
        <Link className="tag" href={t.note_id ? `/dashboard/meetings?note=${t.note_id}#note-${t.note_id}` : '/dashboard/meetings'}>
          {t.meeting_title}
          {t.meeting_at ? ` · ${shortDate(t.meeting_at)}` : ''}
        </Link>
      </p>
    )
  if (t.source === 'partner' && t.partner_name)
    return (
      <p className="tags">
        <Link className="tag" href="/dashboard/partners">from {t.partner_name}</Link>
      </p>
    )
  if (t.source === 'mira')
    return (
      <p className="tags">
        <span className="tag">from Mira</span>
      </p>
    )
  return null
}
