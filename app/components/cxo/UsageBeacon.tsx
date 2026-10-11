'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

function send(payload: Record<string, unknown>, delay = 1500): number {
  const body = JSON.stringify(payload)
  return window.setTimeout(() => {
    try {
      if (navigator.sendBeacon?.('/api/me/activity', new Blob([body], { type: 'application/json' }))) return
    } catch {
      /* fall through */
    }
    void fetch('/api/me/activity', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }, delay)
}

/** True the first time it is asked per key per day (per browser). */
function firstToday(key: string): boolean {
  const k = `cxo-usage:${new Date().toDateString()}:${key}`
  try {
    if (window.localStorage.getItem(k)) return false
    window.localStorage.setItem(k, '1')
  } catch {
    /* storage blocked: the server still keeps one row per page per day */
  }
  return true
}

/**
 * Counts which pages a member opens: one beacon per page per day, sent
 * after the page is up (sendBeacon never blocks navigation). Also marks a
 * new browser session (once per tab) and a meeting note opened (once per
 * note per day). Counts only: the note id never leaves the browser.
 */
function Beacon() {
  const path = usePathname()
  const note = useSearchParams()?.get('note') ?? null

  useEffect(() => {
    if (!path || !path.startsWith('/dashboard')) return
    let session = false
    try {
      if (!window.sessionStorage.getItem('cxo-usage:session')) {
        window.sessionStorage.setItem('cxo-usage:session', '1')
        session = true
      }
    } catch {
      /* storage blocked: sessions are not counted for this browser */
    }
    const page = firstToday(path)
    if (!page && !session) return
    const t = send(session ? { path, session: true } : { path })
    return () => window.clearTimeout(t)
  }, [path])

  useEffect(() => {
    if (!note || path !== '/dashboard/meetings') return
    if (!firstToday(`note:${note}`)) return
    const t = send({ path, note: true }, 2500)
    return () => window.clearTimeout(t)
  }, [path, note])

  return null
}

export default function UsageBeacon() {
  return (
    <Suspense fallback={null}>
      <Beacon />
    </Suspense>
  )
}
