'use client'

/**
 * Pick a call time on the "Book a call" thank-you card. Day chips, then the
 * open times that day, then Confirm (Apollo's booking page; HoneyBook's time
 * pills). The form posts the chosen start to the page's server action, which
 * books it on the owner's calendar (lib/cxoBooking.ts).
 */
import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

export type PickerSlot = { start: string; dayKey: string; dayLabel: string; timeLabel: string }

function Confirm({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="cx-login-submit" disabled={disabled || pending}>
      {pending ? 'Booking…' : 'Confirm this time'}
    </button>
  )
}

export default function SlotPicker({ slots, leadId, action }: { slots: PickerSlot[]; leadId: string; action: (fd: FormData) => Promise<void> }) {
  const days = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of slots) if (!seen.has(s.dayKey)) seen.set(s.dayKey, s.dayLabel)
    return [...seen.entries()].map(([key, label]) => ({ key, label }))
  }, [slots])
  const [day, setDay] = useState(days[0]?.key ?? '')
  const [start, setStart] = useState('')
  const times = slots.filter((s) => s.dayKey === day)

  return (
    <form action={action} className="cx-slots">
      <input type="hidden" name="lead" value={leadId} />
      <input type="hidden" name="start" value={start} />
      <p className="cx-slots-label">Pick a day (Eastern time, 30 minutes)</p>
      <div className="cx-slot-days" role="group" aria-label="Day">
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            className="cx-slot-day"
            aria-pressed={d.key === day}
            onClick={() => {
              setDay(d.key)
              setStart('')
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="cx-slot-times" role="group" aria-label="Time">
        {times.map((s) => (
          <button key={s.start} type="button" className="cx-slot-time" aria-pressed={s.start === start} onClick={() => setStart(s.start)}>
            {s.timeLabel}
          </button>
        ))}
      </div>
      <Confirm disabled={!start} />
    </form>
  )
}
