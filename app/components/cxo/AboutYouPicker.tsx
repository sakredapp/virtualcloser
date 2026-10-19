'use client'
/**
 * About you (Suite CXO): "What's your role?" and "What do you want to keep an
 * eye on?" (lib/onboarding/aboutYouShared). Two small screens inside the
 * first-day card (skippable), or both at once in Profile. Saves to the
 * person's own row through /api/me/about. Employees get the role question only.
 */
import { useState } from 'react'
import type { AboutView } from '@/lib/onboarding/aboutYouShared'
import { FOCUS_MAX, ROLE_OTHER_MAX } from '@/lib/onboarding/aboutYouShared'

const picked: React.CSSProperties = { background: 'var(--cx-ink)', borderColor: 'var(--cx-ink)', color: 'var(--cx-on-accent)' }

function Chip({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="cx-todo-act" aria-pressed={on} onClick={onClick} disabled={disabled} style={on ? picked : undefined}>
      {label}
    </button>
  )
}

export default function AboutYouPicker({
  initial,
  mode,
  assistantName,
  onSaved,
}: {
  initial: AboutView
  mode: 'card' | 'profile'
  assistantName: string
  onSaved?: (v: AboutView | null) => void
}) {
  const [role, setRole] = useState<string | null>(initial.role ?? initial.guess)
  const [other, setOther] = useState(initial.roleOther ?? '')
  const [focus, setFocus] = useState<string[]>(initial.focus)
  const [step, setStep] = useState<1 | 2>(1)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const hasFocus = initial.focusOptions.length > 0
  const roleReady = !!role && (role !== 'other' || other.trim().length > 0)

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch('/api/me/about', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { about?: AboutView; error?: string }
      if (!r.ok || !j.about) throw new Error(j.error || 'Could not save that.')
      setNote({ tone: 'ok', text: ok })
      onSaved?.(j.about)
    } catch (e) {
      setNote({ tone: 'err', text: e instanceof Error ? e.message : 'Could not save that.' })
    } finally {
      setBusy(false)
    }
  }

  const save = () => post({ role: roleReady ? role : null, ...(role === 'other' ? { roleOther: other } : {}), ...(hasFocus ? { focus } : {}) }, `Saved. ${assistantName} will lead with what matters to you.`)
  const skip = () => post({ skip: true }, 'Skipped. You can answer any time in Profile.')
  const toggle = (id: string) => setFocus((f) => (f.includes(id) ? f.filter((x) => x !== id) : f.length >= FOCUS_MAX ? f : [...f, id]))

  const roleQ = (
    <div>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>What&rsquo;s your role?</p>
      <div className="cx-msg-actions" role="radiogroup" aria-label="Your role">
        {initial.roles.map((o) => (
          <Chip key={o.id} on={role === o.id} label={o.label} onClick={() => setRole(o.id)} disabled={busy} />
        ))}
      </div>
      {role === 'other' && (
        <input
          type="text"
          value={other}
          maxLength={ROLE_OTHER_MAX}
          placeholder="e.g. Chief Compliance Officer"
          aria-label="Your role"
          onChange={(e) => setOther(e.target.value)}
          style={{ marginTop: 8, width: '100%', maxWidth: 320 }}
        />
      )}
    </div>
  )

  const focusQ = hasFocus ? (
    <div>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>What do you want to keep an eye on?</p>
      <p className="cx-msg-note" style={{ margin: '2px 0 0' }}>Pick up to {FOCUS_MAX}. The first ones you pick come first.</p>
      <div className="cx-msg-actions" aria-label="What you keep an eye on">
        {initial.focusOptions.map((o) => (
          <Chip key={o.id} on={focus.includes(o.id)} label={o.label} onClick={() => toggle(o.id)} disabled={busy || (!focus.includes(o.id) && focus.length >= FOCUS_MAX)} />
        ))}
      </div>
    </div>
  ) : null

  const status = note ? (
    <p className={note.tone === 'err' ? 'cx-pref-err' : 'cx-msg-note'} role="status" style={{ margin: '8px 0 0' }}>
      {note.text}
    </p>
  ) : null

  if (mode === 'profile') {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        {roleQ}
        {focusQ}
        <div className="cx-msg-actions" style={{ marginTop: 0 }}>
          <button type="button" className="cx-btn cx-btn-sm" disabled={busy || (role === 'other' && !other.trim())} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {status}
      </div>
    )
  }

  // The card: one question at a time, each skippable.
  const twoSteps = hasFocus
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p className="cx-msg-note" style={{ margin: 0 }}>
        {twoSteps ? `Two quick questions so ${assistantName} leads with what matters to you (${step} of 2).` : `One quick question so ${assistantName} fits your job.`}
      </p>
      {step === 1 ? roleQ : focusQ}
      <div className="cx-msg-actions" style={{ marginTop: 4 }}>
        {step === 1 && twoSteps ? (
          <button type="button" className="cx-todo-act" style={picked} disabled={busy || (role === 'other' && !other.trim())} onClick={() => setStep(2)}>
            Next
          </button>
        ) : (
          <button type="button" className="cx-todo-act" style={picked} disabled={busy || (!roleReady && focus.length === 0)} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
        {step === 2 && (
          <button type="button" className="cx-todo-act" disabled={busy} onClick={() => setStep(1)}>
            Back
          </button>
        )}
        <button type="button" className="cx-todo-act" disabled={busy} onClick={() => void skip()} style={{ border: 'none', background: 'transparent', color: 'var(--cx-muted)' }}>
          Skip
        </button>
      </div>
      {status}
    </div>
  )
}
