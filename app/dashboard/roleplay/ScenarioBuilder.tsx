'use client'

// Scenario builder for /dashboard/roleplay.
//
// Three things the rep can do here:
//   1. Click a preset card → instantly creates a scenario seeded with
//      generic objections (not interested / call me later / send email / etc).
//   2. Build their own scenario from scratch — name, persona, difficulty,
//      objection list.
//   3. Edit / delete existing scenarios.
//
// The "Random mix" preset materializes a special scenario that the runtime
// roleplay engine will treat as "pick a random scenario each session" —
// so reps can practice their actual objection bank in a randomized order.

import { useEffect, useState, useTransition } from 'react'

type Objection = { text: string; weight?: number | null }
type Scenario = {
  id: string
  name: string
  product_brief: string | null
  persona: string | null
  difficulty: 'easy' | 'standard' | 'hard' | 'brutal'
  objection_bank: Objection[]
  is_active: boolean
}
type Preset = {
  slug: string
  name: string
  blurb: string
  persona: string | null
  difficulty: 'easy' | 'standard' | 'hard' | 'brutal'
  objection_bank: Objection[]
}

const DIFFICULTIES: Array<Scenario['difficulty']> = ['easy', 'standard', 'hard', 'brutal']

export default function ScenarioBuilder() {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Scenario | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const r = await fetch('/api/me/roleplay-scenarios')
      const j = (await r.json()) as { ok: boolean; scenarios?: Scenario[]; presets?: Preset[]; error?: string }
      if (j.ok) {
        setScenarios(j.scenarios ?? [])
        setPresets(j.presets ?? [])
      } else setErr(j.error ?? 'load failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  function addPreset(slug: string) {
    start(async () => {
      setErr(null)
      const r = await fetch('/api/me/roleplay-scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_slug: slug }),
      })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (!j.ok) setErr(j.error ?? `HTTP ${r.status}`)
      await refresh()
    })
  }

  function save(payload: Partial<Scenario> & { name: string }) {
    start(async () => {
      setErr(null)
      const isUpdate = Boolean(payload.id)
      const r = await fetch('/api/me/roleplay-scenarios', {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (!j.ok) {
        setErr(j.error ?? `HTTP ${r.status}`)
        return
      }
      setEditing(null)
      setCreatingNew(false)
      await refresh()
    })
  }

  function remove(s: Scenario) {
    if (!confirm(`Delete scenario "${s.name}"? Past sessions stay readable.`)) return
    start(async () => {
      await fetch(`/api/me/roleplay-scenarios?id=${s.id}`, { method: 'DELETE' })
      await refresh()
    })
  }

  // Slugs the user already added — hide them from the preset library so the
  // same preset card doesn't get clicked twice.
  const usedPresetNames = new Set(scenarios.map((s) => s.name))
  const availablePresets = presets.filter((p) => !usedPresetNames.has(p.name))

  return (
    <section style={{ marginTop: '1.4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: '0.66rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 800,
              color: 'var(--brand-red, #ff2800)',
            }}
          >
            Your scenarios
          </p>
          <h2 style={{ margin: 0, fontSize: 18 }}>Build the prospect the AI will play</h2>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreatingNew(true)
            setEditing({
              id: '',
              name: '',
              product_brief: '',
              persona: '',
              difficulty: 'standard',
              objection_bank: [],
              is_active: true,
            })
          }}
          style={btnPrimary}
        >
          + New scenario
        </button>
      </div>

      {err && <p style={{ color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>✗ {err}</p>}

      {/* Existing scenarios */}
      {loading ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Loading…</p>
      ) : scenarios.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          No scenarios yet. Click a preset below or build your own.
        </p>
      ) : (
        <div style={cardGrid}>
          {scenarios.map((s) => (
            <div key={s.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <strong style={{ fontSize: '0.95rem' }}>{s.name}</strong>
                <span style={difficultyPill(s.difficulty)}>{s.difficulty}</span>
              </div>
              {s.persona && (
                <p style={{ margin: '0.3rem 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  {s.persona}
                </p>
              )}
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                {s.objection_bank.length} objection{s.objection_bank.length === 1 ? '' : 's'}
              </p>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setEditing(s)} style={btnGhost}>
                  Edit
                </button>
                <button type="button" onClick={() => remove(s)} style={btnGhostMuted}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preset library */}
      {availablePresets.length > 0 && (
        <div style={{ marginTop: '1.6rem' }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.66rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 800,
              color: 'var(--brand-red, #ff2800)',
            }}
          >
            Preset library
          </p>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: 16 }}>
            One-click scenarios — generic objections every rep hits
          </h3>
          <div style={cardGrid}>
            {availablePresets.map((p) => (
              <button
                key={p.slug}
                type="button"
                disabled={pending}
                onClick={() => addPreset(p.slug)}
                style={{ ...presetCard, cursor: pending ? 'wait' : 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <strong style={{ fontSize: '0.92rem', textAlign: 'left' }}>{p.name}</strong>
                  <span style={difficultyPill(p.difficulty)}>{p.difficulty}</span>
                </div>
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'left' }}>
                  {p.blurb}
                </p>
                <span
                  style={{
                    marginTop: 10,
                    display: 'inline-block',
                    color: 'var(--brand-red, #ff2800)',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                  }}
                >
                  Add to my scenarios →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <ScenarioEditor
          initial={editing}
          isNew={creatingNew}
          onCancel={() => {
            setEditing(null)
            setCreatingNew(false)
          }}
          onSave={(payload) => save(payload)}
          pending={pending}
        />
      )}
    </section>
  )
}

function ScenarioEditor({
  initial,
  isNew,
  onCancel,
  onSave,
  pending,
}: {
  initial: Scenario
  isNew: boolean
  onCancel: () => void
  onSave: (payload: Partial<Scenario> & { name: string }) => void
  pending: boolean
}) {
  const [name, setName] = useState(initial.name)
  const [persona, setPersona] = useState(initial.persona ?? '')
  const [productBrief, setProductBrief] = useState(initial.product_brief ?? '')
  const [difficulty, setDifficulty] = useState<Scenario['difficulty']>(initial.difficulty)
  const [objections, setObjections] = useState<Objection[]>(
    initial.objection_bank.length ? initial.objection_bank : [{ text: '' }],
  )

  function setObj(i: number, text: string) {
    setObjections((p) => p.map((o, idx) => (idx === i ? { ...o, text } : o)))
  }
  function addObj() {
    setObjections((p) => [...p, { text: '' }])
  }
  function removeObj(i: number) {
    setObjections((p) => p.filter((_, idx) => idx !== i))
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,15,15,0.6)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          color: 'var(--ink)',
          borderRadius: 14,
          padding: '20px 22px',
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>
          {isNew ? 'New scenario' : 'Edit scenario'}
        </h3>

        <label style={fieldLabel}>
          <span style={fieldHint}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
        </label>

        <label style={fieldLabel}>
          <span style={fieldHint}>Who the AI is playing</span>
          <input
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="e.g. Skeptical CFO of a mid-market SaaS company"
            style={input}
          />
        </label>

        <label style={fieldLabel}>
          <span style={fieldHint}>Product brief (optional · falls back to your dashboard summary)</span>
          <textarea
            rows={3}
            value={productBrief}
            onChange={(e) => setProductBrief(e.target.value)}
            placeholder="What the rep is selling. Leave blank to use your global product summary."
            style={{ ...input, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', gap: 6, margin: '10px 0 4px' }}>
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              style={{
                ...difficultyPill(d),
                cursor: 'pointer',
                border:
                  d === difficulty
                    ? '2px solid var(--brand-red, #ff2800)'
                    : '1px solid rgba(0,0,0,0.1)',
                opacity: d === difficulty ? 1 : 0.6,
              }}
            >
              {d}
            </button>
          ))}
        </div>

        <p style={{ ...fieldHint, marginTop: 14 }}>Objections the AI will throw at you</p>
        {objections.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              value={o.text}
              onChange={(e) => setObj(i, e.target.value)}
              placeholder={`Objection #${i + 1}`}
              style={{ ...input, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => removeObj(i)}
              style={{ ...btnGhostMuted, padding: '6px 10px' }}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={addObj} style={btnGhost}>
          + Add objection
        </button>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} style={btnGhostMuted}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() =>
              onSave({
                ...(initial.id ? { id: initial.id } : {}),
                name: name.trim(),
                persona: persona.trim() || null,
                product_brief: productBrief.trim() || null,
                difficulty,
                objection_bank: objections.filter((o) => o.text.trim()),
              })
            }
            style={btnPrimary}
          >
            {pending ? 'Saving…' : 'Save scenario'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── styles ────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  background: 'var(--brand-red, #ff2800)',
  color: '#fff',
  border: 'none',
  padding: '8px 14px',
  borderRadius: 10,
  fontWeight: 800,
  fontSize: '0.85rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--brand-red, #ff2800)',
  border: '1.5px solid var(--brand-red, #ff2800)',
  padding: '6px 12px',
  borderRadius: 8,
  fontWeight: 700,
  fontSize: '0.8rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const btnGhostMuted: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid rgba(0,0,0,0.15)',
  padding: '6px 12px',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: '0.8rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
}
const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 12,
  padding: 14,
  color: 'var(--ink)',
}
const presetCard: React.CSSProperties = {
  ...card,
  textAlign: 'left',
  background: 'var(--paper-2, #f7f4ef)',
  borderStyle: 'dashed',
  fontFamily: 'inherit',
}
const input: React.CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.15)',
  background: '#fff',
  color: 'var(--ink)',
  fontSize: '0.88rem',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const fieldLabel: React.CSSProperties = { display: 'block', margin: '8px 0' }
const fieldHint: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 700,
  color: 'var(--muted)',
  marginBottom: 4,
}

function difficultyPill(d: Scenario['difficulty']): React.CSSProperties {
  const map: Record<Scenario['difficulty'], { bg: string; fg: string }> = {
    easy: { bg: 'rgba(34,197,94,0.12)', fg: '#15803d' },
    standard: { bg: 'rgba(96,165,250,0.16)', fg: '#1d4ed8' },
    hard: { bg: 'rgba(245,158,11,0.18)', fg: '#b45309' },
    brutal: { bg: 'rgba(255,40,0,0.16)', fg: 'var(--brand-red, #ff2800)' },
  }
  const c = map[d]
  return {
    background: c.bg,
    color: c.fg,
    fontSize: '0.66rem',
    fontWeight: 800,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '3px 8px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  }
}
