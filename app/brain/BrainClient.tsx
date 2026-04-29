'use client'

import { useEffect, useRef, useState } from 'react'
import DashboardNav from '@/app/dashboard/DashboardNav'
import type { DashboardNavData } from '@/app/dashboard/dashboardTabs'

type BrainItem = {
  id: string
  item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
  content: string
  priority: 'low' | 'normal' | 'high'
  horizon: string | null
  due_date: string | null
  status: 'open' | 'done' | 'dismissed'
  created_at: string
}

type RecognitionLike = {
  start: () => void
  stop: () => void
  abort: () => void
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: Event) => void) | null
  onend: (() => void) | null
}

export default function BrainClient({
  repName,
  initialItems,
  navTabs,
}: {
  repName: string
  initialItems: BrainItem[]
  navTabs: DashboardNavData
}) {
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState<BrainItem[]>(initialItems)
  const [lastSummary, setLastSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<RecognitionLike | null>(null)

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => RecognitionLike
      webkitSpeechRecognition?: new () => RecognitionLike
    }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) {
      setSupported(false)
      return
    }
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'

    r.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        if (res.isFinal) finalChunk += res[0].transcript
        else interimChunk += res[0].transcript
      }
      if (finalChunk) {
        setText((prev) => (prev ? prev + ' ' : '') + finalChunk.trim())
      }
      setInterim(interimChunk)
    }
    r.onerror = () => {
      setListening(false)
    }
    r.onend = () => {
      setListening(false)
      setInterim('')
    }
    recognitionRef.current = r
    return () => {
      r.abort()
    }
  }, [])

  function toggleListen() {
    const r = recognitionRef.current
    if (!r) return
    if (listening) {
      r.stop()
      setListening(false)
    } else {
      try {
        r.start()
        setListening(true)
      } catch {
        // already started
      }
    }
  }

  async function submit() {
    // Stop any active recognition so the final transcript is captured.
    const r = recognitionRef.current
    if (r && listening) {
      try { r.stop() } catch {}
      setListening(false)
    }

    const combined = `${text} ${interim}`.trim()
    if (!combined) {
      setError('Nothing to save yet — record or type something first.')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/brain-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: combined }),
      })
      const json = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok || !json.ok) {
        const msg = typeof json.error === 'string' ? json.error : `Save failed (${res.status})`
        setError(msg)
        return
      }
      setItems((prev) => [...(json.items as BrainItem[]), ...prev])
      setLastSummary(json.dump?.summary ?? null)
      setText('')
      setInterim('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(id: string, status: 'done' | 'dismissed' | 'open') {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status } : it)).filter((it) => it.status !== 'dismissed'),
    )
    await fetch('/api/brain-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
  }

  const openItems = items.filter((i) => i.status === 'open')
  const doneItems = items.filter((i) => i.status === 'done')

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Brain Dump</p>
        <h1>Speak your week, {repName.split(' ')[0] || 'friend'}</h1>
        <p className="sub">
          Hit record, talk freely. Tasks, goals, plans, ideas — all extracted and filed for you.
        </p>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <section className="card">
        <div className="rec-row">
          <button
            type="button"
            onClick={toggleListen}
            disabled={!supported}
            className={`btn ${listening ? 'approve' : 'dismiss'}`}
          >
            {listening ? 'Stop recording' : supported ? 'Start recording' : 'Mic not supported'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="btn approve"
          >
            {submitting ? 'Thinking…' : 'Save & extract'}
          </button>
        </div>

        {!supported && (
          <p className="hint" style={{ marginTop: '0.6rem' }}>
            Your browser does not support voice input. Type in the box below instead.
          </p>
        )}

        <textarea
          value={text + (interim ? ` ${interim}` : '')}
          onChange={(e) => {
            setText(e.target.value)
            setInterim('')
          }}
          placeholder="Talk or type. Everything here gets routed into tasks, goals, plans, ideas…"
          rows={8}
        />

        {error && (
          <p className="meta" style={{ marginTop: '0.6rem', color: 'var(--red-deep)', fontWeight: 600 }}>
            {error}
          </p>
        )}
        {lastSummary && (
          <p className="meta" style={{ marginTop: '0.6rem', fontStyle: 'italic' }}>
            {lastSummary}
          </p>
        )}
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>Open items</h2>
            <p>{openItems.length}</p>
          </div>
          {openItems.length === 0 ? (
            <p className="empty">Nothing open. Record a brain dump above.</p>
          ) : (
            <ul className="list">
              {openItems.map((it) => (
                <li key={it.id} className="draft">
                  <div className="tags">
                    <span className={`badge type ${it.item_type}`}>{it.item_type}</span>
                    {it.horizon && it.horizon !== 'none' && (
                      <span className="badge horizon">{it.horizon}</span>
                    )}
                    {it.priority === 'high' && <span className="badge high">high</span>}
                    {it.due_date && <span className="badge due">{it.due_date}</span>}
                  </div>
                  <p className="body">{it.content}</p>
                  <div className="actions">
                    <button onClick={() => updateStatus(it.id, 'done')} className="btn approve">
                      Done
                    </button>
                    <button onClick={() => updateStatus(it.id, 'dismissed')} className="btn dismiss">
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Completed</h2>
            <p>{doneItems.length}</p>
          </div>
          {doneItems.length === 0 ? (
            <p className="empty">Nothing done yet.</p>
          ) : (
            <ul className="list">
              {doneItems.slice(0, 30).map((it) => (
                <li key={it.id} className="draft" style={{ opacity: 0.65 }}>
                  <div className="tags">
                    <span className={`badge type ${it.item_type}`}>{it.item_type}</span>
                  </div>
                  <p className="body">{it.content}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <style jsx>{`
        .rec-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
        textarea {
          width: 100%;
          margin-top: 0.7rem;
          background: #ffffff;
          color: var(--ink);
          border: 1px solid var(--ink-soft);
          border-radius: 10px;
          padding: 0.8rem;
          font-family: inherit;
          font-size: 0.95rem;
          resize: vertical;
        }
        textarea:focus {
          outline: none;
          border-color: var(--red);
          box-shadow: 0 0 0 3px rgba(255, 40, 0, 0.18);
        }
        .tags {
          display: flex; gap: 0.35rem; flex-wrap: wrap;
          margin-bottom: 0.4rem;
        }
        .badge {
          font-size: 0.66rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 0.16rem 0.55rem;
          border-radius: 999px;
          border: 1px solid var(--ink-soft);
          background: #ffffff;
          color: var(--ink);
          font-weight: 700;
        }
        .badge.type.task { background: #fff4d1; }
        .badge.type.goal { background: var(--red); color: #fff; border-color: var(--red); }
        .badge.type.idea { background: var(--ink); color: #fff; border-color: var(--ink); }
        .badge.horizon { background: var(--ink); color: #fff; border-color: var(--ink); }
        .badge.high { background: var(--red); color: #fff; border-color: var(--red); }
      `}</style>
    </main>
  )
}
