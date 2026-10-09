import { headers } from 'next/headers'
import { after } from 'next/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createHash } from 'node:crypto'
import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import WeekTimeGrid, { type GridDay } from './WeekTimeGrid'
import s from './calendar.module.css'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import {
  googleOauthConfigured,
  listCalendars,
  listConnectedGoogleAccounts,
  listUpcomingEvents,
  type ConnectedAccount,
  type GoogleCalendarInfo,
} from '@/lib/google'
import { listFeeds, refreshFeed, isStale, maskIcsUrl, type IcsFeed } from '@/lib/icsFeeds'
import { IcsAddForm, IcsRemoveButton } from './IcsCalendarMenu'
import { ownsGoogleAccount } from '@/lib/googleAccountOwner'
import { supabase } from '@/lib/supabase'
import { noteForEvent, noteHref, type MatchableNote } from '@/lib/meetings/noteMatch'

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
  /** The provider's own event id (Google), for matching meeting notes. */
  eventId?: string
  /** Meetings page link when a meeting note belongs to this event. */
  notesHref?: string
  /** Which calendar the event came from (colour + name for the chip). */
  color: string
  calendar: string
  location?: string
  conferenceLink?: string
  attendees: Array<{ email: string; displayName?: string; responseStatus?: string }>
}

/** One calendar inside one connected account. */
type CalSource = {
  key: string
  account: ConnectedAccount
  calendar: GoogleCalendarInfo
  color: string
  label: string
}

// Fixed categorical order: ink and its tints, all from theme tokens so a
// re-theme carries through. The accent stays reserved for "today".
// Identity is never colour-alone — every chip carries its name.
const inkTint = (pct: number) => `color-mix(in srgb, var(--ink) ${pct}%, var(--surface, var(--paper)))`
const CAL_COLORS = ['var(--ink)', inkTint(58), inkTint(34), inkTint(80), inkTint(46), inkTint(24), inkTint(90), inkTint(68)]

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
  // Calendar arithmetic, not -N×24h, so a DST change inside the week
  // doesn't land the week start at 1am or 11pm.
  return dayInTz(local.y, local.m, local.d - dow, tz)
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

/** Holidays, birthdays, contacts and other subscribed group calendars:
 *  hidden by default, one click on the chip shows them. */
function isNoiseCalendar(c: { id: string; summary: string; primary: boolean }): boolean {
  if (c.primary) return false
  if (/group\.v\.calendar\.google\.com$/i.test(c.id)) return true
  return /holiday|birthdays|#contacts|#holiday/i.test(`${c.id} ${c.summary}`)
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
  // `hide` absent = defaults (subscribed holiday/birthday/contact calendars
  // off). Present, even empty, = the person's own choice from the chips.
  const hideExplicit = sp.hide !== undefined
  const hidden = new Set((sp.hide ?? '').split(',').filter(Boolean))
  const notice = sp.gcal ?? null

  // Every Google account this person can see: the workspace (owner) account
  // plus each account they connected themselves. Several per person is fine.
  const allAccounts = await listConnectedGoogleAccounts(tenant.id)
  const accounts = allAccounts.filter((a) => a.isShared || a.memberId === member.id)
  const oauthConfigured = googleOauthConfigured()

  // Apple / iCloud or any .ics link the member added. Served from the cache;
  // a never-read link is read now, a stale one refreshes after the response.
  let feeds: IcsFeed[] = await listFeeds(tenant.id, member.id).catch(() => [] as IcsFeed[])
  const unread = feeds.filter((f) => !f.fetched_at)
  if (unread.length) {
    await Promise.all(unread.map((f) => refreshFeed(f)))
    feeds = await listFeeds(tenant.id, member.id).catch(() => feeds)
  }
  const stale = feeds.filter((f) => f.fetched_at && isStale(f))
  if (stale.length) after(() => Promise.all(stale.map((f) => refreshFeed(f))).then(() => undefined))

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
    const single = accounts.length === 1
    const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || null
    accounts.forEach((a, i) => {
      // Subscribed/read-only extras (holidays, birthdays, contacts) go last so
      // the 12-chip cap never pushes a real calendar out.
      const cals = [...(lists[i] ?? [])].sort((x, y) => Number(isNoiseCalendar(x)) - Number(isNoiseCalendar(y)))
      for (const c of cals) {
        if (sources.length >= 12) break
        const owner = a.email ?? a.label
        const ownerName = (a.isShared ? firstName(member.display_name) : firstName(a.label)) ?? owner
        const key = calKey(a.accountId, c.id)
        if (!hideExplicit && isNoiseCalendar(c)) hidden.add(key)
        sources.push({
          key,
          account: a,
          calendar: c,
          color: CAL_COLORS[sources.length % CAL_COLORS.length],
          // One account: the chips need no email ("Spencer (primary)",
          // "Weekly Trainings"). Several: say whose calendar each chip is.
          label: single
            ? c.primary ? `${ownerName} (primary)` : c.summary
            : c.primary ? owner : `${c.summary} · ${owner}`,
        })
      }
    })
  }

  // Each .ics link gets its own chip and the next tint in the order.
  const icsSources = feeds.map((f, i) => ({
    key: calKey('ics', f.id),
    feed: f,
    color: CAL_COLORS[(sources.length + i) % CAL_COLORS.length],
    label: f.label,
  }))

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
          eventId: e.id,
          summary: e.summary,
          startIso: e.start,
          endIso: e.end,
          allDay: e.start.length === 10, // YYYY-MM-DD form for all-day events
          htmlLink: e.htmlLink,
          color: src.color,
          calendar: src.label,
          location: e.location,
          conferenceLink: e.conferenceLink,
          attendees: e.attendees ?? [],
        }))
      } catch (err) {
        eventsError = err instanceof Error ? err.message : 'failed to load events'
        return []
      }
    }),
  )
  events = results.flat()
  const winFrom = windowStart.toISOString()
  const winTo = windowEnd.toISOString()
  for (const src of icsSources) {
    if (hidden.has(src.key)) continue
    for (const e of src.feed.events) {
      // All-day ends are exclusive dates; timed ones are UTC instants.
      const startCmp = e.allDay ? `${e.start}T00:00:00.000Z` : e.start
      const endCmp = e.allDay ? `${e.end}T00:00:00.000Z` : e.end
      if (endCmp <= winFrom && startCmp < winFrom) continue
      if (startCmp >= winTo) continue
      events.push({
        id: `${src.key}:${e.uid}:${e.start}`,
        summary: e.summary,
        startIso: e.start,
        endIso: e.end,
        allDay: e.allDay,
        htmlLink: '',
        color: src.color,
        calendar: src.label,
        location: e.location ?? undefined,
        attendees: [],
      })
    }
  }
  const feedErrors = feeds.filter((f) => f.last_error)

  // Meeting notes in this window (same set the Meetings page lists), so an
  // event with notes gets an "Open notes" link in its popup.
  const { data: noteRows } = await supabase
    .from('plaud_notes')
    .select('id, title, occurred_at, calendar_event_id')
    .eq('rep_id', tenant.id)
    .gte('occurred_at', addDays(windowStart, -1).toISOString())
    .lt('occurred_at', addDays(windowEnd, 1).toISOString())
    .order('occurred_at')
    .limit(500)
  const windowNotes = (noteRows ?? []) as MatchableNote[]
  if (windowNotes.length) {
    for (const e of events) {
      const note = noteForEvent({ eventId: e.eventId, startIso: e.startIso, endIso: e.endIso, title: e.summary, allDay: e.allDay }, windowNotes)
      if (note) e.notesHref = noteHref(note.id)
    }
  }
  const calendarCount = sources.length + icsSources.length

  // Index events by local date string so the grid renders cheap. The same
  // event invited to two calendars shows once.
  const byDay = new Map<string, EventRow[]>()
  const seen = new Set<string>()
  const dedupedEvents: EventRow[] = []
  for (const e of events) {
    const dedupe = `${e.startIso}|${e.endIso}|${e.summary}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    dedupedEvents.push(e)
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

  const hideQs = hideExplicit ? `&hide=${Array.from(hidden).join(',')}` : ''
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
    const qs = `&hide=${Array.from(next).join(',')}`
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
  const connected = accounts.length > 0 || feeds.length > 0

  return (
    <main className="wrap">
      <PageHeader
        eyebrow={connected ? `Calendar · ${tz}` : undefined}
        title={connected ? (view === 'day' ? dayLabel : view === 'week' ? weekLabel : monthLabel) : 'Calendar'}
        subtitle={connected ? 'Every calendar you connected, in one view.' : 'Connect a calendar to see your day and week here.'}
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
        <details className={`${s.menu} ${s.connectIcs}`}>
          <summary className={s.btn}>Use Apple / iCloud or a calendar link instead</summary>
          <div className={`${s.menuBody} ${s.addBody}`} style={{ position: 'static', marginTop: 8 }}>
            <IcsAddForm />
          </div>
        </details>
        </div>
      )}

      {connected && (
        <section className="cx-panel" style={{ marginTop: '0.8rem' }}>
          {/* Toolbar: one control size; navigation left, view + accounts right. */}
          <div className={s.toolbar}>
            <div className={s.group}>
              <Link href={todayHref} className={s.btn}>Today</Link>
              <Link href={view === 'month' ? monthPrev : shiftHref(-stride)} className={`${s.btn} ${s.square}`} aria-label="Previous">‹</Link>
              <Link href={view === 'month' ? monthNext : shiftHref(stride)} className={`${s.btn} ${s.square}`} aria-label="Next">›</Link>
              {calendarCount > 0 && (
                <span className={s.synced} data-testid="calendars-synced">
                  {calendarCount} {calendarCount === 1 ? 'calendar' : 'calendars'} synced
                </span>
              )}
            </div>
            <div className={s.right} id="accounts">
              <div className={s.seg} role="tablist" aria-label="View">
                {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
                  <Link key={v} href={viewHref(v)} role="tab" aria-selected={view === v}>
                    {v}
                  </Link>
                ))}
              </div>
              {/* The chips name the account already; the email lives in this
                  menu only, next to Disconnect. */}
              <details className={s.menu}>
                <summary className={s.btn} title="Connected calendars">Manage</summary>
                <div className={s.menuBody}>
                  {feeds.map((f) => (
                    <div key={f.id}>
                      <span className={s.menuEmail}>{f.label} · {maskIcsUrl(f.url)}</span>
                      <IcsRemoveButton id={f.id} label={f.label} />
                    </div>
                  ))}
                  {accounts.map((a) =>
                    // Only the person who connected a calendar can disconnect
                    // it; everyone else sees whose it is (server enforces too).
                    ownsGoogleAccount(a, member) ? (
                      <form key={a.accountId} action="/api/google/disconnect" method="POST">
                        <input type="hidden" name="account" value={a.accountId} />
                        <input type="hidden" name="return" value="/dashboard/calendar" />
                        <span className={s.menuEmail}>{a.email ?? a.label}</span>
                        <button type="submit" className={s.menuLink}>Disconnect this calendar</button>
                      </form>
                    ) : (
                      <div key={a.accountId}>
                        <span className={s.menuEmail}>{a.email ?? a.label}</span>
                        <span className={s.menuEmail}>Only its owner can disconnect it</span>
                      </div>
                    ),
                  )}
                </div>
              </details>
              <details className={s.menu}>
                <summary className={s.btn}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M8 3v10M3 8h10" /></svg><span className={s.addLong}>Add another calendar</span><span className={s.addShort}>Add</span></summary>
                <div className={`${s.menuBody} ${s.addBody}`}>
                  {oauthConfigured && <a href={addHref}>Google Calendar</a>}
                  <IcsAddForm />
                </div>
              </details>
            </div>
          </div>

          {/* One chip per calendar; click to hide/show it. */}
          <div className={s.chips} aria-label="Calendars">
            {sources.map((src) => (
              <Link key={src.key} href={toggleHref(src.key)} className={`${s.chip}${hidden.has(src.key) ? ` ${s.chipOff}` : ''}`} aria-pressed={!hidden.has(src.key)} title={hidden.has(src.key) ? 'Show' : 'Hide'}>
                <i style={{ background: src.color }} />
                {src.label}
              </Link>
            ))}
            {icsSources.map((src) => (
              <Link key={src.key} href={toggleHref(src.key)} className={`${s.chip} ${s.chipIcs}${hidden.has(src.key) ? ` ${s.chipOff}` : ''}`} aria-pressed={!hidden.has(src.key)} title={hidden.has(src.key) ? 'Show' : 'Hide'}>
                <i style={{ background: src.color }} />
                {src.label}
                <span className={s.chipTag}>link</span>
              </Link>
            ))}
          </div>
          {feedErrors.map((f) => (
            <p key={f.id} className="cx-notice">{f.label}: {f.last_error}</p>
          ))}

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
            <WeekTimeGrid
              {...buildWeekGrid(windowStart, dedupedEvents, tz)}
              tz={tz}
              prevWeekHref={shiftHref(-7)}
              nextWeekHref={shiftHref(7)}
            />
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

function fmtRange(a: { hh: number; mm: number }, b: { hh: number; mm: number }): string {
  const sameHalf = (a.hh >= 12) === (b.hh >= 12)
  const bare = (p: { hh: number; mm: number }) => fmtTime(p.hh, p.mm).replace(/[ap]m$/, '')
  return sameHalf ? `${bare(a)} – ${fmtTime(b.hh, b.mm)}` : `${fmtTime(a.hh, a.mm)} – ${fmtTime(b.hh, b.mm)}`
}

/** Shape the week's events for the time grid: per-day timed segments in
 *  minutes from local midnight (an event crossing midnight shows on both
 *  days), all-day events on every day they cover, and an hour range of
 *  7 AM–8 PM that grows to fit anything earlier or later. */
function buildWeekGrid(
  windowStart: Date,
  events: EventRow[],
  tz: string,
): { days: GridDay[]; startHour: number; endHour: number } {
  const w = toLocalParts(windowStart.toISOString(), tz)
  const todayKey = ymdToday(tz)
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const days: GridDay[] = []
  const bounds: Array<{ start: number; end: number }> = []
  for (let i = 0; i < 7; i++) {
    const start = dayInTz(w.y, w.m, w.d + i, tz)
    const end = dayInTz(w.y, w.m, w.d + i + 1, tz)
    const l = toLocalParts(start.toISOString(), tz)
    const key = ymd(l.y, l.m, l.d)
    const label = dayFmt.format(new Date(Date.UTC(l.y, l.m - 1, l.d)))
    days.push({ key, dow: label.split(',')[0], dayNum: l.d, label, isToday: key === todayKey, timed: [], allDay: [] })
    bounds.push({ start: start.getTime(), end: end.getTime() })
  }

  const base = (e: EventRow) => ({
    calendar: e.calendar,
    color: e.color,
    title: e.summary,
    htmlLink: e.htmlLink,
    notesHref: e.notesHref,
    location: e.location,
    conferenceLink: e.conferenceLink,
    attendees: e.attendees.map((a) => ({ label: a.displayName || a.email, status: a.responseStatus })),
  })

  let minMin = 7 * 60
  let maxMin = 20 * 60
  for (const e of events) {
    if (e.allDay) {
      // Dates are YYYY-MM-DD; the end date is exclusive.
      const endKey = e.endIso && e.endIso.length === 10 ? e.endIso : e.startIso
      for (const d of days) {
        if (d.key >= e.startIso && (d.key < endKey || d.key === e.startIso)) {
          d.allDay.push({ ...base(e), id: `${e.id}@${d.key}`, startMin: 0, endMin: 0, timeLabel: 'All day', whenLabel: `${d.label} · all day` })
        }
      }
      continue
    }
    const s = new Date(e.startIso).getTime()
    const en = Math.max(s, new Date(e.endIso || e.startIso).getTime())
    const sl = toLocalParts(e.startIso, tz)
    const el = toLocalParts(new Date(en).toISOString(), tz)
    const timeLabel = fmtRange(sl, el)
    days.forEach((d, i) => {
      const b = bounds[i]
      const segStart = Math.max(s, b.start)
      const segEnd = Math.min(en, b.end)
      if (segStart > segEnd || segStart >= b.end || (segStart === segEnd && s !== segStart)) return
      const a = toLocalParts(new Date(segStart).toISOString(), tz)
      const startMin = a.hh * 60 + a.mm
      const endMin = segEnd >= b.end ? 24 * 60 : (() => { const z = toLocalParts(new Date(segEnd).toISOString(), tz); return z.hh * 60 + z.mm })()
      d.timed.push({ ...base(e), id: `${e.id}@${d.key}`, startMin, endMin, timeLabel, whenLabel: `${d.label} · ${timeLabel}` })
      minMin = Math.min(minMin, startMin)
      maxMin = Math.max(maxMin, Math.max(endMin, startMin + 30))
    })
  }
  for (const d of days) d.timed.sort((a, b) => a.startMin - b.startMin)
  return { days, startHour: Math.floor(minMin / 60), endHour: Math.min(24, Math.ceil(maxMin / 60)) }
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
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
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
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
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
                border: `1px solid ${isToday ? 'var(--accent)' : 'var(--ink-soft)'}`,
                borderRadius: 8,
                padding: '0.35rem 0.45rem',
                minHeight: 96,
                minWidth: 0,
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
                  color: isToday ? 'var(--accent)' : 'var(--ink)',
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
