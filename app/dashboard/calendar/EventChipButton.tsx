'use client'

import { useEffect, useState } from 'react'
import EventPopover from './EventPopover'
import type { GridEvent } from './WeekTimeGrid'

/**
 * An event chip for the Day and Month views. Clicking it opens the same
 * popover as the Week view (Open notes, Join meeting, Open in Google Calendar).
 */
export default function EventChipButton({
  ev,
  label,
  tz,
  size = 'day',
}: {
  ev: GridEvent
  /** Chip text, e.g. "10am · Board prep". */
  label: string
  tz: string
  size?: 'day' | 'month'
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 699px)')
    const on = () => setMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!rect) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRect(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rect])

  const small = size === 'month'
  return (
    <>
      <button
        type="button"
        data-testid="event-chip"
        title={`${ev.title} · ${ev.calendar}`}
        onClick={(e) => setRect(e.currentTarget.getBoundingClientRect())}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          font: 'inherit',
          fontSize: small ? '0.7rem' : '0.78rem',
          lineHeight: small ? 1.25 : 1.3,
          padding: small ? '2px 5px 2px 7px' : '3px 6px 3px 8px',
          border: 0,
          borderRadius: 4,
          borderLeft: `3px solid ${ev.color}`,
          background: 'var(--paper-alt)',
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
      {rect && <EventPopover ev={ev} rect={rect} mobile={mobile} tz={tz} onClose={() => setRect(null)} />}
    </>
  )
}
