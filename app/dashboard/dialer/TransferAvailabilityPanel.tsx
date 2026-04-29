'use client'

import { useEffect, useState, useCallback } from 'react'

type Window = {
  id?: string
  day_of_week: number
  start_local: string
  end_local: string
  timezone?: string | null
  accepts_live_transfer?: boolean
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const BLANK_WINDOW: Window = {
  day_of_week: 1,
  start_local: '09:00',
  end_local: '17:00',
  accepts_live_transfer: true,
}

export default function TransferAvailabilityPanel({ canEdit }: { canEdit: boolean }) {
  const [windows, setWindows] = useState<Window[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [pendingNew, setPendingNew] = useState<Window>(BLANK_WINDOW)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/live-transfer-availability')
      if (res.status === 403) {
        // Not enterprise — show upgrade message, don't throw
        setWindows([])
        setLoading(false)
        return
      }
      const json = (await res.json()) as { ok: boolean; availability?: Window[]; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Load failed')
      setWindows(json.availability ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  async function commit(next: Window[]) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/me/live-transfer-availability', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ windows: next }),
      })
      const json = (await res.json()) as { ok: boolean; availability?: Window[]; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Save failed')
      setWindows(json.availability ?? next)
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function addWindow() {
    if (!pendingNew.start_local || !pendingNew.end_local) return
    if (pendingNew.end_local <= pendingNew.start_local) {
      setError('End time must be after start time.')
      return
    }
    const next = [...windows, { ...pendingNew }]
    setWindows(next)
    setPendingNew(BLANK_WINDOW)
    setShowAdd(false)
    void commit(next)
  }

  function removeWindow(idx: number) {
    const next = windows.filter((_, i) => i !== idx)
    setWindows(next)
    void commit(next)
  }

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Live transfer availability</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
            Weekly windows when this rep accepts live transfers. Enterprise accounts only.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {savedAt && <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>Saved ✓</span>}
          {saving && <span style={{ fontSize: 12, opacity: 0.6 }}>Saving…</span>}
          {canEdit && (
            <button onClick={() => setShowAdd((v) => !v)} style={btnPrimary}>
              {showAdd ? 'Cancel' : '+ Add window'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {showAdd && canEdit && (
        <div style={formBox}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <label style={fieldLabel}>
              Day
              <select
                style={inp}
                value={pendingNew.day_of_week}
                onChange={(e) => setPendingNew((w) => ({ ...w, day_of_week: Number(e.target.value) }))}
              >
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>
              Start (local)
              <input
                type="time"
                style={inp}
                value={pendingNew.start_local}
                onChange={(e) => setPendingNew((w) => ({ ...w, start_local: e.target.value }))}
              />
            </label>
            <label style={fieldLabel}>
              End (local)
              <input
                type="time"
                style={inp}
                value={pendingNew.end_local}
                onChange={(e) => setPendingNew((w) => ({ ...w, end_local: e.target.value }))}
              />
            </label>
            <label style={fieldLabel}>
              Timezone
              <input
                style={inp}
                placeholder="America/New_York"
                value={pendingNew.timezone ?? ''}
                onChange={(e) => setPendingNew((w) => ({ ...w, timezone: e.target.value || null }))}
              />
            </label>
            <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 18 }}>
              <input
                type="checkbox"
                checked={pendingNew.accepts_live_transfer !== false}
                onChange={(e) => setPendingNew((w) => ({ ...w, accepts_live_transfer: e.target.checked }))}
                style={{ width: 16, height: 16 }}
              />
              Accepts transfers
            </label>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={addWindow} style={btnPrimary}>Save window</button>
            <button onClick={() => { setShowAdd(false); setPendingNew(BLANK_WINDOW) }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 16, opacity: 0.7, fontSize: 13 }}>Loading…</div>
      ) : windows.length === 0 ? (
        <div style={{ padding: 16, opacity: 0.7, fontSize: 13 }}>
          No availability windows set.{' '}
          {canEdit
            ? 'Add a window to enable live transfer routing to this rep.'
            : 'Contact your account owner to configure transfer windows.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {windows.map((w, i) => (
            <div
              key={i}
              style={{
                background: w.accepts_live_transfer !== false ? '#f0fdf4' : '#fafafa',
                border: `1px solid ${w.accepts_live_transfer !== false ? '#86efac' : '#e2e8f0'}`,
                borderRadius: 10,
                padding: '12px 14px',
                position: 'relative',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
                {DAYS[w.day_of_week]}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                {w.start_local.slice(0, 5)} – {w.end_local.slice(0, 5)}
              </div>
              {w.timezone && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{w.timezone}</div>
              )}
              <div style={{ marginTop: 6 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: w.accepts_live_transfer !== false ? '#22c55e' : '#94a3b8',
                  color: '#fff',
                }}>
                  {w.accepts_live_transfer !== false ? 'ACCEPTING' : 'PAUSED'}
                </span>
              </div>
              {canEdit && (
                <button
                  onClick={() => removeWindow(i)}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 4,
                  }}
                  title="Remove window"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const card: React.CSSProperties = {
  margin: '0.8rem 24px 0',
  background: 'var(--paper)',
  color: 'var(--ink)',
  borderRadius: 12,
  padding: '18px 20px',
  boxShadow: '0 1px 0 rgba(0,0,0,.05)',
}
const btnPrimary: React.CSSProperties = {
  background: 'var(--red, #ff2800)',
  color: '#fff',
  border: 0,
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid rgba(0,0,0,.15)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}
const formBox: React.CSSProperties = {
  background: '#f7f4ef',
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 14,
}
const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--muted, #5a5a5a)',
}
const inp: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,.12)',
  background: '#fff',
  color: 'var(--ink)',
  fontSize: 13,
}
