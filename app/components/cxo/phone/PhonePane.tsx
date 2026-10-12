'use client'

/**
 * One settings section as its own page on a phone. The section is the same
 * one a wider screen shows on the Settings page (same form, same server
 * action); only how it is reached changes. On a phone it is hidden until its
 * row on Me is tapped, then it takes the page with a back button and its
 * name. On a wider screen the wrapper is not a box (cxo-phone.css,
 * `.cxph-pane { display: contents }`), so nothing moves.
 *
 * Opening a section adds a step to the browser's history, so the phone's own
 * back gesture closes it instead of leaving Me. The address does not change.
 *
 * Closing (the back button or the back gesture) plays the page's way out
 * first: for LEAVE_MS the wrapper says data-open="leaving" and cxo-phone.css
 * sinks it, then Me comes back. Only on a phone, and only when the person has
 * not asked for reduced motion; otherwise it is the cut it always was.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

/** How long a closing section stays on the page (cxo-phone.css, cxph-sink). */
const LEAVE_MS = 200
const canSlide = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px) and (prefers-reduced-motion: no-preference)').matches

let current: string | null = null
/** We added a history step for the open section (so Back should take it away). */
let pushed = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function openPhonePane(id: string) {
  current = id
  try {
    window.history.pushState({ ...(window.history.state ?? {}), cxphPane: id }, '')
    pushed = true
  } catch {
    pushed = false
  }
  emit()
  window.scrollTo(0, 0)
}

export function closePhonePane() {
  if (pushed) {
    // The popstate listener below clears the section.
    pushed = false
    window.history.back()
    return
  }
  current = null
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const next = (window.history.state as { cxphPane?: unknown } | null)?.cxphPane
    current = typeof next === 'string' ? next : null
    if (!current) pushed = false
    emit()
  })
}

/** A row on Me that opens a section. */
export function PhonePaneLink({ pane, className, children }: { pane: string; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => openPhonePane(pane)}>
      {children}
    </button>
  )
}

export default function PhonePane({ id, title, startOpen = false, children }: {
  id: string
  title: string
  /** The page came back from this section's own form (a saved or an error note is showing): open on it. */
  startOpen?: boolean
  children: React.ReactNode
}) {
  const store = useSyncExternalStore(subscribe, () => current, () => null)
  const [flash, setFlash] = useState(startOpen)
  const open = store === id || (flash && store === null)
  // 'leaving' = just closed, still drawn while it sinks; 'left' = gone, and Me is rising back in.
  const [exit, setExit] = useState<'leaving' | 'left' | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setExit(!open && canSlide() ? 'leaving' : null)
  }
  useEffect(() => {
    if (!exit) return
    const t = setTimeout(() => setExit(exit === 'leaving' ? 'left' : null), exit === 'leaving' ? LEAVE_MS : 300)
    return () => clearTimeout(t)
  }, [exit])

  // Leaving the page closes the section, so coming back to Me shows the list.
  useEffect(() => () => {
    if (current === id) {
      current = null
      pushed = false
    }
  }, [id])

  const back = () => {
    setFlash(false)
    if (store === id) closePhonePane()
  }

  return (
    <div className="cxph-pane" data-pane={id} data-open={open ? 'true' : exit === 'leaving' ? 'leaving' : 'false'} data-left={exit === 'left' ? '' : undefined}>
      <div className="cxph cxph-pane__head">
        <button type="button" className="cxph-round" onClick={back} aria-label="Back to Me">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m14.5 6-6 6 6 6" /></svg>
        </button>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  )
}
