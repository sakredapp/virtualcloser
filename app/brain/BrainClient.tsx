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
          border: 2px solid var(--ink);
          background: linear-gradient(130deg, #ff4a26 0%, var(--bg) 45%, var(--bg-deep) 100%);
          border-radius: 18px;
          padding: 1.6rem 1.8rem;
          box-shadow: 0 18px 40px rgba(10, 10, 10, 0.35);
          margin-bottom: 1.2rem;
          color: #ffffff;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: #ffffff;
          margin: 0;
          font-size: 0.78rem;
          font-weight: 800;
        }
        h1 {
          margin: 0.15rem 0 0.2rem;
          font-size: clamp(1.8rem, 3vw, 2.8rem);
          color: #ffffff;
          letter-spacing: -0.01em;
        }
        .sub {
          margin: 0;
          color: rgba(255,255,255,0.9);
        }
        .card {
          border: 2px solid var(--ink);
          background: var(--panel-deep);
          color: #ffffff;
          border-radius: 14px;
          padding: 1rem;
          margin-bottom: 0.8rem;
          box-shadow: 0 10px 24px rgba(10, 10, 10, 0.28);
        }
        .rec-row {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .mic {
          padding: 0.75rem 1.2rem;
          border-radius: 999px;
          border: 2px solid var(--ink);
          background: #ffffff;
          color: var(--ink);
          cursor: pointer;
          font-weight: 700;
          box-shadow: 0 8px 22px rgba(10, 10, 10, 0.3);
        }
        .mic:hover {
          background: var(--accent);
          color: #ffffff;
          border-color: var(--ink);
        }
        .mic.on {
          background: var(--ink);
          color: #ffffff;
          border-color: var(--ink);
          box-shadow: 0 0 30px rgba(255, 40, 0, 0.6);
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
          border: 2px solid var(--ink);
          background: var(--ink);
          color: #ffffff;
          cursor: pointer;
          font-weight: 700;
        }
        .save:hover { background: var(--accent); color: #ffffff; }
        .save:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        textarea {
          width: 100%;
          margin-top: 0.8rem;
          background: #ffffff;
          color: var(--ink);
          border: 2px solid var(--ink);
          border-radius: 10px;
          padding: 0.8rem;
          font-family: inherit;
          font-size: 0.95rem;
          resize: vertical;
        }
        textarea:focus {
          outline: none;
          border-color: var(--ink);
          box-shadow: 0 0 0 3px var(--accent);
        }
        .summary {
          margin: 0.8rem 0 0;
          color: rgba(255,255,255,0.9);
          font-style: italic;
        }
        .hint {
          margin: 0.5rem 0 0;
          color: rgba(255,255,255,0.8);
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
          font-size: 1.1rem;
          color: #ffffff;
        }
        .section-head p {
          margin: 0;
          color: rgba(255,255,255,0.85);
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
          border: 1px solid var(--ink);
          background: #ffffff;
          color: var(--ink);
          border-radius: 10px;
          padding: 0.75rem;
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
          letter-spacing: 0.08em;
          padding: 0.18rem 0.55rem;
          border-radius: 999px;
          border: 1px solid var(--ink);
          background: #ffffff;
          color: var(--ink);
          font-weight: 700;
        }
        .badge.type.task { background: #ffd400; color: var(--ink); }
        .badge.type.goal { background: var(--accent); color: #ffffff; }
        .badge.type.plan { background: #ffffff; color: var(--ink); }
        .badge.type.idea { background: var(--ink); color: #ffffff; }
        .badge.type.note { background: #ffffff; color: var(--ink); }
        .badge.horizon { background: var(--ink); color: #ffffff; }
        .badge.high { background: var(--accent); color: #ffffff; }
        .badge.due { background: #ffffff; color: var(--ink); }
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
          border-radius: 10px;
          padding: 0.45rem 0.85rem;
          border: 2px solid var(--ink);
          background: #ffffff;
          color: var(--ink);
          cursor: pointer;
          font-size: 0.88rem;
          font-weight: 700;
        }
        .btn.approve { background: var(--ink); border-color: var(--ink); color: #ffffff; }
        .btn.approve:hover { background: var(--accent); border-color: var(--ink); color: #ffffff; }
        .btn.dismiss { background: #ffffff; border-color: var(--ink); color: var(--ink); }
        .empty { margin: 0.35rem 0 0; color: rgba(255,255,255,0.85); }
        @media (max-width: 880px) { .grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
