'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { syncStampLabel } from '@/lib/pinnacle/syncStamp'

/**
 * "Last synced today 9:00am" stamp + Refresh button for the executive pages.
 * `computedAt` is the page's one timestamp (lib/pinnacle/syncStamp syncedAtOf).
 * Refresh re-runs the Airtable sync and rebuilds the cached rollup
 * (POST /api/pinnacle/refresh), then reloads the page for the new stamp.
 * The timeframe and breakdown filters never touch this; they work on the
 * cached payload client side.
 */
export default function RefreshRollup({ computedAt, building = false }: { computedAt: string | null; building?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [stamp, setStamp] = useState<string>(() => (computedAt ? 'Last synced' : building ? 'Building today’s numbers, about a minute.' : ''))

  useEffect(() => {
    if (!computedAt) return
    setStamp(syncStampLabel(computedAt))
  }, [computedAt])

  useEffect(() => {
    if (!building) return
    const t = setTimeout(() => router.refresh(), 20_000)
    return () => clearTimeout(t)
  }, [building, router])

  async function refresh() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/pinnacle/refresh', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string; syncError?: string | null }
      if (!res.ok) {
        setMsg(body.error || 'Refresh did not finish. The numbers shown are the last good ones.')
      } else {
        if (body.syncError) setMsg(`Numbers rebuilt, but the Airtable sync reported: ${body.syncError}`)
        router.refresh()
      }
    } catch {
      setMsg('Refresh did not finish. The numbers shown are the last good ones.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="cx-refresh">
      <span className="cx-refresh-stamp" title={computedAt ?? undefined}>
        {busy ? 'Refreshing, this can take a minute' : stamp}
      </span>
      <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" onClick={refresh} disabled={busy} aria-busy={busy}>
        {busy ? <span className="cx-spin" aria-hidden /> : <RefreshIcon />}
        Refresh
      </button>
      {msg && <span className="cx-refresh-msg" role="status">{msg}</span>}
    </span>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}
