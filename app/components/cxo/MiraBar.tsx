'use client'

/**
 * MiraBar — talk to Mira from the CXO executive suite. ONE floating bar at
 * the foot of the page panel (her orb, a text field, a microphone) and her
 * answer in a card just above it. Ported from Virtual Closer's ads-manager
 * dock (mira-light-dock.tsx); self-contained, nothing imported from there.
 *
 * Mount it as the LAST child of a flex-column panel: it sits in the flow and
 * sticks to the bottom of the window while the page is longer than it, so at
 * the end of the page it rests under the last row instead of over it. With
 * the answer card open on a wide screen the whole dock moves to a column on
 * the right and the panel makes room for it, so it never covers the page;
 * changing page folds the card away.
 *
 *   mode='live'  POST /api/mira/ask { text } → { reply, choice?, error? }
 *   mode='demo'  never fetches; answers from `canned` by exact match.
 *
 * The microphone is plain dictation (useDictation): words are typed into the
 * bar, nothing is sent until the person sends. Where the browser has no
 * recogniser there is no microphone. Holding Space anywhere Space has no
 * meaning of its own is the microphone for as long as it is held.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { usePathname } from 'next/navigation'
import { MiraOrb } from '../mira/MiraOrb'
import Markdown from './Markdown'
import { useDictation } from '../mira/useDictation'
import './mira-bar.css'

export type MiraBarProps = {
  firstName?: string
  mode?: 'live' | 'demo'
  canned?: Array<{ q: string; a: string }>
  /** Demo only: a looser matcher tried after an exact `canned` hit (e.g. "send it"). */
  answer?: (q: string) => string | null
  placeholder?: string
  /** Live mode: suggested questions shown before the first one (employee logins). */
  starters?: string[]
  /** One line behind an ⓘ in the answer header: what Mira can and can't do here. */
  explainer?: string
}

type Msg = { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
type Choice = { prompt: string; options: Array<{ label: string; value: string }> }

const DEMO_FALLBACK =
  'In the live product I answer that from your numbers and your meetings. In the demo, try one of the suggested questions.'
const DEMO_DELAY_MS = 700
/** A Space tap shorter than this is a tap, not a hold: nothing is kept. */
const HOLD_TAP_MS = 250
/** Talk mode sends what was said after this long a pause. */
const TALK_PAUSE_MS = 1400
/** The field grows to this many lines, then scrolls. */
const MAX_LINES = 6
const LINE_PX = 22

let seq = 0
const nextId = () => `cx${Date.now().toString(36)}${(seq++).toString(36)}`

/** Space is ours only where it has no meaning of its own. */
function spaceIsFree(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  if (target.closest('input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="textbox"], [role="button"]')) return false
  return true
}

export default function MiraBar({ firstName, mode = 'live', canned = [], answer, placeholder, starters = [], explainer }: MiraBarProps) {
  const [open, setOpen] = useState(false)
  const [why, setWhy] = useState(false)
  const [typed, setTyped] = useState('')
  const [focused, setFocused] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [talk, setTalk] = useState(false)
  const [micMenu, setMicMenu] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const talkSend = useRef<(text: string) => void>(() => {})
  const body = useRef<HTMLDivElement>(null)
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dictation = useDictation(useCallback((text: string, final: boolean) => {
    setTyped(text)
    // Talk mode: a pause after a finished sentence sends it, and she keeps listening.
    if (talkTimer.current) { clearTimeout(talkTimer.current); talkTimer.current = null }
    if (talkModeRef.current && final && text.trim()) {
      talkTimer.current = setTimeout(() => { talkTimer.current = null; talkSend.current(text) }, TALK_PAUSE_MS)
    }
  }, []))
  const talkModeRef = useRef(false)
  talkModeRef.current = talk
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

  // The field grows with what is typed, up to MAX_LINES, then scrolls.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    const max = MAX_LINES * LINE_PX
    el.style.height = `${Math.min(Math.max(el.scrollHeight, LINE_PX), max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [typed])

  // Listening stops: Talk mode ends with it.
  useEffect(() => {
    if (!dictation.listening) {
      setTalk(false)
      if (talkTimer.current) { clearTimeout(talkTimer.current); talkTimer.current = null }
    }
  }, [dictation.listening])

  useEffect(() => {
    if (!micMenu) return
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.cx-dock__micwrap')) setMicMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [micMenu])

  // A new page starts with the card folded away (owner 10-09: an answer from
  // Today was left floating over the middle of Sales Plan). The bar stays and
  // the conversation is kept; focusing the bar brings the card back.
  const pathname = usePathname()
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    setOpen(false)
    setMicMenu(false)
  }, [pathname])

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
    // "Ask Mira" buttons that only want the bar: focus it, optionally pre-filled.
    const onFocus = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (typeof text === 'string') setTyped(text)
      setOpen(true)
      requestAnimationFrame(() => {
        const el = field.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
    window.addEventListener('mira:ask', onAsk)
    window.addEventListener('mira:focus', onFocus)
    return () => {
      window.removeEventListener('mira:ask', onAsk)
      window.removeEventListener('mira:focus', onFocus)
    }
  }, [])

  const sendText = (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setTyped('')
    if (mic) dictation.reset()
    ask(text)
  }
  talkSend.current = sendText
  const send = (e: FormEvent) => {
    e.preventDefault()
    sendText(typed)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendText(typed)
    }
  }
  const startMode = (m: 'dictate' | 'talk') => {
    setMicMenu(false)
    if (listening) dictation.stop()
    setTalk(m === 'talk')
    talkModeRef.current = m === 'talk'
    dictation.start()
    if (m === 'dictate') field.current?.focus()
  }

  const status = busy ? 'Reading the book…' : mic ? dictation.error : null
  const on = listening ? 'listening' : focused ? 'focus' : undefined
  const starterQs = mode === 'demo' ? canned.map((c) => c.q) : starters
  const showStarters = messages.length === 0 && !busy && starterQs.length > 0
  const hello = firstName ? `Hi ${firstName}. ` : ''

  return (
    <form className="cx-dock" data-on={on} onSubmit={send} aria-label="Talk to Mira">
      {open && (
        <section className="cx-dock__ans" aria-label="Mira's answer">
          <header>
            <span>
              Mira
              {explainer && (
                <button type="button" className="cx-dock__close" style={{ width: 22, height: 22, fontSize: 13, marginLeft: 4 }} onClick={() => setWhy((v) => !v)} aria-expanded={why} aria-label="What Mira can do here" title={explainer}>ⓘ</button>
              )}
            </span>
            <button type="button" className="cx-dock__close" onClick={() => setOpen(false)} aria-label="Close Mira's answer">×</button>
          </header>
          <div className="cx-dock__body" ref={body} aria-live="polite">
            {explainer && why && <p className="cx-dock__hint" style={{ textTransform: 'none' }}>{explainer}</p>}
            {showStarters && (
              <>
                <p className="cx-dock__hint">{hello}Try one of these, or ask your own.</p>
                <div className="cx-dock__chips" role="group" aria-label="Suggested questions">
                  {starterQs.map((q) => (
                    <button key={q} type="button" className="cx-dock__chip" onClick={() => ask(q)}>{q}</button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m) => m.role === 'user'
              ? <p key={m.id} className="cx-dock__q">{m.content}</p>
              : <div key={m.id} className="cx-dock__a" data-error={m.error ? '' : undefined}><Markdown text={m.content} /></div>,
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
        <textarea
          ref={field}
          className="cx-dock__input"
          rows={1}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { setFocused(true); if (mode === 'demo' || messages.length > 0 || starterQs.length > 0) setOpen(true) }}
          onBlur={() => setFocused(false)}
          placeholder={listening ? (talk ? 'Talking. Pause and I answer.' : 'Listening. Just say it.') : placeholder ?? 'Ask Mira'}
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
          // Space types a space while the field has focus, so the hint changes with it.
          <span className="cx-dock__key" aria-hidden="true">{focused ? 'Click the mic to talk' : 'Hold Space to talk'}</span>
        )}
        {mic && (
          <span className="cx-dock__micwrap">
            <button
              type="button"
              className="cx-dock__mic"
              aria-label={listening ? 'Stop listening' : 'Talk to Mira'}
              aria-pressed={listening}
              aria-haspopup={listening ? undefined : 'menu'}
              aria-expanded={listening ? undefined : micMenu}
              aria-keyshortcuts="Space"
              title={listening ? 'Stop' : 'Dictate or talk'}
              onClick={() => (listening ? dictation.stop() : setMicMenu((v) => !v))}
            >
              {listening ? (
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
                  <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
                </svg>
              )}
            </button>
            {micMenu && !listening && (
              <span className="cx-dock__micmenu" role="menu">
                <button type="button" role="menuitem" onClick={() => startMode('dictate')}>
                  <strong>Dictate</strong>
                  <span>Your words are typed in. You send.</span>
                </button>
                <button type="button" role="menuitem" onClick={() => startMode('talk')}>
                  <strong>Talk</strong>
                  <span>Speak; pause and Mira answers.</span>
                </button>
              </span>
            )}
          </span>
        )}
      </div>
    </form>
  )
}
