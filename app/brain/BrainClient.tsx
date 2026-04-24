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
          background: linear-gradient(130deg, #ffffff 0%, #fff8e0 55%, #f3e7c1 100%);
          border-radius: 18px;
          padding: 1.4rem 1.6rem;
          box-shadow: 0 10px 30px rgba(30, 58, 138, 0.10);
          margin-bottom: 1.2rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--royal);
          margin: 0;
          font-size: 0.75rem;
          font-weight: 700;
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
          background: var(--panel);
          border-radius: 14px;
          padding: 1rem;
          margin-bottom: 0.8rem;
          box-shadow: 0 6px 18px rgba(30, 58, 138, 0.06);
        }
        .rec-row {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .mic {
          padding: 0.75rem 1.2rem;
          border-radius: 999px;
          border: 1px solid var(--royal);
          background: var(--royal);
          color: #fff8e0;
          cursor: pointer;
          font-weight: 600;
          box-shadow: 0 6px 18px rgba(30, 58, 138, 0.18);
        }
        .mic:hover {
          background: var(--royal-bright);
          border-color: var(--royal-bright);
        }
        .mic.on {
          background: #d14b2a;
          color: #fff8e0;
          border-color: #d14b2a;
          box-shadow: 0 0 30px rgba(209, 75, 42, 0.45);
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
          border: 1px solid var(--royal-ring);
          background: #ffffff;
          color: var(--royal);
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
          background: #ffffff;
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
          border-color: var(--royal);
          box-shadow: 0 0 0 3px var(--royal-ring);
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
          border: 1px solid var(--panel-border);
          background: #fffaea;
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
          background: #fff8e0;
          color: var(--muted);
        }
        .badge.type.task { border-color: #c79322; color: #8a6512; background: rgba(199,147,34,0.12); }
        .badge.type.goal { border-color: var(--royal); color: var(--royal); background: var(--royal-soft); }
        .badge.type.plan { border-color: var(--royal-ring); color: var(--royal); }
        .badge.type.idea { border-color: #7a4fd0; color: #4b2f94; background: rgba(122,79,208,0.12); }
        .badge.type.note { border-color: #b6aa83; color: #6e6544; }
        .badge.horizon { background: var(--royal-soft); color: var(--royal); border-color: var(--royal-ring); }
        .badge.high { border-color: #d14b2a; color: #a6381d; background: rgba(209,75,42,0.10); }
        .badge.due { border-color: var(--royal-ring); color: var(--royal); }
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
          padding: 0.42rem 0.78rem;
          border: 1px solid var(--panel-border);
          background: #fffaea;
          color: var(--text);
          cursor: pointer;
          font-size: 0.84rem;
          font-weight: 600;
        }
        .btn.approve { background: var(--royal); border-color: var(--royal); color: #fff8e0; }
        .btn.approve:hover { background: var(--royal-bright); border-color: var(--royal-bright); }
        .btn.dismiss { background: #ffffff; border-color: var(--royal-ring); color: var(--royal); }
        .empty { margin: 0.35rem 0 0; color: var(--muted); }
        @media (max-width: 880px) { .grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
