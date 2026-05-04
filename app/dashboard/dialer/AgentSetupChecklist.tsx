'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type CheckItem = {
  key: string
  label: string
  ok: boolean
  note: string
  fix_url?: string
}

type Mode = 'sdr' | 'receptionist' | 'trainer'

type Props = {
  mode: Mode
  collapsed?: boolean
}

const MODE_META: Record<Mode, { emoji: string; title: string; doneMsg: string }> = {
  sdr:         { emoji: '📞', title: 'AI SDR setup',         doneMsg: 'Your AI SDR is fully configured and ready to dial.' },
  receptionist:{ emoji: '🤝', title: 'Receptionist setup',   doneMsg: 'Receptionist is live. Appointments will be auto-confirmed.' },
  trainer:     { emoji: '🎯', title: 'AI Trainer setup',     doneMsg: 'Trainer is ready. Start a roleplay session anytime.' },
}

export default function AgentSetupChecklist({ mode, collapsed = false }: Props) {
  const [checks, setChecks] = useState<CheckItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(!collapsed)

  useEffect(() => {
    fetch('/api/me/setup-readiness')
      .then((r) => r.json())
      .then((json: { ok: boolean; checks?: Record<Mode, CheckItem[]> }) => {
        if (json.ok && json.checks) setChecks(json.checks[mode])
      })
      .finally(() => setLoading(false))
  }, [mode])

  const meta = MODE_META[mode]
  const doneCount = checks?.filter((c) => c.ok).length ?? 0
  const total = checks?.length ?? 0
  const allDone = checks != null && doneCount === total
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const blockers = checks?.filter((c) => !c.ok) ?? []

  return (
    <div style={{
      background: 'var(--paper)', borderRadius: 12,
      border: `1px solid ${allDone ? '#bbf7d0' : 'var(--border-soft)'}`,
      boxShadow: 'var(--shadow-card)', overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>{meta.emoji}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{meta.title}</div>
            {!loading && (
              <div style={{ fontSize: 12, color: allDone ? '#166534' : 'var(--muted)', marginTop: 1 }}>
                {allDone ? meta.doneMsg : `${doneCount} / ${total} steps complete`}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Progress ring */}
          {!loading && !allDone && (
            <div style={{ position: 'relative', width: 36, height: 36 }}>
              <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: 36, height: 36 }}>
                <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15" fill="none"
                  stroke={pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="3"
                  strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
                  strokeLinecap="round"
                />
              </svg>
              <span style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 9, fontWeight: 700, color: 'var(--ink)',
              }}>
                {pct}%
              </span>
            </div>
          )}
          {!loading && allDone && (
            <span style={{
              background: '#dcfce7', color: '#166534', padding: '3px 10px',
              borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>
              Ready ✓
            </span>
          )}
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Progress bar */}
      {!loading && !allDone && (
        <div style={{ height: 3, background: '#e5e7eb', margin: '0 18px' }}>
          <div style={{
            height: '100%', borderRadius: 2,
            background: pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444',
            width: `${pct}%`, transition: 'width 0.4s',
          }} />
        </div>
      )}

      {/* Body */}
      {open && (
        <div style={{ padding: '14px 18px 18px' }}>
          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Checking setup…</p>
          ) : allDone ? (
            <div style={{
              padding: '12px 16px', borderRadius: 8,
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              fontSize: 13, color: '#166534', fontWeight: 600,
            }}>
              ✅ {meta.doneMsg}
            </div>
          ) : (
            <div>
              {/* Blockers up top */}
              {blockers.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#c21a00', margin: '0 0 8px' }}>
                    Action needed ({blockers.length} remaining)
                  </p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {blockers.map((c) => (
                      <CheckRow key={c.key} item={c} />
                    ))}
                  </div>
                </div>
              )}

              {/* Completed items */}
              {doneCount > 0 && (
                <details>
                  <summary style={{
                    fontSize: 12, color: 'var(--muted)', cursor: 'pointer',
                    userSelect: 'none', marginBottom: 6,
                  }}>
                    {doneCount} completed step{doneCount !== 1 ? 's' : ''} ▸
                  </summary>
                  <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                    {checks!.filter((c) => c.ok).map((c) => (
                      <CheckRow key={c.key} item={c} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
      borderRadius: 8,
      background: item.ok ? '#f0fdf4' : '#fff7ed',
      border: `1px solid ${item.ok ? '#bbf7d0' : '#fed7aa'}`,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>
        {item.ok ? '✅' : '⚠️'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{item.label}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{item.note}</div>
      </div>
      {!item.ok && item.fix_url && (
        <Link
          href={item.fix_url}
          style={{
            flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '3px 10px',
            borderRadius: 5, border: '1px solid #fed7aa',
            background: '#fff', color: '#92400e', textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Fix →
        </Link>
      )}
    </div>
  )
}
