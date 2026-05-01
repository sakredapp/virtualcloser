'use client'

import { useEffect, useState } from 'react'
import type { DialerSettings } from '@/lib/voice/dialerSettings'

type Props = {
  initial: DialerSettings
  canEdit: boolean
}

export default function DialerSettingsCard({ initial, canEdit }: Props) {
  const [settings, setSettings] = useState<DialerSettings>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-clear "Saved" status after 2.5s
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  async function save(next: DialerSettings) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/me/dialer-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = (await res.json()) as { ok: boolean; settings?: DialerSettings; error?: string }
      if (!json.ok) {
        setError(json.error ?? 'Save failed')
      } else if (json.settings) {
        setSettings(json.settings)
        setSavedAt(Date.now())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof DialerSettings>(key: K, value: DialerSettings[K]) {
    const next = { ...settings, [key]: value }
    setSettings(next)
    if (canEdit) void save(next)
  }

  function toggleMode(mode: DialerSettings['enabled_modes'][number]) {
    const has = settings.enabled_modes.includes(mode)
    const nextModes = has
      ? settings.enabled_modes.filter((m) => m !== mode)
      : [...settings.enabled_modes, mode]
    update('enabled_modes', nextModes)
  }

  return (
    <section
      style={{
        margin: '0 24px 20px',
        background: 'var(--paper)',
        color: 'var(--ink)',
        borderRadius: 12,
        padding: '18px 20px',
        boxShadow: '0 1px 0 rgba(0,0,0,.05)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Auto-confirm settings</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
            When the system should auto-call leads to confirm or reschedule their booked appointments.
          </p>
        </div>
        <div style={{ fontSize: 12, color: savedAt ? '#1f8a3b' : error ? '#c21a00' : 'var(--muted)', minHeight: 16 }}>
          {saving ? 'Saving…' : savedAt ? 'Saved' : error ? error : !canEdit ? 'Read-only — admin can edit' : ''}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <Toggle
          label="Auto-confirm enabled"
          help="Master switch. When off, the cron skips this account but manual Call now buttons still work."
          checked={settings.auto_confirm_enabled}
          onChange={(v) => update('auto_confirm_enabled', v)}
          disabled={!canEdit}
        />

        <NumberField
          label="Lead time — earliest (min)"
          help="Don't call sooner than this many minutes before the appointment."
          value={settings.auto_confirm_lead_min}
          min={5}
          max={240}
          onCommit={(v) => update('auto_confirm_lead_min', v)}
          disabled={!canEdit || !settings.auto_confirm_enabled}
        />

        <NumberField
          label="Lead time — latest (min)"
          help="Don't call once we're closer than this many minutes — the bot will catch the next pass."
          value={settings.auto_confirm_lead_max}
          min={10}
          max={300}
          onCommit={(v) => update('auto_confirm_lead_max', v)}
          disabled={!canEdit || !settings.auto_confirm_enabled}
        />

        <NumberField
          label="Max attempts per meeting"
          help="Stop trying after this many calls. Includes the first attempt."
          value={settings.max_attempts}
          min={1}
          max={5}
          onCommit={(v) => update('max_attempts', v)}
          disabled={!canEdit}
        />

        <Toggle
          label="Retry on voicemail / no answer"
          help="If the first attempt missed, try once more after the delay below."
          checked={settings.retry_on_voicemail}
          onChange={(v) => update('retry_on_voicemail', v)}
          disabled={!canEdit}
        />

        <NumberField
          label="Retry delay (min)"
          help="How long to wait after a voicemail or no-answer before trying again."
          value={settings.retry_delay_min}
          min={5}
          max={240}
          onCommit={(v) => update('retry_delay_min', v)}
          disabled={!canEdit || !settings.retry_on_voicemail}
        />

        <Toggle
          label="AI call summaries"
          help="After every call, Claude reads the transcript and writes a 2-3 sentence recap + next-action."
          checked={settings.enable_post_call_summary}
          onChange={(v) => update('enable_post_call_summary', v)}
          disabled={!canEdit}
        />

        <Toggle
          label="Auto-create follow-up tasks"
          help="On voicemail / no answer / cancellation, drop a follow-up task into your brain inbox."
          checked={settings.enable_followup_tasks}
          onChange={(v) => update('enable_followup_tasks', v)}
          disabled={!canEdit}
        />

        <Toggle
          label="Pipeline workflow mode opt-in"
          help="Rep/account controlled: when off, pipeline-triggered dialing queues are ignored."
          checked={settings.pipeline_opt_in}
          onChange={(v) => update('pipeline_opt_in', v)}
          disabled={!canEdit}
        />

        <NumberField
          label="Max concurrent calls"
          help="Backpressure guard for queue workers in high-volume dialing."
          value={settings.max_concurrent_calls}
          min={1}
          max={50}
          onCommit={(v) => update('max_concurrent_calls', v)}
          disabled={!canEdit}
        />
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {[
          ['concierge', 'Concierge'],
          ['appointment_setter', 'Appointment Setter'],
          ['pipeline', 'Pipeline/Workflow'],
          ['live_transfer', 'Live Transfer Hunter'],
        ].map(([modeKey, label]) => {
          const mode = modeKey as DialerSettings['enabled_modes'][number]
          const active = settings.enabled_modes.includes(mode)
          const provider = settings.mode_providers[mode] ?? 'revring'
          return (
            <div
              key={mode}
              style={{
                padding: '12px 14px',
                background: 'var(--paper-2, #f7f4ef)',
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                opacity: canEdit ? 1 : 0.75,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <strong style={{ fontSize: 14 }}>{label}</strong>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={!canEdit}
                  onChange={() => toggleMode(mode)}
                  style={{ width: 18, height: 18, accentColor: 'var(--red, #ff2800)' }}
                />
              </div>
              <p style={{ margin: '6px 0', fontSize: 12, color: 'var(--muted, #5a5a5a)' }}>
                {active ? 'Enabled' : 'Disabled'}
              </p>
              <p style={{ marginTop: 6, fontSize: 12, color: 'var(--muted, #5a5a5a)' }}>
                Voice provider: <strong>RevRing</strong>
              </p>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 14, maxWidth: 360 }}>
        <label style={{ fontSize: 12, color: 'var(--muted, #5a5a5a)' }}>
          Live transfer fallback
          <select
            value={settings.live_transfer_fallback}
            disabled={!canEdit}
            onChange={(e) =>
              update(
                'live_transfer_fallback',
                e.target.value as 'book_appointment' | 'collect_callback' | 'end_call',
              )
            }
            style={{
              marginTop: 6,
              width: '100%',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff',
              color: 'var(--ink, #0f0f0f)',
              fontSize: 13,
            }}
          >
            <option value="book_appointment">Book appointment fallback</option>
            <option value="collect_callback">Collect callback window</option>
            <option value="end_call">End call politely</option>
          </select>
        </label>
      </div>

      <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--muted)' }}>
        Current window: meetings starting between{' '}
        <strong>{settings.auto_confirm_lead_min}</strong> and{' '}
        <strong>{settings.auto_confirm_lead_max}</strong> minutes from now will be auto-dialed.
      </p>
    </section>
  )
}

function Toggle({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        background: 'var(--paper-2, #f7f4ef)',
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: 'var(--red, #ff2800)' }}
        />
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted, #5a5a5a)' }}>{help}</span>
    </label>
  )
}

function NumberField({
  label,
  help,
  value,
  min,
  max,
  onCommit,
  disabled,
}: {
  label: string
  help: string
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
  disabled?: boolean
}) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => {
    setLocal(String(value))
  }, [value])
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        background: 'var(--paper-2, #f7f4ef)',
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const parsed = Number(local)
          if (!Number.isFinite(parsed)) return
          const clamped = Math.max(min, Math.min(max, Math.round(parsed)))
          if (clamped !== value) onCommit(clamped)
          setLocal(String(clamped))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          padding: '8px 10px',
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          background: '#fff',
          color: 'var(--ink, #0f0f0f)',
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--muted, #5a5a5a)' }}>{help}</span>
    </label>
  )
}
