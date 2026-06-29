import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/app/components/PageHeader'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { getTokensFor, googleOauthConfigured, listUpcomingEvents, listConnectedGoogleAccounts } from '@/lib/google'
import DashboardNav from '../DashboardNav'
import AccountSwitcher from '../inbox/AccountSwitcher'
import { buildDashboardTabs } from '../dashboardTabs'

/**
 * Calendar tab — read-only Google Calendar view that mirrors the
 * day/week/month switches in the rep's actual GCal. The Telegram bot can
 * already create events via createCalendarEvent — this page is the visual
 * counterpart so reps see what the bot booked without bouncing to GCal.
 *
 * Source of truth: Google Calendar primary calendar via OAuth tokens. We
 * intentionally don't mirror the data into our own DB — this page just
 * fetches a window and renders.
 */
export const dynamic = 'force-dynamic'

type ViewMode = 'day' | 'week' | 'month'

type EventRow = {
  id: string
  summary: string
  startIso: string
  endIso: string
  allDay: boolean
  htmlLink: string
}

const MS_DAY = 86_400_000

function toLocalParts(iso: string, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number } {
  // Use Intl to extract local parts in the rep's timezone, since the page
  // renders timezone-aware (a 9am ET event should show under 9am even when
  // the server is UTC).
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(iso))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const hh = get('hour')
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    // Some locales return "24" for midnight; normalize.
    hh: hh === 24 ? 0 : hh,
    mm: get('minute'),
  }
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function fmtTime(hh: number, mm: number): string {
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  const ap = hh >= 12 ? 'pm' : 'am'
  return mm === 0 ? `${h12}${ap}` : `${h12}:${String(mm).padStart(2, '0')}${ap}`
}

// Wall-clock → UTC: the instant of local 00:00 on calendar date (y, m[1-12], d)
// in `tz`. Build the date as if it were UTC, read back the tz offset that
// applies at that instant, then subtract it. Single-pass and exact at
// midnight (the ~1h DST overlap never lands on 00:00). Unlike a drift
// approximation, this stays correct even when the as-UTC guess localizes into
// a neighbouring day/month — which is precisely what startOfMonth/next-month
// arithmetic does in any behind-UTC timezone.
function dayInTz(y: number, m: number, d: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d)
  const l = toLocalParts(new Date(wall).toISOString(), tz)
  const offsetMs = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - wall
  return new Date(wall - offsetMs)
}

function startOfDayInTz(date: Date, tz: string): Date {
  const local = toLocalParts(date.toISOString(), tz)
  return dayInTz(local.y, local.m, local.d, tz)
}

function startOfWeek(d: Date, tz: string): Date {
  const local = toLocalParts(d.toISOString(), tz)
  const dow = new Date(Date.UTC(local.y, local.m - 1, local.d)).getUTCDay()
  return new Date(startOfDayInTz(d, tz).getTime() - dow * MS_DAY)
}

function startOfMonth(d: Date, tz: string): Date {
  const local = toLocalParts(d.toISOString(), tz)
  return dayInTz(local.y, local.m, 1, tz)
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_DAY)
}

function parseDateParam(q: string | undefined, tz: string): Date {
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    // Treat as midnight local in tz.
    const [y, m, d] = q.split('-').map(Number)
    return dayInTz(y, m, d, tz)
  }
  return startOfDayInTz(new Date(), tz)
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; date?: string; account?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const sp = (await searchParams) ?? {}
  const view: ViewMode =
    sp.view === 'day' || sp.view === 'month' ? sp.view : 'week'
  const tz = member.timezone ?? 'America/New_York'
  const anchor = parseDateParam(sp.date, tz)

  // Account switcher: which connected Google calendar to show. 'shared' = the
  // workspace/owner account (member_id null); a member uuid = their own. Default
  // to the viewer's own account, else the shared one.
  const accounts = await listConnectedGoogleAccounts(tenant.id)
  const ownKey = accounts.some((a) => a.memberId === member.id) ? member.id : 'shared'
  const accountKey = sp.account || ownKey
  const selectedMemberId = accountKey === 'shared' ? null : accountKey
  const accountQs = sp.account ? `&account=${encodeURIComponent(sp.account)}` : ''
  const calAccountOptions = accounts.map((a) => ({
    key: a.isShared ? 'shared' : (a.memberId as string),
    label: a.label,
  }))

  // Compute the visible window based on view.
  let windowStart: Date
  let windowEnd: Date
  if (view === 'day') {
    windowStart = startOfDayInTz(anchor, tz)
    windowEnd = addDays(windowStart, 1)
  } else if (view === 'week') {
    windowStart = startOfWeek(anchor, tz)
    windowEnd = addDays(windowStart, 7)
  } else {
    const mStart = startOfMonth(anchor, tz)
    // Pad to full weeks (Sun .. Sat) so the grid is rectangular.
    const gridStart = startOfWeek(mStart, tz)
    const localStart = toLocalParts(mStart.toISOString(), tz)
    // First of the following month (dayInTz normalizes month 13 → next Jan).
    const nextMonth = dayInTz(localStart.y, localStart.m + 1, 1, tz)
    const cells = Math.ceil(
      (nextMonth.getTime() - gridStart.getTime()) / MS_DAY / 7,
    )
    windowStart = gridStart
    windowEnd = addDays(gridStart, cells * 7)
  }

  // Pull events. Cache-buster: revalidate=0.
  // Prefer the member's per-member tokens; fall back to tenant-level for
  // legacy individual-tier accounts.
  const tokens = await getTokensFor(tenant.id, selectedMemberId)
  const oauthConfigured = googleOauthConfigured()
  let events: EventRow[] = []
  let eventsError: string | null = null
  if (tokens && oauthConfigured) {
    try {
      const list = await listUpcomingEvents(tenant.id, {
        fromIso: windowStart.toISOString(),
        toIso: windowEnd.toISOString(),
        maxResults: 250,
        timeZone: tz,
        memberId: selectedMemberId,
      })
      events = (list ?? []).map((e) => {
        const allDay = e.start.length === 10 // YYYY-MM-DD form for all-day events
        return {
          id: e.id,
          summary: e.summary,
          startIso: e.start,
          endIso: e.end,
          allDay,
          htmlLink: e.htmlLink,
        }
      })
    } catch (err) {
      eventsError = err instanceof Error ? err.message : 'failed to load events'
    }
  }

  // Index events by local date string so the grid renders cheap.
  const byDay = new Map<string, EventRow[]>()
  for (const e of events) {
    const isoForBucket = e.allDay ? `${e.startIso}T00:00:00Z` : e.startIso
    const local = toLocalParts(isoForBucket, tz)
    const key = ymd(local.y, local.m, local.d)
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }

  // Date label + nav links.
  const anchorLocal = toLocalParts(anchor.toISOString(), tz)
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  }).format(anchor)
  const dayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  }).format(anchor)

  function shiftHref(deltaDays: number): string {
    const next = addDays(anchor, deltaDays)
    const nl = toLocalParts(next.toISOString(), tz)
    return `/dashboard/calendar?view=${view}&date=${ymd(nl.y, nl.m, nl.d)}${accountQs}`
  }
  function viewHref(v: ViewMode): string {
    return `/dashboard/calendar?view=${v}&date=${ymd(anchorLocal.y, anchorLocal.m, anchorLocal.d)}${accountQs}`
  }
  const todayHref = `/dashboard/calendar?view=${view}${accountQs}`

  const stride = view === 'day' ? 1 : view === 'week' ? 7 : 30 // approximate; month nav is recomputed below
  // For month nav, jump to the 1st of next/prev month rather than +30d.
  const monthPrev = (() => {
    const m = anchorLocal.m - 1
    const y = m < 1 ? anchorLocal.y - 1 : anchorLocal.y
    return `/dashboard/calendar?view=month&date=${ymd(y, m < 1 ? 12 : m, 1)}${accountQs}`
  })()
  const monthNext = (() => {
    const m = anchorLocal.m + 1
    const y = m > 12 ? anchorLocal.y + 1 : anchorLocal.y
    return `/dashboard/calendar?view=month&date=${ymd(y, m > 12 ? 1 : m, 1)}${accountQs}`
  })()

  return (
    <main className="wrap">
      <PageHeader
        eyebrow={`Schedule · ${tz}`}
        title="Calendar"
        subtitle="Live view of your connected Google Calendar. Anything the bot books shows up here within seconds."
      />

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {calAccountOptions.length > 1 && (
        <div style={{ marginTop: '0.8rem' }}>
          <AccountSwitcher options={calAccountOptions} value={accountKey} label="Calendar" allowAll={false} />
        </div>
      )}

      {!tokens && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Connect Google Calendar</h2>
            <p>not connected</p>
          </div>
          <p className="meta" style={{ margin: '0 0 0.6rem' }}>
            Connect your calendar so this view + the Telegram bot can both
            read and create events.
          </p>
          <Link href="/dashboard/integrations" className="btn approve">
            Connect Google →
          </Link>
        </section>
      )}

      {tokens && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              flexWrap: 'wrap',
              marginBottom: '0.8rem',
            }}
          >
            <Link href={todayHref} className="btn">
              Today
            </Link>
            <div style={{ display: 'flex', gap: 4 }}>
              <Link
                href={view === 'month' ? monthPrev : shiftHref(-stride)}
                className="btn"
                aria-label="Previous"
                style={{ padding: '0.4rem 0.7rem' }}
              >
                ‹
              </Link>
              <Link
                href={view === 'month' ? monthNext : shiftHref(stride)}
                className="btn"
                aria-label="Next"
                style={{ padding: '0.4rem 0.7rem' }}
              >
                ›
              </Link>
            </div>
            <strong style={{ fontSize: '1.05rem', color: 'var(--ink)' }}>
              {view === 'day' ? dayLabel : monthLabel}
            </strong>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
                <Link
                  key={v}
                  href={viewHref(v)}
                  className="btn"
                  style={
                    view === v
                      ? {
                          background: 'var(--ink)',
                          color: '#fff',
                          borderColor: 'var(--ink)',
                          textTransform: 'capitalize',
                        }
                      : { textTransform: 'capitalize' }
                  }
                >
                  {v}
                </Link>
              ))}
            </div>
          </div>

          {eventsError && (
            <p className="meta" style={{ color: 'var(--danger-fg, #b00020)' }}>
              Couldn&rsquo;t load events: {eventsError}
            </p>
          )}

          {view === 'day' && (
            <DayGrid
              dateKey={ymd(anchorLocal.y, anchorLocal.m, anchorLocal.d)}
              events={byDay.get(ymd(anchorLocal.y, anchorLocal.m, anchorLocal.d)) ?? []}
              tz={tz}
            />
          )}

          {view === 'week' && (
            <WeekGrid windowStart={windowStart} byDay={byDay} tz={tz} />
          )}

          {view === 'month' && (
            <MonthGrid
              gridStart={windowStart}
              gridEnd={windowEnd}
              focusMonth={anchorLocal.m}
              byDay={byDay}
              tz={tz}
            />
          )}
        </section>
      )}
    </main>
  )
}

// ─── Day view ─────────────────────────────────────────────────────────

function DayGrid({
  dateKey,
  events,
  tz,
}: {
  dateKey: string
  events: EventRow[]
  tz: string
}) {
  const allDay = events.filter((e) => e.allDay)
  const timed = events
    .filter((e) => !e.allDay)
    .sort((a, b) => a.startIso.localeCompare(b.startIso))

  return (
    <div>
      {allDay.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border-soft)',
            borderRadius: 10,
            padding: '0.5rem 0.75rem',
            marginBottom: '0.7rem',
            background: 'var(--paper-alt)',
          }}
        >
          <p className="meta" style={{ margin: '0 0 0.3rem', fontWeight: 700, textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.12em' }}>
            All day
          </p>
          {allDay.map((e) => (
            <EventChip key={e.id} ev={e} tz={tz} />
          ))}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr',
          border: '1px solid var(--border-soft)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {Array.from({ length: 24 }).map((_, hour) => {
          const slotEvents = timed.filter((e) => {
            const local = toLocalParts(e.startIso, tz)
            return local.hh === hour && ymd(local.y, local.m, local.d) === dateKey
          })
          return (
            <DayHourRow key={hour} hour={hour} events={slotEvents} tz={tz} />
          )
        })}
      </div>
    </div>
  )
}

function DayHourRow({ hour, events, tz }: { hour: number; events: EventRow[]; tz: string }) {
  return (
    <>
      <div
        style={{
          padding: '0.4rem 0.5rem',
          borderTop: hour === 0 ? 'none' : '1px solid var(--border-soft)',
          borderRight: '1px solid var(--border-soft)',
          background: 'var(--paper-alt)',
          fontSize: '0.72rem',
          color: 'var(--muted)',
          textAlign: 'right',
          minHeight: 44,
        }}
      >
        {fmtTime(hour, 0)}
      </div>
      <div
        style={{
          padding: '0.3rem 0.5rem',
          borderTop: hour === 0 ? 'none' : '1px solid var(--border-soft)',
          minHeight: 44,
          background: 'var(--paper)',
        }}
      >
        {events.map((e) => (
          <EventChip key={e.id} ev={e} tz={tz} />
        ))}
      </div>
    </>
  )
}

// ─── Week view ────────────────────────────────────────────────────────

function WeekGrid({
  windowStart,
  byDay,
  tz,
}: {
  windowStart: Date
  byDay: Map<string, EventRow[]>
  tz: string
}) {
  const days = Array.from({ length: 7 }).map((_, i) => addDays(windowStart, i))
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 4,
      }}
    >
      {days.map((d) => {
        const local = toLocalParts(d.toISOString(), tz)
        const key = ymd(local.y, local.m, local.d)
        const dayEvents = (byDay.get(key) ?? []).slice().sort((a, b) =>
          a.allDay === b.allDay ? a.startIso.localeCompare(b.startIso) : a.allDay ? -1 : 1,
        )
        const isToday = key === ymdToday(tz)
        const dow = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d)
        return (
          <div
            key={key}
            style={{
              border: `1px solid ${isToday ? 'var(--red)' : 'var(--ink-soft)'}`,
              borderRadius: 10,
              padding: '0.5rem 0.55rem',
              background: 'var(--paper)',
              minHeight: 200,
              minWidth: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>
                {dow}
              </span>
              <span
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: isToday ? 'var(--red)' : 'var(--ink)',
                }}
              >
                {local.d}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {dayEvents.length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>—</span>
              )}
              {dayEvents.map((e) => (
                <EventChip key={e.id} ev={e} tz={tz} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Month view ───────────────────────────────────────────────────────

function MonthGrid({
  gridStart,
  gridEnd,
  focusMonth,
  byDay,
  tz,
}: {
  gridStart: Date
  gridEnd: Date
  focusMonth: number
  byDay: Map<string, EventRow[]>
  tz: string
}) {
  const days: Date[] = []
  for (let t = gridStart.getTime(); t < gridEnd.getTime(); t += MS_DAY) {
    days.push(new Date(t))
  }
  const todayKey = ymdToday(tz)
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
          marginBottom: 4,
        }}
      >
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--muted)',
              padding: '0.4rem 0.5rem',
            }}
          >
            {d}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
        }}
      >
        {days.map((d) => {
          const local = toLocalParts(d.toISOString(), tz)
          const key = ymd(local.y, local.m, local.d)
          const inMonth = local.m === focusMonth
          const isToday = key === todayKey
          const dayEvents = byDay.get(key) ?? []
          return (
            <div
              key={key}
              style={{
                border: `1px solid ${isToday ? 'var(--red)' : 'var(--ink-soft)'}`,
                borderRadius: 8,
                padding: '0.35rem 0.45rem',
                minHeight: 96,
                background: inMonth ? 'var(--paper)' : 'var(--paper-alt)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                opacity: inMonth ? 1 : 0.55,
              }}
            >
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: isToday ? 'var(--red)' : 'var(--ink)',
                  alignSelf: 'flex-end',
                }}
              >
                {local.d}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayEvents.slice(0, 3).map((e) => (
                  <a
                    key={e.id}
                    href={e.htmlLink || undefined}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: '0.7rem',
                      lineHeight: 1.25,
                      padding: '2px 5px',
                      borderRadius: 4,
                      background: 'var(--red)',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: 'none',
                    }}
                  >
                    {e.summary}
                  </a>
                ))}
                {dayEvents.length > 3 && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Shared bits ──────────────────────────────────────────────────────

function ymdToday(tz: string): string {
  const local = toLocalParts(new Date().toISOString(), tz)
  return ymd(local.y, local.m, local.d)
}

function EventChip({ ev, tz }: { ev: EventRow; tz: string }) {
  const start = ev.allDay ? null : toLocalParts(ev.startIso, tz)
  const label = start ? `${fmtTime(start.hh, start.mm)} · ${ev.summary}` : ev.summary
  return (
    <a
      href={ev.htmlLink || undefined}
      target="_blank"
      rel="noreferrer"
      title={ev.summary}
      style={{
        display: 'block',
        fontSize: '0.78rem',
        lineHeight: 1.3,
        padding: '3px 6px',
        borderRadius: 4,
        background: 'var(--red)',
        color: '#fff',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  )
}
