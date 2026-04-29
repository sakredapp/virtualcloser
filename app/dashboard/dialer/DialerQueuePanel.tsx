'use client'

import { useEffect, useState, useCallback } from 'react'

type DialerMode = 'concierge' | 'appointment_setter' | 'pipeline' | 'live_transfer'

type QueueItem = {
  id: string
  dialer_mode: DialerMode
  status: string
  phone: string | null
  attempt_count: number
  max_attempts: number
  last_outcome: string | null
  live_transfer_status: string | null
  scheduled_for: string | null
  created_at: string
  source_kind: string
}

type Props = {
  canEdit: boolean
}

const MODE_COLORS: Record<DialerMode, string> = {
  concierge: '#22c55e',
  appointment_setter: '#3b82f6',
  pipeline: '#f59e0b',
  live_transfer: '#ef4444',
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#94a3b8',
  expired: '#94a3b8',
}

export default function DialerQueuePanel({ canEdit }: Props) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enqueueing, setEnqueueing] = useState(false)
  const [showEnqueue, setShowEnqueue] = useState(false)
  const [enqForm, setEnqForm] = useState<{ phone: string; mode: DialerMode }>({
    phone: '',
    mode: 'concierge',
  })
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'failed'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/dialer-queue')
      const json = (await res.json()) as { ok: boolean; queue?: QueueItem[]; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Failed to load')
      setItems(json.queue ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-refresh every 20 seconds while panel is open.
  useEffect(() => {
    void load()
    const interval = setInterval(() => { void load() }, 20_000)
    return () => clearInterval(interval)
  }, [load])

  async function handleEnqueue(e: React.FormEvent) {
    e.preventDefault()
    if (!enqForm.phone.trim()) return
    setEnqueueing(true)
    try {
      const res = await fetch('/api/me/dialer-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: enqForm.phone.trim(),
          dialer_mode: enqForm.mode,
        }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'Enqueue failed')
      setShowEnqueue(false)
      setEnqForm({ phone: '', mode: 'concierge' })
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enqueue failed')
    } finally {
      setEnqueueing(false)
    }
  }

  const displayed =
    filter === 'all' ? items : items.filter((i) => i.status === filter)

  const counts = {
    pending: items.filter((i) => i.status === 'pending').length,
    in_progress: items.filter((i) => i.status === 'in_progress').length,
    completed: items.filter((i) => i.status === 'completed').length,
    failed: items.filter((i) => i.status === 'failed').length,
  }

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Dialer queue</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
            Live view of pending and recent queue items. Refreshes every 20s.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { void load() }} style={btnGhost} title="Refresh now">⟳</button>
          {canEdit && (
            <button onClick={() => setShowEnqueue((v) => !v)} style={btnPrimary}>
              {showEnqueue ? 'Cancel' : '+ Manual call'}
            </button>
          )}
        </div>
      </div>

      {/* Bucket pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['all', 'pending', 'in_progress', 'completed', 'failed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              ...btnGhost,
              padding: '4px 12px',
              fontSize: 12,
              background: filter === s ? 'var(--red, #ff2800)' : 'transparent',
              color: filter === s ? '#fff' : 'var(--ink)',
              borderColor: filter === s ? 'var(--red, #ff2800)' : 'rgba(0,0,0,.15)',
            }}
          >
            {s === 'all' ? `All (${items.length})` : s === 'in_progress' ? `Running (${counts.in_progress})` : `${s.charAt(0).toUpperCase()}${s.slice(1)} (${counts[s as keyof typeof counts] ?? 0})`}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      {showEnqueue && canEdit && (
        <form onSubmit={(e) => { void handleEnqueue(e) }} style={formBox}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <label style={fieldLabel}>
              Phone (E.164 or local)
              <input
                style={inp}
                required
                value={enqForm.phone}
                onChange={(e) => setEnqForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+15551234567"
              />
            </label>
            <label style={fieldLabel}>
              Mode
              <select style={inp} value={enqForm.mode} onChange={(e) => setEnqForm((f) => ({ ...f, mode: e.target.value as DialerMode }))}>
                <option value="concierge">Concierge</option>
                <option value="appointment_setter">Appointment Setter</option>
                <option value="pipeline">Pipeline</option>
                <option value="live_transfer">Live Transfer</option>
              </select>
            </label>
            <button type="submit" disabled={enqueueing} style={{ ...btnPrimary, marginBottom: 1 }}>
              {enqueueing ? 'Queuing…' : 'Enqueue'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ padding: 16, opacity: 0.7, fontSize: 13 }}>Loading…</div>
      ) : displayed.length === 0 ? (
        <div style={{ padding: 16, opacity: 0.7, fontSize: 13 }}>
          {filter === 'all' ? 'Queue is empty.' : `No ${filter} items.`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f7f4ef' }}>
                <th style={th}>When</th>
                <th style={th}>Mode</th>
                <th style={th}>Phone</th>
                <th style={th}>Status</th>
                <th style={th}>Tries</th>
                <th style={th}>Outcome</th>
                <th style={th}>Transfer</th>
                <th style={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    {new Date(item.created_at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </td>
                  <td style={td}>
                    <span style={{ background: MODE_COLORS[item.dialer_mode] ?? '#94a3b8', color: '#fff', padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                      {item.dialer_mode.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={td}>{item.phone ?? '—'}</td>
                  <td style={td}>
                    <span style={{ background: STATUS_COLORS[item.status] ?? '#94a3b8', color: '#fff', padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={td}>{item.attempt_count}/{item.max_attempts}</td>
                  <td style={td}>{item.last_outcome?.replace(/_/g, ' ') ?? '—'}</td>
                  <td style={td}>{item.live_transfer_status?.replace(/_/g, ' ') ?? '—'}</td>
                  <td style={td}>{item.source_kind}</td>
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
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  opacity: 0.7,
}
const td: React.CSSProperties = { padding: '10px 12px' }
