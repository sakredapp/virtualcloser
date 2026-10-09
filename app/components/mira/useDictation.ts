'use client'

/**
 * useDictation — talk to Mira through the browser's own Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). Nothing is sent to us: audio
 * goes to the browser vendor's recogniser, the text comes back into the bar,
 * and the bar sends it exactly as typed text is sent. Nothing here submits.
 *
 *   press       → on, and it STAYS on (interim results shown live, continuous)
 *   press again → off. Nothing else turns it off.
 *
 * Chrome ends a recognition session on its own after a few seconds of
 * silence; while the person has the microphone on, `onend` means "start the
 * next session". The on/off intent lives in a ref (`wanted`), so a re-render
 * or a sent turn cannot flip it. Only the person's own press, `stop`, unmount,
 * and the two errors a restart cannot fix (`not-allowed`, `audio-capture`)
 * turn it off.
 *
 * Ported from sakredcrm's components/mira/use-dictation.ts. `supported` is
 * decided on mount (not at module load) so server and client render the same
 * first frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type RecognitionResult = { isFinal: boolean; 0: { transcript: string; confidence?: number } }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function joinSpeech(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return /\s$/.test(a) || /^\s/.test(b) ? `${a}${b}` : `${a} ${b}`
}

/** The two errors a restart cannot fix, and the one line each shows. */
const DICTATION_FATAL: Readonly<Record<string, string>> = {
  'not-allowed': 'Microphone access is blocked for this site.',
  'service-not-allowed': 'Microphone access is blocked for this site.',
  'audio-capture': 'No microphone was found.',
}

const DICTATION_RESTART_MS = 150

export type Dictation = {
  /** False where the browser has no recogniser: render no microphone. */
  supported: boolean
  /** The person has it on. Stays true through silence and session restarts. */
  listening: boolean
  /** One plain line when the microphone cannot be used at all, else null. */
  error: string | null
  start: () => void
  stop: () => void
  toggle: () => void
  /** Forget everything heard so far (the bar just sent it); keep listening. */
  reset: () => void
}

/**
 * `onTranscript(text)` fires on every recognition result with the WHOLE
 * transcript heard since the microphone was turned on (or since `reset()`),
 * interim words included, so the caller replaces, never appends.
 */
export function useDictation(onTranscript: (text: string, final: boolean) => void): Dictation {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const wanted = useRef(false)
  const settled = useRef('')
  const live = useRef('')
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef(onTranscript)
  cb.current = onTranscript

  useEffect(() => { setSupported(recognitionCtor() !== null) }, [])

  const clearRestart = () => {
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null }
  }

  const openSession = useCallback(function openSession(): void {
    if (!wanted.current || rec.current) return
    const Ctor = recognitionCtor()
    if (!Ctor) return
    let r: Recognition
    try {
      r = new Ctor()
    } catch {
      return
    }
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    r.interimResults = true
    r.continuous = true
    r.maxAlternatives = 1
    live.current = ''
    r.onresult = (e) => {
      let text = ''
      let final = true
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        text = joinSpeech(text, res[0]?.transcript ?? '')
        if (!res.isFinal) final = false
      }
      live.current = text
      cb.current(`${settled.current}${text}`.replace(/\s+/g, ' ').trimStart(), final)
    }
    r.onerror = (e) => {
      const reason = e?.error ? DICTATION_FATAL[e.error] : undefined
      if (!reason) return // no-speech, aborted, network: onend follows and reopens
      wanted.current = false
      setError(reason)
    }
    r.onend = () => {
      if (rec.current === r) rec.current = null
      if (live.current.trim()) settled.current = `${settled.current}${live.current}`.replace(/\s+/g, ' ').trimStart() + ' '
      live.current = ''
      if (!wanted.current) { setListening(false); return }
      clearRestart()
      restartTimer.current = setTimeout(() => { restartTimer.current = null; openSession() }, DICTATION_RESTART_MS)
    }
    try {
      r.start()
    } catch {
      if (wanted.current) {
        clearRestart()
        restartTimer.current = setTimeout(() => { restartTimer.current = null; openSession() }, DICTATION_RESTART_MS)
      }
      return
    }
    rec.current = r
  }, [])

  const start = useCallback(() => {
    if (recognitionCtor() === null || wanted.current) return
    wanted.current = true
    settled.current = ''
    live.current = ''
    setError(null)
    setListening(true)
    openSession()
  }, [openSession])

  const stop = useCallback(() => {
    if (!wanted.current && !rec.current) return
    wanted.current = false
    clearRestart()
    rec.current?.stop()
    setListening(false)
  }, [])

  const toggle = useCallback(() => {
    if (wanted.current) stop()
    else start()
  }, [start, stop])

  const reset = useCallback(() => {
    settled.current = ''
    live.current = ''
    if (!wanted.current) return
    const r = rec.current
    if (r) { rec.current = null; try { r.abort() } catch { /* already gone */ } }
    clearRestart()
    restartTimer.current = setTimeout(() => { restartTimer.current = null; openSession() }, DICTATION_RESTART_MS)
  }, [openSession])

  // Leaving the surface mid-sentence must not leave the microphone open.
  useEffect(() => () => {
    wanted.current = false
    clearRestart()
    rec.current?.abort()
    rec.current = null
  }, [])

  return { supported, listening, error, start, stop, toggle, reset }
}
