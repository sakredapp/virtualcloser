'use client'

/**
 * MiraDock — the floating Mira orb at the bottom-right of every signed-in
 * dashboard screen. Tap it and her thread opens above it: prior turns, her
 * answers, tappable choices when she asks you to pick, and the ask bar (type
 * or talk). Talks to POST /api/mira/ask, which runs the same agent the
 * dashboard's data lives behind.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MiraOrb } from './MiraOrb'
import { MiraAskBar } from './MiraAskBar'
import './mira.css'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
type Choice = { prompt: string; options: Array<{ label: string; value: string }> }

const STARTERS = [
  'How did yesterday go?',
  'What does today look like?',
  "What's waiting on me?",
  'How is revenue pacing this month?',
]

let seq = 0
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`

function CloseGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export default function MiraDock({ firstName }: { firstName?: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const thread = useRef<HTMLDivElement>(null)

  // Prior turns, once, the first time the panel opens.
  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    fetch('/api/mira/ask', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { messages?: Array<{ role: 'user' | 'assistant'; content: string }> } | null) => {
        if (cancelled) return
        const prior = (j?.messages ?? [])
          .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
          .map((m) => ({ id: nextId(), role: m.role, content: m.content }))
        setMessages((cur) => (cur.length ? cur : prior))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [open, loaded])

  // Keep the newest turn in view.
  useEffect(() => {
    const el = thread.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, busy, choice, open])

  // Esc closes the panel (the ask bar swallows Esc only while it holds text).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const send = useCallback(async (text: string, display?: string) => {
    const shown = (display ?? text).trim()
    if (!shown || busy) return
    setChoice(null)
    setMessages((cur) => [...cur, { id: nextId(), role: 'user', content: shown }])
    setBusy(true)
    try {
      const r = await fetch('/api/mira/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, display: display ?? undefined }),
      })
      if (r.status === 401) {
        setMessages((cur) => [...cur, { id: nextId(), role: 'assistant', content: 'Your session has expired. Sign in again and ask me that once more.', error: true }])
        return
      }
      const j = (await r.json().catch(() => null)) as { reply?: string; choice?: Choice; error?: string } | null
      const reply = (j?.reply ?? '').trim()
      if (!r.ok || !j) {
        setMessages((cur) => [...cur, { id: nextId(), role: 'assistant', content: reply || 'Something hiccuped on my end. Ask me that again in a moment.', error: true }])
        return
      }
      if (reply) setMessages((cur) => [...cur, { id: nextId(), role: 'assistant', content: reply, error: Boolean(j.error) }])
      if (j.choice && Array.isArray(j.choice.options) && j.choice.options.length > 0) setChoice(j.choice)
    } catch {
      setMessages((cur) => [...cur, { id: nextId(), role: 'assistant', content: "Couldn't reach Mira just now. Check your connection and try again.", error: true }])
    } finally {
      setBusy(false)
    }
  }, [busy])

  // Other pages (Partners "Ask Mira to send something") hand Mira a question.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim()
      if (!text) return
      setOpen(true)
      void send(text)
    }
    window.addEventListener('mira:ask', onAsk)
    return () => window.removeEventListener('mira:ask', onAsk)
  }, [send])

  const greetName = firstName ? `, ${firstName}` : ''

  return (
    <div className="mira-dock" data-open={open || undefined}>
      {open && (
        <section className="mira-dock__panel" role="dialog" aria-label="Mira" aria-modal={false}>
          <header className="mira-dock__head">
            <MiraOrb state={busy ? 'thinking' : 'idle'} size={30} decorative />
            <div className="mira-dock__title">
              <span className="mira-dock__name">Mira</span>
              <span className="mira-dock__sub">Your numbers and your meetings</span>
            </div>
            <button type="button" className="mira-dock__close" onClick={() => setOpen(false)} aria-label="Close Mira">
              <CloseGlyph />
            </button>
          </header>

          <div className="mira-dock__thread" ref={thread} aria-live="polite">
            {messages.length === 0 && !busy && (
              <div className="mira-dock__greet">
                <strong>Hi{greetName}.</strong>
                I answer from your numbers and your meetings. Ask me how the book is pacing, what moved, or what came up on a call.
                <div className="mira-chips" style={{ justifyContent: 'center', marginTop: 12 }}>
                  {STARTERS.map((s) => (
                    <button key={s} type="button" className="mira-chip" onClick={() => send(s)} disabled={busy || !loaded}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={['mira-msg', `mira-msg--${m.role}`, m.error ? 'mira-msg--error' : ''].filter(Boolean).join(' ')}>
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="mira-msg mira-msg--assistant mira-msg--thinking">
                <MiraOrb state="thinking" size={16} decorative /> Mira is thinking…
              </div>
            )}
            {choice && !busy && (
              <div className="mira-dock__choices">
                <div className="mira-chips" role="group" aria-label={choice.prompt}>
                  {choice.options.map((o) => (
                    <button key={`${o.value}|${o.label}`} type="button" className="mira-chip" onClick={() => send(o.value, o.label)} title={o.label}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mira-dock__compose">
            <MiraAskBar onAsk={(t) => send(t)} busy={busy} autoFocus placeholder="Ask Mira" />
          </div>
        </section>
      )}

      {!open && (
        <button type="button" className="mira-dock__fab" onClick={() => setOpen(true)} aria-label="Ask Mira" title="Ask Mira">
          <span className="mira-dock__fab-label" aria-hidden>Ask Mira</span>
          <span className="mira-dock__fab-orb"><MiraOrb state="idle" size={44} decorative /></span>
        </button>
      )}
    </div>
  )
}
