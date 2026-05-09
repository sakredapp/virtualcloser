'use client'

// PipelineBoard — Kanban with HTML5 drag-and-drop + slide-in detail panel.
// No external DnD library; the data model is small and simple enough that
// raw drag events are fine.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { STAGE_ORDER, STAGE_LABEL, STAGE_TONE, type PipelineStage } from '@/lib/pipeline'

export type ProspectCard = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  source: string | null
  status: string | null
  stage: PipelineStage
  position: number
  stageChangedAt: string | null
  meetingAt: string | null
  kickoffCallAt: string | null
  buildSummary: string | null
  buildPlan: string | null
  buildBrief: string | null
  buildCostEstimate: number | null
  selectedFeatures: unknown[]
  adminNotes: string | null
  cartId: string | null
  repId: string | null
  bookingCount?: number
  rep: {
    id: string
    displayName: string
    slug: string
    tier: string
    billingStatus: string | null
    stripeCustomerId: string | null
    weeklyHoursQuota: number | null
    buildFeePaidCents: number | null
    buildFeePaidAt: string | null
    subscriptionActivatedAt: string | null
    stripeSubscriptionId: string | null
  } | null
  cart: {
    id: string
    weeklyHours: number | null
    trainerWeeklyHours: number | null
    repCount: number | null
    addons: unknown[]
    computedTotalCents: number | null
    tier: string | null
  } | null
}

type Props = {
  initialCards: ProspectCard[]
  stageCounts: Record<PipelineStage, number>
}

const ALL_STAGES: PipelineStage[] = [...STAGE_ORDER, 'lost']

export default function PipelineBoard({ initialCards }: Props) {
  const [cards, setCards] = useState<ProspectCard[]>(initialCards)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null)

  const byStage = useMemo(() => {
    const out: Record<PipelineStage, ProspectCard[]> = {
      lead: [], call_booked: [], plan_generated: [], quote_sent: [],
      payment_made: [], kickoff_scheduled: [], building: [], active: [], lost: [],
    }
    for (const c of cards) (out[c.stage] ?? out.lead).push(c)
    for (const s of ALL_STAGES) {
      out[s].sort((a, b) => (a.position - b.position) || (Date.parse(b.stageChangedAt ?? '') - Date.parse(a.stageChangedAt ?? '')))
    }
    return out
  }, [cards])

  function moveCard(id: string, toStage: PipelineStage) {
    const card = cards.find((c) => c.id === id)
    if (!card || card.stage === toStage) return
    // Optimistic update.
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, stage: toStage, stageChangedAt: new Date().toISOString() } : c)))
    fetch('/api/admin/pipeline/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prospectId: id, stage: toStage }),
    }).then((r) => r.json()).then((j) => {
      if (!j.ok) {
        // Roll back on failure.
        setCards((prev) => prev.map((c) => (c.id === id ? { ...c, stage: card.stage } : c)))
        alert(`Move failed: ${j.reason ?? 'unknown'}`)
      }
    }).catch(() => {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, stage: card.stage } : c)))
    })
  }

  const openCard = cards.find((c) => c.id === openId) ?? null

  return (
    <>
      <div style={{
        display: 'flex',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 12,
        // Allows sticky column headers within a horizontally scrolling row
        // without breaking the grid.
        scrollSnapType: 'x proximity',
      }}>
        {ALL_STAGES.map((stage) => {
          const tone = STAGE_TONE[stage]
          const list = byStage[stage]
          const isDragOver = dragOverStage === stage
          return (
            <section
              key={stage}
              onDragOver={(e) => {
                e.preventDefault()
                if (draggingId) setDragOverStage(stage)
              }}
              onDragLeave={(e) => {
                // Only clear when actually leaving the column (not entering a child).
                if (e.currentTarget === e.target) setDragOverStage(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingId) moveCard(draggingId, stage)
                setDraggingId(null)
                setDragOverStage(null)
              }}
              style={{
                flex: '0 0 280px',
                minWidth: 280,
                background: isDragOver ? tone.bg : 'rgba(0,0,0,0.02)',
                border: `1.5px solid ${isDragOver ? tone.bd : 'transparent'}`,
                borderRadius: 12,
                padding: '0.75rem 0.6rem',
                scrollSnapAlign: 'start',
                transition: 'background 120ms ease, border-color 120ms ease',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 'calc(100vh - 180px)',
              }}
            >
              <header style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: tone.fg,
                }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: tone.accent,
                    display: 'inline-block',
                  }} />
                  {STAGE_LABEL[stage]}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: tone.fg,
                  background: tone.bg,
                  border: `1px solid ${tone.bd}`,
                  padding: '1px 8px',
                  borderRadius: 999,
                }}>{list.length}</span>
              </header>

              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {list.length === 0 && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '12px 0', margin: 0 }}>
                    {stage === 'lost' ? 'Nothing lost.' : '—'}
                  </p>
                )}
                {list.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    onOpen={() => setOpenId(card.id)}
                    onDragStart={() => setDraggingId(card.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOverStage(null) }}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {openCard && (
        <DetailPanel
          card={openCard}
          onClose={() => setOpenId(null)}
          onMoveStage={(s) => moveCard(openCard.id, s)}
          onLocalUpdate={(patch) => {
            setCards((prev) => prev.map((c) => (c.id === openCard.id ? { ...c, ...patch } : c)))
          }}
        />
      )}
    </>
  )
}

// ── Card (column entry) ───────────────────────────────────────────────────

function Card({ card, onOpen, onDragStart, onDragEnd }: {
  card: ProspectCard
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const tone = STAGE_TONE[card.stage]
  const totalCents = card.cart?.computedTotalCents ?? 0
  const buildFeePaid = card.rep?.buildFeePaidCents ?? 0
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', card.id) } catch {}
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      style={{
        background: '#fff',
        border: `1px solid ${tone.bd}`,
        borderLeft: `4px solid ${tone.accent}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'grab',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 6 }}>
        {card.name ?? card.email ?? 'Unknown'}
        {card.bookingCount && card.bookingCount > 1 && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'rgba(99,102,241,0.12)', color: '#4338ca', border: '1px solid rgba(99,102,241,0.25)', whiteSpace: 'nowrap' }}>
            {card.bookingCount}x
          </span>
        )}
      </div>
      {card.company && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{card.company}</div>
      )}
      {(card.email || card.phone) && (
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
          {card.email ?? card.phone}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {totalCents > 0 && (
          <Tag label="quote" value={`$${Math.round(totalCents / 100)}/wk`} tone={tone} />
        )}
        {buildFeePaid > 0 && (
          <Tag label="paid" value={`$${Math.round(buildFeePaid / 100)}`} tone={STAGE_TONE.payment_made} />
        )}
        {card.buildSummary && (
          <Tag label="plan" value="✓" tone={STAGE_TONE.plan_generated} />
        )}
        {card.kickoffCallAt && (
          <Tag label="kickoff" value={new Date(card.kickoffCallAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tone={STAGE_TONE.kickoff_scheduled} />
        )}
      </div>
      {card.buildSummary && (
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0', lineHeight: 1.4, fontStyle: 'italic' }}>
          {card.buildSummary.length > 100 ? card.buildSummary.slice(0, 100) + '…' : card.buildSummary}
        </p>
      )}
    </article>
  )
}

function Tag({ label, value, tone }: { label: string; value: string; tone: { bg: string; bd: string; fg: string } }) {
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '2px 6px',
      borderRadius: 4,
      background: tone.bg,
      color: tone.fg,
      border: `1px solid ${tone.bd}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ opacity: 0.65, marginRight: 3 }}>{label}</span>{value}
    </span>
  )
}

// ── Slide-in detail panel ─────────────────────────────────────────────────

function DetailPanel({ card, onClose, onMoveStage, onLocalUpdate }: {
  card: ProspectCard
  onClose: () => void
  onMoveStage: (s: PipelineStage) => void
  onLocalUpdate: (patch: Partial<ProspectCard>) => void
}) {
  const [notes, setNotes] = useState(card.adminNotes ?? '')
  const [kickoff, setKickoff] = useState(card.kickoffCallAt ? card.kickoffCallAt.slice(0, 16) : '')
  const [savingNotes, startNotesSave] = useTransition()
  const [savingKickoff, startKickoffSave] = useTransition()
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset local state when switching to a different card.
  useEffect(() => {
    setNotes(card.adminNotes ?? '')
    setKickoff(card.kickoffCallAt ? card.kickoffCallAt.slice(0, 16) : '')
  }, [card.id, card.adminNotes, card.kickoffCallAt])

  // Auto-save notes 600ms after stop typing.
  function onNotesChange(next: string) {
    setNotes(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      startNotesSave(async () => {
        const r = await fetch('/api/admin/pipeline/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prospectId: card.id, notes: next }),
        })
        const j = await r.json()
        if (j.ok) {
          setSavedHint('saved')
          onLocalUpdate({ adminNotes: next })
          setTimeout(() => setSavedHint(null), 1200)
        } else {
          setSavedHint(`error: ${j.reason}`)
        }
      })
    }, 600)
  }

  function saveKickoff() {
    startKickoffSave(async () => {
      const iso = kickoff ? new Date(kickoff).toISOString() : null
      const r = await fetch('/api/admin/pipeline/kickoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prospectId: card.id, kickoffAt: iso }),
      })
      const j = await r.json()
      if (j.ok) {
        onLocalUpdate({ kickoffCallAt: iso })
        setSavedHint('kickoff saved')
        setTimeout(() => setSavedHint(null), 1200)
      }
    })
  }

  return (
    <>
      <div onClick={onClose} aria-hidden style={{
        position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.4)',
        backdropFilter: 'blur(2px)', zIndex: 50,
      }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(560px, calc(100vw - 32px))',
        background: '#fff', boxShadow: '-12px 0 40px rgba(15,15,15,0.18)',
        zIndex: 51, overflowY: 'auto', padding: '1.2rem 1.4rem 2rem',
      }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 12, right: 16, fontSize: 26,
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', lineHeight: 1, padding: 4,
          }}
        >×</button>

        <div style={{ marginTop: 4, marginBottom: 12 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: '1.4rem', color: 'var(--ink)' }}>
            {card.name ?? card.email ?? 'Unknown'}
          </h2>
          {card.company && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{card.company}</p>}
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>
            {card.email}{card.phone ? ` · ${card.phone}` : ''}
          </p>
        </div>

        {/* Stage selector */}
        <Section label="Stage">
          <select
            value={card.stage}
            onChange={(e) => onMoveStage(e.target.value as PipelineStage)}
            style={selectStyle}
          >
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
            Stage changed {card.stageChangedAt ? new Date(card.stageChangedAt).toLocaleString() : 'never'}
          </p>
        </Section>

        {/* Quote */}
        {card.cart && (
          <Section label="Quote on file">
            <div style={{
              border: '1px solid var(--ink-soft, #e6e1d8)', borderRadius: 8, padding: 12, fontSize: 13,
              background: 'rgba(0,0,0,0.02)',
            }}>
              <Row label="Tier" value={card.cart.tier ?? '—'} />
              <Row label="Reps" value={String(card.cart.repCount ?? '—')} />
              <Row label="SDR hrs/wk" value={String(card.cart.weeklyHours ?? '—')} />
              <Row label="Trainer hrs/wk" value={String(card.cart.trainerWeeklyHours ?? '—')} />
              {Array.isArray(card.cart.addons) && card.cart.addons.length > 0 && (
                <Row label="Addons" value={card.cart.addons.join(', ')} />
              )}
              {card.cart.computedTotalCents != null && card.cart.computedTotalCents > 0 && (
                <Row label="Weekly subtotal" value={`$${(card.cart.computedTotalCents / 100).toFixed(0)}/wk`} bold />
              )}
            </div>
          </Section>
        )}

        {/* Stripe state */}
        {card.rep && (
          <Section label="Customer (Stripe)">
            <div style={{
              border: '1px solid var(--ink-soft, #e6e1d8)', borderRadius: 8, padding: 12, fontSize: 13,
              background: 'rgba(0,0,0,0.02)',
            }}>
              <Row label="Tier" value={String(card.rep.tier ?? '—')} />
              <Row label="Status" value={String(card.rep.billingStatus ?? '—')} />
              {card.rep.buildFeePaidCents != null && card.rep.buildFeePaidCents > 0 && (
                <Row label="Build fee paid" value={`$${(card.rep.buildFeePaidCents / 100).toFixed(0)} on ${card.rep.buildFeePaidAt ? new Date(card.rep.buildFeePaidAt).toLocaleDateString() : '?'}`} />
              )}
              {card.rep.subscriptionActivatedAt && (
                <Row label="Sub activated" value={new Date(card.rep.subscriptionActivatedAt).toLocaleDateString()} bold />
              )}
            </div>
            <Link href={`/admin/billing/customers/${card.rep.id}`} style={{
              display: 'inline-block', marginTop: 8, fontSize: 12, color: '#ff2800', fontWeight: 700,
            }}>
              Open in Stripe admin →
            </Link>
          </Section>
        )}

        {/* Fathom build plan */}
        {(card.buildSummary || card.buildPlan || card.buildBrief) && (
          <Section label="AI build plan (from Fathom)">
            {card.buildSummary && <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 10px' }}>{card.buildSummary}</p>}
            {card.buildCostEstimate != null && (
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>
                Estimated monthly: <strong style={{ color: 'var(--ink)' }}>${Number(card.buildCostEstimate).toLocaleString()}</strong>
              </p>
            )}
            {Array.isArray(card.selectedFeatures) && card.selectedFeatures.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px' }}>
                Features: {card.selectedFeatures.join(', ')}
              </p>
            )}
            {card.buildBrief && (
              <details style={{ fontSize: 12, color: 'var(--muted)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--ink)' }}>Brief</summary>
                <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{card.buildBrief}</p>
              </details>
            )}
            {card.buildPlan && (
              <details style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--ink)' }}>Full plan</summary>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', fontFamily: 'inherit' }}>{card.buildPlan}</pre>
              </details>
            )}
          </Section>
        )}

        {/* Kickoff scheduling */}
        <Section label="Kickoff call">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="datetime-local"
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
              style={{ ...selectStyle, flex: 1 }}
            />
            <button onClick={saveKickoff} disabled={savingKickoff} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 700,
              background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
              opacity: savingKickoff ? 0.7 : 1,
            }}>
              Save
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
            Setting a date auto-advances to <strong>Kickoff scheduled</strong>.
          </p>
        </Section>

        {/* Notes */}
        <Section label="My notes">
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Anything you want to remember about this deal — auto-saves."
            rows={5}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--ink-soft, #e6e1d8)',
              borderRadius: 6,
              fontSize: 13,
              fontFamily: 'inherit',
              background: '#fff',
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
          <p style={{ fontSize: 10, color: savedHint?.startsWith('error') ? 'var(--red)' : 'var(--muted)', margin: '4px 0 0', minHeight: 14 }}>
            {savingNotes ? 'saving…' : (savedHint ?? 'auto-saves while you type')}
          </p>
        </Section>

        <div style={{
          marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--ink-soft, #e6e1d8)',
          fontSize: 11, color: 'var(--muted)',
        }}>
          Source: {card.source ?? '—'} · meeting {card.meetingAt ? new Date(card.meetingAt).toLocaleString() : '—'}
        </div>
      </aside>
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--muted)', marginBottom: 6,
      }}>{label}</div>
      {children}
    </section>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: bold ? 700 : 400, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--ink-soft, #e6e1d8)',
  borderRadius: 6,
  background: '#fff',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'inherit',
}
