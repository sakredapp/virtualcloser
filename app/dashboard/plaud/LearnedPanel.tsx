'use client'

import { useState } from 'react'

export type GuidanceRuleLite = {
  id: string
  rule: string
  scope: 'note_agent' | 'planner' | 'both'
  kind: 'avoid' | 'prefer' | 'correction' | 'fact'
  source: 'action' | 'plan' | 'manual'
  weight: number
  active: boolean
}

const KIND_LABEL: Record<GuidanceRuleLite['kind'], string> = {
  avoid: 'Avoid',
  prefer: 'Prefer',
  correction: 'Correction',
  fact: 'Fact',
}
const KIND_COLOR: Record<GuidanceRuleLite['kind'], string> = {
  avoid: 'var(--red-deep, #dc2626)',
  prefer: 'var(--signal-ok, #16a34a)',
  correction: '#7c3aed',
  fact: '#0a66c2',
}
const SCOPE_LABEL: Record<GuidanceRuleLite['scope'], string> = {
  note_agent: 'recordings',
  planner: 'daily plan',
  both: 'everywhere',
}

/**
 * "What your assistant has learned" — the visible, editable learned-state.
 * Lists the durable rules the Plaud agent/planner reads into its prompts, and
 * lets Spencer correct, mute, or delete them so the learning stays in his
 * control rather than being a black box.
 */
export default function LearnedPanel({ initialRules }: { initialRules: GuidanceRuleLite[] }) {
  const [rules, setRules] = useState<GuidanceRuleLite[]>(initialRules)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  async function add() {
    const rule = adding.trim()
    if (!rule) return
    setBusy(true)
    const res = await fetch('/api/plaud/guidance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule }),
    })
    setBusy(false)
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; rule?: GuidanceRuleLite }
    if (json.ok && json.rule) {
      setRules((rs) => [json.rule as GuidanceRuleLite, ...rs])
      setAdding('')
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true)
    const res = await fetch(`/api/plaud/guidance/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    return res.ok
  }

  async function toggleActive(r: GuidanceRuleLite) {
    const ok = await patch(r.id, { active: !r.active })
    if (ok) setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)))
  }

  async function saveEdit(id: string) {
    const text = editText.trim()
    if (!text) return
    const ok = await patch(id, { rule: text })
    if (ok) {
      setRules((rs) => rs.map((x) => (x.id === id ? { ...x, rule: text } : x)))
      setEditingId(null)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    const res = await fetch(`/api/plaud/guidance/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) setRules((rs) => rs.filter((x) => x.id !== id))
  }

  return (
    <section className="card" style={{ marginTop: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>What your assistant has learned</h2>
          <p className="meta" style={{ margin: '0.2rem 0 0', fontSize: '0.78rem' }}>
            Durable rules the agent follows when triaging recordings and building your daily plan.
            Dismiss an action with a reason — or add a rule here — and it sharpens.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem' }}>
        <input
          type="text"
          placeholder="Teach a rule, e.g. “Never email clients without my OK”"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          style={{ flex: 1 }}
        />
        <button className="btn approve" onClick={add} disabled={busy || !adding.trim()}>Add</button>
      </div>

      {rules.length === 0 ? (
        <p className="meta" style={{ margin: '0.8rem 0 0', fontSize: '0.82rem' }}>
          Nothing learned yet. As you dismiss or correct the agent’s suggestions, rules show up here.
        </p>
      ) : (
        <div style={{ marginTop: '0.7rem', border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
          {rules.map((r) => (
            <div
              key={r.id}
              style={{
                padding: '0.55rem 0.75rem',
                borderTop: '1px solid var(--border-soft)',
                opacity: r.active ? 1 : 0.5,
                display: 'grid',
                gap: '0.3rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  className="status"
                  style={{ background: KIND_COLOR[r.kind], color: '#fff', flexShrink: 0, fontSize: '0.68rem' }}
                >
                  {KIND_LABEL[r.kind]}
                </span>
                {editingId === r.id ? (
                  <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(r.id) }}
                    autoFocus
                    style={{ flex: 1, minWidth: 180 }}
                  />
                ) : (
                  <p className="name" style={{ margin: 0, flex: 1, fontSize: '0.86rem', fontWeight: 500 }}>
                    {r.rule}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="meta" style={{ fontSize: '0.7rem' }}>
                  applies to {SCOPE_LABEL[r.scope]}
                  {r.weight > 1 ? ` · reinforced ×${r.weight}` : ''}
                  {r.source === 'manual' ? ' · added by you' : ''}
                  {!r.active ? ' · muted' : ''}
                </span>
                <span style={{ flex: 1 }} />
                {editingId === r.id ? (
                  <>
                    <button className="btn" onClick={() => saveEdit(r.id)} disabled={busy}>Save</button>
                    <button className="btn" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn"
                      onClick={() => { setEditingId(r.id); setEditText(r.rule) }}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn"
                      onClick={() => toggleActive(r)}
                      disabled={busy}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                    >
                      {r.active ? 'Mute' : 'Unmute'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => remove(r.id)}
                      disabled={busy}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
