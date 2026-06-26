'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Always-available feedback button (bottom-right, every dashboard page). Anything
 * typed here is stored in fix_requests tagged with the page it was sent from, so
 * "execute on Lauren's feedback" is just reading the database. Keeps the whole
 * dashboard improving from real in-context feedback.
 */
export default function FeedbackWidget() {
  const pathname = usePathname() || ''
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const pageLabel = pathname.replace(/^\/dashboard\/?/, '') || 'home'

  async function send() {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    await fetch('/api/feedback/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, area: `page:${pathname || '/dashboard'}`, severity: 'normal' }),
    }).catch(() => {})
    setBusy(false)
    setText('')
    setDone(true)
    setTimeout(() => { setDone(false); setOpen(false) }, 1800)
  }

  return (
    <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 50 }}>
      {open ? (
        <div
          style={{
            width: 300,
            background: 'var(--paper, #fff)',
            border: '1px solid var(--border-soft)',
            borderRadius: 14,
            boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
            padding: '0.85rem 0.95rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>Feedback</strong>
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>
          <p className="meta" style={{ margin: '0.15rem 0 0.5rem', fontSize: '0.72rem' }}>
            On <strong>{pageLabel}</strong> — what would make this better, or what’s broken?
          </p>
          {done ? (
            <p className="meta" style={{ fontSize: '0.82rem', color: 'var(--signal-ok, #16a34a)', margin: 0 }}>✓ Sent — thank you!</p>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Type anything — a fix, an idea, “I’d rather…”"
                style={{
                  width: '100%', fontSize: '0.85rem', fontFamily: 'inherit', padding: '0.5rem 0.6rem',
                  border: '1px solid var(--border-soft)', borderRadius: 8, background: 'var(--paper)',
                  color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  onClick={send}
                  disabled={busy || !text.trim()}
                  style={{
                    border: 'none', borderRadius: 8, padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 700,
                    cursor: busy || !text.trim() ? 'default' : 'pointer',
                    background: busy || !text.trim() ? 'var(--paper-2, #e8e3d8)' : 'var(--ink)',
                    color: busy || !text.trim() ? 'var(--muted)' : 'var(--text-inv, #fff)',
                  }}
                >
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Send feedback"
          title="Feedback"
          style={{
            width: 46, height: 46, borderRadius: '50%', border: '1px solid var(--border-soft)',
            background: 'var(--ink)', color: 'var(--text-inv, #fff)', cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(0,0,0,0.22)', fontSize: 20, fontWeight: 700,
          }}
        >
          ?
        </button>
      )}
    </div>
  )
}
