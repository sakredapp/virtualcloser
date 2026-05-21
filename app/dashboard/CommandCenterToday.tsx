import Link from 'next/link'
import type { MonthSummary } from '@/lib/pinnacle/rollup'

type AgendaEvent = { summary: string; start: string; conferenceLink?: string }

function money(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

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
  monthSummary,
  events,
  timezone,
}: {
  monthSummary: MonthSummary | null
  events: AgendaEvent[] | null
  timezone?: string
}) {
  // Run-rate projection for the current month from MTD pace.
  let projected = 0
  let pacePct: number | null = null
  let placement: number | null = null
  if (monthSummary) {
    const now = new Date()
    const dayOfMonth = now.getDate()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    projected = dayOfMonth > 0 ? (monthSummary.this_month_premium / dayOfMonth) * daysInMonth : 0
    if (monthSummary.prev_month_premium > 0) {
      pacePct = projected / monthSummary.prev_month_premium - 1
    }
    if (monthSummary.this_month_total > 0) {
      placement = monthSummary.this_month_paid / monthSummary.this_month_total
    }
  }

  if (!monthSummary && (!events || events.length === 0)) return null

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
      {/* Pinnacle revenue strip */}
      {monthSummary && (
        <Link
          href="/dashboard/pinnacle"
          style={{
            display: 'block',
            textDecoration: 'none',
            color: 'inherit',
            background: 'var(--paper)',
            border: '1px solid var(--border-soft)',
            borderRadius: 12,
            padding: '1rem 1.1rem',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 14 }}>Pinnacle revenue · this month</strong>
            <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Open dashboard →</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.8rem',
              marginTop: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{money(monthSummary.this_month_premium)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>MTD premium</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: 'var(--signal-info, #2563eb)' }}>
                {money(projected)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>
                Projected
                {pacePct != null && (
                  <span style={{ color: pacePct >= 0 ? 'var(--signal-ok, #16a34a)' : 'var(--red-deep, #c21a00)' }}>
                    {' '}
                    {pacePct >= 0 ? '+' : ''}
                    {(pacePct * 100).toFixed(0)}% vs last mo
                  </span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: 'var(--signal-ok, #16a34a)' }}>
                {placement != null ? `${(placement * 100).toFixed(0)}%` : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 600 }}>Placement</div>
            </div>
          </div>
        </Link>
      )}

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
