'use client'

import { useEffect, useState } from 'react'

/**
 * "Thursday, October 8 · 9:14am CT" — today's date and the time in the
 * tenant's time zone, ticking once a minute. Same source as the per-page
 * timezone eyebrow (member timezone, else tenant, else Eastern). The IANA
 * name sits in the tooltip so a wrong zone is one hover away from obvious.
 */
export function railClockLabel(now: Date, tz: string): string {
  try {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(now)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const ampm = get('dayPeriod').toLowerCase()
    const zone = get('timeZoneName').replace(/^([A-Z])[SD]T$/, '$1T')
    return `${date} · ${get('hour')}:${get('minute')}${ampm} ${zone}`
  } catch {
    return now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
}

export default function RailClock({ timezone, fixed }: { timezone?: string | null; fixed?: Date }) {
  const tz = timezone || 'America/New_York'
  const [now, setNow] = useState<Date | null>(fixed ?? null)
  useEffect(() => {
    if (fixed) return
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [fixed])
  return (
    <div className="dash-rail-clock" title={tz} suppressHydrationWarning>
      {now ? railClockLabel(now, tz) : ' '}
    </div>
  )
}
