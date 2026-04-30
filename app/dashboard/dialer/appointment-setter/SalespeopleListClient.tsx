'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { MemberRole } from '@/types'

export type SalespersonCard = {
  id: string
  name: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  product_name: string | null
  ai_name: string | null
  dials_today: number
  appts_today: number
  leads_total: number
  pacing_cap_per_day: number | null
}

const STATUS_STYLES: Record<SalespersonCard['status'], { bg: string; fg: string; label: string }> = {
  draft:    { bg: '#e5e7eb', fg: '#374151', label: 'Draft' },
  active:   { bg: '#dcfce7', fg: '#15803d', label: 'Active' },
  paused:   { bg: '#fef3c7', fg: '#b45309', label: 'Paused' },
  archived: { bg: '#fee2e2', fg: '#991b1b', label: 'Archived' },
}

export default function SalespeopleListClient({
  initial,
  viewerRole,
}: {
  initial: SalespersonCard[]
  viewerRole?: MemberRole
}) {
  const isRep = viewerRole === 'rep'
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [, startTransition] = useTransition()

  async function setStatus(id: string, status: SalespersonCard['status']) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert((j as { error?: string })?.error ?? 'Failed to update status')
        return
      }
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)))
      startTransition(() => router.refresh())
    } finally {
      setBusyId(null)
    }
  }

  async function duplicate(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${id}/duplicate`, { method: 'POST' })
      if (!res.ok) {
        alert('Failed to duplicate')
        return
      }
      startTransition(() => router.refresh())
    } finally {
      setBusyId(null)
    }
  }

  async function archive(id: string) {
    if (!confirm('Archive this AI Salesperson? You can restore it later.')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        alert('Failed to archive')
        return
      }
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'archived' } : x)))
      startTransition(() => router.refresh())
    } finally {
      setBusyId(null)
    }
  }

  async function createNew() {
    setCreating(true)
    try {
      const name = prompt('Name for this AI Salesperson?', 'New Salesperson')
      if (!name) return
      const res = await fetch('/api/me/ai-salespeople', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const j = await res.json()
      if (!res.ok) {
        alert((j as { error?: string })?.error ?? 'Failed to create')
        return
      }
      const id = (j as { salesperson?: { id?: string } }).salesperson?.id
      if (id) router.push(`/dashboard/dialer/appointment-setter/${id}`)
      else startTransition(() => router.refresh())
    } finally {
      setCreating(false)
    }
  }

  const visible = items.filter((x) => x.status !== 'archived')
  const archived = items.filter((x) => x.status === 'archived')

  return (
    <section style={{ margin: '0 24px 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 12px' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Your AI Salespeople</h2>
        {!isRep && (
          <button
            onClick={createNew}
            disabled={creating}
            style={{
              background: 'var(--red, #ff2800)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              fontWeight: 700,
              cursor: creating ? 'wait' : 'pointer',
              fontSize: 14,
            }}
          >
            {creating ? 'Creating…' : '+ New AI Salesperson'}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div style={{
          background: '#fff',
          border: '1px dashed #d1d5db',
          borderRadius: 12,
          padding: '32px 20px',
          textAlign: 'center',
          color: '#6b7280',
        }}>
          <p style={{ margin: 0, fontWeight: 600, color: '#111' }}>No AI Salespeople yet</p>
          <p style={{ margin: '6px 0 14px', fontSize: 14 }}>
            {isRep
              ? 'No AI Salespeople are assigned to you yet. Ask your manager to set one up.'
              : 'Create your first one to start scripting calls, importing leads, and booking appointments automatically.'}
          </p>
          {!isRep && (
            <button
              onClick={createNew}
              disabled={creating}
              style={{
                background: 'var(--red, #ff2800)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Create AI Salesperson
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
        }}>
          {visible.map((sp) => {
            const sty = STATUS_STYLES[sp.status]
            const cap = sp.pacing_cap_per_day ?? 120
            const dialPct = Math.min(100, Math.round((sp.dials_today / Math.max(cap, 1)) * 100))
            return (
              <div key={sp.id} style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    <Link
                      href={`/dashboard/dialer/appointment-setter/${sp.id}`}
                      style={{ color: '#111', textDecoration: 'none', fontWeight: 700, fontSize: 16 }}
                    >
                      {sp.name}
                    </Link>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {sp.ai_name ? `${sp.ai_name} · ` : ''}{sp.product_name ?? 'No product set'}
                    </div>
                  </div>
                  <span style={{
                    background: sty.bg,
                    color: sty.fg,
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>{sty.label}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <Stat label="Dials today" value={`${sp.dials_today}/${cap}`} />
                  <Stat label="Appts today" value={String(sp.appts_today)} />
                  <Stat label="Leads" value={String(sp.leads_total)} />
                </div>

                <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${dialPct}%`, height: '100%', background: sp.status === 'active' ? '#22c55e' : '#cbd5e1' }} />
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <Link
                    href={`/dashboard/dialer/appointment-setter/${sp.id}`}
                    style={btn('primary')}
                  >
                    Open
                  </Link>
                  {!isRep && (sp.status === 'active' ? (
                    <button onClick={() => setStatus(sp.id, 'paused')} disabled={busyId === sp.id} style={btn('secondary')}>
                      Pause
                    </button>
                  ) : (
                    <button onClick={() => setStatus(sp.id, 'active')} disabled={busyId === sp.id} style={btn('secondary')}>
                      Activate
                    </button>
                  ))}
                  {!isRep && (
                    <button onClick={() => duplicate(sp.id)} disabled={busyId === sp.id} style={btn('ghost')}>
                      Duplicate
                    </button>
                  )}
                  {!isRep && (
                    <button onClick={() => archive(sp.id)} disabled={busyId === sp.id} style={btn('ghost')}>
                      Archive
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>
            Archived ({archived.length})
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 8 }}>
            {archived.map((sp) => (
              <div key={sp.id} style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ color: '#374151' }}>{sp.name}</span>
                <button onClick={() => setStatus(sp.id, 'draft')} disabled={busyId === sp.id} style={btn('ghost')}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #f1f5f9', borderRadius: 8, padding: '6px 8px' }}>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{value}</div>
    </div>
  )
}

function btn(kind: 'primary' | 'secondary' | 'ghost'): React.CSSProperties {
  if (kind === 'primary') {
    return {
      background: 'var(--red, #ff2800)',
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
      textDecoration: 'none',
      display: 'inline-block',
    }
  }
  if (kind === 'secondary') {
    return {
      background: '#fff',
      color: '#111',
      border: '1px solid #d1d5db',
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    }
  }
  return {
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid transparent',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  }
}
