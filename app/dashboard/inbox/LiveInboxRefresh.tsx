'use client'

// Live-refresh client wrapper for the Email Triage inbox.
//
// Opens an EventSource to /api/inbox/stream which server-side holds a
// Supabase Realtime subscription on email_threads + email_drafts filtered
// to the viewer's rep_id. Each push triggers router.refresh() so the
// server-rendered list re-renders with the new data. We debounce so a
// burst of inserts (initial seed, bulk supersedes) only triggers one
// refresh.
//
// EventSource auto-reconnects when the server closes the connection
// (Vercel's 5-min function limit), so the live feel survives function
// boundaries — we just see a sub-second gap every five minutes.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LiveInboxRefresh() {
  const router = useRouter()
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRefreshRef = useRef<number>(0)

  useEffect(() => {
    let es: EventSource | null = null
    let aborted = false

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        // Floor at one refresh per 1.5s so a burst doesn't pummel the server.
        const sinceLast = Date.now() - lastRefreshRef.current
        if (sinceLast < 1500) {
          debounceRef.current = setTimeout(() => {
            lastRefreshRef.current = Date.now()
            router.refresh()
          }, 1500 - sinceLast)
          return
        }
        lastRefreshRef.current = Date.now()
        router.refresh()
      }, 250)
    }

    const connect = () => {
      if (aborted) return
      es = new EventSource('/api/inbox/stream')
      es.onopen = () => setStatus('live')
      es.onerror = () => {
        setStatus('reconnecting')
        // EventSource's built-in retry will reopen; we just surface status.
      }
      es.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(ev.data) as { type: string }
          if (data.type === 'thread' || data.type === 'draft') {
            scheduleRefresh()
          }
        } catch {
          // ignore malformed
        }
      })
    }

    connect()

    return () => {
      aborted = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (es) es.close()
    }
  }, [router])

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '999px',
        background:
          status === 'live'
            ? 'rgba(16, 185, 129, 0.12)'
            : status === 'reconnecting'
              ? 'rgba(234, 179, 8, 0.12)'
              : 'rgba(100, 116, 139, 0.12)',
        color:
          status === 'live'
            ? '#047857'
            : status === 'reconnecting'
              ? '#7a5500'
              : '#475569',
        fontSize: '0.75rem',
        fontWeight: 600,
      }}
      title={
        status === 'live'
          ? 'Connected — new emails appear instantly'
          : status === 'reconnecting'
            ? 'Reconnecting to the live stream…'
            : 'Connecting…'
      }
    >
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background:
            status === 'live'
              ? '#10b981'
              : status === 'reconnecting'
                ? '#eab308'
                : '#94a3b8',
        }}
      />
      {status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
    </div>
  )
}
