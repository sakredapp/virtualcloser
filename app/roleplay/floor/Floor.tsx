'use client'

// The live practice floor. Full session loop:
//   pick persona → POST /api/roleplay/start → SDK startCall (browser WebRTC)
//   → POST /api/roleplay/dialed on accept → hang up / disconnect
//   → POST /api/roleplay/finalize (poll while the provider writes the call)
//   → scorecard.
//
// The RevRing SDK is lazy-imported (touches window at import time; breaks SSR
// if imported eagerly) — same pattern as app/demo/TryVoiceButton.tsx.

import { useCallback, useEffect, useRef, useState } from 'react'

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
    console.error('[roleplay-floor] revring sdk import failed', err)
    return null
  }
}

const RED = '#ff2800'

export type FloorPersona = {
  key: string
  name: string
  headline: string
  blurb: string
  difficulty: string
}

type Scorecard = {
  id: string
  score: number | null
  summary: string | null
  strengths: string | null
  weaknesses: string | null
  durationSeconds: number | null
  transcript: string | null
}

type HistoryRow = {
  id: string
  persona: string | null
  status: string
  startedAt: string
  durationSeconds: number | null
  score: number | null
  summary: string | null
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'connecting' }
  | { kind: 'live'; startedAt: number }
  | { kind: 'grading'; note: string }
  | { kind: 'scored'; card: Scorecard }
  | { kind: 'error'; message: string }

export default function Floor({
  personas,
  appScenarios = [],
  memberName,
}: {
  personas: FloorPersona[]
  appScenarios?: FloorPersona[]
  memberName: string
}) {
  const [selected, setSelected] = useState<string>(personas[0]?.key ?? appScenarios[0]?.key ?? '')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [showTranscript, setShowTranscript] = useState(false)

  const clientRef = useRef<RevRingClient | null>(null)
  const callRef = useRef<RevRingCall | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const finalizingRef = useRef(false)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/roleplay/sessions')
      const body = (await res.json()) as { ok?: boolean; sessions?: HistoryRow[] }
      if (body.ok && Array.isArray(body.sessions)) setHistory(body.sessions)
    } catch {}
  }, [])

  useEffect(() => {
    void loadHistory()
    return () => {
      try {
        callRef.current?.disconnect?.()
        clientRef.current?.destroy()
      } catch {}
    }
  }, [loadHistory])

  // Live call timer.
  useEffect(() => {
    if (phase.kind !== 'live') return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - phase.startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase])

  const finalize = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId || finalizingRef.current) return
    finalizingRef.current = true
    setPhase({ kind: 'grading', note: 'Pulling the transcript…' })
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await fetch('/api/roleplay/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          state?: string
          note?: string
          session?: Scorecard
        }
        if (body.state === 'graded' && body.session) {
          setPhase({ kind: 'scored', card: body.session })
          void loadHistory()
          return
        }
        if (body.state === 'failed' || (!res.ok && res.status !== 200)) {
          setPhase({ kind: 'error', message: body.note ?? 'Could not grade this session.' })
          return
        }
        setPhase({ kind: 'grading', note: attempt < 3 ? 'Provider is wrapping the call…' : 'Grading the call…' })
        await new Promise((r) => setTimeout(r, 4000))
      }
      setPhase({ kind: 'error', message: 'The transcript never arrived. Your session is saved — check history in a minute.' })
    } finally {
      finalizingRef.current = false
    }
  }, [loadHistory])

  async function startSession() {
    if (!selected) return
    setPhase({ kind: 'starting' })
    setElapsed(0)
    finalizingRef.current = false
    try {
      const res = await fetch('/api/roleplay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: selected }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        sessionId?: string
        agentNumber?: string
        message?: string
      }
      if (!res.ok || !body.ok || !body.sessionId || !body.agentNumber) {
        setPhase({ kind: 'error', message: body.message ?? `Could not start (HTTP ${res.status}).` })
        return
      }
      sessionIdRef.current = body.sessionId

      const ClientCtor = await loadRevRing()
      if (!ClientCtor) {
        setPhase({ kind: 'error', message: 'The WebRTC SDK failed to load — check the browser console.' })
        return
      }
      setPhase({ kind: 'connecting' })
      clientRef.current ??= new ClientCtor()
      const call = await clientRef.current.startCall({ to: body.agentNumber })
      callRef.current = call

      call.on('accept', () => {
        setPhase({ kind: 'live', startedAt: Date.now() })
        // Server-stamp the dial moment — bounds the call-bind window.
        void fetch('/api/roleplay/dialed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: body.sessionId }),
        })
      })
      call.on('disconnect', () => void finalize())
      call.on('cancel', () => void finalize())
      call.on('reject', () =>
        setPhase({ kind: 'error', message: 'The persona is unavailable right now. Try again in a moment.' }),
      )
      call.on('error', (err) => {
        const msg = err instanceof Error ? err.message : 'WebRTC error'
        setPhase({
          kind: 'error',
          message: msg.toLowerCase().includes('permission')
            ? 'Microphone blocked. Allow mic access in your browser and try again.'
            : msg,
        })
      })
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Session failed.' })
    }
  }

  function hangUp() {
    try {
      callRef.current?.disconnect?.()
      clientRef.current?.hangupAll()
    } catch {}
    callRef.current = null
    void finalize()
  }

  const busy = phase.kind === 'starting' || phase.kind === 'connecting' || phase.kind === 'live' || phase.kind === 'grading'
  const activePersona = personas.find((p) => p.key === selected) ?? appScenarios.find((p) => p.key === selected)

  const renderCard = (p: FloorPersona) => {
    const active = p.key === selected
    return (
      <button
        key={p.key}
        type="button"
        disabled={busy}
        onClick={() => setSelected(p.key)}
        style={{
          textAlign: 'left',
          cursor: busy ? 'default' : 'pointer',
          border: active ? `2px solid ${RED}` : '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14,
          padding: '15px 16px 13px',
          background: active ? `${RED}14` : '#161616',
          color: '#fff',
          opacity: busy && !active ? 0.5 : 1,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: p.difficulty === 'brutal' ? '#fff' : RED,
              background: p.difficulty === 'brutal' ? RED : `${RED}22`,
              borderRadius: 999,
              padding: '2px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {p.difficulty}
          </span>
        </div>
        <p style={{ fontSize: 11, color: RED, fontWeight: 700, margin: '3px 0 6px' }}>{p.headline}</p>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.65)', margin: 0 }}>{p.blurb}</p>
      </button>
    )
  }

  return (
    <div>
      <header style={{ marginBottom: 26 }}>
        <p style={{ color: RED, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 11, margin: 0 }}>
          Practice floor
        </p>
        <h1 style={{ fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 900, margin: '8px 0 4px' }}>
          Headset on, {memberName.split(' ')[0]}.
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, margin: 0 }}>
          Pick a prospect, start the call, close them — then take the grade like a pro.
        </p>
      </header>

      {/* Persona picker — sales calls */}
      {personas.length > 0 && (
        <>
          <p style={sectionLabel}>Sales calls · close them</p>
          <div style={pickerGrid}>{personas.map(renderCard)}</div>
        </>
      )}

      {/* Application mode — the sale is made; write the business */}
      {appScenarios.length > 0 && (
        <>
          <p style={sectionLabel}>Application mode · write the business</p>
          <div style={pickerGrid}>{appScenarios.map(renderCard)}</div>
        </>
      )}

      {/* Call console */}
      <div
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          background: 'linear-gradient(160deg, #1d1d1d 0%, #131313 100%)',
          padding: '26px 24px',
          textAlign: 'center',
          marginBottom: 30,
        }}
      >
        {phase.kind === 'scored' ? (
          <ScorecardView
            card={phase.card}
            personaName={activePersona?.name ?? 'the prospect'}
            showTranscript={showTranscript}
            onToggleTranscript={() => setShowTranscript((v) => !v)}
            onAgain={() => {
              setShowTranscript(false)
              setPhase({ kind: 'idle' })
            }}
          />
        ) : (
          <>
            <div
              style={{
                width: 74,
                height: 74,
                borderRadius: '50%',
                margin: '0 auto 12px',
                display: 'grid',
                placeItems: 'center',
                fontSize: 32,
                background:
                  phase.kind === 'live' ? '#22c55e' : phase.kind === 'error' ? '#ef4444' : phase.kind === 'idle' ? RED : '#f59e0b',
                boxShadow:
                  phase.kind === 'live'
                    ? '0 0 0 8px rgba(34,197,94,0.16), 0 0 0 16px rgba(34,197,94,0.07)'
                    : `0 0 0 6px ${RED}22`,
                transition: 'box-shadow 250ms, background 250ms',
              }}
            >
              🎙
            </div>
            <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', margin: '0 0 6px', color: phase.kind === 'live' ? '#22c55e' : phase.kind === 'error' ? '#ef4444' : 'rgba(255,255,255,0.8)' }}>
              {phase.kind === 'idle' && 'READY'}
              {phase.kind === 'starting' && 'OPENING SESSION…'}
              {phase.kind === 'connecting' && 'CONNECTING…'}
              {phase.kind === 'live' && `LIVE · ${fmtClock(elapsed)}`}
              {phase.kind === 'grading' && 'GRADING'}
              {phase.kind === 'error' && 'ERROR'}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 18px', minHeight: 18 }}>
              {phase.kind === 'idle' && (activePersona ? `${activePersona.name} picks up on the first ring.` : 'Pick a prospect.')}
              {phase.kind === 'starting' && 'Creating your session…'}
              {phase.kind === 'connecting' && 'Allow the mic when your browser asks.'}
              {phase.kind === 'live' && 'Mic is open. Work the call.'}
              {phase.kind === 'grading' && phase.note}
              {phase.kind === 'error' && phase.message}
            </p>
            {phase.kind === 'live' ? (
              <button type="button" onClick={hangUp} style={{ ...bigBtn, background: '#dc2626' }}>
                Hang up & get graded
              </button>
            ) : phase.kind === 'grading' ? (
              <button type="button" disabled style={{ ...bigBtn, opacity: 0.6 }}>
                Scoring the call…
              </button>
            ) : (
              <button
                type="button"
                onClick={startSession}
                disabled={busy || !selected}
                style={{ ...bigBtn, opacity: busy || !selected ? 0.6 : 1 }}
              >
                {phase.kind === 'error' ? 'Try again' : '🎙 Start the call'}
              </button>
            )}
          </>
        )}
      </div>

      {/* History */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 900, margin: '0 0 12px' }}>Your last sessions</h2>
        {history.length === 0 ? (
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            Nothing yet. Your first graded call lands here.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {history.map((row) => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  background: '#141414',
                }}
              >
                <ScoreBadge score={row.score} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>
                    {personaLabel(row.persona)}{' '}
                    <span style={{ fontWeight: 400, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      · {new Date(row.startedAt).toLocaleString()} · {row.durationSeconds ? fmtClock(row.durationSeconds) : '—'}
                    </span>
                  </p>
                  {row.summary && (
                    <p
                      style={{
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.6)',
                        margin: '3px 0 0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.summary}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ScorecardView({
  card,
  personaName,
  showTranscript,
  onToggleTranscript,
  onAgain,
}: {
  card: Scorecard
  personaName: string
  showTranscript: boolean
  onToggleTranscript: () => void
  onAgain: () => void
}) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: scoreColor(card.score),
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 30, fontWeight: 900, color: '#fff' }}>{card.score ?? '—'}</span>
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: RED, margin: 0 }}>
            Scorecard · {personaName}
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.55, margin: '6px 0 0', color: 'rgba(255,255,255,0.85)' }}>
            {card.summary ?? 'No summary.'}
          </p>
          {card.durationSeconds != null && (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '6px 0 0' }}>
              Call length {fmtClock(card.durationSeconds)}
            </p>
          )}
        </div>
      </div>

      {(card.strengths || card.weaknesses) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 18 }}>
          {card.strengths && (
            <div style={{ border: '1px solid rgba(34,197,94,0.35)', borderRadius: 12, padding: '13px 15px' }}>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#22c55e', margin: '0 0 6px' }}>WHAT LANDED</p>
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: 'rgba(255,255,255,0.8)' }}>{card.strengths}</p>
            </div>
          )}
          {card.weaknesses && (
            <div style={{ border: `1px solid ${RED}55`, borderRadius: 12, padding: '13px 15px' }}>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: RED, margin: '0 0 6px' }}>FIX NEXT RUN</p>
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: 'rgba(255,255,255,0.8)' }}>{card.weaknesses}</p>
            </div>
          )}
        </div>
      )}

      {card.transcript && showTranscript && (
        <pre
          style={{
            marginTop: 16,
            maxHeight: 260,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            lineHeight: 1.6,
            background: '#0c0c0c',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: '14px 16px',
            color: 'rgba(255,255,255,0.75)',
          }}
        >
          {card.transcript}
        </pre>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button type="button" onClick={onAgain} style={bigBtn}>
          Run it again
        </button>
        {card.transcript && (
          <button
            type="button"
            onClick={onToggleTranscript}
            style={{ ...bigBtn, background: 'transparent', border: '1px solid rgba(255,255,255,0.25)' }}
          >
            {showTranscript ? 'Hide transcript' : 'Read the transcript'}
          </button>
        )}
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number | null }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: scoreColor(score),
        flexShrink: 0,
        fontWeight: 900,
        fontSize: 15,
        color: '#fff',
      }}
    >
      {score ?? '—'}
    </div>
  )
}

function scoreColor(score: number | null): string {
  if (score == null) return 'rgba(255,255,255,0.15)'
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#ca8a04'
  return '#dc2626'
}

function personaLabel(key: string | null): string {
  switch (key) {
    case 'sam_carter':
      return 'Sam Carter'
    case 'jamie_torres':
      return 'Jamie Torres'
    case 'robert_hutchins':
      return 'Robert Hutchins'
    case 'travis_holt':
      return 'Travis Holt'
    case 'app_ta_sam':
      return 'Sam Carter · Transamerica app'
    case 'app_foresters_jamie':
      return 'Jamie Torres · Foresters e-App'
    default:
      return key ?? 'Session'
  }
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
  margin: '0 0 10px',
}

const pickerGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
  marginBottom: 22,
}

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const bigBtn: React.CSSProperties = {
  background: RED,
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '13px 26px',
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
}
