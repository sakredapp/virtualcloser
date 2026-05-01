'use client'

// Visual weekly shift editor. One column per weekday (Mon-Sun). Each
// column lists time ranges; user can add/edit/delete via inline form.

import { useState } from 'react'
import type { ShiftRow } from '@/lib/dialerHours'

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

function parseTime(input: string): number | null {
  // Accept "16:30", "4:30 pm", "4 pm", "16"
  const s = input.trim().toLowerCase()
  if (!s) return null
  const ampm = s.includes('pm') ? 'pm' : s.includes('am') ? 'am' : null
  const stripped = s.replace(/[ap]m/g, '').trim()
  const [hStr, mStr = '0'] = stripped.split(':')
  let h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return h * 60 + m
}

export default function ShiftsClient({ initialShifts, timezone }: { initialShifts: ShiftRow[]; timezone: string }) {
  const [shifts, setShifts] = useState<ShiftRow[]>(initialShifts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    const res = await fetch('/api/billing/shifts')
    const json = (await res.json()) as { ok: boolean; shifts?: ShiftRow[] }
    if (json.ok && json.shifts) setShifts(json.shifts)
  }

  async function addShift(weekday: number, startMin: number, endMin: number) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekday, startMinute: startMin, endMinute: endMin, mode: null }),
      })
      const json = (await res.json()) as { ok: boolean; reason?: string }
      if (!json.ok) throw new Error(json.reason ?? 'add failed')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed')
    } finally {
      setBusy(false)
    }
  }

  async function removeShift(shiftId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/shifts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId }),
      })
      const json = (await res.json()) as { ok: boolean; reason?: string }
      if (!json.ok) throw new Error(json.reason ?? 'delete failed')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}
      {shifts.length === 0 && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, fontSize: 13, color: '#9a3412' }}>
          <strong>No shifts set yet.</strong> While the schedule is empty, the
          dialer treats it as &ldquo;always on.&rdquo; Add at least one window to limit
          when it&apos;s allowed to dial.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
        {WEEKDAY_NAMES.map((name, weekday) => {
          const dayShifts = shifts
            .filter((s) => s.weekday === weekday)
            .sort((a, b) => a.start_minute - b.start_minute)
          return (
            <div key={weekday} style={dayCardStyle}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0f172a', textAlign: 'center' }}>{name}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayShifts.map((s) => (
                  <li key={s.id} style={shiftPillStyle}>
                    <span>
                      {fmtTime(s.start_minute)} – {fmtTime(s.end_minute)}
                    </span>
                    <button type="button" onClick={() => removeShift(s.id)} disabled={busy} style={removeBtnStyle} aria-label="Remove">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <AddShiftForm weekday={weekday} onAdd={addShift} disabled={busy} />
            </div>
          )
        })}
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 11, color: '#94a3b8' }}>
        Times shown and saved in your local timezone ({timezone}). The dialer cron
        evaluates &ldquo;is now in a shift?&rdquo; using this same timezone before placing
        each new outbound call.
      </p>
    </>
  )
}

function AddShiftForm({
  weekday,
  onAdd,
  disabled,
}: {
  weekday: number
  onAdd: (weekday: number, startMin: number, endMin: number) => void
  disabled: boolean
}) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const s = parseTime(start)
    const eMin = parseTime(end)
    if (s === null || eMin === null) {
      setErr('Use format like 4:00 pm or 16:00')
      return
    }
    if (eMin <= s) {
      setErr('End must be after start')
      return
    }
    setErr(null)
    onAdd(weekday, s, eMin)
    setStart('')
    setEnd('')
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        type="text"
        placeholder="9:00 am"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        style={inputStyle}
        disabled={disabled}
      />
      <input
        type="text"
        placeholder="5:00 pm"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        style={inputStyle}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled} style={addBtnStyle}>
        + Add
      </button>
      {err && <p style={{ margin: 0, fontSize: 10, color: '#dc2626' }}>{err}</p>}
    </form>
  )
}

const dayCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border-soft)',
  borderRadius: 10,
  padding: '10px 8px',
  minHeight: 200,
  display: 'flex',
  flexDirection: 'column',
}

const shiftPillStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: '#0f172a',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  padding: '5px 8px',
  borderRadius: 999,
}

const removeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#fca5a5',
  fontSize: 14,
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  marginLeft: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid var(--border-soft)',
  borderRadius: 6,
  fontFamily: 'inherit',
}

const addBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 700,
  background: '#ff2800',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}
