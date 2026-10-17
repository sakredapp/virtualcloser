'use client'

import { useEffect, useState } from 'react'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import { askCiao } from '@/lib/followups/noticeActionsShared'
import { DAY_ONE_ANCHOR, type Step } from '@/lib/onboarding/dayOneShared'

type DayOne = { steps: Step[]; done: number; total: number; abilities: string[]; home: string }

/**
 * Day one with Ciao (Suite CXO). A new person's first-day checklist, from
 * their real state: calendar connected, what Ciao can do for their role, who
 * their manager is, their first 1:1 and first to-do. Each open step has one
 * tap. The card is gone once every step is done, or two weeks after they
 * joined. Reads and writes only the signed-in person's own list, through
 * /api/employees/me/onboarding.
 */
export default function DayOneCard() {
  const assistantName = useAssistantName()
  const [data, setData] = useState<DayOne | null>(null)
  const [showAbilities, setShowAbilities] = useState(false)
  const [todo, setTodo] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/employees/me/onboarding')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { dayOne?: DayOne | null } | null) => {
        if (live && j?.dayOne) setData(j.dayOne)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (!data) return null

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch('/api/employees/me/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { dayOne?: DayOne | null; error?: string }
      if (!r.ok) {
        setNote(j.error || 'Could not save that.')
        return
      }
      if (j.dayOne === null) {
        setData(null)
        return
      }
      if (j.dayOne) setData(j.dayOne)
      setNote(ok)
    } finally {
      setBusy(false)
    }
  }

  function act(s: Step) {
    const a = s.action
    if (!a) return
    if (a.kind === 'link') window.location.href = a.href
    else if (a.kind === 'ask') askCiao(a.prompt)
    else if (a.kind === 'ack') {
      setShowAbilities(false)
      void send({ op: 'abilities_seen' }, 'Got it.')
    }
  }

  return (
    <section className="cx-panel" id={DAY_ONE_ANCHOR} aria-labelledby="day-one-h">
      <div className="cxp-head">
        <h2 id="day-one-h">Your first day with {assistantName}</h2>
        <span className="cx-msg-note" style={{ margin: 0 }}>
          {data.done} of {data.total} done
        </span>
      </div>
      <p className="cx-msg-note" style={{ marginTop: 0 }}>A few quick steps so I can help from today. This list goes away when they are done.</p>
      {note && (
        <p className="cx-msg-note" role="status">
          {note}
        </p>
      )}
      <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 12 }}>
        {data.steps.map((s) => (
          <li key={s.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, alignItems: 'start' }}>
            <span role="img" aria-label={s.done ? 'Done' : 'To do'} style={{ fontWeight: 700, opacity: s.done ? 0.55 : 1 }}>
              {s.done ? '✓' : '○'}
            </span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14, textDecoration: s.done ? 'line-through' : undefined, opacity: s.done ? 0.65 : 1 }}>
                {s.title}
              </p>
              <p className="cx-msg-note" style={{ margin: '2px 0 0' }}>
                {s.detail}
              </p>
              {s.id === 'abilities' && !s.done && data.abilities.length > 0 && showAbilities && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {data.abilities.map((l) => (
                    <li key={l} style={{ fontSize: 14 }}>
                      {l}
                    </li>
                  ))}
                </ul>
              )}
              {!s.done && s.action && (
                <div className="cx-msg-actions">
                  {s.action.kind === 'todo' ? (
                    <form
                      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: '100%' }}
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (todo.trim()) void send({ op: 'add_todo', body: todo }, 'Added to your to-dos.').then(() => setTodo(''))
                      }}
                    >
                      <input type="text" value={todo} maxLength={500} placeholder="e.g. Meet the team" aria-label="Your first to-do" onChange={(e) => setTodo(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }} />
                      <button type="submit" className="cx-todo-act" disabled={busy || !todo.trim()}>
                        {s.action.label}
                      </button>
                    </form>
                  ) : s.id === 'abilities' && !showAbilities && data.abilities.length > 0 ? (
                    <button type="button" className="cx-todo-act" onClick={() => setShowAbilities(true)}>
                      Show me
                    </button>
                  ) : (
                    <button type="button" className="cx-todo-act" disabled={busy} onClick={() => act(s)}>
                      {s.action.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
