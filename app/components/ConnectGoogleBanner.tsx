'use client'

import { useEffect, useState } from 'react'

/**
 * Shown to a member who hasn't connected their own Google yet (e.g. an exec's
 * assistant on her first login). One click runs a single Google consent that
 * authorizes Gmail + Calendar + Sheets together — she never has to do it three
 * times. Dismissible for the session; reappears next login until she connects.
 */
export default function ConnectGoogleBanner() {
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage.getItem('cg_dismissed') !== '1') {
      setHidden(false)
    }
  }, [])

  if (hidden) return null

  function dismiss() {
    try { window.sessionStorage.setItem('cg_dismissed', '1') } catch {}
    setHidden(true)
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
        display: 'flex', justifyContent: 'center',
        padding: '8px 14px', background: 'var(--ink)', color: 'var(--text-inv, #fff)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 820, width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>
          <strong>Connect your Google</strong> to use Gmail, Calendar & Sheets in here — one click sets up all three.
        </span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <a
            href="/api/google/oauth/start"
            style={{ background: '#fff', color: 'var(--ink)', padding: '6px 16px', borderRadius: 999, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
          >
            Connect Google
          </a>
          <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </span>
      </div>
    </div>
  )
}
