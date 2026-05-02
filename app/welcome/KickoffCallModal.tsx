'use client'

// Auto-popup modal that appears the moment a buyer lands on /welcome after
// a successful Stripe Checkout (?session_id=... in the URL). Pushes them
// straight to book the kickoff call so the build can actually start.
//
// Dismissable but persistent on first visit — they can close it but the
// underlying page still has the same link in the onboarding checklist.

import { useEffect, useState } from 'react'

const KICKOFF_URL = 'https://cal.com/team/virtual-closer/kick-off-call'

export default function KickoffCallModal({ buildFeePaid }: { buildFeePaid: boolean }) {
  const [open, setOpen] = useState(true)
  const [closing, setClosing] = useState(false)

  // Lock body scroll while open so the modal feels modal.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setClosing(true)
    setTimeout(() => setOpen(false), 200)
  }

  if (!open) return null

  return (
    <>
      <div
        onClick={close}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 15, 15, 0.62)',
          backdropFilter: 'blur(6px)',
          zIndex: 999,
          opacity: closing ? 0 : 1,
          transition: 'opacity 200ms ease',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kickoff-modal-title"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: closing
            ? 'translate(-50%, -48%) scale(0.97)'
            : 'translate(-50%, -50%) scale(1)',
          opacity: closing ? 0 : 1,
          transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
          background: '#fff',
          border: '2px solid #ff2800',
          borderRadius: 16,
          padding: '2rem 1.6rem 1.4rem',
          boxShadow: '0 24px 80px rgba(15, 15, 15, 0.35)',
          zIndex: 1000,
        }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            background: 'transparent',
            border: 'none',
            fontSize: 26,
            color: 'var(--muted)',
            cursor: 'pointer',
            lineHeight: 1,
            padding: 4,
          }}
        >×</button>

        <div style={{
          display: 'inline-block',
          padding: '4px 12px',
          background: 'rgba(255, 40, 0, 0.1)',
          border: '1.5px solid rgba(255, 40, 0, 0.3)',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#ff2800',
          marginBottom: 12,
        }}>
          {buildFeePaid ? 'Payment received' : 'Almost there'}
        </div>

        <h2
          id="kickoff-modal-title"
          style={{
            margin: '0 0 0.4rem',
            fontSize: '1.7rem',
            fontWeight: 800,
            color: 'var(--ink, #0f0f0f)',
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          {buildFeePaid ? "You're in. Let's build it." : 'Book your kickoff call'}
        </h2>

        <p style={{
          margin: '0.4rem 0 1.1rem',
          fontSize: '0.95rem',
          color: 'var(--muted)',
          lineHeight: 1.55,
        }}>
          Pick a time on the calendar so we can spec out your build live —
          ICP, voice, scripts, integrations. After the call, we wire everything
          up and email you the moment it&rsquo;s live. <strong style={{ color: 'var(--ink)' }}>Weekly billing
          starts only after your build is live</strong>, not before.
        </p>

        <a
          href={KICKOFF_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            textAlign: 'center',
            background: '#ff2800',
            color: '#fff',
            padding: '14px 22px',
            borderRadius: 10,
            fontWeight: 800,
            fontSize: 16,
            textDecoration: 'none',
            letterSpacing: '0.02em',
            boxShadow: '0 8px 24px rgba(255, 40, 0, 0.32)',
            transition: 'transform 80ms ease',
          }}
          onClick={() => {
            // Persist a flag so we don't auto-pop on reload after they
            // clicked through to Cal.
            try { sessionStorage.setItem('vc_kickoff_clicked', '1') } catch {}
          }}
        >
          Book kickoff call →
        </a>

        <button
          type="button"
          onClick={close}
          style={{
            display: 'block',
            margin: '12px auto 0',
            background: 'transparent',
            border: 'none',
            color: 'var(--muted)',
            fontSize: 13,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          I&rsquo;ll book it later
        </button>

        <p style={{
          margin: '14px 0 0',
          fontSize: 11,
          color: 'var(--muted)',
          textAlign: 'center',
          lineHeight: 1.4,
        }}>
          Calendar opens in a new tab.{' '}
          <span style={{ display: 'inline-block', wordBreak: 'break-all' }}>
            {KICKOFF_URL}
          </span>
        </p>
      </div>
    </>
  )
}
