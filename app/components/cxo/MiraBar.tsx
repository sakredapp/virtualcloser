'use client'

/**
 * MiraBar — talk to Mira from the CXO executive suite. ONE floating bar at
 * the foot of the page panel (her orb, a text field, a microphone) and her
 * answer in a card just above it. Ported from Virtual Closer's ads-manager
 * dock (mira-light-dock.tsx); self-contained, nothing imported from there.
 *
 * Mount it as the LAST child of a flex-column panel: it sits in the flow and
 * sticks to the bottom of the window while the page is longer than it, so at
 * the end of the page it rests under the last row instead of over it.
 *
 *   mode='live'  POST /api/mira/ask { text } → { reply, choice?, error? }
 *   mode='demo'  never fetches; answers from `canned` by exact match.
 *
 * The microphone is plain dictation (useDictation): words are typed into the
 * bar, nothing is sent until the person sends. Where the browser has no
 * recogniser there is no microphone. Holding Space anywhere Space has no
 * meaning of its own is the microphone for as long as it is held.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { MiraOrb } from '../mira/MiraOrb'
import { useDictation } from '../mira/useDictation'
import './mira-bar.css'

export type MiraBarProps = {
  firstName?: string
  mode?: 'live' | 'demo'
  canned?: Array<{ q: string; a: string }>
  /** Demo only: a looser matcher tried after an exact `canned` hit (e.g. "send it"). */
  answer?: (q: string) => string | null
  placeholder?: string
}

type Msg = { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
type Choice = { prompt: string; options: Array<{ label: string; value: string }> }

const DEMO_FALLBACK =
  'In the live product I answer that from your numbers and your meetings. In the demo, try one of the suggested questions.'
const DEMO_DELAY_MS = 700
/** A Space tap shorter than this is a tap, not a hold: nothing is kept. */
const HOLD_TAP_MS = 250

let seq = 0
const nextId = () => `cx${Date.now().toString(36)}${(seq++).toString(36)}`

/** Space is ours only where it has no meaning of its own. */
function spaceIsFree(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  if (target.closest('input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="textbox"], [role="button"]')) return false
  return true
}

export default function MiraBar({ firstName, mode = 'live', canned = [], answer, placeholder }: MiraBarProps) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [focused, setFocused] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dictation = useDictation(useCallback((text: string) => setTyped(text), []))
  const mic = dictation.supported
  const listening = mic && dictation.listening

  // Hold Space to talk. Dictation the person tapped on is not the key's to stop.
  const held = useRef<{ at: number; ours: boolean } | null>(null)
  useEffect(() => {
    if (!mic) return
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (held.current || !spaceIsFree(e.target)) return
      e.preventDefault()
      held.current = { at: Date.now(), ours: !dictation.listening }
      if (held.current.ours) dictation.start()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !held.current) return
      const { at, ours } = held.current
      held.current = null
      if (!ours) return
      dictation.stop()
      if (Date.now() - at < HOLD_TAP_MS) setTyped('')
      else field.current?.focus()
    }
    const cancel = () => {
      if (!held.current) return
      const { ours } = held.current
      held.current = null
      if (ours) dictation.stop()
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      window.removeEventListener('blur', cancel)
    }
  }, [mic, dictation])

  // Escape closes the card; the bar stays.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Keep the newest turn in view.
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy, choice, open])

  useEffect(() => () => { if (demoTimer.current) clearTimeout(demoTimer.current) }, [])

  const push = useCallback((m: Omit<Msg, 'id'>) => setMessages((cur) => [...cur, { id: nextId(), ...m }]), [])

  const askLive = useCallback(async (text: string, display?: string) => {
    try {
      const r = await fetch('/api/mira/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, display: display ?? undefined }),
      })
      if (r.status === 401) {
        push({ role: 'assistant', content: 'Sign in again to ask Mira.', error: true })
        return
      }
      const j = (await r.json().catch(() => null)) as { reply?: string; choice?: Choice; error?: string } | null
      const reply = (j?.reply ?? '').trim()
      if (!r.ok || !j) {
        push({ role: 'assistant', content: reply || 'Something hiccuped on my end. Ask me that again in a moment.', error: true })
        return
      }
      if (reply) push({ role: 'assistant', content: reply, error: Boolean(j.error) })
      else if (j.error) push({ role: 'assistant', content: String(j.error), error: true })
      if (j.choice && Array.isArray(j.choice.options) && j.choice.options.length > 0) setChoice(j.choice)
    } catch {
      push({ role: 'assistant', content: "Couldn't reach Mira just now. Check your connection and try again.", error: true })
    } finally {
      setBusy(false)
    }
  }, [push])

  const askDemo = useCallback((text: string) => {
    const hit = canned.find((c) => c.q === text)?.a ?? answer?.(text) ?? null
    demoTimer.current = setTimeout(() => {
      demoTimer.current = null
      push({ role: 'assistant', content: hit ?? DEMO_FALLBACK })
      setBusy(false)
    }, DEMO_DELAY_MS)
  }, [canned, answer, push])

  const ask = useCallback((text: string, display?: string) => {
    const shown = (display ?? text).trim()
    if (!shown || busy) return
    setChoice(null)
    push({ role: 'user', content: shown })
    setBusy(true)
    setOpen(true)
    if (mode === 'demo') askDemo(text.trim())
    else void askLive(text.trim(), display)
  }, [busy, mode, push, askDemo, askLive])

  // Other surfaces (the Partners board's "Ask Mira") hand a question to the bar.
  const askRef = useRef(ask)
  askRef.current = ask
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim()
      if (text) askRef.current(text)
    }
    window.addEventListener('mira:ask', onAsk)
    return () => window.removeEventListener('mira:ask', onAsk)
  }, [])

  const send = (e: FormEvent) => {
    e.preventDefault()
    const text = typed.trim()
    if (!text || busy) return
    setTyped('')
    if (mic) dictation.reset()
    ask(text)
  }

  const status = busy ? 'Reading the book…' : mic ? dictation.error : null
  const on = listening ? 'listening' : focused ? 'focus' : undefined
  const showStarters = mode === 'demo' && messages.length === 0 && !busy && canned.length > 0
  const hello = firstName ? `Hi ${firstName}. ` : ''

  return (
    <form className="cx-dock" data-on={on} onSubmit={send} aria-label="Talk to Mira">
      {open && (
        <section className="cx-dock__ans" aria-label="Mira's answer">
          <header>
            <span>Mira</span>
            <button type="button" className="cx-dock__close" onClick={() => setOpen(false)} aria-label="Close Mira's answer">×</button>
          </header>
          <div className="cx-dock__body" ref={body} aria-live="polite">
            {showStarters && (
              <>
                <p className="cx-dock__hint">{hello}Try one of these, or ask your own.</p>
                <div className="cx-dock__chips" role="group" aria-label="Suggested questions">
                  {canned.map((c) => (
                    <button key={c.q} type="button" className="cx-dock__chip" onClick={() => ask(c.q)}>{c.q}</button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m) => m.role === 'user'
              ? <p key={m.id} className="cx-dock__q">{m.content}</p>
              : <p key={m.id} className="cx-dock__a" data-error={m.error ? '' : undefined}>{m.content}</p>,
            )}
            {choice && !busy && (
              <div className="cx-dock__chips" role="group" aria-label={choice.prompt}>
                {choice.options.map((o) => (
                  <button key={`${o.value}|${o.label}`} type="button" className="cx-dock__chip" onClick={() => ask(o.value, o.label)} title={o.label}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
      {status && (
        <p className="cx-dock__status" role="status" aria-live="polite">{status}</p>
      )}
      <div className="cx-dock__bar">
        <MiraOrb className="cx-dock__orb" size={26} decorative state={listening ? 'listening' : 'idle'} busy={busy} />
        <input
          ref={field}
          className="cx-dock__input"
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onFocus={() => { setFocused(true); if (mode === 'demo') setOpen(true) }}
          onBlur={() => setFocused(false)}
          placeholder={listening ? 'Listening. Just say it.' : placeholder ?? 'Ask Mira'}
          aria-label="Message Mira"
          autoComplete="off"
          enterKeyHint="send"
        />
        {typed.trim() && (
          <button type="submit" className="cx-dock__send" disabled={busy} aria-label="Send to Mira">
            {busy ? 'Wait' : 'Send'}
          </button>
        )}
        {mic && !listening && !typed.trim() && (
          <span className="cx-dock__key" aria-hidden="true">Hold Space to talk</span>
        )}
        {mic && (
          <button
            type="button"
            className="cx-dock__mic"
            aria-label={listening ? 'Stop listening' : 'Talk to Mira'}
            aria-pressed={listening}
            aria-keyshortcuts="Space"
            title="Speak and your words are typed into the bar."
            onClick={dictation.toggle}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
              <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
            </svg>
          </button>
        )}
      </div>
    </form>
  )
}
