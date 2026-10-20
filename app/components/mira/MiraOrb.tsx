'use client'

/**
 * MiraOrb — the assistant's face (Ciao on Suite CXO, Mira on Virtual Closer).
 * Used alone as a presence mark (the dock, the phone tab bar, the Ciao page) or
 * at the left of <MiraAskBar/>. Every orb in the app is this one component.
 *
 * The HD orb (owner 2026-10-20): the same sphere as the Run My Ads app icon
 * (Ados) — one radial gradient lit from the upper left, drawn as SVG so it is
 * sharp at 16px and on a retina hero — in three tones: black (Suite CXO),
 * red (Virtual Closer), blue (Run My Ads). Colours and states live in mira.css.
 * The clock stops when the orb is off-screen or the tab is hidden, and under
 * prefers-reduced-motion it is a still sphere whose glow still carries the state.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import './mira.css'
import { useAssistantName } from '@/app/components/AssistantNameProvider'

/** `thinking` is the busy state: Mira is working on an answer. */
export type MiraOrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

/** black = Suite CXO / Ciao, red = Virtual Closer / Mira, blue = Run My Ads / Ados.
 *  Unset: the brand on <html data-brand> picks (Suite CXO black, otherwise red). */
export type MiraOrbTone = 'black' | 'red' | 'blue'

export type MiraOrbProps = {
  state?: MiraOrbState
  /** Shorthand used by ask surfaces: `busy` wins over `state` and shows `thinking`. */
  busy?: boolean
  /** Pixel diameter. 28 sits in the ask bar; 44-64 works as a mark. */
  size?: number
  /** Greyed down: the surface is disabled or Mira is unavailable. */
  dim?: boolean
  /** Force a tone; unset follows the brand. */
  tone?: MiraOrbTone
  /** Overrides the spoken name ("Mira is thinking", ...). */
  title?: string
  /** Beside a labelled input the orb is decoration: hide it from assistive tech. */
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

function stateLabel(state: MiraOrbState, name: string): string {
  const labels: Record<MiraOrbState, string> = {
    idle: name,
    listening: `${name} is listening`,
    thinking: `${name} is thinking`,
    speaking: `${name} is answering`,
  }
  return labels[state]
}

/** True while the element is on screen AND the tab is visible. */
function useOnStage(ref: React.RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(true)
  const [tabVisible, setTabVisible] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setSeen(e.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const on = () => setTabVisible(document.visibilityState !== 'hidden')
    on()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  return seen && tabVisible
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export function MiraOrb({ state = 'idle', busy = false, size = 28, dim = false, tone, title, decorative = false, className, style }: MiraOrbProps) {
  const assistantName = useAssistantName()
  const gid = `mira-orb-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const host = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const onStage = useOnStage(host)
  const shown: MiraOrbState = busy ? 'thinking' : state
  const label = decorative ? undefined : title ?? stateLabel(shown, assistantName)

  return (
    <span
      ref={host}
      className={['mira-orb', `mira-orb--${shown}`, tone ? `mira-orb--${tone}` : '', dim ? 'is-dim' : '', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ['--mira-size' as string]: `${size}px`, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={shown}
      data-paused={onStage ? undefined : ''}
      data-reduced={reduced ? '' : undefined}
    >
      <svg className="mira-orb__sphere" viewBox="0 0 100 100" aria-hidden focusable="false">
        <defs>
          {/* The Run My Ads icon's light, measured off the 1024px icon: centre (35.8%, 29.8%), radius 74.4%. */}
          <radialGradient id={`${gid}-g`} cx="35.8%" cy="29.8%" r="74.4%" fx="35.8%" fy="29.8%">
            <stop offset="0" className="mira-orb__hi" />
            <stop offset="0.4" className="mira-orb__body" />
            <stop offset="1" className="mira-orb__deep" />
          </radialGradient>
          <radialGradient id={`${gid}-l`} cx="35.8%" cy="29.8%" r="30%">
            <stop offset="0" className="mira-orb__hi" stopOpacity="0.55" />
            <stop offset="1" className="mira-orb__hi" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill={`url(#${gid}-g)`} />
        <circle className="mira-orb__glint" cx="50" cy="50" r="50" fill={`url(#${gid}-l)`} />
        <circle className="mira-orb__rim" cx="50" cy="50" r="49.5" />
      </svg>
    </span>
  )
}
