'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import s from './calendar.module.css'
import { placePopover } from './placePopover'

/**
 * Week view as a real time grid (Google Calendar style): hour axis, one
 * column per day, events as blocks sized by duration, overlaps side by side,
 * all-day strip under the header, a now-line on today. All times arrive
 * already converted to the member's timezone (minutes from local midnight),
 * so nothing here depends on the browser's or the server's clock zone except
 * the now-line, which reads the member's zone through Intl.
 */

export type GridAttendee = { label: string; status?: string }
export type GridEvent = {
  id: string
  title: string
  calendar: string
  /** Token-based CSS colour of the event's calendar chip. */
  color: string
  /** Minutes from local midnight on this day, clipped to the day. */
  startMin: number
  endMin: number
  /** "10 – 11:30am" (the event's own range, not the clipped one). */
  timeLabel: string
  /** "Thu, Oct 9 · 10 – 11:30am" for the popover. */
  whenLabel: string
  htmlLink: string
  /** Meetings page link when a meeting note exists for this event. */
  notesHref?: string
  /** 2+ = several notes at the same time; the link lists them all. */
  notesCount?: number
  /** First lines of the matched note's summary (one confident match only). */
  notesSummary?: string
  location?: string
  conferenceLink?: string
  attendees: GridAttendee[]
}
export type GridDay = {
  key: string
  dow: string
  dayNum: number
  /** "Thu, Oct 9" for the mobile range line. */
  label: string
  isToday: boolean
  timed: GridEvent[]
  allDay: GridEvent[]
}

const HOUR_PX = 52
const PX_PER_MIN = HOUR_PX / 60
const MIN_BLOCK_PX = 20
const MOBILE_COLS = 3

type Placed = { ev: GridEvent; left: number; width: number; z: number }

/** Events that start within this many minutes of each other sit side by
 *  side; an event that starts later than that is drawn inset on top of the
 *  longer one it overlaps (Google's look), so a long block keeps its width. */
const SIDE_BY_SIDE_MIN = 30
const INDENT = 0.14

function layoutDay(events: GridEvent[]): Placed[] {
  const minDur = MIN_BLOCK_PX / PX_PER_MIN
  const items = events
    .map((ev) => ({ ev, start: ev.startMin, end: Math.max(ev.endMin, ev.startMin + minDur) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  type Item = (typeof items)[number]
  type Group = { start: number; end: number; items: Item[]; level: number }
  const groups: Group[] = []
  for (const it of items) {
    const g = groups.find((x) => it.start - x.start < SIDE_BY_SIDE_MIN && it.start < x.end)
    if (g) {
      g.items.push(it)
      g.end = Math.max(g.end, it.end)
    } else groups.push({ start: it.start, end: it.end, items: [it], level: 0 })
  }
  const out: Placed[] = []
  groups.forEach((g, gi) => {
    // Nest one level deeper than the deepest earlier group still running.
    let level = 0
    for (let j = 0; j < gi; j++) {
      const o = groups[j]
      if (o.start < g.end && g.start < o.end) level = Math.max(level, o.level + 1)
    }
    g.level = level
    // Pack the group's events into columns (two that don't overlap share one).
    const colEnds: number[] = []
    const cols = g.items.map((it) => {
      let c = colEnds.findIndex((end) => end <= it.start)
      if (c === -1) {
        c = colEnds.length
        colEnds.push(it.end)
      } else colEnds[c] = it.end
      return c
    })
    const n = colEnds.length
    const base = Math.min(level * INDENT, 0.6)
    const avail = 1 - base
    g.items.forEach((it, k) => {
      // Stretch right over group columns that are free for this event's span.
      let span = 1
      while (cols[k] + span < n) {
        const next = cols[k] + span
        if (g.items.some((o, m) => cols[m] === next && o.start < it.end && it.start < o.end)) break
        span++
      }
      out.push({ ev: it.ev, left: base + (cols[k] / n) * avail, width: (span / n) * avail, z: 1 + level * 10 + cols[k] })
    })
  })
  return out
}

function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`
}

function nowMinutesIn(tz: string): { key: string; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  const hh = Number(g('hour')) % 24
  return { key: `${g('year')}-${g('month')}-${g('day')}`, min: hh * 60 + Number(g('minute')) }
}

export default function WeekTimeGrid({
  days,
  tz,
  startHour,
  endHour,
  prevWeekHref,
  nextWeekHref,
}: {
  days: GridDay[]
  tz: string
  startHour: number
  endHour: number
  prevWeekHref: string
  nextWeekHref: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(false)
  const todayIdx = days.findIndex((d) => d.isToday)
  const [offset, setOffset] = useState(() => Math.max(0, Math.min(days.length - MOBILE_COLS, todayIdx === -1 ? 0 : todayIdx)))
  const [now, setNow] = useState<{ key: string; min: number } | null>(null)
  const [open, setOpen] = useState<{ ev: GridEvent; rect: DOMRect } | null>(null)
  const touchX = useRef<number | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 699px)')
    const on = () => setIsMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const tick = () => setNow(nowMinutesIn(tz))
    tick()
    const t = window.setInterval(tick, 60_000)
    return () => window.clearInterval(t)
  }, [tz])

  // Open scrolled to ~8 AM, or earlier when the first event is earlier.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const firsts = days.flatMap((d) => d.timed.map((e) => e.startMin))
    const target = Math.min(8 * 60, firsts.length ? Math.min(...firsts) : 8 * 60)
    el.scrollTop = Math.max(0, (target - startHour * 60) * PX_PER_MIN - 8)
  }, [days, startHour])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const placed = useMemo(() => days.map((d) => layoutDay(d.timed)), [days])
  const shown = isMobile
    ? days.map((d, i) => ({ d, i })).slice(offset, offset + MOBILE_COLS)
    : days.map((d, i) => ({ d, i }))
  const cols = shown.length
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const totalPx = (endHour - startHour) * HOUR_PX
  const hasAllDay = shown.some(({ d }) => d.allDay.length > 0)
  const maxOffset = Math.max(0, days.length - MOBILE_COLS)

  const shift = (delta: number) => setOffset((o) => Math.max(0, Math.min(maxOffset, o + delta)))

  const openEvent = (ev: GridEvent, target: HTMLElement) => setOpen({ ev, rect: target.getBoundingClientRect() })

  return (
    <div
      className={s.grid}
      style={{ ['--cols' as string]: cols }}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null }}
      onTouchEnd={(e) => {
        if (!isMobile || touchX.current == null) return
        const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 50) shift(dx < 0 ? MOBILE_COLS : -MOBILE_COLS)
      }}
    >
      {isMobile && (
        <div className={s.mobileNav}>
          {offset > 0 ? (
            <button type="button" className={`${s.btn} ${s.square}`} aria-label="Earlier days" onClick={() => shift(-MOBILE_COLS)}>‹</button>
          ) : (
            <Link href={prevWeekHref} className={`${s.btn} ${s.square}`} aria-label="Previous week">‹</Link>
          )}
          <span>{shown[0]?.d.label} – {shown[shown.length - 1]?.d.label}</span>
          {offset < maxOffset ? (
            <button type="button" className={`${s.btn} ${s.square}`} aria-label="Later days" onClick={() => shift(MOBILE_COLS)}>›</button>
          ) : (
            <Link href={nextWeekHref} className={`${s.btn} ${s.square}`} aria-label="Next week">›</Link>
          )}
        </div>
      )}

      <div className={`${s.row} ${s.head}`}>
        <div className={s.tz} />
        {shown.map(({ d }) => (
          <div key={d.key} className={s.headCell}>
            <span className={`${s.dow}${d.isToday ? ` ${s.dowToday}` : ''}`}>{d.dow}</span>
            <span className={`${s.date}${d.isToday ? ` ${s.dateToday}` : ''}`} aria-current={d.isToday ? 'date' : undefined}>{d.dayNum}</span>
          </div>
        ))}
      </div>

      {hasAllDay && (
        <div className={`${s.row} ${s.allday}`}>
          <div className={s.alldayLabel}>All day</div>
          {shown.map(({ d }) => (
            <div key={d.key} className={s.alldayCell}>
              {d.allDay.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className={s.allEv}
                  style={{ ['--c' as string]: ev.color }}
                  title={`${ev.title} · ${ev.calendar}`}
                  onClick={(e) => openEvent(ev, e.currentTarget)}
                >
                  {ev.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={s.body} ref={bodyRef}>
        <div className={s.row} style={{ height: totalPx }}>
          <div className={s.axis}>
            {hours.map((h, i) => (i === 0 ? null : (
              <span key={h} className={s.hourLabel} style={{ top: i * HOUR_PX }}>{hourLabel(h)}</span>
            )))}
          </div>
          {shown.map(({ d, i: dayIdx }) => (
            <div key={d.key} className={`${s.col}${d.isToday ? ` ${s.colToday}` : ''}`}>
              {hours.map((h, i) => (
                <span key={h}>
                  {i > 0 && <span className={s.hourLine} style={{ top: i * HOUR_PX }} />}
                  <span className={s.halfLine} style={{ top: i * HOUR_PX + HOUR_PX / 2 }} />
                </span>
              ))}
              {placed[dayIdx].map(({ ev, left, width, z }) => {
                const top = (ev.startMin - startHour * 60) * PX_PER_MIN
                const height = Math.max((ev.endMin - ev.startMin) * PX_PER_MIN, MIN_BLOCK_PX) - 1
                const inline = height < 34
                const titleLines = Math.max(1, Math.floor((height - 6 - 13) / 14))
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className={s.ev}
                    style={{
                      ['--c' as string]: ev.color,
                      top,
                      height,
                      left: `calc(${left * 100}% + 1px)`,
                      width: `calc(${width * 100}% - 3px)`,
                      zIndex: z,
                    }}
                    title={`${ev.title}\n${ev.timeLabel} · ${ev.calendar}`}
                    onClick={(e) => openEvent(ev, e.currentTarget)}
                  >
                    {inline ? (
                      <span className={s.evInline}>
                        <span className={s.evTitle}>{ev.title}</span>
                        <span className={s.evTime}>{ev.timeLabel}</span>
                      </span>
                    ) : (
                      <>
                        <span className={s.evTitle} style={{ WebkitLineClamp: titleLines }}>{ev.title}</span>
                        <span className={s.evTime}>{ev.timeLabel}</span>
                      </>
                    )}
                  </button>
                )
              })}
              {now && d.key === now.key && now.min >= startHour * 60 && now.min <= endHour * 60 && (
                <span className={s.now} style={{ top: (now.min - startHour * 60) * PX_PER_MIN }} aria-label="Now" />
              )}
            </div>
          ))}
        </div>
      </div>

      {open && <EventPopover ev={open.ev} rect={open.rect} mobile={isMobile} tz={tz} onClose={() => setOpen(null)} />}
    </div>
  )
}

function EventPopover({ ev, rect, mobile, tz, onClose }: { ev: GridEvent; rect: DOMRect; mobile: boolean; tz: string; onClose: () => void }) {
  const W = 340
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // Measure the rendered popover, then place it so it never crosses an edge.
  useLayoutEffect(() => {
    if (mobile) return
    const el = popRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth
    setPos(placePopover(rect, { width: box.width || W, height: box.height }, { width: vw, height: window.innerHeight }))
  }, [rect, mobile, ev])
  const style: React.CSSProperties = {}
  if (mobile) {
    style.left = 16
    style.right = 16
    style.bottom = 16
    style.width = 'auto'
  } else if (pos) {
    style.left = pos.left
    style.top = pos.top
  } else {
    // First paint, before measuring: off-screen-safe guess, hidden.
    style.left = 16
    style.top = 16
    style.visibility = 'hidden'
  }
  const shownAttendees = ev.attendees.slice(0, 10)
  return (
    <>
      <div className={s.scrim} onClick={onClose} />
      <div ref={popRef} className={s.pop} style={{ ...style, ['--c' as string]: ev.color }} role="dialog" aria-label={ev.title} data-testid="event-popover">
        <div className={s.popHead}>
          <span className={s.popSwatch} />
          <h3 className={s.popTitle}>{ev.title}</h3>
          <button type="button" className={s.popClose} aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className={s.popMeta}>{ev.whenLabel}</p>
        <p className={s.popMeta} style={{ marginTop: 0 }}>{ev.calendar} · {tz.replace(/_/g, ' ')}</p>
        {(ev.location || ev.conferenceLink) && (
          <div className={s.popRow}>
            <span className={s.popLabel}>Where</span>
            {ev.location && (/^https?:\/\//.test(ev.location) ? <a href={ev.location} target="_blank" rel="noreferrer">{ev.location}</a> : ev.location)}
            {ev.conferenceLink && ev.conferenceLink !== ev.location && (
              <>
                {ev.location && <br />}
                <a href={ev.conferenceLink} target="_blank" rel="noreferrer">{meetLabel(ev.conferenceLink)}</a>
              </>
            )}
          </div>
        )}
        {shownAttendees.length > 0 && (
          <div className={s.popRow}>
            <span className={s.popLabel}>{ev.attendees.length} {ev.attendees.length === 1 ? 'guest' : 'guests'}</span>
            <ul className={s.popList}>
              {shownAttendees.map((a, i) => (
                <li key={i}>
                  {a.label}
                  {a.status === 'declined' ? ' · declined' : a.status === 'tentative' ? ' · maybe' : a.status === 'needsAction' ? ' · no reply' : ''}
                </li>
              ))}
              {ev.attendees.length > shownAttendees.length && <li>+{ev.attendees.length - shownAttendees.length} more</li>}
            </ul>
          </div>
        )}
        {ev.notesSummary && (
          <div className={s.popRow} data-testid="mira-notes">
            <span className={s.popLabel}>Mira took notes</span>
            <p className={s.popNotes}>{ev.notesSummary}</p>
          </div>
        )}
        <div className={s.popActions}>
          {ev.notesHref && (
            <Link href={ev.notesHref} className={s.btn} data-testid="open-notes">{(ev.notesCount ?? 1) > 1 ? `Open notes (${ev.notesCount})` : 'Open notes'}</Link>
          )}
          {ev.conferenceLink && (
            <a href={ev.conferenceLink} target="_blank" rel="noreferrer" className={`${s.btn} ${s.btnAccent}`}>Join meeting</a>
          )}
          {ev.htmlLink && (
            <a href={ev.htmlLink} target="_blank" rel="noreferrer" className={s.btn}>Open in Google Calendar</a>
          )}
        </div>
      </div>
    </>
  )
}

/** "Google Meet" / "Zoom" / "Teams" for a conference URL, else its host. */
function meetLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host === 'meet.google.com') return `Google Meet · ${url.replace(/^https?:\/\/meet\.google\.com\//, '')}`
    if (host.endsWith('zoom.us')) return 'Zoom meeting'
    if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return 'Microsoft Teams'
    return host
  } catch {
    return url
  }
}
