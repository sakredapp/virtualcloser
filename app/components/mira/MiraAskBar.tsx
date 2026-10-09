'use client'

/**
 * MiraAskBar — the one way you ask Mira anything. A pill, translucent over
 * whatever is behind it, the orb at the left, Enter sends, Shift+Enter is a
 * new line, Esc clears. The field grows up to six lines, then scrolls.
 *
 * THE ORB IS THE MICROPHONE. Tap it to dictate into the bar through the
 * browser's own recogniser (useDictation); tap again to stop. Dictation never
 * submits: the transcript stays in the field, editable, and goes out with
 * Enter or the arrow. Where the browser has no recogniser the orb is plain
 * decoration, never a greyed button.
 *
 * Ported from sakredcrm's components/mira/mira-ask-bar.tsx, minus hands-free
 * voice mode and the voice picker. Icons are inline SVG (no icon dependency).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MiraOrb, type MiraOrbState } from './MiraOrb'
import { useDictation } from './useDictation'
import './mira.css'

export const MIRA_ASK_PLACEHOLDER = 'Ask Mira'
const MAX_LINES = 6
const LINE_PX = 22

export type MiraAskBarProps = {
  /** Called with the trimmed text on Enter, on the send button, or on a chip. */
  onAsk: (text: string) => void
  /** Mira is working: the orb shows `thinking`, sending is held, typing is not. */
  busy?: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  /** Override the orb state. Default: listening while dictating, thinking when busy, else idle. */
  orbState?: MiraOrbState
}

function MicGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}

function ArrowUpGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  )
}

export function MiraAskBar({ onAsk, busy = false, disabled = false, placeholder = MIRA_ASK_PLACEHOLDER, autoFocus, orbState }: MiraAskBarProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  // Dictation replaces the words spoken THIS session after whatever was in the
  // bar when the microphone was pressed.
  const spokenFrom = useRef('')
  const textRef = useRef(text)
  textRef.current = text
  const followCaret = useRef(false)
  const dictation = useDictation((spoken) => {
    followCaret.current = true
    setText(spokenFrom.current + spoken)
  })
  const resetDictation = dictation.reset

  const ask = useCallback((raw: string) => {
    const q = raw.trim()
    if (!q || busy || disabled) return
    onAsk(q)
    setText('')
    spokenFrom.current = ''
    resetDictation()
  }, [busy, disabled, onAsk, resetDictation])

  const onSubmit = (e: FormEvent) => { e.preventDefault(); ask(text) }

  const onMic = () => {
    if (!dictation.listening) {
      const before = textRef.current.trimEnd()
      spokenFrom.current = before ? `${before} ` : ''
      input.current?.focus()
    }
    dictation.toggle()
  }

  const stopDictation = dictation.stop
  useEffect(() => { if (disabled) stopDictation() }, [disabled, stopDictation])

  // Height follows the text, one line up to MAX_LINES, then it scrolls.
  const [multiline, setMultiline] = useState(false)
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
    const pad = (parseFloat(cs?.paddingTop || '') || 0) + (parseFloat(cs?.paddingBottom || '') || 0)
    const max = LINE_PX * MAX_LINES + pad
    const content = el.scrollHeight
    const grown = content > LINE_PX * 1.5 + pad
    el.style.height = grown ? `${Math.min(content, max)}px` : ''
    el.style.overflowY = content > max ? 'auto' : 'hidden'
    setMultiline(grown)
    if (followCaret.current) {
      followCaret.current = false
      const end = el.value.length
      try { el.setSelectionRange(end, end) } catch { /* not focusable right now */ }
      el.scrollTop = el.scrollHeight
    }
  }, [text])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      ask(text)
      return
    }
    if (e.key !== 'Escape') return
    if (text) { e.preventDefault(); e.stopPropagation(); setText('') }
  }

  const orb: MiraOrbState = orbState ?? (dictation.listening ? 'listening' : busy ? 'thinking' : 'idle')
  const canSend = !!text.trim() && !busy && !disabled
  const micLabel = dictation.listening ? 'Stop listening' : 'Talk to Mira'

  return (
    <div
      className={['mira-ask', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}
      data-busy={busy || undefined}
      data-listening={dictation.listening || undefined}
      data-multiline={multiline || undefined}
    >
      <form className="mira-ask__bar" onSubmit={onSubmit} aria-busy={busy || undefined}>
        {dictation.supported ? (
          <button
            type="button"
            className="mira-ask__orb-btn"
            onClick={onMic}
            disabled={disabled}
            aria-pressed={dictation.listening}
            aria-label={micLabel}
            title={micLabel}
          >
            <MiraOrb state={orb} size={28} dim={disabled} decorative />
            <span className="mira-ask__orb-glyph" aria-hidden><MicGlyph size={10} /></span>
          </button>
        ) : (
          <span className="mira-ask__orb-still"><MiraOrb state={orb} size={28} dim={disabled} decorative /></span>
        )}
        <textarea
          ref={input}
          id={id}
          className="mira-ask__input"
          rows={1}
          inputMode="text"
          enterKeyHint="send"
          autoComplete="off"
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {text.trim() && (
          <button type="submit" className="mira-ask__send" disabled={!canSend} aria-label="Send">
            <ArrowUpGlyph size={17} />
          </button>
        )}
      </form>
      {dictation.error && (
        <p className="mira-ask__note" role="status">{dictation.error}</p>
      )}
    </div>
  )
}
