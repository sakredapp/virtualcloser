'use client'

import { useEffect, useState, useCallback } from 'react'

type DialerMode = 'concierge' | 'appointment_setter' | 'pipeline' | 'live_transfer'
type TriggerKind =
  | 'calendar_reminder'
  | 'calendar_reschedule_request'
  | 'crm_stage_changed'
  | 'payment_event'
  | 'csv_batch'
  | 'telegram_command'
type Scope = 'personal' | 'team' | 'account'

type WorkflowRule = {
  id: string
  name: string
  is_active: boolean
  dialer_mode: DialerMode
  trigger_kind: TriggerKind
  scope: Scope
  max_attempts: number
  retry_delay_min: number
  priority: number
  business_hours_only: boolean
  created_at: string
}

type Props = {
  canEdit: boolean
  isEnterprise: boolean
}

const MODE_COLORS: Record<DialerMode, string> = {
  concierge: '#22c55e',
  appointment_setter: '#3b82f6',
  pipeline: '#f59e0b',
  live_transfer: '#ef4444',
}

const MODE_LABELS: Record<DialerMode, string> = {
  concierge: 'Concierge',
  appointment_setter: 'Appt Setter',
  pipeline: 'Pipeline',
  live_transfer: 'Live Transfer',
}

const TRIGGER_LABELS: Record<TriggerKind, string> = {
  calendar_reminder: 'Calendar reminder',
  calendar_reschedule_request: 'Reschedule request',
  crm_stage_changed: 'CRM stage changed',
  payment_event: 'Payment event',
  csv_batch: 'CSV batch',
  telegram_command: 'Telegram command',
}

const BLANK: Omit<WorkflowRule, 'id' | 'created_at'> = {
  name: '',
  is_active: true,
  dialer_mode: 'concierge',
  trigger_kind: 'calendar_reminder',
  scope: 'personal',
  max_attempts: 2,
  retry_delay_min: 30,
  priority: 10,
  business_hours_only: false,
}

export default function DialerWorkflowsPanel({ canEdit, isEnterprise }: Props) {
  const [rules, setRules] = useState<WorkflowRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Omit<WorkflowRule, 'id' | 'created_at'>>(BLANK)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/dialer-workflows')
      const json = (await res.json()) as { ok: boolean; workflows?: WorkflowRule[]; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Failed to load')
      setRules(json.workflows ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/me/dialer-workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Save failed')
      setShowForm(false)
      setForm(BLANK)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(rule: WorkflowRule) {
    setTogglingId(rule.id)
    try {
      const res = await fetch('/api/me/dialer-workflows', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Update failed')
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this workflow rule?')) return
    setDeletingId(id)
    try {
      const res = await fetch('/api/me/dialer-workflows', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Delete failed')
      setRules((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Workflow rules</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
            Define when and how the dialer fires for each mode.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowForm((v) => !v)} style={btnPrimary}>
            {showForm ? 'Cancel' : '+ Add rule'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {showForm && canEdit && (
        <form onSubmit={(e) => { void handleCreate(e) }} style={formBox}>
          <div style={formGrid}>
            <label style={fieldLabel}>
              Name
              <input
                style={input}
                value={form.name}
                required
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Calendar confirm · concierge"
              />
            </label>
            <label style={fieldLabel}>
              Mode
              <select style={input} value={form.dialer_mode} onChange={(e) => setForm((f) => ({ ...f, dialer_mode: e.target.value as DialerMode }))}>
                <option value="concierge">Concierge</option>
                <option value="appointment_setter">Appointment Setter</option>
                <option value="pipeline">Pipeline</option>
                <option value="live_transfer">Live Transfer</option>
              </select>
            </label>
            <label style={fieldLabel}>
              Trigger
              <select style={input} value={form.trigger_kind} onChange={(e) => setForm((f) => ({ ...f, trigger_kind: e.target.value as TriggerKind }))}>
                <option value="calendar_reminder">Calendar reminder</option>
                <option value="calendar_reschedule_request">Reschedule request</option>
                <option value="crm_stage_changed">CRM stage changed</option>
                <option value="payment_event">Payment event</option>
                <option value="csv_batch">CSV batch</option>
                <option value="telegram_command">Telegram command</option>
              </select>
            </label>
            {isEnterprise && (
              <label style={fieldLabel}>
                Scope
                <select style={input} value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as Scope }))}>
                  <option value="personal">Personal</option>
                  <option value="team">Team</option>
                  <option value="account">Account-wide</option>
                </select>
              </label>
            )}
            <label style={fieldLabel}>
              Max attempts
              <input
                style={input}
                type="number"
                min={1}
                max={10}
                value={form.max_attempts}
                onChange={(e) => setForm((f) => ({ ...f, max_attempts: Number(e.target.value) }))}
              />
            </label>
            <label style={fieldLabel}>
              Retry delay (min)
              <input
                style={input}
                type="number"
                min={1}
                max={1440}
                value={form.retry_delay_min}
                onChange={(e) => setForm((f) => ({ ...f, retry_delay_min: Number(e.target.value) }))}
              />
            </label>
            <label style={fieldLabel}>
              Priority
              <input
                style={input}
                type="number"
                min={1}
                max={100}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
              />
            </label>
            <label style={{ ...fieldLabel, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input
                type="checkbox"
                checked={form.business_hours_only}
                onChange={(e) => setForm((f) => ({ ...f, business_hours_only: e.target.checked }))}
                style={{ width: 16, height: 16 }}
              />
              Business hours only
            </label>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={btnPrimary}>
              {saving ? 'Saving…' : 'Save rule'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setForm(BLANK) }} style={btnGhost}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ padding: 16, opacity: 0.7, fontSize: 13 }}>Loading…</div>
      ) : rules.length === 0 ? (
        <div style={{ padding: 16, opacity: 0.7, fontSize: 13 }}>
          No workflow rules yet. {canEdit ? 'Add one above.' : 'Ask your owner/admin to create rules.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f7f4ef' }}>
                <th style={th}>Name</th>
                <th style={th}>Mode</th>
                <th style={th}>Trigger</th>
                {isEnterprise && <th style={th}>Scope</th>}
                <th style={th}>Attempts</th>
                <th style={th}>Retry</th>
                <th style={th}>Active</th>
                {canEdit && <th style={{ ...th, textAlign: 'right' }}></th>}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee', opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>
                    <span style={{ background: MODE_COLORS[r.dialer_mode], color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                      {MODE_LABELS[r.dialer_mode]}
                    </span>
                  </td>
                  <td style={td}>{TRIGGER_LABELS[r.trigger_kind] ?? r.trigger_kind}</td>
                  {isEnterprise && <td style={td}>{r.scope}</td>}
                  <td style={td}>{r.max_attempts}×</td>
                  <td style={td}>{r.retry_delay_min}m</td>
                  <td style={td}>
                    {canEdit ? (
                      <button
                        onClick={() => { void handleToggle(r) }}
                        disabled={togglingId === r.id}
                        style={{
                          background: r.is_active ? '#22c55e' : '#94a3b8',
                          color: '#fff',
                          border: 0,
                          borderRadius: 12,
                          padding: '3px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {r.is_active ? 'ON' : 'OFF'}
                      </button>
                    ) : (
                      <span style={{ color: r.is_active ? '#22c55e' : '#94a3b8', fontWeight: 700 }}>
                        {r.is_active ? 'ON' : 'OFF'}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        onClick={() => { void handleDelete(r.id) }}
                        disabled={deletingId === r.id}
                        style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                      >
                        {deletingId === r.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
  boxShadow: 'var(--shadow-card)',
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
  border: '1px solid var(--border-soft)',
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
const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
}
const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--muted, #5a5a5a)',
}
const input: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-soft)',
  background: '#fff',
  color: 'var(--ink)',
  fontSize: 13,
}
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  opacity: 0.7,
}
const td: React.CSSProperties = { padding: '10px 12px' }
