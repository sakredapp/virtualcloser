'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Lightweight auto-refresh: every `intervalMs` (default 20s), and again
 * whenever the tab regains focus, ask Next to re-fetch the server component
 * tree. No flicker, no client-side state needed.
 */
export default function DashboardAutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const tick = () => router.refresh()
    const id = window.setInterval(tick, intervalMs)
    const onFocus = () => router.refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [router, intervalMs])
  return null
}
