'use client'

// Dashboard customizer — show/hide + drag-reorder.
//
// Each major section on /dashboard is tagged with `data-widget="key"`. The
// rep clicks "Customize" → checks visibility, drags to reorder → we
//   1. inject a <style> tag with display:none rules for hidden widgets
//   2. physically reparent the widget DOM nodes in the saved order so they
//      render in the order the rep chose
// Selection persists per-user via /api/me/dashboard-layout (POST stores
// { visible, order }, GET returns { layout: { visible, order } }).
//
// We use real DOM moves (parent.insertBefore) instead of CSS `order:` because
// the dashboard sections aren't all siblings of a single flex container, so
// CSS-only reorder wouldn't work across nested parents. DOM moves keep
// server-side rendering intact and reorder client-side after hydration.

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

const WIDGET_KEYS = WIDGETS.map((w) => w.key)
const DEFAULT_VISIBLE = new Set(WIDGET_KEYS)

type Layout = { visible: string[]; order: string[] }
type Props = { initial?: Layout | null }

export default function DashboardCustomizer({ initial }: Props) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    if (initial?.visible && Array.isArray(initial.visible)) return new Set(initial.visible)
    return DEFAULT_VISIBLE
  })
  const [order, setOrder] = useState<string[]>(() => {
    if (initial?.order && Array.isArray(initial.order) && initial.order.length) {
      // Ensure every known widget appears exactly once (append missing, drop unknown).
      const seen = new Set<string>()
      const merged: string[] = []
      for (const k of initial.order) {
        if (WIDGET_KEYS.includes(k) && !seen.has(k)) {
          merged.push(k)
          seen.add(k)
        }
      }
      for (const k of WIDGET_KEYS) {
        if (!seen.has(k)) merged.push(k)
      }
      return merged
    }
    return WIDGET_KEYS.slice()
  })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)

  // Apply visibility via a style tag.
  useEffect(() => {
    const id = 'dashboard-widget-vis'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    const hidden = WIDGET_KEYS.filter((k) => !visible.has(k))
    el.textContent = hidden.length
      ? hidden.map((k) => `[data-widget="${k}"] { display: none !important; }`).join('\n')
      : ''
  }, [visible])

  // Apply order by physically moving DOM nodes inside their shared parent.
  // For each pair of adjacent widgets in the saved order, if they share a
  // parent, we make sure they appear in that order. Cross-parent reorders
  // are not attempted (would need a refactor).
  useEffect(() => {
    if (typeof document === 'undefined') return
    // Group widgets by parent element.
    const nodes = order
      .map((k) => document.querySelector(`[data-widget="${k}"]`) as HTMLElement | null)
      .filter((n): n is HTMLElement => !!n)
    const byParent = new Map<HTMLElement, HTMLElement[]>()
    for (const n of nodes) {
      const p = n.parentElement
      if (!p) continue
      const arr = byParent.get(p) ?? []
      arr.push(n)
      byParent.set(p, arr)
    }
    // For each parent, append children in the saved order. appendChild moves
    // the existing node, so this is a no-op when already in order.
    for (const [parent, children] of byParent) {
      for (const child of children) {
        parent.appendChild(child)
      }
    }
  }, [order])

  function toggle(key: string) {
    setVisible((p) => {
      const next = new Set(p)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function move(key: string, delta: -1 | 1) {
    setOrder((prev) => {
      const i = prev.indexOf(key)
      if (i < 0) return prev
      const j = i + delta
      if (j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function onDragStart(key: string) {
    setDragKey(key)
  }
  function onDragOver(e: React.DragEvent, key: string) {
    if (!dragKey || dragKey === key) return
    e.preventDefault()
  }
  function onDrop(target: string) {
    if (!dragKey || dragKey === target) return
    setOrder((prev) => {
      const from = prev.indexOf(dragKey)
      const to = prev.indexOf(target)
      if (from < 0 || to < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDragKey(null)
  }

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/me/dashboard-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: Array.from(visible), order }),
      })
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  function reset() {
    setVisible(DEFAULT_VISIBLE)
    setOrder(WIDGET_KEYS.slice())
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
        Customize
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
              maxWidth: 560,
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
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>
              Tick widgets to show, drag to reorder
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--muted, #5a5a5a)' }}>
              Saved to your account so you see the same layout every time you sign in.
              Use the ↑↓ buttons or drag-and-drop the cards.
            </p>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {order.map((key, idx) => {
                const w = WIDGETS.find((x) => x.key === key)
                if (!w) return null
                const on = visible.has(w.key)
                return (
                  <li
                    key={w.key}
                    draggable
                    onDragStart={() => onDragStart(w.key)}
                    onDragOver={(e) => onDragOver(e, w.key)}
                    onDrop={() => onDrop(w.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: on ? 'rgba(255,40,0,0.06)' : 'var(--paper-2, #f7f4ef)',
                      border: `1.5px solid ${on ? 'var(--red, #ff2800)' : 'rgba(0,0,0,0.08)'}`,
                      cursor: 'grab',
                      opacity: dragKey === w.key ? 0.5 : 1,
                    }}
                  >
                    <span
                      title="Drag to reorder"
                      style={{
                        fontSize: 18,
                        lineHeight: 1,
                        color: 'var(--muted, #5a5a5a)',
                        cursor: 'grab',
                        userSelect: 'none',
                      }}
                    >
                      ⋮⋮
                    </span>
                    <div
                      style={{ flex: 1, cursor: 'pointer' }}
                      onClick={() => toggle(w.key)}
                    >
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>{w.label}</p>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted, #5a5a5a)' }}>
                        {w.blurb}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => move(w.key, -1)}
                        disabled={idx === 0}
                        style={btnArrowStyle(idx === 0)}
                        aria-label="Move up"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(w.key, 1)}
                        disabled={idx === order.length - 1}
                        style={btnArrowStyle(idx === order.length - 1)}
                        aria-label="Move down"
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                    <span
                      onClick={() => toggle(w.key)}
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
                        cursor: 'pointer',
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                  </li>
                )
              })}
            </ul>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={reset} style={btnGhost}>
                Reset
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setOpen(false)} style={btnGhost}>
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

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--muted, #5a5a5a)',
  border: '1px solid rgba(0,0,0,0.15)',
  padding: '8px 14px',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function btnArrowStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'rgba(0,0,0,0.04)' : '#fff',
    color: disabled ? 'rgba(0,0,0,0.25)' : 'var(--ink, #0f0f0f)',
    border: '1px solid rgba(0,0,0,0.15)',
    width: 26,
    height: 26,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  }
}
