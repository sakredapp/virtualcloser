'use client'

import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import type { AppointmentSetterConfig } from '@/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type LeadRow = {
  phone: string
  name?: string
  email?: string
  company?: string
  notes?: string
}

type ImportState =
  | { phase: 'idle' }
  | { phase: 'preview'; rows: LeadRow[] }
  | { phase: 'importing'; done: number; total: number }
  | { phase: 'done'; inserted: number; skipped: number }
  | { phase: 'error'; message: string }

type QueueCounts = {
  pending: number
  in_progress: number
  completed: number
  failed: number
  cancelled: number
  appointments_set: number
}

function parseCSV(text: string): LeadRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return {
      phone: obj.phone ?? obj.phone_number ?? obj.mobile ?? obj.cell ?? '',
      name: obj.name ?? obj.full_name ?? ([obj.first_name, obj.last_name].filter(Boolean).join(' ') || undefined),
      email: obj.email ?? obj.email_address ?? undefined,
      company: obj.company ?? obj.company_name ?? obj.account ?? undefined,
      notes: obj.notes ?? obj.note ?? undefined,
    }
  }).filter((r) => r.phone)
}

function parseXlsx(buf: ArrayBuffer): LeadRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return raw.map((rawRow) => {
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawRow)) {
      row[k.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')] = String(v ?? '').trim()
    }
    return {
      phone: row.phone ?? row.phone_number ?? row.mobile ?? row.cell ?? '',
      name: row.name ?? row.full_name ?? ([row.first_name, row.last_name].filter(Boolean).join(' ') || undefined),
      email: row.email ?? row.email_address ?? undefined,
      company: row.company ?? row.company_name ?? row.account ?? undefined,
      notes: row.notes ?? row.note ?? undefined,
    }
  }).filter((r) => r.phone)
}

export default function AppointmentSetterClient({
  initial,
  initialCounts,
}: {
  initial: AppointmentSetterConfig
  initialCounts: QueueCounts
}) {
  const [cfg, setCfg] = useState<AppointmentSetterConfig>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [importState, setImportState] = useState<ImportState>({ phase: 'idle' })
  const [counts, setCounts] = useState<QueueCounts>(initialCounts)
  const [ghlCalendars, setGhlCalendars] = useState<{ id: string; name?: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [optInConfirmed, setOptInConfirmed] = useState(false)
  const [caConfirmed, setCaConfirmed] = useState(false)

  const complianceOk = optInConfirmed && caConfirmed

  useEffect(() => {
    fetch('/api/me/ghl-calendars')
      .then((r) => r.json() as Promise<{ ok: boolean; calendars?: { id: string; name?: string }[] }>)
      .then((d) => { if (d.ok && d.calendars?.length) setGhlCalendars(d.calendars) })
      .catch(() => null)
  }, [])

  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  async function save(next: AppointmentSetterConfig) {
    setSaving(true)
    try {
      const res = await fetch('/api/me/appointment-setter-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await res.json() as { ok: boolean; config?: AppointmentSetterConfig }
      if (json.ok && json.config) {
        setCfg(json.config)
        setSavedAt(Date.now())
      }
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof AppointmentSetterConfig>(key: K, value: AppointmentSetterConfig[K]) {
    const next = { ...cfg, [key]: value }
    setCfg(next)
    void save(next)
  }

  function toggleDay(d: number) {
    const next = cfg.active_days.includes(d)
      ? cfg.active_days.filter((x) => x !== d)
      : [...cfg.active_days, d].sort()
    update('active_days', next)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const rows = isXlsx
        ? parseXlsx(ev.target?.result as ArrayBuffer)
        : parseCSV(String(ev.target?.result ?? ''))
      setImportState(rows.length ? { phase: 'preview', rows } : { phase: 'error', message: 'No valid rows found. File must include a phone column.' })
      setOptInConfirmed(false)
      setCaConfirmed(false)
    }
    if (isXlsx) {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsText(file)
    }
    e.target.value = ''
  }

  async function confirmImport(rows: LeadRow[]) {
    const CHUNK = 500
    let totalInserted = 0
    let totalSkipped = 0
    setImportState({ phase: 'importing', done: 0, total: rows.length })
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        setImportState({ phase: 'importing', done: i, total: rows.length })
        const res = await fetch('/api/me/appointment-setter-leads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            leads: rows.slice(i, i + CHUNK),
            compliance: { opt_in: true, california_ai_disclosure: true },
          }),
        })
        const json = await res.json() as { ok: boolean; inserted?: number; skipped?: number; error?: string }
        if (!json.ok) { setImportState({ phase: 'error', message: json.error ?? 'Import failed' }); return }
        totalInserted += json.inserted ?? 0
        totalSkipped += json.skipped ?? 0
      }
      setImportState({ phase: 'done', inserted: totalInserted, skipped: totalSkipped })
      const cRes = await fetch('/api/me/appointment-setter-leads')
      const cJson = await cRes.json() as { ok: boolean; counts?: QueueCounts }
      if (cJson.ok && cJson.counts) setCounts(cJson.counts)
    } catch (err) {
      setImportState({ phase: 'error', message: err instanceof Error ? err.message : 'Network error' })
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--paper)', color: 'var(--ink)',
    borderRadius: 12, padding: '18px 20px',
    boxShadow: 'var(--shadow-card)', marginBottom: 16,
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: '1.5px solid var(--border, #e5e7eb)', fontSize: 14,
    background: 'var(--paper)', color: 'var(--ink)',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block', color: 'var(--ink)',
  }

  const hintStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--muted)', marginTop: 3,
  }

  return (
    <div style={{ padding: '0 24px 40px' }}>

      {/* Enabled toggle + status */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Appointment Setter</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Autonomous outbound dialing engine — dumps leads in, sets appointments on your calendar all day.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{saving ? 'Saving…' : savedAt ? '✓ Saved' : ''}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--red)' }}
            />
            <span style={{ fontWeight: 700, fontSize: 14 }}>Enabled</span>
          </label>
        </div>
      </div>

      {/* Queue counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Pending', value: counts.pending, color: '#6366f1' },
          { label: 'In progress', value: counts.in_progress, color: '#f59e0b' },
          { label: 'Completed', value: counts.completed, color: '#94a3b8' },
          { label: 'Appts set', value: counts.appointments_set, color: '#22c55e' },
          { label: 'Failed', value: counts.failed, color: '#ef4444' },
          { label: 'Cancelled', value: counts.cancelled, color: '#9ca3af' },
        ].map((s) => (
          <div key={s.label} style={{
            background: 'var(--paper)', borderRadius: 10, padding: '12px 14px',
            boxShadow: 'var(--shadow-card)',
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Lead Import */}
      <details open style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Lead import</summary>
        <div style={cardStyle}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Lead Import</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Accepts <strong>.csv</strong>, <strong>.xlsx</strong>, or <strong>.xls</strong>.
              Required column: <code>phone</code>. Optional: name, email, company, notes.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                background: 'var(--red)', color: '#fff', border: 0, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13,
              }}
            >
              Choose file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            {importState.phase === 'preview' && (
              <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                {importState.rows.length.toLocaleString()} leads parsed
              </span>
            )}
          </div>

          {importState.phase === 'preview' && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f7f4ef' }}>
                    {['#', 'Phone', 'Name', 'Email', 'Company', 'Notes'].map((h) => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importState.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '5px 10px', color: 'var(--muted)' }}>{i + 1}</td>
                      <td style={{ padding: '5px 10px' }}>{r.phone}</td>
                      <td style={{ padding: '5px 10px' }}>{r.name ?? '—'}</td>
                      <td style={{ padding: '5px 10px' }}>{r.email ?? '—'}</td>
                      <td style={{ padding: '5px 10px' }}>{r.company ?? '—'}</td>
                      <td style={{ padding: '5px 10px' }}>{r.notes ?? '—'}</td>
                    </tr>
                  ))}
                  {importState.rows.length > 5 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '5px 10px', color: 'var(--muted)', fontStyle: 'italic' }}>
                        … and {(importState.rows.length - 5).toLocaleString()} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {importState.phase === 'preview' && (
            <div style={{ background: '#fefce8', border: '1px solid #fcd34d', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#78350f', marginBottom: 10 }}>
                Required compliance acknowledgements — read before importing
              </div>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={optInConfirmed}
                  onChange={(e) => setOptInConfirmed(e.target.checked)}
                  style={{ marginTop: 2, accentColor: '#ca8a04', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: '#44403c', lineHeight: 1.5 }}>
                  <strong>I confirm all leads in this file have opted in</strong> to receive calls about this product or service.
                  Calling non-opt-in leads may violate the TCPA and expose me to significant legal liability.
                </span>
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={caConfirmed}
                  onChange={(e) => setCaConfirmed(e.target.checked)}
                  style={{ marginTop: 2, accentColor: '#ca8a04', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: '#44403c', lineHeight: 1.5 }}>
                  <strong>If any leads are in California,</strong> my AI calling script includes a clear disclosure that this
                  is an AI voice call, as required under California law (AB 2602 / SB 1228). This is my legal responsibility.
                </span>
              </label>
            </div>
          )}

          {importState.phase === 'preview' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => void confirmImport(importState.rows)}
                disabled={!complianceOk}
                title={!complianceOk ? 'Check both compliance boxes above to unlock' : undefined}
                style={{
                  background: 'var(--red)', color: '#fff', border: 0, padding: '8px 18px',
                  borderRadius: 8, cursor: complianceOk ? 'pointer' : 'not-allowed',
                  fontWeight: 700, fontSize: 13, opacity: complianceOk ? 1 : 0.45,
                }}
              >
                Import {importState.rows.length.toLocaleString()} leads
              </button>
              {!complianceOk && (
                <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                  Check both boxes above to unlock import
                </span>
              )}
              <button
                onClick={() => { setImportState({ phase: 'idle' }); setOptInConfirmed(false); setCaConfirmed(false) }}
                style={{ background: '#f3f4f6', color: 'var(--ink)', border: 0, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          )}

          {importState.phase === 'importing' && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Importing… {importState.done.toLocaleString()} / {importState.total.toLocaleString()} leads
            </p>
          )}

          {importState.phase === 'done' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ background: '#dcfce7', color: '#166534', padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                ✓ {importState.inserted.toLocaleString()} leads imported
              </span>
              {importState.skipped > 0 && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{importState.skipped} skipped (missing phone)</span>
              )}
              <button
                onClick={() => { setImportState({ phase: 'idle' }); setOptInConfirmed(false); setCaConfirmed(false) }}
                style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 0, cursor: 'pointer' }}
              >
                Import more
              </button>
            </div>
          )}

          {importState.phase === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ background: '#fee2e2', color: '#991b1b', padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                ✗ {importState.message}
              </span>
              <button
                onClick={() => { setImportState({ phase: 'idle' }); setOptInConfirmed(false); setCaConfirmed(false) }}
                style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 0, cursor: 'pointer' }}
              >
                Try again
              </button>
            </div>
          )}

          {importState.phase === 'idle' && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              Required column: <code>phone</code>. Optional: <code>name</code>, <code>first_name</code>, <code>last_name</code>, <code>email</code>, <code>company</code>, <code>notes</code>.
            </p>
          )}
        </div>
      </details>

      {/* Work Schedule */}
      <details open style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Work schedule and dial windows</summary>
        <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>Work Schedule</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Active days</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => toggleDay(i)}
                  style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: '1.5px solid',
                    borderColor: cfg.active_days.includes(i) ? 'var(--red)' : '#e5e7eb',
                    background: cfg.active_days.includes(i) ? 'var(--red)' : 'transparent',
                    color: cfg.active_days.includes(i) ? '#fff' : 'var(--ink)',
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span style={labelStyle}>Start time</span>
            <input
              type="time"
              value={`${String(cfg.start_hour).padStart(2, '0')}:00`}
              onChange={(e) => update('start_hour', parseInt(e.target.value.split(':')[0]))}
              style={fieldStyle}
            />
            <p style={hintStyle}>Don&apos;t dial before this time</p>
          </div>

          <div>
            <span style={labelStyle}>End time</span>
            <input
              type="time"
              value={`${String(cfg.end_hour).padStart(2, '0')}:00`}
              onChange={(e) => update('end_hour', parseInt(e.target.value.split(':')[0]))}
              style={fieldStyle}
            />
            <p style={hintStyle}>Stop dialing at this time</p>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <span style={labelStyle}>Preferred call windows</span>
            <textarea
              rows={3}
              value={cfg.preferred_call_windows}
              placeholder={'Examples:\n8:00-10:00 (before work)\n12:00-1:00 (lunch)\n5:30-7:30 (after work)'}
              onChange={(e) => update('preferred_call_windows', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <p style={hintStyle}>Use one window per line. Great for off-work-hour dialing strategy.</p>
          </div>
        </div>
        </div>
      </details>

      {/* Daily Targets */}
      <details open style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Targets and pacing</summary>
        <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>Daily Targets</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Appointments to set / day</span>
            <input
              type="number" min={1} max={50} value={cfg.daily_appt_target}
              onChange={(e) => update('daily_appt_target', parseInt(e.target.value) || 5)}
              style={fieldStyle}
            />
            <p style={hintStyle}>Once hit, the dialer stops for the day</p>
          </div>
          <div>
            <span style={labelStyle}>Max dials / day</span>
            <input
              type="number" min={10} max={1000} value={cfg.max_daily_dials}
              onChange={(e) => update('max_daily_dials', parseInt(e.target.value) || 100)}
              style={fieldStyle}
            />
          </div>

          <div>
            <span style={labelStyle}>Leads to dial / day</span>
            <input
              type="number" min={10} max={2000} value={cfg.leads_per_day}
              onChange={(e) => update('leads_per_day', parseInt(e.target.value) || 120)}
              style={fieldStyle}
            />
            <p style={hintStyle}>Hard pacing target independent from queue size</p>
          </div>

          <div>
            <span style={labelStyle}>Leads to dial / hour</span>
            <input
              type="number" min={1} max={100} value={cfg.leads_per_hour}
              onChange={(e) => update('leads_per_hour', parseInt(e.target.value) || 18)}
              style={fieldStyle}
            />
            <p style={hintStyle}>Controls session intensity and rep callback load</p>
          </div>

          <div>
            <span style={labelStyle}>Max hours / day</span>
            <input
              type="number" min={1} max={12} step={0.5} value={cfg.max_daily_hours}
              onChange={(e) => update('max_daily_hours', parseFloat(e.target.value) || 6)}
              style={fieldStyle}
            />
            <p style={hintStyle}>Stops daily dialing when this runtime is reached</p>
          </div>
        </div>
        </div>
      </details>

      {/* Calendar */}
      <details open style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Calendar and booking</summary>
        <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>Calendar &amp; Booking</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Booking calendar URL</span>
            <input
              type="url" value={cfg.booking_calendar_url} placeholder="https://cal.com/yourlink"
              onChange={(e) => update('booking_calendar_url', e.target.value)}
              style={fieldStyle}
            />
            <p style={hintStyle}>Cal.com link or GHL calendar embed. The AI reads available slots from this.</p>
          </div>
          {ghlCalendars.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>GoHighLevel calendar</span>
              <select
                value={cfg.ghl_calendar_id ?? ''}
                onChange={(e) => update('ghl_calendar_id', e.target.value)}
                style={fieldStyle}
              >
                <option value="">— Select a GHL calendar —</option>
                {ghlCalendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>{cal.name ?? cal.id}</option>
                ))}
              </select>
              <p style={hintStyle}>When GHL is connected, appointments will be created in this calendar automatically.</p>
            </div>
          )}
          <div>
            <span style={labelStyle}>Rep name on invite</span>
            <input
              type="text" value={cfg.booking_rep_name} placeholder="Your Name"
              onChange={(e) => update('booking_rep_name', e.target.value)}
              style={fieldStyle}
            />
            <p style={hintStyle}>Shown on calendar invites</p>
          </div>
        </div>
        </div>
      </details>

      {/* Script */}
      <details open style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Role and script settings</summary>
        <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem' }}>AI Script</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
          All fields are optional — the provider uses its default if blank.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Role title</span>
            <input
              type="text" value={cfg.role_title} placeholder="e.g. Appointment Coordinator"
              onChange={(e) => update('role_title', e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div>
            <span style={labelStyle}>Role mission</span>
            <input
              type="text" value={cfg.role_mission} placeholder="e.g. Book qualified demos with decision-makers"
              onChange={(e) => update('role_mission', e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div>
            <span style={labelStyle}>AI name (what it calls itself)</span>
            <input
              type="text" value={cfg.ai_name} placeholder="e.g. Alex from VirtualCloser"
              onChange={(e) => update('ai_name', e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div />
          <div>
            <span style={labelStyle}>Call opener</span>
            <textarea
              rows={3} value={cfg.opener}
              placeholder={"e.g. Hi {first_name}, this is Alex — I'm reaching out because you expressed interest in..."}
              onChange={(e) => update('opener', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>
          <div>
            <span style={labelStyle}>Qualification questions</span>
            <textarea
              rows={3} value={cfg.qualification_questions}
              placeholder={"One per line:\nWhat does your current process look like?\nWhat's holding you back from booking?"}
              onChange={(e) => update('qualification_questions', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={labelStyle}>Objection handling</span>
            <textarea
              rows={5} value={cfg.objections}
              placeholder={'Format: Objection → Response\ne.g. "I\'m busy" → "Totally get it — that\'s why I\'m calling. Takes 90 seconds..."'}
              onChange={(e) => update('objections', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={labelStyle}>Disqualify rules</span>
            <textarea
              rows={4} value={cfg.disqualify_rules}
              placeholder={'One per line:\nNo budget authority\nOutside service area\nTimeline greater than 12 months'}
              onChange={(e) => update('disqualify_rules', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <p style={hintStyle}>AI can mark leads as nurture/not-qualified using these rules.</p>
          </div>
        </div>
        </div>
      </details>
    </div>
  )
}
