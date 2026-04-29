'use client'

// Client-side editor that lets a tenant customize the per-flow Vapi prompt
// addendums (product summary, objections, dialer script) without going
// through admin. Saves to /api/me/voice-prompts which writes into
// client_integrations.config (key='vapi') and re-runs provisionVapiForRep so
// the change flows into their live Vapi assistants immediately.
//
// Used by:
//   /dashboard/dialer  — kind='dialer'
//   /dashboard/roleplay — kind='roleplay'

import { useState, useTransition } from 'react'
import Link from 'next/link'

type DocRow = {
  id: string
  title: string
  doc_kind: string
  scope: 'personal' | 'account'
  is_active: boolean
}

type Props = {
  kind: 'dialer' | 'roleplay'
  initial: {
    product_summary: string
    objections: string
    confirm_addendum: string
    reschedule_addendum: string
    roleplay_addendum: string
    ai_name: string
  }
  /** When kind==='roleplay' we surface attached training docs. */
  trainingDocs?: DocRow[]
}

const FIELD_LABELS = {
  product_summary: 'Product / service summary',
  objections: 'Common objections + how to handle',
  confirm_addendum: 'Confirm-call extra rules (script add-ons)',
  reschedule_addendum: 'Reschedule-call extra rules',
  roleplay_addendum: 'Roleplay scenario brief',
  ai_name: 'AI assistant name',
} as const

export default function VoicePromptEditor({ kind, initial, trainingDocs }: Props) {
  const [vals, setVals] = useState(initial)
  const [pending, start] = useTransition()
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'err'; msg?: string }>({
    kind: 'idle',
  })
  const [open, setOpen] = useState(false)

  function set<K extends keyof typeof vals>(key: K, v: string) {
    setVals((p) => ({ ...p, [key]: v }))
  }

  function save() {
    start(async () => {
      setStatus({ kind: 'idle' })
      const res = await fetch('/api/me/voice-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vals),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        provision?: { changed?: string[]; warnings?: string[] }
      }
      if (res.ok && body.ok !== false) {
        const changed = body.provision?.changed?.length
          ? ` · synced to Vapi (${body.provision.changed.join(', ')})`
          : ''
        setStatus({ kind: 'ok', msg: `Saved${changed}` })
      } else {
        setStatus({ kind: 'err', msg: body.error ?? `HTTP ${res.status}` })
      }
    })
  }

  // Show only the fields relevant to this surface
  const visibleFields: Array<keyof typeof vals> =
    kind === 'dialer'
      ? ['ai_name', 'product_summary', 'objections', 'confirm_addendum', 'reschedule_addendum']
      : ['ai_name', 'product_summary', 'objections', 'roleplay_addendum']

  return (
    <section
      style={{
        margin: '0 24px 24px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.96)',
        color: 'var(--ink)',
        padding: '14px 16px',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontFamily: 'inherit',
          color: 'inherit',
          textAlign: 'left',
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: '0.66rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 800,
              color: 'var(--red)',
            }}
          >
            {kind === 'dialer' ? 'Your AI Dialer script' : 'Your AI Roleplay scenario'}
          </p>
          <strong style={{ fontSize: '1rem' }}>
            {kind === 'dialer'
              ? 'Customize what the dialer says on confirmation calls'
              : 'Customize what the roleplay AI argues with you about'}
          </strong>
          <p
            style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}
          >
            Saves directly to your live Vapi assistant. Edit any field and click
            save — your next call uses it.
          </p>
        </div>
        <span
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            color: 'var(--red)',
            fontWeight: 800,
            border: '1.5px solid var(--red)',
            padding: '4px 10px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
          }}
        >
          {open ? 'Hide ▴' : 'Edit ▾'}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {visibleFields.map((k) => {
            const isText = k === 'ai_name'
            return (
              <label key={k} style={{ display: 'grid', gap: 4 }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: 'var(--muted)',
                  }}
                >
                  {FIELD_LABELS[k]}
                </span>
                {isText ? (
                  <input
                    value={vals[k]}
                    onChange={(e) => set(k, e.target.value)}
                    placeholder="Riley"
                    style={inputSt}
                  />
                ) : (
                  <textarea
                    value={vals[k]}
                    onChange={(e) => set(k, e.target.value)}
                    rows={k === 'product_summary' || k === 'objections' ? 6 : 4}
                    placeholder={hintFor(k)}
                    style={{ ...inputSt, fontFamily: 'inherit', resize: 'vertical' }}
                  />
                )}
              </label>
            )
          })}

          {kind === 'roleplay' && (
            <div
              style={{
                marginTop: 4,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--paper-2, #f7f4ef)',
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.7rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--muted)',
                }}
              >
                Training docs the AI references
              </p>
              {(trainingDocs ?? []).length === 0 ? (
                <p style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>
                  No training docs yet.{' '}
                  <Link href="/brain" style={{ color: 'var(--red)', fontWeight: 600 }}>
                    Drop a product brief, script, or objection list in your brain dump
                  </Link>{' '}
                  and tag it as training. The roleplay AI grounds its answers in those.
                </p>
              ) : (
                <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                  {(trainingDocs ?? []).map((d) => (
                    <li
                      key={d.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '4px 0',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span>
                        {d.title}{' '}
                        <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                          · {d.doc_kind} · {d.scope}
                        </span>
                      </span>
                      <span
                        style={{
                          color: d.is_active ? 'var(--red)' : 'var(--muted)',
                          fontWeight: 700,
                          fontSize: '0.7rem',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {d.is_active ? 'ACTIVE' : 'OFF'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              style={{
                background: 'var(--red)',
                color: '#fff',
                border: 'none',
                padding: '10px 18px',
                borderRadius: 10,
                fontWeight: 800,
                cursor: pending ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
              }}
            >
              {pending ? 'Saving…' : 'Save & sync to Vapi'}
            </button>
            {status.kind === 'ok' && (
              <span style={{ color: '#16a34a', fontSize: '0.85rem', fontWeight: 600 }}>
                ✓ {status.msg}
              </span>
            )}
            {status.kind === 'err' && (
              <span style={{ color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>
                ✗ {status.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function hintFor(k: keyof typeof FIELD_LABELS): string {
  switch (k) {
    case 'product_summary':
      return '1–2 paragraphs: what you sell, who buys it, the price point. The AI uses this so it sounds informed.'
    case 'objections':
      return '- "Send me an email" → say you can after the call but want to confirm time first.\n- "Not interested" → empathize, ask if timing or fit is the issue.\n- "I\'m busy" → offer to reschedule, hand off a 2-line summary.'
    case 'confirm_addendum':
      return 'Specific to the appointment-confirmation call only — tone, mandatory questions, disclaimers.'
    case 'reschedule_addendum':
      return 'Specific to the reschedule flow — how aggressive, how many slots to offer, etc.'
    case 'roleplay_addendum':
      return 'Who the AI plays, how skeptical they are, what objections they raise, what closes them.'
    default:
      return ''
  }
}

const inputSt: React.CSSProperties = {
  padding: '0.6rem 0.7rem',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.15)',
  background: '#fff',
  color: 'var(--ink)',
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
}
