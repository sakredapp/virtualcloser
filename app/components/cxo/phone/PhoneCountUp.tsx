'use client'

/**
 * A figure that counts up to its value once, when the page first loads at
 * phone width. The value itself is whatever the server rendered ("1.2M",
 * "482K", "7"): only the number inside it moves, and it always ends on the
 * exact text it was given. Nothing is computed or invented here.
 *
 * No count-up when the person has asked for reduced motion, on a wider screen
 * (where the phone blocks are not shown), or when coming back to a page whose
 * figure has already counted up since the last full load.
 */
import { useEffect, useState } from 'react'

const PHONE = '(max-width: 640px)'
const DURATION_MS = 900
/** Figures that have already counted up since the page loaded. */
const played = new Set<string>()

export default function PhoneCountUp({ text }: { text: string }) {
  const [shown, setShown] = useState(text)

  useEffect(() => {
    setShown(text)
    const m = text.match(/\d[\d,]*(?:\.\d+)?/)
    if (!m || m.index === undefined || played.has(text)) return
    if (!window.matchMedia(PHONE).matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const target = Number(m[0].replace(/,/g, ''))
    if (!Number.isFinite(target) || target <= 0) return
    const decimals = (m[0].split('.')[1] ?? '').length
    const grouped = m[0].includes(',')
    const before = text.slice(0, m.index)
    const after = text.slice(m.index + m[0].length)
    const fmt = (n: number) => (grouped ? n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n.toFixed(decimals))

    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION_MS)
      if (p >= 1) {
        played.add(text)
        setShown(text)
        return
      }
      setShown(before + fmt(target * (1 - Math.pow(1 - p, 3))) + after)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text])

  return <>{shown}</>
}
