'use client'

import { useEffect } from 'react'

/**
 * Sends the browser's IANA timezone to /api/me/timezone once per page load
 * (gated by sessionStorage to avoid a POST on every refresh). The server
 * only writes the value if the member has no timezone set yet (or has the
 * legacy 'UTC' default), so an explicit /timezone command from Telegram
 * is never overwritten.
 */
export default function TimezoneSync() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem('vc_tz_synced') === '1') return
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!tz) return
      fetch('/api/me/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      })
        .then(() => sessionStorage.setItem('vc_tz_synced', '1'))
        .catch(() => {})
    } catch {
      // sessionStorage / Intl unavailable — ignore.
    }
  }, [])
  return null
}
