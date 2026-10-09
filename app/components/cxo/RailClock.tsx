'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * THE TOP OF THE RAIL, ported from the VC product's left menu
 * (client/src/components/menu-clock.tsx + lib/speed-dial.ts, owner 2026-10-05):
 * the company name as the headline, the date under it in small mono capitals,
 * then the US time zones ET · CT · MT · PT · HI drifting sideways. Real clocks,
 * re-read every 15 seconds; a zone outside business hours (before 8 AM, 9 PM
 * and later, local) is dim. The set is drawn twice so the loop has no seam
 * (the copy is hidden from a screen reader); it stops under the pointer and
 * stands still, wrapped, for reduced motion.
 *
 * NO COLOUR OF ITS OWN: globals.css reads `--menu-clock-*`, which the CXO
 * rail points at its own tokens. Renders after mount (or pinned with `fixed`)
 * so the server and browser clocks never disagree during hydration.
 */

export const MENU_TIME_ZONES = [
  { label: 'ET', zone: 'America/New_York' },
  { label: 'CT', zone: 'America/Chicago' },
  { label: 'MT', zone: 'America/Denver' },
  { label: 'PT', zone: 'America/Los_Angeles' },
  { label: 'HI', zone: 'Pacific/Honolulu' },
] as const

/** Business hours are 8:00 AM up to, not including, 9:00 PM local. */
export function menuZoneOffHours(hour: number): boolean {
  return hour < 8 || hour >= 21
}

export type MenuZoneTime = { label: string; time: string; off: boolean }

/** Each zone's clock at `now`: "3:07 PM", and whether it is outside business hours. */
export function menuZoneTimes(now: Date): MenuZoneTime[] {
  return MENU_TIME_ZONES.map(({ label, zone }) => {
    try {
      const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(now)
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now)) % 24
      return { label, time, off: menuZoneOffHours(hour) }
    } catch {
      return { label, time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), off: false }
    }
  })
}

/** The rail's date, "Thu, Oct 8", in Eastern time. */
export function menuDate(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

/** The clock, re-read on a timer; null until mounted. `fixed` pins it (demo). */
function useMenuNow(fixed: Date | undefined, everyMs: number): Date | null {
  const [now, setNow] = useState<Date | null>(fixed ?? null)
  useEffect(() => {
    if (fixed) return
    setNow(new Date())
    const t = window.setInterval(() => setNow(new Date()), everyMs)
    return () => window.clearInterval(t)
  }, [fixed, everyMs])
  return fixed ?? now
}

export function MenuDate({ now: fixed }: { now?: Date }) {
  const now = useMenuNow(fixed, 30_000)
  return <div className="menu-clock-date">{now ? menuDate(now) : ' '}</div>
}

/** ET · CT · MT · PT · HI, drifting. */
export function MenuZoneStrip({ now: fixed }: { now?: Date }) {
  const now = useMenuNow(fixed, 15_000)
  const zones: MenuZoneTime[] = now ? menuZoneTimes(now) : MENU_TIME_ZONES.map((z) => ({ label: z.label, time: '--:--', off: false }))
  const set = (copy: boolean) => (
    <span className="menu-clock-tz__set" aria-hidden={copy ? true : undefined}>
      {zones.map((z) => (
        <Fragment key={z.label}>
          <span data-off={z.off ? '' : undefined} data-zone={z.label}>
            {z.label} {z.time}
          </span>
          <i aria-hidden>·</i>
        </Fragment>
      ))}
    </span>
  )
  return (
    <div className="menu-clock-tz" role="group" aria-label="US time zones">
      <span className="menu-clock-tz__run">
        {set(false)}
        {set(true)}
      </span>
    </div>
  )
}

/** Date + zones under the name. `fixed` pins the time (demo). */
export default function RailClock({ fixed }: { timezone?: string | null; fixed?: Date }) {
  return (
    <div className="menu-clock">
      <MenuDate now={fixed} />
      <MenuZoneStrip now={fixed} />
    </div>
  )
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * The company name on ONE line at the rail's width: 20px Lora, shrunk in half
 * steps down to 16px for longer names, then an ellipsis (full name in title).
 */
export function RailName({ name, max = 20, min = 16 }: { name: string; max?: number; min?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let size = max
      el.style.fontSize = `${size}px`
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) {
        size -= 0.5
        el.style.fontSize = `${size}px`
      }
    }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    document.fonts?.ready.then(fit).catch(() => {})
    return () => ro?.disconnect()
  }, [name, max, min])
  return (
    <span ref={ref} className="dash-rail-client-name" title={name}>
      {name}
    </span>
  )
}
