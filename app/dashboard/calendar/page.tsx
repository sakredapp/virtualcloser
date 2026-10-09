import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createHash } from 'node:crypto'
import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import {
  googleOauthConfigured,
  listCalendars,
  listConnectedGoogleAccounts,
  listUpcomingEvents,
  type ConnectedAccount,
  type GoogleCalendarInfo,
} from '@/lib/google'

/**
 * Calendar — every connected Google account (and every calendar inside
 * each) merged into one day/week/month view. Each calendar gets a chip in
 * the header that toggles it on/off; "Add another calendar" is always there.
 *
 * Source of truth: Google Calendar via OAuth tokens. We intentionally don't
 * mirror the data into our own DB — this page fetches a window and renders.
 * No calendar connected → the page IS the connect state.
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
  /** Which calendar the event came from (colour + name for the chip). */
  color: string
  calendar: string
}

/** One calendar inside one connected account. */
type CalSource = {
  key: string
  account: ConnectedAccount
  calendar: GoogleCalendarInfo
  color: string
  label: string
}

// Fixed categorical order: charcoal and its tints. Red stays reserved for
// "today". Identity is never colour-alone — every chip carries its name.
const CAL_COLORS = ['#1C1B1A', '#7A7673', '#B9B3AB', '#4A4745', '#9C968F', '#D6D0C7', '#2F2D2B', '#8C8782']

function calKey(accountId: string, calendarId: string): string {
  return createHash('sha1').update(`${accountId}|${calendarId}`).digest('hex').slice(0, 8)
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
  searchParams?: Promise<{ view?: string; date?: string; hide?: string; gcal?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()

  const sp = (await searchParams) ?? {}
  const view: ViewMode =
    sp.view === 'day' || sp.view === 'month' ? sp.view : 'week'
  const tz = member.timezone ?? 'America/New_York'
  const anchor = parseDateParam(sp.date, tz)
  const hidden = new Set((sp.hide ?? '').split(',').filter(Boolean))
  const notice = sp.gcal ?? null

  // Every Google account this person can see: the workspace (owner) account
  // plus each account they connected themselves. Several per person is fine.
  const allAccounts = await listConnectedGoogleAccounts(tenant.id)
  const accounts = allAccounts.filter((a) => a.isShared || a.memberId === member.id)
  const oauthConfigured = googleOauthConfigured()

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

  // Every calendar inside every account, in a fixed colour order.
  const sources: CalSource[] = []
  if (oauthConfigured && accounts.length > 0) {
    const lists = await Promise.all(
      accounts.map((a) => listCalendars(tenant.id, { memberId: a.memberId, accountId: a.accountId }).catch(() => null)),
    )
    accounts.forEach((a, i) => {
      for (const c of lists[i] ?? []) {
        if (sources.length >= 12) break
        const owner = a.email ?? a.label
        sources.push({
          key: calKey(a.accountId, c.id),
          account: a,
          calendar: c,
          color: CAL_COLORS[sources.length % CAL_COLORS.length],
          label: c.primary ? owner : `${c.summary} · ${owner}`,
        })
      }
    })
  }

  // Pull events for every visible calendar in parallel.
  let events: EventRow[] = []
  let eventsError: string | null = null
  const visible = sources.filter((s) => !hidden.has(s.key))
  const results = await Promise.all(
    visible.map(async (src) => {
      try {
        const list = await listUpcomingEvents(tenant.id, {
          fromIso: windowStart.toISOString(),
          toIso: windowEnd.toISOString(),
          maxResults: 250,
          timeZone: tz,
          memberId: src.account.memberId,
          accountId: src.account.accountId,
          calendarId: src.calendar.id,
        })
        return (list ?? []).map<EventRow>((e) => ({
          id: `${src.key}:${e.id}`,
          summary: e.summary,
          startIso: e.start,
          endIso: e.end,
          allDay: e.start.length === 10, // YYYY-MM-DD form for all-day events
          htmlLink: e.htmlLink,
          color: src.color,
          calendar: src.label,
        }))
      } catch (err) {
        eventsError = err instanceof Error ? err.message : 'failed to load events'
        return []
      }
    }),
  )
  events = results.flat()

  // Index events by local date string so the grid renders cheap. The same
  // event invited to two calendars shows once.
  const byDay = new Map<string, EventRow[]>()
  const seen = new Set<string>()
  for (const e of events) {
    const dedupe = `${e.startIso}|${e.endIso}|${e.summary}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
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
  const weekLabel = (() => {
    const a = toLocalParts(windowStart.toISOString(), tz)
    const b = toLocalParts(addDays(windowStart, 6).toISOString(), tz)
    const f = (y: number, m: number, d: number, withYear: boolean) =>
      new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
    return `${f(a.y, a.m, a.d, false)} – ${f(b.y, b.m, b.d, true)}`
  })()

  const hideQs = hidden.size > 0 ? `&hide=${Array.from(hidden).join(',')}` : ''
  function shiftHref(deltaDays: number): string {
    const next = addDays(anchor, deltaDays)
    const nl = toLocalParts(next.toISOString(), tz)
    return `/dashboard/calendar?view=${view}&date=${ymd(nl.y, nl.m, nl.d)}${hideQs}`
  }
  function viewHref(v: ViewMode): string {
    return `/dashboard/calendar?view=${v}&date=${ymd(anchorLocal.y, anchorLocal.m, anchorLocal.d)}${hideQs}`
  }
  function toggleHref(key: string): string {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    const qs = next.size > 0 ? `&hide=${Array.from(next).join(',')}` : ''
    return `/dashboard/calendar?view=${view}&date=${ymd(anchorLocal.y, anchorLocal.m, anchorLocal.d)}${qs}`
  }
  const todayHref = `/dashboard/calendar?view=${view}${hideQs}`

  const stride = view === 'day' ? 1 : view === 'week' ? 7 : 30 // approximate; month nav is recomputed below
  // For month nav, jump to the 1st of next/prev month rather than +30d.
  const monthPrev = (() => {
    const m = anchorLocal.m - 1
    const y = m < 1 ? anchorLocal.y - 1 : anchorLocal.y
    return `/dashboard/calendar?view=month&date=${ymd(y, m < 1 ? 12 : m, 1)}${hideQs}`
  })()
  const monthNext = (() => {
    const m = anchorLocal.m + 1
    const y = m > 12 ? anchorLocal.y + 1 : anchorLocal.y
    return `/dashboard/calendar?view=month&date=${ymd(y, m > 12 ? 1 : m, 1)}${hideQs}`
  })()

  const connectHref = '/api/google/oauth/start?return=%2Fdashboard%2Fcalendar'
  const addHref = '/api/google/oauth/start?add=1&return=%2Fdashboard%2Fcalendar'
  const connected = accounts.length > 0

  return (
    <main className="wrap">
      <PageHeader
        eyebrow={`Calendar · ${tz}`}
        title={connected ? (view === 'day' ? dayLabel : view === 'week' ? weekLabel : monthLabel) : 'Calendar'}
        subtitle={connected ? 'Today and this week across every calendar you connected.' : undefined}
        actions={
          connected ? (
            <span className="cx-cal-accounts" id="accounts">
              {accounts.map((a) => (
                <details key={a.accountId} className="cx-menu">
                  <summary className="cx-chip" title={a.email ?? a.label}>
                    <i style={{ background: sources.find((s) => s.account.accountId === a.accountId)?.color ?? '#1C1B1A' }} />
                    connected as {a.email ?? a.label}
                  </summary>
                  <div className="cx-menu-body">
                    <form action="/api/google/disconnect" method="POST">
                      <input type="hidden" name="account" value={a.accountId} />
                      <input type="hidden" name="return" value="/dashboard/calendar" />
                      <button type="submit" className="cx-link">Disconnect this calendar</button>
                    </form>
                  </div>
                </details>
              ))}
              <a href={addHref} className="cx-btn cx-btn-sm cx-btn-red-text"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M8 3v10M3 8h10" /></svg> Add another calendar</a>
            </span>
          ) : undefined
        }
      />

      {notice === 'limit' && (
        <p className="cx-notice">Only one Google account per person can be connected right now. Disconnect the current one to switch.</p>
      )}
      {notice === 'error' && <p className="cx-notice">Google did not finish connecting. Try again.</p>}

      {!connected && (
        <div id="accounts">
        <ConnectState
          kind="calendar"
          sentence="Connect your calendar and today and this week sit right here, with Mira learning from every meeting."
          button="Connect Google Calendar"
          href={connectHref}
          external
        />
        </div>
      )}

      {connected && (
        <section className="cx-panel" style={{ marginTop: '0.8rem' }}>
          {/* Toolbar */}
          <div className="cx-cal-toolbar">
            <Link href={todayHref} className="cx-btn cx-btn-ghost">Today</Link>
            <div style={{ display: 'flex', gap: 4 }}>
              <Link href={view === 'month' ? monthPrev : shiftHref(-stride)} className="cx-btn cx-btn-ghost" aria-label="Previous" style={{ padding: '8px 12px' }}>‹</Link>
              <Link href={view === 'month' ? monthNext : shiftHref(stride)} className="cx-btn cx-btn-ghost" aria-label="Next" style={{ padding: '8px 12px' }}>›</Link>
            </div>
            <div className="cx-seg" role="tablist" aria-label="View" style={{ marginLeft: 'auto' }}>
              {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
                <Link key={v} href={viewHref(v)} role="tab" aria-selected={view === v} style={{ textTransform: 'capitalize' }}>
                  {v}
                </Link>
              ))}
            </div>
          </div>

          {/* One chip per calendar; click to hide/show it. */}
          <div className="cx-cal-chips" aria-label="Calendars">
            {sources.map((s) => (
              <Link key={s.key} href={toggleHref(s.key)} className={`cx-chip${hidden.has(s.key) ? ' is-off' : ''}`} aria-pressed={!hidden.has(s.key)} title={hidden.has(s.key) ? 'Show' : 'Hide'}>
                <i style={{ background: s.color }} />
                {s.label}
              </Link>
            ))}
          </div>

          {eventsError && (
            <p className="cx-notice">Couldn&rsquo;t load some events: {eventsError}</p>
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
                    title={`${e.summary} · ${e.calendar}`}
                    style={{
                      fontSize: '0.7rem',
                      lineHeight: 1.25,
                      padding: '2px 5px 2px 7px',
                      borderRadius: 4,
                      borderLeft: `3px solid ${e.color}`,
                      background: 'var(--paper-alt)',
                      color: 'var(--ink)',
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
      title={`${ev.summary} · ${ev.calendar}`}
      style={{
        display: 'block',
        fontSize: '0.78rem',
        lineHeight: 1.3,
        padding: '3px 6px 3px 8px',
        borderRadius: 4,
        borderLeft: `3px solid ${ev.color}`,
        background: 'var(--paper-alt)',
        color: 'var(--ink)',
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
