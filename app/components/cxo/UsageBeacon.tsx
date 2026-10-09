'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Counts which pages a member opens: one beacon per page per day, sent
 * after the page is up (sendBeacon never blocks navigation).
 */
export default function UsageBeacon() {
  const path = usePathname()
  useEffect(() => {
    if (!path || !path.startsWith('/dashboard')) return
    const key = `cxo-usage:${new Date().toDateString()}:${path}`
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, '1')
    } catch {
      /* storage blocked: the server still keeps one row per page per day */
    }
    const body = JSON.stringify({ path })
    const t = window.setTimeout(() => {
      try {
        if (navigator.sendBeacon?.('/api/me/activity', new Blob([body], { type: 'application/json' }))) return
      } catch {
        /* fall through */
      }
      void fetch('/api/me/activity', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }, 1500)
    return () => window.clearTimeout(t)
  }, [path])
  return null
}
