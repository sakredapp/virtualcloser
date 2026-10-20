'use client'

import { useEffect, useState } from 'react'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import { askCiao } from '@/lib/followups/noticeActionsShared'
import { DAY_ONE_ANCHOR, type Step } from '@/lib/onboarding/dayOneShared'
import type { AboutView } from '@/lib/onboarding/aboutYouShared'
import AboutYouPicker from './AboutYouPicker'
import './day-one.css'

type DayOne = { steps: Step[]; done: number; total: number; abilities: string[]; home: string }

/**
 * Day one with Ciao (Suite CXO). A new person's first-day checklist, from
 * their real state: calendar connected, what Ciao can do for their role, who
 * their manager is, their first 1:1 and first to-do. Each open step has one
 * tap. The card is gone once every step is done, or two weeks after they
 * joined. Reads and writes only the signed-in person's own list, through
 * /api/employees/me/onboarding.
 *
 * Until they answer or skip it, the card also opens with two quick questions
 * (their role, and what they want to keep an eye on), so the abilities list
 * and Ciao lead with what matters to them. A member past their first two
 * weeks who never answered sees only the questions, once, in the same panel.
 */
export default function DayOneCard() {
  const assistantName = useAssistantName()
  const [data, setData] = useState<DayOne | null>(null)
  const [showAbilities, setShowAbilities] = useState(false)
  const [todo, setTodo] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [about, setAbout] = useState<AboutView | null>(null)

  function load(isLive: () => boolean = () => true) {
    return fetch('/api/employees/me/onboarding')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { dayOne?: DayOne | null; about?: AboutView | null } | null) => {
        if (!isLive() || !j) return
        setData(j.dayOne ?? null)
        setAbout(j.about ?? null)
      })
      .catch(() => {})
  }

  useEffect(() => {
    let live = true
    void load(() => live)
    return () => {
      live = false
    }
  }, [])

  const askAbout = !!about?.ask
  if (!data && !askAbout) return null

  // Answered or skipped: refetch so the abilities reorder for their role.
  const aboutDone = () => void load()

  if (!data && about) {
    return (
      <section className="cx-panel" aria-labelledby="about-you-h">
        <div className="cxp-head">
          <h2 id="about-you-h">Help {assistantName} fit your job</h2>
        </div>
        <AboutYouPicker initial={about} mode="card" assistantName={assistantName} onSaved={aboutDone} />
      </section>
    )
  }
  if (!data) return null

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch('/api/employees/me/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { dayOne?: DayOne | null; about?: AboutView | null; error?: string }
      if (!r.ok) {
        setNote(j.error || 'Could not save that.')
        return
      }
      if ('about' in j) setAbout(j.about ?? null)
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

  const pct = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0
  return (
    <section className="cx-panel cx-d1" id={DAY_ONE_ANCHOR} aria-labelledby="day-one-h">
      <div className="cxp-head">
        <h2 id="day-one-h">Your first day with {assistantName}</h2>
        <span className="cx-d1-count">
          {data.done} of {data.total} done
        </span>
      </div>
      <div className="cx-d1-bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} aria-label="Setup progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="cx-d1-sub">A few taps so {assistantName} can help from today.</p>
      {askAbout && about && (
        <div className="cx-d1-about">
          <AboutYouPicker initial={about} mode="card" assistantName={assistantName} onSaved={aboutDone} />
        </div>
      )}
      {note && (
        <p className="cx-msg-note" role="status">
          {note}
        </p>
      )}
      <ol className="cx-d1-steps">
        {data.steps.map((s, i) => (
          <li key={s.id} className={s.done ? 'cx-d1-step is-done' : 'cx-d1-step'}>
            <span className="cx-d1-mark" role="img" aria-label={s.done ? 'Done' : 'To do'}>
              {s.done ? '✓' : i + 1}
            </span>
            <div className="cx-d1-body">
              <p className="cx-d1-title">{s.title}</p>
              <p className="cx-d1-detail">{s.detail}</p>
              {s.id === 'abilities' && !s.done && data.abilities.length > 0 && showAbilities && (
                <ul className="cx-d1-abilities">
                  {data.abilities.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              {!s.done && s.action && (
                <div className="cx-d1-act">
                  {s.action.kind === 'todo' ? (
                    <form
                      className="cx-d1-todo"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (todo.trim()) void send({ op: 'add_todo', body: todo }, 'Added to your to-dos.').then(() => setTodo(''))
                      }}
                    >
                      <input type="text" value={todo} maxLength={500} placeholder="e.g. Meet the team" aria-label="Your first to-do" onChange={(e) => setTodo(e.target.value)} />
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
