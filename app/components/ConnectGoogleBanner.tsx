'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Shown to a member who hasn't connected their own Google yet (e.g. an exec's
 * assistant on her first login). One click runs a single Google consent that
 * authorizes Calendar + Sheets (and Gmail on the Pinnacle edition only, owner
 * 2026-10-17) together. Dismissible for the session; reappears next login until she connects.
 *
 * With `reconnect`, the same bar asks for a reconnect: Google stopped
 * honouring a saved connection (lib/google/tokenHealth). Its dismissal is kept
 * apart from the first-connect one.
 */
export default function ConnectGoogleBanner({
  inbox = false,
  reconnect = null,
}: {
  inbox?: boolean
  /** calendarOnly = an outside calendar: reconnect through the same outside path. */
  reconnect?: { email: string | null; calendarOnly?: boolean } | null
}) {
  const dismissKey = reconnect ? 'cg_reconnect_dismissed' : 'cg_dismissed'
  const [hidden, setHidden] = useState(true)
  const bar = useRef<HTMLDivElement>(null)

  // Publish the bar's height as --cx-topbar-h so pop-ups (Boards, Partners,
  // the ask/confirm dialog) open below it on a phone, where it wraps to
  // three lines. 0 when the bar is gone.
  useEffect(() => {
    const root = document.documentElement
    const el = bar.current
    if (hidden || !el) {
      root.style.removeProperty('--cx-topbar-h')
      return
    }
    const set = () => root.style.setProperty('--cx-topbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--cx-topbar-h')
    }
  }, [hidden])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(dismissKey) !== '1') {
      setHidden(false)
    }
  }, [dismissKey])

  if (hidden) return null

  function dismiss() {
    try { window.sessionStorage.setItem(dismissKey, '1') } catch {}
    setHidden(true)
  }

  return (
    <div
      ref={bar}
      data-cx-topbar
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
        display: 'flex', justifyContent: 'center',
        padding: '8px 14px', background: 'var(--ink)', color: 'var(--cx-ground, #fff)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 820, width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>
          {reconnect ? (
            <>
              <strong>Reconnect Google</strong> Google stopped letting Suite CXO reach {reconnect.email ?? 'your account'}, so {reconnect.calendarOnly ? 'that calendar is' : inbox ? 'your email and calendar are' : 'your calendar is'} paused. One click turns {inbox && !reconnect.calendarOnly ? 'them' : 'it'} back on.
            </>
          ) : (
            <>
              <strong>Connect your Google</strong> {inbox ? 'to use Gmail, Calendar & Sheets in here — one click sets up all three.' : 'to see your calendar and Sheets in here — one click sets up both.'}
            </>
          )}
        </span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <a
            href={reconnect?.calendarOnly ? '/api/google/oauth/start?add=1&outside=1' : '/api/google/oauth/start'}
            style={{ background: 'var(--cx-ground, #fff)', color: 'var(--ink)', padding: '6px 16px', borderRadius: 999, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
          >
            {reconnect ? 'Reconnect Google' : 'Connect Google'}
          </a>
          <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </span>
      </div>
    </div>
  )
}
