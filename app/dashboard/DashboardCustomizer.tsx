'use client'

// Dashboard customizer — iPhone-home-screen style toggles.
//
// Each major section on /dashboard is tagged with `data-widget="key"`. The
// user clicks "Customize" → ticks/unticks widgets they care about → we
// inject a <style> tag that hides the unchecked ones via
// `[data-widget="x"] { display: none }`. The selection persists per-user via
// /api/me/dashboard-layout.
//
// Reorder is intentionally NOT in this first cut — true reorder requires
// rendering each widget through one wrapper component which is a bigger
// refactor of the 1400-line dashboard. Visibility nails 80% of the value
// (rep can mute the panels they don't use) without touching the server-
// rendered tree.

import { useEffect, useState } from 'react'

const WIDGETS: Array<{ key: string; label: string; blurb: string }> = [
  { key: 'goals-summary',    label: 'Goals (week / month / quarter / year)',  blurb: 'The four-tile summary at the top.' },
  { key: 'voice-quick',      label: 'AI dialer + roleplay quick-access',       blurb: 'Cards linking out to the dialer and roleplay pages.' },
  { key: 'team-goals',       label: 'Team goals',                              blurb: 'Manager-set targets your activity rolls into.' },
  { key: 'custom-kpis',      label: 'Daily KPI cards',                         blurb: 'Custom counters you defined (dials, conversations, etc).' },
  { key: 'brain-goals',      label: 'Brain — Goals list',                      blurb: 'Goals you logged via Telegram or the brain dump.' },
  { key: 'brain-overdue',    label: 'Brain — Overdue',                         blurb: 'Tasks past their due date.' },
  { key: 'brain-today-week', label: 'Brain — Today + This week',               blurb: 'Two-column today/this-week view.' },
  { key: 'brain-month-long', label: 'Brain — This month + Long range',         blurb: 'Two-column month/long-range view.' },
  { key: 'leads-drafts',     label: 'Lead queue + email drafts',               blurb: 'Active leads and pending email approvals.' },
]

const DEFAULT_VISIBLE = new Set(WIDGETS.map((w) => w.key))

type Props = { initial?: string[] | null }

export default function DashboardCustomizer({ initial }: Props) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    if (Array.isArray(initial)) return new Set(initial)
    return DEFAULT_VISIBLE
  })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Apply to DOM whenever selection changes
  useEffect(() => {
    const id = 'dashboard-widget-vis'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    const hidden = WIDGETS.filter((w) => !visible.has(w.key)).map((w) => w.key)
    el.textContent = hidden.length
      ? hidden.map((k) => `[data-widget="${k}"] { display: none !important; }`).join('\n')
      : ''
  }, [visible])

  function toggle(key: string) {
    setVisible((p) => {
      const next = new Set(p)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/me/dashboard-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: Array.from(visible) }),
      })
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  function reset() {
    setVisible(DEFAULT_VISIBLE)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          background: 'var(--red, #ff2800)',
          color: '#fff',
          border: 'none',
          padding: '10px 16px',
          borderRadius: 999,
          fontSize: '0.85rem',
          fontWeight: 800,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 8px 24px rgba(255,40,0,0.35)',
          zIndex: 30,
          letterSpacing: '0.04em',
        }}
        aria-label="Customize dashboard"
      >
        ⚙ Customize
      </button>

      {open && (
        <div
          role="dialog"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,15,15,0.55)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              color: 'var(--ink, #0f0f0f)',
              borderRadius: 14,
              padding: '20px 22px',
              maxWidth: 520,
              width: '100%',
              maxHeight: '88vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '0.66rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 800,
                color: 'var(--red, #ff2800)',
              }}
            >
              Customize dashboard
            </p>
            <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>
              Show only the widgets you actually use
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--muted, #5a5a5a)' }}>
              Tick to show, untick to hide. Saved to your account so you see the same layout
              every time you sign in.
            </p>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {WIDGETS.map((w) => {
                const on = visible.has(w.key)
                return (
                  <li
                    key={w.key}
                    onClick={() => toggle(w.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: on ? 'rgba(255,40,0,0.06)' : 'var(--paper-2, #f7f4ef)',
                      border: `1.5px solid ${on ? 'var(--red, #ff2800)' : 'rgba(0,0,0,0.08)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>{w.label}</p>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted, #5a5a5a)' }}>
                        {w.blurb}
                      </p>
                    </div>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        border: `1.5px solid ${on ? 'var(--red, #ff2800)' : 'rgba(0,0,0,0.25)'}`,
                        background: on ? 'var(--red, #ff2800)' : '#fff',
                        color: '#fff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                  </li>
                )
              })}
            </ul>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  background: 'transparent',
                  color: 'var(--muted, #5a5a5a)',
                  border: '1px solid rgba(0,0,0,0.15)',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Reset all on
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    background: 'transparent',
                    color: 'var(--muted, #5a5a5a)',
                    border: '1px solid rgba(0,0,0,0.15)',
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={save}
                  style={{
                    background: 'var(--red, #ff2800)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: saving ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {saving ? 'Saving…' : 'Save layout'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
