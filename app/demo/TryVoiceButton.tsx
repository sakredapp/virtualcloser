'use client'

// Demo "Try the voice" button + modal.
//
// Renders a CTA that, when clicked, opens a modal with a microphone
// state (idle → connecting → live → ended), a status pill, and a
// "Hang up" button. Tomorrow's WebRTC + Twilio SIP integration wires
// the actual mic permissions + provider session into this shell —
// today the modal shows a friendly "wiring tomorrow" placeholder so
// the demo flow is testable end-to-end visually.

import { useEffect, useRef, useState, useTransition } from 'react'
import { AGREEMENT_TITLE, CURRENT_VERSION } from '@/lib/liabilityAgreementCopy'

// Lazy-import the SDK so it doesn't bloat the initial JS bundle and
// doesn't run server-side. The SDK touches `window` / `navigator` at
// import time, so importing eagerly breaks SSR.
type RevRingClient = {
  startCall: (opts: { to: string; twilioLogLevel?: string }) => Promise<RevRingCall>
  hangupAll: () => void
  destroy: () => void
}
type RevRingCall = {
  on: (event: 'accept' | 'disconnect' | 'cancel' | 'reject' | 'error', cb: (err?: unknown) => void) => void
  disconnect?: () => void
}
async function loadRevRing(): Promise<{ new (opts?: unknown): RevRingClient } | null> {
  try {
    const mod = (await import('@revring/webrtc-sdk')) as {
      RevRingWebRtcClient?: { new (opts?: unknown): RevRingClient }
    }
    return mod.RevRingWebRtcClient ?? null
  } catch (err) {
    console.error('[try-voice] revring sdk import failed', err)
    return null
  }
}

import type { ReceptionistCallType } from '@/lib/voice/receptionistPrompts'
import { RECEPTIONIST_CALL_TYPE_LABELS } from '@/lib/voice/receptionistPrompts'

type IndustryKey =
  | 'life_mortgage_protection'
  | 'windows'
  | 'solar'
  | 'roofing'
  | 'pest'
  | 'lawn'

type Props = {
  /** Tier scope for analytics + which sandbox agent we'd hit. */
  tier: 'individual' | 'enterprise'
  /** Default industry the demo lands on. */
  defaultMode?: IndustryKey
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
  product?: 'sdr' | 'trainer' | 'receptionist'
  /** Default call type when product === 'receptionist'. */
  defaultCallType?: ReceptionistCallType
  /** Default trainer scenario when product === 'trainer'. */
  defaultTrainerScenario?: 'sam_carter' | 'jamie_torres'
  /** Optional caption shown under the circular variant. */
  circularCaption?: string
}

const INDUSTRY_LABELS: Record<IndustryKey, string> = {
  life_mortgage_protection: 'Mortgage Protection (Life Insurance)',
  windows: 'Energy-Efficient Windows',
  solar: 'Residential Solar',
  roofing: 'Roofing (Insurance Claim)',
  pest: 'Pest Control',
  lawn: 'Lawn Care',
}

// Each industry routes to its own RevRing SDR agent (defaultId is wired
// in app/api/demo/voice-session/route.ts). The demo flips on per-industry
// when the matching REVRING_SDR_*_NUMBER env var is set on Vercel.
// Receptionist, Live Transfer, and Workflows are separate hiring options
// on the offer page — this modal is specifically the SDR demo.
const AVAILABLE_INDUSTRIES: Record<IndustryKey, boolean> = {
  life_mortgage_protection: true,
  windows: true,
  solar: true,
  roofing: true,
  pest: true,
  lawn: true,
}

const BRAND_RED = '#ff2800'

type SessionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'live'; startedAt: number }
  | { kind: 'ended'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'placeholder'; message: string }

const TRAINER_SCENARIO_LABELS: Record<'sam_carter' | 'jamie_torres', string> = {
  sam_carter: 'Sam Carter — Skeptical Homeowner, Age 56 (Mortgage Protection)',
  jamie_torres: 'Jamie Torres — New Parent, First Home, Age 34 (Mortgage Protection)',
}

export default function TryVoiceButton({
  tier,
  defaultMode = 'life_mortgage_protection',
  agreementHtml,
  variant = 'pill',
  product = 'sdr',
  defaultCallType = 'outbound_confirm',
  defaultTrainerScenario = 'sam_carter',
}: Props) {
  const [open, setOpen] = useState(false)
  const [showAgreement, setShowAgreement] = useState(false)
  const [mode, setMode] = useState<IndustryKey>(defaultMode)
  const [callType, setCallType] = useState<ReceptionistCallType>(defaultCallType)
  const [trainerScenario, setTrainerScenario] = useState<'sam_carter' | 'jamie_torres'>(defaultTrainerScenario)
  const [session, setSession] = useState<SessionState>({ kind: 'idle' })
  const [pending, start] = useTransition()

  const clientRef = useRef<RevRingClient | null>(null)
  const callRef = useRef<RevRingCall | null>(null)
  const productLabel =
    product === 'trainer' ? 'AI Trainer'
    : product === 'receptionist' ? 'AI Receptionist'
    : 'AI SDR'

  // Tear down the SDK when this component unmounts so we don't leak
  // open mic streams or stale Twilio devices across navigations.
  useEffect(() => {
    return () => {
      try {
        callRef.current?.disconnect?.()
        clientRef.current?.destroy()
      } catch {}
    }
  }, [])

  function startSession() {
    setSession({ kind: 'connecting' })
    start(async () => {
      try {
        const res = await fetch('/api/demo/voice-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            tier,
            product,
            ...(product === 'receptionist' ? { callType } : {}),
            ...(product === 'trainer' ? { trainerScenario } : {}),
          }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          message?: string
          reason?: string
          agentNumber?: string
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
        if (!res.ok || body.ok === false || !body.agentNumber) {
          setSession({ kind: 'error', message: body.message ?? body.reason ?? `HTTP ${res.status}` })
          return
        }

        // Mint a RevRing WebRTC client (lazy-imported so SSR doesn't see
        // it) and start the call against the agent's routing number. The
        // SDK handles mic permission + Twilio auth via the dashboard
        // config; we just react to events.
        const ClientCtor = await loadRevRing()
        if (!ClientCtor) {
          setSession({ kind: 'error', message: 'WebRTC SDK failed to load — check the browser console.' })
          return
        }
        clientRef.current ??= new ClientCtor()
        const client = clientRef.current
        const call = await client.startCall({ to: body.agentNumber })
        callRef.current = call

        call.on('accept', () => setSession({ kind: 'live', startedAt: Date.now() }))
        call.on('disconnect', () => setSession({ kind: 'ended', reason: 'Call ended.' }))
        call.on('cancel', () => setSession({ kind: 'ended', reason: 'Cancelled before connect.' }))
        call.on('reject', () => setSession({ kind: 'error', message: 'AI agent unavailable. Setup may be incomplete — try again in a moment.' }))
        call.on('error', (err) => {
          const msg = err instanceof Error ? err.message : 'WebRTC error'
          setSession({
            kind: 'error',
            message: msg.toLowerCase().includes('permission')
              ? 'Microphone access blocked. Allow it in your browser and try again.'
              : msg,
          })
        })
      } catch (err) {
        setSession({ kind: 'error', message: err instanceof Error ? err.message : 'session failed' })
      }
    })
  }

  function close() {
    try {
      callRef.current?.disconnect?.()
      clientRef.current?.hangupAll()
    } catch {}
    callRef.current = null
    setOpen(false)
    setShowAgreement(false)
    setSession({ kind: 'idle' })
  }

  function hangUp() {
    try {
      callRef.current?.disconnect?.()
      clientRef.current?.hangupAll()
    } catch {}
    callRef.current = null
    setSession({ kind: 'ended', reason: 'You hung up.' })
  }

  return (
    <>
      {variant === 'circular' ? (
        <div className="try-voice-circ">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Try the ${productLabel}'s voice`}
            className="try-voice-circ-btn"
            onMouseDown={(e) => {
              ;(e.currentTarget as HTMLElement).style.transform = 'scale(0.95)'
            }}
            onMouseUp={(e) => {
              ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            }}
          >
            <span className="try-voice-circ-icon">🎙</span>
          </button>
          <p className="try-voice-circ-label">Try me</p>
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
                <div style={brandStripStyle} />
                <header style={modalHeaderStyle}>
                  <p style={kickerStyle}>
                    <span style={brandDotStyle} />
                    Sample liability agreement
                  </p>
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
                <div style={brandStripStyle} />
                <header style={modalHeaderStyle}>
                  <p style={kickerStyle}>
                    <span style={brandDotStyle} />
                    {productLabel} voice preview
                  </p>
                  <h2 style={{ margin: '4px 0 0', fontSize: 17, color: '#0f172a' }}>
                    Talk to the {productLabel} live
                  </h2>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                    {tier === 'enterprise' ? 'Enterprise demo · ' : ''}
                    Live voice over WebRTC · sandbox agent · session capped at ~2 min
                  </p>
                </header>

                <div style={{ padding: '20px 24px', display: 'grid', gap: 14 }}>
                  {product === 'receptionist' ? (
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#525252' }}>
                      <span>Pick a call type</span>
                      <select
                        value={callType}
                        onChange={(e) => {
                          setCallType(e.target.value as ReceptionistCallType)
                          setSession({ kind: 'idle' })
                        }}
                        disabled={session.kind === 'connecting' || session.kind === 'live'}
                        style={{
                          padding: '8px 10px',
                          border: '1px solid var(--border-soft)',
                          borderRadius: 8,
                          fontSize: 14,
                          fontFamily: 'inherit',
                        }}
                      >
                        {(Object.keys(RECEPTIONIST_CALL_TYPE_LABELS) as ReceptionistCallType[]).map((k) => (
                          <option key={k} value={k}>
                            {RECEPTIONIST_CALL_TYPE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        Three demo agents — each wired with a different call script. Inbound picks up your line. Outbound confirms appointments. Life insurance handles missed premium collections.
                      </span>
                    </label>
                  ) : product === 'trainer' ? (
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#525252' }}>
                      <span>Pick a prospect</span>
                      <select
                        value={trainerScenario}
                        onChange={(e) => {
                          setTrainerScenario(e.target.value as 'sam_carter' | 'jamie_torres')
                          setSession({ kind: 'idle' })
                        }}
                        disabled={session.kind === 'connecting' || session.kind === 'live'}
                        style={{
                          padding: '8px 10px',
                          border: '1px solid var(--border-soft)',
                          borderRadius: 8,
                          fontSize: 14,
                          fontFamily: 'inherit',
                        }}
                      >
                        {(Object.keys(TRAINER_SCENARIO_LABELS) as Array<'sam_carter' | 'jamie_torres'>).map((k) => (
                          <option key={k} value={k}>
                            {TRAINER_SCENARIO_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        Two different prospects — different age, finances, family situation, and objection set. Practice closing both.
                      </span>
                    </label>
                  ) : (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#525252' }}>
                    <span>Pick an industry</span>
                    <select
                      value={mode}
                      onChange={(e) => {
                        const next = e.target.value as IndustryKey
                        if (AVAILABLE_INDUSTRIES[next]) setMode(next)
                      }}
                      disabled={session.kind === 'connecting' || session.kind === 'live'}
                      style={{
                        padding: '8px 10px',
                        border: '1px solid var(--border-soft)',
                        borderRadius: 8,
                        fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    >
                      {(Object.keys(INDUSTRY_LABELS) as IndustryKey[]).map((k) => {
                        const enabled = AVAILABLE_INDUSTRIES[k]
                        return (
                          <option key={k} value={k} disabled={!enabled}>
                            {INDUSTRY_LABELS[k]}{enabled ? '' : ' — coming soon'}
                          </option>
                        )
                      })}
                    </select>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      All six industries are wired with their own AI SDR. Each one books appointments end-to-end on the call. Receptionist, Live Transfer, and Workflow agents are separate hiring options below.
                    </span>
                  </label>
                  )}

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
      ? { dot: BRAND_RED, label: 'PREVIEW', text: session.message }
      : session.kind === 'ended'
      ? { dot: '#94a3b8', label: 'ENDED', text: session.reason }
      : session.kind === 'error'
      ? { dot: '#ef4444', label: 'ERROR', text: session.message }
      : { dot: BRAND_RED, label: 'READY', text: 'Click "Start voice session" to begin.' }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #2a2a2a 0%, #161616 100%)',
        color: '#fff',
        borderRadius: 12,
        padding: '20px 24px',
        display: 'grid',
        gap: 10,
        textAlign: 'center',
        border: `1px solid ${BRAND_RED}33`,
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
              : `0 0 0 4px ${tone.dot}22`,
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

// Circular variant styles live in globals.css under `.try-voice-circ*`
// so the mobile breakpoint can flip the layout from stacked-circle to
// inline-pill without prop plumbing.

const linkBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: BRAND_RED,
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
  borderBottom: '1px solid var(--border-soft)',
  background: 'linear-gradient(180deg, #ffffff 0%, #fef2f2 100%)',
}

const brandStripStyle: React.CSSProperties = {
  height: 4,
  background: `linear-gradient(90deg, ${BRAND_RED} 0%, #b91c1c 100%)`,
}

const brandDotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: BRAND_RED,
  marginRight: 8,
  verticalAlign: 'middle',
  boxShadow: `0 0 0 3px ${BRAND_RED}33`,
}

const modalFooterStyle: React.CSSProperties = {
  padding: '12px 20px',
  borderTop: '1px solid var(--border-soft)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
}

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: BRAND_RED,
  margin: 0,
  display: 'inline-flex',
  alignItems: 'center',
}

const primaryBtnStyle: React.CSSProperties = {
  background: BRAND_RED,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: `0 4px 12px ${BRAND_RED}40`,
}

const secondaryBtnStyle: React.CSSProperties = {
  background: '#fff',
  color: '#0f172a',
  border: '1px solid var(--border-soft)',
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
  color: BRAND_RED,
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  fontSize: 12,
  fontWeight: 600,
}
