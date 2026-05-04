'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DialerSettings } from '@/lib/voice/dialerSettings'

type Meeting = {
  id: string
  attendee_name: string | null
  phone: string | null
  scheduled_at: string
  status: string
  confirmation_attempts: number
  title: string | null
}

type Props = {
  repId: string
  initialSettings: DialerSettings
  canEdit: boolean
  fromNumber: string | null
}

type Tab = 'confirmation' | 'inbound' | 'ghl'

export default function ReceptionistModesPanel({ repId, initialSettings, canEdit, fromNumber }: Props) {
  const [tab, setTab] = useState<Tab>('confirmation')

  return (
    <section style={{ margin: '0.8rem 24px 0' }}>
      {/* Tab pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['confirmation', '📅 Auto Confirm'],
          ['inbound',      '📲 Inbound Calls'],
          ['ghl',          '⚡ GHL / Workflow Triggers'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: tab === key ? '2px solid var(--red, #ff2800)' : '1.5px solid var(--border-soft)',
              background: tab === key ? 'var(--red, #ff2800)' : 'var(--paper)',
              color: tab === key ? '#fff' : 'var(--ink)',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'confirmation' && (
        <ConfirmationTab initialSettings={initialSettings} canEdit={canEdit} />
      )}
      {tab === 'inbound' && (
        <InboundTab fromNumber={fromNumber} repId={repId} />
      )}
      {tab === 'ghl' && (
        <GhlWorkflowTab repId={repId} />
      )}
    </section>
  )
}

// ── Confirmation Tab ───────────────────────────────────────────────────────

function ConfirmationTab({ initialSettings, canEdit }: { initialSettings: DialerSettings; canEdit: boolean }) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [loadingMeetings, setLoadingMeetings] = useState(true)
  const [callingId, setCallingId] = useState<string | null>(null)
  const [callResults, setCallResults] = useState<Record<string, 'ok' | 'err'>>({})

  useEffect(() => {
    if (savedAt) {
      const t = setTimeout(() => setSavedAt(null), 2500)
      return () => clearTimeout(t)
    }
  }, [savedAt])

  const fetchMeetings = useCallback(async () => {
    setLoadingMeetings(true)
    try {
      const res = await fetch('/api/me/upcoming-meetings?hours=8')
      const json = (await res.json()) as { ok: boolean; meetings?: Meeting[] }
      if (json.ok) setMeetings(json.meetings ?? [])
    } finally {
      setLoadingMeetings(false)
    }
  }, [])

  useEffect(() => { void fetchMeetings() }, [fetchMeetings])

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
      if (!json.ok) setError(json.error ?? 'Save failed')
      else if (json.settings) { setSettings(json.settings); setSavedAt(Date.now()) }
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

  async function callNow(meetingId: string) {
    setCallingId(meetingId)
    try {
      const res = await fetch('/api/voice/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      setCallResults((p) => ({ ...p, [meetingId]: json.ok ? 'ok' : 'err' }))
      if (json.ok) void fetchMeetings()
    } catch {
      setCallResults((p) => ({ ...p, [meetingId]: 'err' }))
    } finally {
      setCallingId(null)
    }
  }

  return (
    <div>
      {/* Settings card */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Auto-confirm settings</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Dial each booked meeting automatically in the window below.
            </p>
          </div>
          <span style={{ fontSize: 12, color: savedAt ? '#1f8a3b' : error ? '#c21a00' : 'var(--muted)' }}>
            {saving ? 'Saving…' : savedAt ? 'Saved ✓' : error ?? (!canEdit ? 'Read-only' : '')}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <SettingToggle
            label="Auto-confirm enabled"
            help="Master switch — cron dials meetings automatically when on."
            checked={settings.auto_confirm_enabled}
            onChange={(v) => update('auto_confirm_enabled', v)}
            disabled={!canEdit}
          />
          <SettingNumber
            label="Earliest (min before)"
            help="Don't call sooner than this."
            value={settings.auto_confirm_lead_min}
            min={5} max={240}
            onCommit={(v) => update('auto_confirm_lead_min', v)}
            disabled={!canEdit || !settings.auto_confirm_enabled}
          />
          <SettingNumber
            label="Latest (min before)"
            help="Skip if appointment is this close."
            value={settings.auto_confirm_lead_max}
            min={10} max={300}
            onCommit={(v) => update('auto_confirm_lead_max', v)}
            disabled={!canEdit || !settings.auto_confirm_enabled}
          />
          <SettingNumber
            label="Max attempts"
            help="Total dials per meeting including first."
            value={settings.max_attempts}
            min={1} max={5}
            onCommit={(v) => update('max_attempts', v)}
            disabled={!canEdit}
          />
          <SettingToggle
            label="Retry on voicemail"
            help="Try again after voicemail or no-answer."
            checked={settings.retry_on_voicemail}
            onChange={(v) => update('retry_on_voicemail', v)}
            disabled={!canEdit}
          />
          <SettingNumber
            label="Retry delay (min)"
            help="Wait this long before the retry attempt."
            value={settings.retry_delay_min}
            min={5} max={240}
            onCommit={(v) => update('retry_delay_min', v)}
            disabled={!canEdit || !settings.retry_on_voicemail}
          />
        </div>

        <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          Current window: meetings <strong>{settings.auto_confirm_lead_min}–{settings.auto_confirm_lead_max} min</strong> from now are eligible for auto-dial. Cron runs every 15 min.
        </p>
      </div>

      {/* Upcoming meetings */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Upcoming meetings (next 8 hours)</h3>
          <button
            onClick={() => void fetchMeetings()}
            style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 6,
              border: '1px solid var(--border-soft)', background: 'transparent',
              color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>

        {loadingMeetings ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : !meetings || meetings.length === 0 ? (
          <div style={{
            padding: '16px', borderRadius: 8, background: '#f7f4ef',
            fontSize: 13, color: 'var(--muted)', textAlign: 'center',
          }}>
            No meetings in the next 8 hours.{' '}
            {!settings.auto_confirm_enabled && (
              <span style={{ color: '#c21a00' }}>Auto-confirm is off — enable it above to let the cron dial automatically.</span>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f7f4ef' }}>
                  {['Time', 'Attendee', 'Phone', 'Status', 'Attempts', 'Action'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => {
                  const dt = new Date(m.scheduled_at)
                  const minsUntil = Math.round((dt.getTime() - Date.now()) / 60_000)
                  const inWindow = minsUntil >= settings.auto_confirm_lead_min && minsUntil <= settings.auto_confirm_lead_max
                  const result = callResults[m.id]
                  return (
                    <tr key={m.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {minsUntil > 0 ? `in ${minsUntil}m` : 'past'}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.attendee_name ?? m.title ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                        {m.phone ?? <span style={{ opacity: 0.4 }}>no phone</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <StatusPill status={m.status} />
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13 }}>
                        {m.confirmation_attempts}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {result === 'ok' ? (
                          <span style={{ color: '#166534', fontSize: 12, fontWeight: 700 }}>Calling…</span>
                        ) : result === 'err' ? (
                          <span style={{ color: '#c21a00', fontSize: 12 }}>Failed</span>
                        ) : (
                          <button
                            disabled={!m.phone || callingId === m.id}
                            onClick={() => void callNow(m.id)}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                              border: inWindow ? '1.5px solid #166534' : '1.5px solid var(--border-soft)',
                              background: inWindow ? '#dcfce7' : 'var(--paper)',
                              color: inWindow ? '#166534' : 'var(--muted)',
                              cursor: !m.phone ? 'not-allowed' : 'pointer',
                              opacity: !m.phone ? 0.4 : 1,
                            }}
                            title={!m.phone ? 'No phone number on file' : inWindow ? 'In auto-confirm window' : 'Force call now'}
                          >
                            {callingId === m.id ? 'Calling…' : 'Call now'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inbound Tab ────────────────────────────────────────────────────────────

function InboundTab({ fromNumber, repId }: { fromNumber: string | null; repId: string }) {
  const [copied, setCopied] = useState(false)

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Status card */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)',
      }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '1rem' }}>Inbound AI Answer</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)' }}>
          When a prospect calls your AI Dialer number, the Receptionist answers, confirms or reschedules the appointment, and logs the outcome — just like an outbound call in reverse.
        </p>

        <div style={{
          padding: '14px 16px', borderRadius: 10,
          background: fromNumber ? '#f0fdf4' : '#fff7ed',
          border: `1px solid ${fromNumber ? '#bbf7d0' : '#fed7aa'}`,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: fromNumber ? '#166534' : '#92400e', marginBottom: 4 }}>
            {fromNumber ? 'Your AI Dialer number' : 'No phone number configured'}
          </div>
          {fromNumber ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, letterSpacing: '0.05em' }}>
                {fromNumber}
              </span>
              <button
                onClick={() => copy(fromNumber)}
                style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 5,
                  border: '1px solid #bbf7d0', background: '#fff', cursor: 'pointer',
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: '#92400e' }}>
              Contact your account manager to configure your AI Dialer number.
            </p>
          )}
        </div>

        <div style={{ fontSize: 13 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>How inbound works:</p>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, color: 'var(--muted)' }}>
            <li>Prospect calls your AI Dialer number</li>
            <li>The call is routed to your <strong>Receptionist agent</strong> (same AI, inbound mode)</li>
            <li>AI greets by name if phone matches a known meeting, confirms or reschedules</li>
            <li>Outcome is logged to Voice Calls + meeting status updated automatically</li>
          </ol>
        </div>
      </div>

      {/* Setup steps */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)',
      }}>
        <h3 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Setup checklist</h3>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            ['Voice provider configured', !!fromNumber, 'Contact your account manager to configure AI Dialer'],
            ['Outbound number assigned', !!fromNumber, 'Your dedicated AI Dialer number'],
            ['Receptionist agent configured', true, 'Set up during onboarding — contact support if missing'],
            ['Inbound routing configured', true, 'Contact your account manager to enable inbound routing'],
          ].map(([label, done, note]) => (
            <div key={label as string} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 14px', borderRadius: 8,
              background: done ? '#f0fdf4' : '#fff7ed',
              border: `1px solid ${done ? '#bbf7d0' : '#fed7aa'}`,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{done ? '✅' : '⚠️'}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{label as string}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{note as string}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── GHL Workflow Tab ───────────────────────────────────────────────────────

function GhlWorkflowTab({ repId }: { repId: string }) {
  const [copied, setCopied] = useState<string | null>(null)
  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/ghl/${repId}`
    : `https://app.virtualcloser.com/api/webhooks/ghl/${repId}`

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Webhook URL */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)',
      }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>Your GHL Webhook URL</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)' }}>
          Paste this URL into a GHL Workflow action — the AI Receptionist fires automatically when triggered.
        </p>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 8,
          background: '#f7f4ef', border: '1px solid var(--border-soft)',
        }}>
          <code style={{ fontSize: 12, flex: 1, wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {webhookUrl}
          </code>
          <button
            onClick={() => copy(webhookUrl, 'url')}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 6,
              border: '1.5px solid var(--red, #ff2800)',
              background: copied === 'url' ? 'var(--red, #ff2800)' : 'transparent',
              color: copied === 'url' ? '#fff' : 'var(--red, #ff2800)',
              fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}
          >
            {copied === 'url' ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      </div>

      {/* Triggered events */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>What triggers the Receptionist</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {[
            ['AppointmentCreate', '📅', 'New appointment booked in GHL → AI calls to confirm within the lead window'],
            ['AppointmentUpdate', '✏️', 'Appointment rescheduled in GHL → AI calls new time to re-confirm'],
            ['ContactTagUpdate', '🏷️', 'Tag "vc-receptionist-call" added → triggers an immediate outbound call'],
            ['OutboundCall (manual)', '📞', 'Custom GHL Webhook action → add body field type: "receptionist_trigger"'],
          ].map(([event, icon, desc]) => (
            <div key={event as string} style={{
              display: 'flex', gap: 12, padding: '10px 14px',
              borderRadius: 8, background: '#f7f4ef',
              border: '1px solid var(--border-soft)',
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{icon as string}</span>
              <div>
                <code style={{ fontSize: 12, fontWeight: 700 }}>{event as string}</code>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>{desc as string}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* GHL setup guide */}
      <div style={{
        background: 'var(--paper)', borderRadius: 12,
        border: '1px solid var(--border-soft)', padding: '18px 20px',
        boxShadow: 'var(--shadow-card)',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>GHL Workflow setup (step by step)</h3>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2, fontSize: 13, color: 'var(--ink)' }}>
          <li>In GHL, open <strong>Automation → Workflows → New Workflow</strong></li>
          <li>Set trigger: <strong>Appointment Status Changed</strong> or <strong>Appointment Created</strong></li>
          <li>Add action: <strong>Webhook</strong></li>
          <li>Set method to <strong>POST</strong>, URL to the webhook URL above</li>
          <li>Leave body as <em>default GHL payload</em> — Virtual Closer parses it automatically</li>
          <li>Save and publish the workflow</li>
          <li>Test: create a test appointment and check Recent Calls below</li>
        </ol>

        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 8,
          background: '#eff6ff', border: '1px solid #bfdbfe',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: '#1d4ed8' }}>
            <strong>Tip:</strong> You can also use this webhook in GHL <strong>Pipeline stage changes</strong> — e.g., "When a deal moves to Closed/Won, call to schedule onboarding".
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    scheduled:            { label: 'Scheduled',   color: '#1d4ed8', bg: '#dbeafe' },
    confirmed:            { label: 'Confirmed',   color: '#166534', bg: '#dcfce7' },
    rescheduled:          { label: 'Rescheduled', color: '#92400e', bg: '#fef3c7' },
    reschedule_requested: { label: 'Reschedule?', color: '#92400e', bg: '#fef3c7' },
    cancelled:            { label: 'Cancelled',   color: '#991b1b', bg: '#fee2e2' },
    no_response:          { label: 'No response', color: '#6b21a8', bg: '#f3e8ff' },
  }
  const s = map[status] ?? { label: status, color: '#4b5563', bg: '#f3f4f6' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  )
}

function SettingToggle({
  label, help, checked, onChange, disabled,
}: {
  label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 5, padding: '10px 14px',
      background: '#f7f4ef', borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)',
      opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
        <input
          type="checkbox" checked={checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: 'var(--red, #ff2800)' }}
        />
      </div>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{help}</span>
    </label>
  )
}

function SettingNumber({
  label, help, value, min, max, onCommit, disabled,
}: {
  label: string; help: string; value: number; min: number; max: number
  onCommit: (v: number) => void; disabled?: boolean
}) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 5, padding: '10px 14px',
      background: '#f7f4ef', borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)',
      opacity: disabled ? 0.55 : 1,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
      <input
        type="number" min={min} max={max} value={local} disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const p = Number(local)
          if (!Number.isFinite(p)) return
          const c = Math.max(min, Math.min(max, Math.round(p)))
          if (c !== value) onCommit(c)
          setLocal(String(c))
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{
          padding: '6px 10px', border: '1px solid var(--border-soft)',
          borderRadius: 6, fontSize: 14, fontWeight: 600,
          background: '#fff', color: 'var(--ink)',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{help}</span>
    </label>
  )
}
