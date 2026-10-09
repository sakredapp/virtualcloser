'use client'

/**
 * MiraOrb — Mira's face. A soft, slowly turning, glowing sphere. Used alone as
 * a presence mark (the dock button) or at the left of <MiraAskBar/>.
 *
 * Ported from sakredcrm's components/mira/mira-orb.tsx. CSS only — three
 * gradient layers moved by transform (mira.css). The clock stops when the orb
 * is off-screen or the tab is hidden, and under prefers-reduced-motion it is
 * a still glow whose brightness still carries the state.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './mira.css'

/** `thinking` is the busy state: Mira is working on an answer. */
export type MiraOrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type MiraOrbProps = {
  state?: MiraOrbState
  /** Shorthand used by ask surfaces: `busy` wins over `state` and shows `thinking`. */
  busy?: boolean
  /** Pixel diameter. 28 sits in the ask bar; 44-64 works as a mark. */
  size?: number
  /** Greyed down: the surface is disabled or Mira is unavailable. */
  dim?: boolean
  /** Overrides the spoken name ("Mira is thinking", ...). */
  title?: string
  /** Beside a labelled input the orb is decoration: hide it from assistive tech. */
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

const STATE_LABEL: Record<MiraOrbState, string> = {
  idle: 'Mira',
  listening: 'Mira is listening',
  thinking: 'Mira is thinking',
  speaking: 'Mira is answering',
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

export function MiraOrb({ state = 'idle', busy = false, size = 28, dim = false, title, decorative = false, className, style }: MiraOrbProps) {
  const host = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const onStage = useOnStage(host)
  const shown: MiraOrbState = busy ? 'thinking' : state
  const label = decorative ? undefined : title ?? STATE_LABEL[shown]

  return (
    <span
      ref={host}
      className={['mira-orb', `mira-orb--${shown}`, dim ? 'is-dim' : '', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ['--mira-size' as string]: `${size}px`, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={shown}
      data-paused={onStage ? undefined : ''}
      data-reduced={reduced ? '' : undefined}
    >
      <span className="mira-orb__clip" aria-hidden>
        <span className="mira-orb__layer mira-orb__core" />
        <span className="mira-orb__layer mira-orb__swirl" />
        <span className="mira-orb__layer mira-orb__swirl mira-orb__swirl--b" />
        <span className="mira-orb__layer mira-orb__sheen" />
      </span>
    </span>
  )
}
