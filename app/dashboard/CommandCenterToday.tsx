import Link from 'next/link'
import PinnacleRevenueStrip from './PinnacleRevenueStrip'

type AgendaEvent = { summary: string; start: string; conferenceLink?: string }

function eventTime(iso: string, tz?: string): string {
  if (iso.length === 10) return 'All day'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    })
  } catch {
    return ''
  }
}

/**
 * "Today" block for the Command Center — the first thing Spencer should see:
 * a compact Pinnacle revenue strip (only when summary is provided / he's
 * gated in) plus today's calendar agenda.
 */
export default function CommandCenterToday({
  showPinnacle,
  events,
  timezone,
}: {
  showPinnacle: boolean
  events: AgendaEvent[] | null
  timezone?: string
}) {
  if (!showPinnacle && (!events || events.length === 0)) return null

  return (
    <section
      style={{
        margin: '1rem 0 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8rem',
      }}
      className="cc-today"
    >
      {/* Pinnacle revenue strip — selectable timeframe, reconciles with the
          Pinnacle dashboard KPI for the same window. */}
      {showPinnacle && <PinnacleRevenueStrip />}

      {/* Today's agenda */}
      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--border-soft)',
          borderRadius: 12,
          padding: '1rem 1.1rem',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 14 }}>Today&apos;s agenda</strong>
          <Link href="/dashboard/calendar" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
            Calendar →
          </Link>
        </div>
        {!events || events.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>
            {events === null ? 'Connect Google Calendar to see your day.' : 'Nothing on the calendar today.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.slice(0, 6).map((e, i) => (
              <li key={`${e.start}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', minWidth: 64, whiteSpace: 'nowrap' }}>
                  {eventTime(e.start, timezone)}
                </span>
                <span style={{ fontSize: 13, flex: 1 }}>{e.summary || '(untitled)'}</span>
                {e.conferenceLink && (
                  <a href={e.conferenceLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    Join
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
