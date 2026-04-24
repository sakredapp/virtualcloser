'use client'

import { useEffect, useRef, useState } from 'react'

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
}: {
  repName: string
  initialItems: BrainItem[]
}) {
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState<BrainItem[]>(initialItems)
  const [lastSummary, setLastSummary] = useState<string | null>(null)
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
    if (!text.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/brain-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const json = await res.json()
      if (json.ok) {
        setItems((prev) => [...(json.items as BrainItem[]), ...prev])
        setLastSummary(json.dump?.summary ?? null)
        setText('')
        setInterim('')
      }
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
    <div className="brain-root">
      <header className="hero">
        <p className="eyebrow">Brain Dump</p>
        <h1>Speak your week, {repName.split(' ')[0] || 'friend'}</h1>
        <p className="sub">
          Hit record, talk freely. Tasks, goals, plans, ideas — all extracted and filed for you.
        </p>
      </header>

      <section className="card recorder">
        <div className="rec-row">
          <button
            type="button"
            onClick={toggleListen}
            disabled={!supported}
            className={`mic ${listening ? 'on' : ''}`}
          >
            {listening ? 'Stop recording' : supported ? 'Start recording' : 'Mic not supported'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="save"
          >
            {submitting ? 'Thinking…' : 'Save & extract'}
          </button>
        </div>

        {!supported && (
          <p className="hint">
            Your browser does not support the Web Speech API. Use Chrome, Edge, or Safari, or type
            directly into the box below.
          </p>
        )}

        <textarea
          value={text + (interim ? ` ${interim}` : '')}
          onChange={(e) => setText(e.target.value)}
          placeholder="Talk or type. Everything here gets routed into tasks, goals, plans, ideas…"
          rows={8}
        />

        {lastSummary && <p className="summary">{lastSummary}</p>}
      </section>

      <section className="grid">
        <article className="card col">
          <div className="section-head">
            <h2>Open items</h2>
            <p>{openItems.length}</p>
          </div>
          {openItems.length === 0 ? (
            <p className="empty">Nothing open. Record a brain dump above.</p>
          ) : (
            <ul className="list">
              {openItems.map((it) => (
                <li key={it.id} className="item">
                  <div className="tags">
                    <span className={`badge type ${it.item_type}`}>{it.item_type}</span>
                    {it.horizon && it.horizon !== 'none' && (
                      <span className="badge horizon">{it.horizon}</span>
                    )}
                    {it.priority === 'high' && <span className="badge high">high</span>}
                    {it.due_date && <span className="badge due">{it.due_date}</span>}
                  </div>
                  <p className="content">{it.content}</p>
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

        <article className="card col">
          <div className="section-head">
            <h2>Completed</h2>
            <p>{doneItems.length}</p>
          </div>
          {doneItems.length === 0 ? (
            <p className="empty">Nothing done yet.</p>
          ) : (
            <ul className="list">
              {doneItems.slice(0, 30).map((it) => (
                <li key={it.id} className="item done">
                  <div className="tags">
                    <span className={`badge type ${it.item_type}`}>{it.item_type}</span>
                  </div>
                  <p className="content">{it.content}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <style jsx>{`
        .brain-root {
          width: min(1200px, 94vw);
          margin: 0 auto;
          padding: 2.5rem 0 3rem;
        }
        .hero {
          border: 1px solid var(--panel-border);
          background: linear-gradient(130deg, rgba(216, 177, 90, 0.2), rgba(17, 17, 17, 0.95) 40%);
          border-radius: 18px;
          padding: 1.4rem 1.6rem;
          box-shadow: 0 0 40px rgba(216, 177, 90, 0.15);
          margin-bottom: 1.2rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--gold);
          margin: 0;
          font-size: 0.75rem;
          font-weight: 600;
        }
        h1 {
          margin: 0.15rem 0 0.2rem;
          font-size: clamp(1.7rem, 2.8vw, 2.6rem);
        }
        .sub {
          margin: 0;
          color: var(--muted);
        }
        .card {
          border: 1px solid var(--panel-border);
          background: linear-gradient(180deg, rgba(17, 17, 17, 0.98), rgba(10, 10, 10, 0.95));
          border-radius: 14px;
          padding: 1rem;
          margin-bottom: 0.8rem;
        }
        .rec-row {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .mic {
          padding: 0.75rem 1.2rem;
          border-radius: 999px;
          border: 1px solid rgba(216, 177, 90, 0.55);
          background: var(--gold-soft);
          color: var(--gold);
          cursor: pointer;
          font-weight: 600;
          box-shadow: 0 0 18px rgba(216, 177, 90, 0.12);
        }
        .mic.on {
          background: #f18e62;
          color: #111;
          border-color: #f18e62;
          box-shadow: 0 0 30px rgba(241, 142, 98, 0.45);
          animation: pulse 1.2s ease-in-out infinite;
        }
        .mic:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        .save {
          padding: 0.75rem 1.2rem;
          border-radius: 999px;
          border: 1px solid #575757;
          background: #1c1c1c;
          color: var(--text);
          cursor: pointer;
          font-weight: 600;
        }
        .save:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        textarea {
          width: 100%;
          margin-top: 0.8rem;
          background: #0b0b0b;
          color: var(--text);
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          padding: 0.8rem;
          font-family: inherit;
          font-size: 0.95rem;
          resize: vertical;
        }
        textarea:focus {
          outline: none;
          border-color: var(--gold);
          box-shadow: 0 0 0 3px rgba(216, 177, 90, 0.18);
        }
        .summary {
          margin: 0.8rem 0 0;
          color: var(--muted);
          font-style: italic;
        }
        .hint {
          margin: 0.5rem 0 0;
          color: var(--muted);
          font-size: 0.85rem;
        }
        .grid {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 0.8rem;
        }
        .section-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 0.5rem;
        }
        h2 {
          margin: 0;
          font-size: 1.06rem;
        }
        .section-head p {
          margin: 0;
          color: var(--muted);
          font-size: 0.85rem;
        }
        .list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.55rem;
          max-height: 620px;
          overflow: auto;
        }
        .item {
          border: 1px solid rgba(216, 177, 90, 0.16);
          background: rgba(216, 177, 90, 0.03);
          border-radius: 10px;
          padding: 0.7rem;
        }
        .item.done {
          opacity: 0.65;
        }
        .tags {
          display: flex;
          gap: 0.35rem;
          flex-wrap: wrap;
          margin-bottom: 0.4rem;
        }
        .badge {
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
          border: 1px solid var(--panel-border);
          background: #1d1d1d;
          color: var(--muted);
        }
        .badge.type.task { border-color: #f4c15f; color: #ffd789; background: rgba(244,193,95,0.12); }
        .badge.type.goal { border-color: var(--gold); color: var(--gold); background: var(--gold-soft); }
        .badge.type.plan { border-color: #9aa4ad; color: #c8d0d7; }
        .badge.type.idea { border-color: #b891f4; color: #dcc7ff; background: rgba(184,145,244,0.12); }
        .badge.type.note { border-color: #7d7a73; color: #bcb7aa; }
        .badge.horizon { background: rgba(216,177,90,0.06); color: var(--gold); border-color: rgba(216,177,90,0.4); }
        .badge.high { border-color: #f18e62; color: #fcb293; background: rgba(241,142,98,0.12); }
        .badge.due { border-color: #9aa4ad; color: #d6dde2; }
        .content {
          margin: 0;
          line-height: 1.4;
        }
        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 0.55rem;
        }
        .btn {
          border-radius: 8px;
          padding: 0.38rem 0.72rem;
          border: 1px solid transparent;
          background: #252525;
          color: var(--text);
          cursor: pointer;
          font-size: 0.82rem;
        }
        .btn.approve { background: var(--gold-soft); border-color: rgba(216,177,90,0.48); color: var(--gold); }
        .btn.dismiss { border-color: #575757; color: #d1d1d1; }
        .empty { margin: 0.35rem 0 0; color: var(--muted); }
        @media (max-width: 880px) { .grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
