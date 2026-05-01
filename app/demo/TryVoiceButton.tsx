'use client'

// Demo "Try the voice" button + modal.
//
// Renders a CTA that, when clicked, opens a modal with a microphone
// state (idle → connecting → live → ended), a status pill, and a
// "Hang up" button. Tomorrow's WebRTC + Twilio SIP integration wires
// the actual mic permissions + provider session into this shell —
// today the modal shows a friendly "wiring tomorrow" placeholder so
// the demo flow is testable end-to-end visually.

import { useState, useTransition } from 'react'
import { AGREEMENT_TITLE, CURRENT_VERSION } from '@/lib/liabilityAgreementCopy'

type DialerModeKey = 'appointment_setter' | 'receptionist' | 'live_transfer' | 'workflows'

type Props = {
  /** Tier scope for analytics + which sandbox agent we'd hit. */
  tier: 'individual' | 'enterprise'
  /** Default mode the demo lands on. */
  defaultMode?: DialerModeKey
  /** Optional: agreement preview HTML for the inline disclosure popup. */
  agreementHtml: string
  /**
   * Visual variant.
   *  - 'pill' (default): the existing pill button + "View liability terms" link.
   *    Used in the demo dialer section.
   *  - 'circular': a big red circular mic button. Used inline in the offer
   *    page SDR + Trainer cards so prospects can click and try the voice
   *    right next to the price.
   */
  variant?: 'pill' | 'circular'
  /**
   * Which voice product is being demoed. Drives the agent + modal copy.
   * Defaults to 'sdr' for backward-compat with the existing demo wiring.
   */
  product?: 'sdr' | 'trainer'
  /** Optional caption shown under the circular variant. */
  circularCaption?: string
}

const MODE_LABELS: Record<DialerModeKey, string> = {
  appointment_setter: 'Appointment Setter',
  receptionist: 'Receptionist',
  live_transfer: 'Live Transfer',
  workflows: 'Workflows',
}

type SessionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'live'; startedAt: number }
  | { kind: 'ended'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'placeholder'; message: string }

export default function TryVoiceButton({
  tier,
  defaultMode = 'appointment_setter',
  agreementHtml,
  variant = 'pill',
  product = 'sdr',
  circularCaption,
}: Props) {
  const [open, setOpen] = useState(false)
  const [showAgreement, setShowAgreement] = useState(false)
  const [mode, setMode] = useState<DialerModeKey>(defaultMode)
  const [session, setSession] = useState<SessionState>({ kind: 'idle' })
  const [pending, start] = useTransition()

  const productLabel = product === 'trainer' ? 'AI Trainer' : 'AI SDR'

  function startSession() {
    setSession({ kind: 'connecting' })
    start(async () => {
      try {
        const res = await fetch('/api/demo/voice-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, tier, product }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          message?: string
          reason?: string
        }
        if (res.status === 501) {
          setSession({
            kind: 'placeholder',
            message:
              body.message ??
              `Live voice demo is wired tomorrow. Until then, picture this card streaming the ${productLabel}'s voice into your headset and your mic into theirs.`,
          })
          return
        }
        if (!res.ok || body.ok === false) {
          setSession({ kind: 'error', message: body.message ?? body.reason ?? `HTTP ${res.status}` })
          return
        }
        // Real implementation lands here tomorrow — request mic, attach
        // tracks to the WebRTC peer, etc. For now flag it as live.
        setSession({ kind: 'live', startedAt: Date.now() })
      } catch (err) {
        setSession({ kind: 'error', message: err instanceof Error ? err.message : 'session failed' })
      }
    })
  }

  function close() {
    setOpen(false)
    setShowAgreement(false)
    setSession({ kind: 'idle' })
  }

  function hangUp() {
    setSession({ kind: 'ended', reason: 'You hung up.' })
  }

  return (
    <>
      {variant === 'circular' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Try the ${productLabel}'s voice`}
            style={circularBtnStyle}
            onMouseDown={(e) => {
              ;(e.currentTarget as HTMLElement).style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
          >
            <span style={{ fontSize: 36, color: '#fff', lineHeight: 1 }}>🎙</span>
          </button>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#dc2626' }}>
            Tap to talk to the {productLabel}
          </p>
          {circularCaption && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#525252', textAlign: 'center', maxWidth: 280, lineHeight: 1.4 }}>
              {circularCaption}
            </p>
          )}
        </div>
      ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={ctaStyle}
        >
          🎙 Try the {productLabel}&apos;s voice
        </button>
        <button
          type="button"
          onClick={() => {
            setShowAgreement(true)
            setOpen(true)
          }}
          style={linkBtnStyle}
        >
          View liability terms
        </button>
      </div>
      )}

      {open && (
        <div style={overlayStyle} onClick={close}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            {showAgreement ? (
              <>
                <header style={modalHeaderStyle}>
                  <p style={kickerStyle}>Sample liability agreement</p>
                  <h2 style={{ margin: '4px 0 0', fontSize: 17, color: '#0f172a' }}>{AGREEMENT_TITLE}</h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>
                    Version <code>{CURRENT_VERSION}</code> · live clients sign this in their dashboard before the dialer turns on.
                  </p>
                </header>
                <div
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: '14px 20px',
                    background: '#fafafa',
                    fontSize: 13,
                  }}
                  dangerouslySetInnerHTML={{ __html: agreementHtml }}
                />
                <footer style={modalFooterStyle}>
                  <button type="button" onClick={() => setShowAgreement(false)} style={secondaryBtnStyle}>
                    ← Back
                  </button>
                  <button type="button" onClick={close} style={primaryBtnStyle}>
                    Close
                  </button>
                </footer>
              </>
            ) : (
              <>
                <header style={modalHeaderStyle}>
                  <p style={kickerStyle}>{productLabel} voice preview</p>
                  <h2 style={{ margin: '4px 0 0', fontSize: 17, color: '#0f172a' }}>
                    Talk to the {productLabel} live
                  </h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                    {tier === 'enterprise' ? 'Enterprise demo · ' : ''}
                    Live voice over WebRTC · sandbox agent · session capped at ~2 min
                  </p>
                </header>

                <div style={{ padding: '20px 24px', display: 'grid', gap: 14 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#525252' }}>
                    <span>Pick a mode</span>
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as DialerModeKey)}
                      disabled={session.kind === 'connecting' || session.kind === 'live'}
                      style={{
                        padding: '8px 10px',
                        border: '1px solid #d4d4d4',
                        borderRadius: 8,
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    >
                      {(Object.keys(MODE_LABELS) as DialerModeKey[]).map((k) => (
                        <option key={k} value={k}>{MODE_LABELS[k]}</option>
                      ))}
                    </select>
                  </label>

                  <MicVisual session={session} />

                  <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                    By starting this demo you agree it&apos;s a sample of the live {productLabel}
                    service. The full{' '}
                    <button type="button" onClick={() => setShowAgreement(true)} style={inlineLinkStyle}>
                      liability agreement
                    </button>{' '}
                    applies to all production calls.
                  </p>
                </div>

                <footer style={modalFooterStyle}>
                  <button type="button" onClick={close} style={secondaryBtnStyle}>
                    Close
                  </button>
                  {session.kind === 'idle' || session.kind === 'ended' || session.kind === 'placeholder' || session.kind === 'error' ? (
                    <button
                      type="button"
                      onClick={startSession}
                      disabled={pending}
                      style={primaryBtnStyle}
                    >
                      {pending ? 'Starting…' : '🎙 Start voice session'}
                    </button>
                  ) : session.kind === 'live' ? (
                    <button type="button" onClick={hangUp} style={dangerBtnStyle}>
                      Hang up
                    </button>
                  ) : (
                    <button type="button" disabled style={primaryBtnStyle}>
                      Connecting…
                    </button>
                  )}
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function MicVisual({ session }: { session: SessionState }) {
  const tone =
    session.kind === 'live'
      ? { dot: '#22c55e', label: 'LIVE', text: 'Mic open. Speak naturally.' }
      : session.kind === 'connecting'
      ? { dot: '#f59e0b', label: 'CONNECTING', text: 'Allocating sandbox agent + WebRTC token…' }
      : session.kind === 'placeholder'
      ? { dot: '#6366f1', label: 'PREVIEW', text: session.message }
      : session.kind === 'ended'
      ? { dot: '#94a3b8', label: 'ENDED', text: session.reason }
      : session.kind === 'error'
      ? { dot: '#ef4444', label: 'ERROR', text: session.message }
      : { dot: '#94a3b8', label: 'IDLE', text: 'Click "Start voice session" to begin.' }

  return (
    <div
      style={{
        background: '#0f172a',
        color: '#fff',
        borderRadius: 12,
        padding: '20px 24px',
        display: 'grid',
        gap: 10,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: tone.dot,
          margin: '0 auto',
          display: 'grid',
          placeItems: 'center',
          fontSize: 28,
          boxShadow:
            session.kind === 'live'
              ? '0 0 0 6px rgba(34,197,94,0.18), 0 0 0 12px rgba(34,197,94,0.08)'
              : 'none',
          transition: 'box-shadow 200ms',
        }}
      >
        🎙
      </div>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: tone.dot, margin: 0 }}>
        {tone.label}
      </p>
      <p style={{ fontSize: 13, margin: 0, opacity: 0.85 }}>{tone.text}</p>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────

const ctaStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  padding: '8px 16px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const circularBtnStyle: React.CSSProperties = {
  width: 88,
  height: 88,
  borderRadius: '50%',
  background: '#dc2626',
  border: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow:
    '0 0 0 6px rgba(220,38,38,0.18), 0 0 0 12px rgba(220,38,38,0.08), 0 12px 30px rgba(220,38,38,0.35)',
  transition: 'transform 80ms ease, box-shadow 80ms ease',
}

const linkBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#1d4ed8',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
  padding: 0,
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.55)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const modalStyle: React.CSSProperties = {
  width: 'min(620px, 100%)',
  maxHeight: '92vh',
  background: '#fff',
  borderRadius: 14,
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const modalHeaderStyle: React.CSSProperties = {
  padding: '14px 20px',
  borderBottom: '1px solid #e5e7eb',
  background: '#f8fafc',
}

const modalFooterStyle: React.CSSProperties = {
  padding: '12px 20px',
  borderTop: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
}

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#6366f1',
  margin: 0,
}

const primaryBtnStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryBtnStyle: React.CSSProperties = {
  background: '#fff',
  color: '#0f172a',
  border: '1px solid #d4d4d4',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const dangerBtnStyle: React.CSSProperties = {
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const inlineLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#1d4ed8',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  fontSize: 12,
}
