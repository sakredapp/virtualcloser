'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Unread teammate messages on the Today rail item. Polls once a minute; when
 * the count goes up and the exec turned on alerts (Today › Messages), the
 * browser shows a notification while Suite CXO is open.
 */
export default function MessagesBadge() {
  const [n, setN] = useState(0)
  const last = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    const check = async () => {
      if (document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && Notification.permission !== 'granted') return
      const r = await fetch('/api/messages?count=1', { cache: 'no-store' }).catch(() => null)
      if (!alive || !r?.ok) return
      const j = (await r.json().catch(() => ({}))) as { unread?: number; latest?: { from: string; body: string } | null }
      const count = Math.max(0, Number(j.unread) || 0)
      if (last.current !== null && count > last.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(j.latest ? `Message from ${j.latest.from}` : 'New message', { body: j.latest?.body?.slice(0, 140) ?? 'Open Today to read it.', tag: 'cxo-messages' })
          n.onclick = () => {
            window.focus()
            window.location.href = '/dashboard'
          }
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
        window.dispatchEvent(new Event('cxo:messages'))
      }
      last.current = count
      setN(count)
    }
    void check()
    const t = setInterval(check, 60_000)
    const onRead = () => void check()
    window.addEventListener('cxo:messages-read', onRead)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('cxo:messages-read', onRead)
    }
  }, [])

  if (n <= 0) return null
  return (
    <span className="dash-side-badge cx-rail-badge" aria-label={`${n} unread ${n === 1 ? 'message' : 'messages'}`}>
      {n > 9 ? '9+' : n}
    </span>
  )
}
