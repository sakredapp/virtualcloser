'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import s from './calendar.module.css'
import { placePopover } from './placePopover'
import type { GridEvent } from './WeekTimeGrid'

/**
 * The event popover shared by the Day, Week and Month views: measures
 * itself, sits beside the event, flips left near the right edge, and is a
 * bottom sheet on phones. Buttons wrap inside the card.
 */
export default function EventPopover({ ev, rect, mobile, tz, onClose }: { ev: GridEvent; rect: DOMRect; mobile: boolean; tz: string; onClose: () => void }) {
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
