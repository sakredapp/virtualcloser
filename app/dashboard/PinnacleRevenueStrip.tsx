'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { WindowSummary } from '@/lib/pinnacle/rollup'

/* ------------------------------------------------------------------ */
/* Window math — UTC, snap-free. 7d/30d here resolve to the SAME       */
/* [start, end] the Pinnacle dashboard uses for its day-grain presets, */
/* so the two surfaces show the same premium for the same window.      */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
function todayUTC(): number {
  const n = new Date()
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
}
function toISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}
function fmtDay(t: number, withYear: boolean): string {
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  })
}

type StripPreset = { key: string; label: string }
const PRESETS: StripPreset[] = [
  { key: 'mtd', label: 'This month' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
]

function resolveWindow(key: string): { startT: number; endT: number } {
  const today = todayUTC()
  if (key === 'mtd') {
    const d = new Date(today)
    return { startT: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), endT: today }
  }
  const span = key === '7d' ? 7 : 30
  return { startT: today - (span - 1) * DAY, endT: today }
}

function rangeLabel(startT: number, endT: number): string {
  const sameYear = new Date(startT).getUTCFullYear() === new Date(endT).getUTCFullYear()
  return `${fmtDay(startT, !sameYear)} – ${fmtDay(endT, true)}`
}

function money(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/**
 * Compact, selectable Pinnacle revenue strip for the Command Center. Fetches a
 * windowed summary on each timeframe change; the date range it covers is
 * printed inline so the number is always read against its own window.
 */
export default function PinnacleRevenueStrip() {
  const [presetKey, setPresetKey] = useState('30d')
  const [summary, setSummary] = useState<WindowSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const win = useMemo(() => resolveWindow(presetKey), [presetKey])
  const start = toISO(win.startT)
  const end = toISO(win.endT)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ start, end })
    fetch(`/api/pinnacle/summary?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!cancelled) setSummary((json.summary ?? null) as WindowSummary | null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [start, end])

  const placement = summary && summary.total > 0 ? summary.paid / summary.total : null

  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--border-soft)',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ fontSize: 14 }}>Pinnacle revenue</strong>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{rangeLabel(win.startT, win.endT)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              gap: 3,
              background: 'var(--paper-2, #f1efe9)',
              border: '1px solid var(--border-soft)',
              borderRadius: 9,
              padding: 3,
            }}
          >
            {PRESETS.map((p) => {
              const active = p.key === presetKey
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPresetKey(p.key)}
                  style={{
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--text-inv, #fff)' : 'var(--text)',
                    background: active ? 'var(--ink)' : 'transparent',
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          <Link href="/dashboard/pinnacle" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Open dashboard →
          </Link>
        </div>
      </div>

      {error ? (
        <p style={{ fontSize: 12, color: 'var(--red-deep, #c21a00)', margin: '12px 0 0' }}>Couldn’t load revenue: {error}</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.8rem',
            marginTop: 12,
            opacity: loading ? 0.5 : 1,
            transition: 'opacity 120ms',
          }}
        >
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{money(summary?.premium ?? 0)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>Premium in window</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: 'var(--signal-ok, #16a34a)' }}>
              {money(summary?.funded ?? 0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>Funded (Issue-Paid)</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: 'var(--signal-info, #2563eb)' }}>
              {placement != null ? `${(placement * 100).toFixed(0)}%` : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>Placement</div>
          </div>
        </div>
      )}
    </div>
  )
}
