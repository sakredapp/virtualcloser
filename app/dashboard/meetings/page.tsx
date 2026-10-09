import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import PageHeader from '@/app/components/PageHeader'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import {
  googleOauthConfigured,
  listCalendars,
  listConnectedGoogleAccounts,
  listUpcomingEvents,
} from '@/lib/google'
import './meetings.css'
import NoteTakerConnect from '@/app/components/cxo/NoteTakerConnect'
import { getOrCreateInboundToken } from '@/lib/meetings/inbound'

/**
 * Meetings — today's calendar with a recording status per meeting, and every
 * past transcript Mira has read, newest first.
 *
 * Sources:
 *   - Today: Google Calendar via lib/google (same fetch the Calendar page
 *     runs), in the member's timezone.
 *   - Past + recording status: `plaud_notes` (the meeting-note store the
 *     Plaud/Zapier webhook writes into). There is no Wispr Flow OAuth in this
 *     repo, so "Connect Wispr Flow" is an instruction expandable, and we only
 *     call the inbox "ready" when `tenant.integrations.plaud_webhook_secret`
 *     exists — never "connected".
 */
export const dynamic = 'force-dynamic'

type NoteRow = {
  id: string
  title: string | null
  transcript: string | null
  summary: string | null
  action_items: unknown
  occurred_at: string
  duration_seconds: number | null
}

type TodayRow = {
  id: string
  title: string
  startIso: string
  endIso: string
  allDay: boolean
  htmlLink: string
  attendees: number
  status: 'recorded' | 'recording' | 'missing'
}

const MS_DAY = 86_400_000
const MS_MIN = 60_000

// ── time helpers (same approach as the Calendar page) ────────────────────

function toLocalParts(iso: string, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number } {
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
  return { y: get('year'), m: get('month'), d: get('day'), hh: hh === 24 ? 0 : hh, mm: get('minute') }
}

function dayInTz(y: number, m: number, d: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d)
  const l = toLocalParts(new Date(wall).toISOString(), tz)
  const offsetMs = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - wall
  return new Date(wall - offsetMs)
}

function startOfTodayInTz(tz: string): Date {
  const l = toLocalParts(new Date().toISOString(), tz)
  return dayInTz(l.y, l.m, l.d, tz)
}

function fmtClock(iso: string, tz: string): string {
  const { hh, mm } = toLocalParts(iso, tz)
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  const ap = hh >= 12 ? 'pm' : 'am'
  return mm === 0 ? `${h12}${ap}` : `${h12}:${String(mm).padStart(2, '0')}${ap}`
}

function fmtDate(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function fmtDur(s: number | null): string | null {
  if (!s || s <= 0) return null
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}

type FiledItem = { id: string; body: string; note_id: string | null; assignee_name: string | null; partner_name: string | null; due_date: string | null; done_at: string | null; created_at: string }

/** "Oct 14" from a YYYY-MM-DD due date (a calendar day, no time zone shift). */
function fmtDue(d: string): string {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function items(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : ''))
      .filter(Boolean)
  }
  return []
}

/** Figures that appear verbatim in the note text ($, %, and larger counts). Extracted, never generated. */
function numbersMentioned(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /(\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[kKmMbB]\b|million|billion|thousand)?|\d[\d,]*(?:\.\d+)?\s?%|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:million|billion|thousand|[kKmM]\b))/g
  for (const m of text.matchAll(re)) {
    const v = m[0].replace(/\s+/g, ' ').trim()
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
    if (out.length >= 12) break
  }
  return out
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** A note belongs to an event when it lands inside the event's window (15 min grace) or carries the same title. */
function noteForEvent(ev: { startIso: string; endIso: string; title: string }, notes: NoteRow[]): NoteRow | null {
  const start = Date.parse(ev.startIso) - 15 * MS_MIN
  const end = Date.parse(ev.endIso) + 15 * MS_MIN
  const title = norm(ev.title)
  for (const n of notes) {
    const t = Date.parse(n.occurred_at)
    if (Number.isFinite(t) && t >= start && t <= end) return n
    const nt = n.title ? norm(n.title) : ''
    if (title && nt && (nt === title || (title.length >= 8 && nt.includes(title)) || (nt.length >= 8 && title.includes(nt)))) return n
  }
  return null
}

function StatusChip({ status }: { status: TodayRow['status'] }) {
  if (status === 'recorded') return <span className="cx-mtg-chip">Recorded</span>
  if (status === 'recording') return <span className="cx-mtg-chip cx-mtg-chip-live">Recording</span>
  return <span className="cx-mtg-chip cx-mtg-chip-missing">Not recorded</span>
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="cx-details">
      <summary>{title}</summary>
      <div className="cx-details-body">{children}</div>
    </details>
  )
}

export default async function MeetingsPage({ searchParams }: { searchParams?: Promise<{ note?: string }> }) {
  const openNote = (await searchParams)?.note ?? null
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')
  const { tenant, member } = await requireMember()
  const tz = member.timezone || tenant.timezone || 'America/New_York'

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const inboxReady = typeof integrations.plaud_webhook_secret === 'string' && integrations.plaud_webhook_secret.length > 0
  const inboundToken = await getOrCreateInboundToken(tenant.id, member.id).catch(() => null)
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const zapierUrl = inboundToken ? `${proto}://${host}/api/meetings/inbound/${inboundToken}` : null

  // ── Past transcripts (newest first) ───────────────────────────────────
  const { data: noteData } = await supabase
    .from('plaud_notes')
    .select('id, title, transcript, summary, action_items, occurred_at, duration_seconds')
    .eq('rep_id', tenant.id)
    .order('occurred_at', { ascending: false })
    .limit(100)
  const notes = (noteData ?? []) as NoteRow[]

  // ── Action items Mira filed from these notes (owner + due date) ───────
  // The viewer's own to-dos only: the same rows their Today list shows.
  const filedByNote = new Map<string, FiledItem[]>()
  if (notes.length) {
    const { data: filed } = await supabase
      .from('cxo_todos')
      .select('id, body, note_id, assignee_name, partner_name, due_date, done_at, created_at')
      .eq('rep_id', tenant.id)
      .eq('member_id', member.id)
      .is('deleted_at', null)
      .in('note_id', notes.map((n) => n.id))
      .order('created_at')
      .limit(500)
    for (const t of (filed ?? []) as FiledItem[]) {
      if (!t.note_id) continue
      const list = filedByNote.get(t.note_id) ?? []
      list.push(t)
      filedByNote.set(t.note_id, list)
    }
  }

  // ── Today's calendar (same path as the Calendar page) ─────────────────
  const dayStart = startOfTodayInTz(tz)
  const dayEnd = new Date(dayStart.getTime() + MS_DAY)
  const allAccounts = await listConnectedGoogleAccounts(tenant.id).catch(() => [])
  const accounts = allAccounts.filter((a) => a.isShared || a.memberId === member.id)
  const calendarConnected = googleOauthConfigured() && accounts.length > 0

  const today: TodayRow[] = []
  if (calendarConnected) {
    const lists = await Promise.all(
      accounts.map((a) => listCalendars(tenant.id, { memberId: a.memberId, accountId: a.accountId }).catch(() => null)),
    )
    const sources = accounts.flatMap((a, i) => (lists[i] ?? []).map((c) => ({ account: a, calendarId: c.id })))
    const results = await Promise.all(
      sources.slice(0, 12).map((src) =>
        listUpcomingEvents(tenant.id, {
          fromIso: dayStart.toISOString(),
          toIso: dayEnd.toISOString(),
          maxResults: 100,
          timeZone: tz,
          memberId: src.account.memberId,
          accountId: src.account.accountId,
          calendarId: src.calendarId,
        }).catch(() => null),
      ),
    )
    const now = Date.now()
    const seen = new Set<string>()
    for (const list of results) {
      for (const e of list ?? []) {
        if (e.eventType && e.eventType !== 'default') continue
        const allDay = e.start.length === 10
        const startIso = allDay ? `${e.start}T00:00:00Z` : e.start
        const endIso = allDay ? `${e.end}T00:00:00Z` : e.end
        const key = `${startIso}|${endIso}|${e.summary}`
        if (seen.has(key)) continue
        seen.add(key)
        const title = e.summary || 'Untitled meeting'
        const note = allDay ? null : noteForEvent({ startIso, endIso, title }, notes)
        const inProgress = !allDay && Date.parse(startIso) <= now && now < Date.parse(endIso)
        today.push({
          id: e.id,
          title,
          startIso,
          endIso,
          allDay,
          htmlLink: e.htmlLink,
          attendees: (e.attendees ?? []).length,
          status: note ? (inProgress ? 'recording' : 'recorded') : 'missing',
        })
      }
    }
    today.sort((a, b) => (a.allDay === b.allDay ? a.startIso.localeCompare(b.startIso) : a.allDay ? -1 : 1))
  }

  const todayLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  return (
    <main className="wrap">
      <div className="cx-mtg-head">
        <PageHeader title="Meetings" subtitle="Every meeting's recording and notes, read by Mira.">
          <NoteTakerConnect inboxReady={inboxReady} inHeader zapierUrl={zapierUrl} />
        </PageHeader>
      </div>

      {/* ── Today ─────────────────────────────────────────────────────── */}
      <section className="cx-mtg-section" aria-labelledby="mtg-today">
        <p className="cx-eyebrow" id="mtg-today">
          Today · {todayLabel}
        </p>
        <div className="cx-panel">
          {!calendarConnected ? (
            <div className="cx-gconnect">
              <span>Connect Google to see today&rsquo;s meetings here.</span>
              <a className="cx-btn cx-btn-sm" href="/api/google/oauth/start?return=%2Fdashboard%2Fmeetings">Connect Google</a>
            </div>
          ) : today.length === 0 ? (
            <p className="cx-mtg-muted">No meetings on the calendar today.</p>
          ) : (
            <ul className="cx-mtg-today">
              {today.map((ev) => (
                <li key={ev.id}>
                  <time dateTime={ev.startIso}>{ev.allDay ? 'All day' : fmtClock(ev.startIso, tz)}</time>
                  <span className="t">
                    {ev.htmlLink ? (
                      <a href={ev.htmlLink} target="_blank" rel="noreferrer">
                        {ev.title}
                      </a>
                    ) : (
                      ev.title
                    )}
                  </span>
                  <span className="n">{ev.attendees > 0 ? `${ev.attendees} attendee${ev.attendees === 1 ? '' : 's'}` : ''}</span>
                  <StatusChip status={ev.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Past ──────────────────────────────────────────────────────── */}
      <section className="cx-mtg-section" aria-labelledby="mtg-past">
        <p className="cx-eyebrow" id="mtg-past">
          Past
        </p>
        {notes.length === 0 ? (
          /* Same shape as ConnectState (icon, one sentence, one red button) — the button here is the Connect expandable itself. */
          <section className="cx-connect" role="region" aria-label="Connect a note-taker">
            <span className="cx-connect-icon">
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </span>
            <p className="cx-connect-line">No meetings yet. Connect your note-taker and every call lands here for Mira.</p>
            <NoteTakerConnect inboxReady={inboxReady} zapierUrl={zapierUrl} />
          </section>
        ) : (
          <div className="cx-mtg-past">
            {notes.map((n) => {
              const filed = filedByNote.get(n.id) ?? []
              const todo = filed.length ? filed.map((t) => t.body) : items(n.action_items)
              const dur = fmtDur(n.duration_seconds)
              const nums = numbersMentioned([n.summary ?? '', n.transcript ?? ''].join('\n'))
              return (
                <details key={n.id} id={`note-${n.id}`} className="cx-details" open={n.id === openNote}>
                  <summary>
                    <span className="d">{fmtDate(n.occurred_at, tz)}</span>
                    <span className="t">{n.title || 'Untitled meeting'}</span>
                    <span className="dur">{dur ?? ''}</span>
                  </summary>
                  <div className="cx-mtg-sub">
                    {n.summary && (
                      <Sub title="Summary">
                        <div style={{ whiteSpace: 'pre-wrap' }}>{n.summary}</div>
                      </Sub>
                    )}
                    {todo.length > 0 && (
                      <Sub title={`Action items (${todo.length})`}>
                        {filed.length > 0 ? (
                          <ul className="cx-mtg-items">
                            {filed.map((t) => (
                              <li key={t.id} className={t.done_at ? 'is-done' : ''}>
                                <span className="b">{t.body}</span>
                                <span className="cx-mtg-item-chips">
                                  <span className="cx-mtg-chip">{t.assignee_name || t.partner_name || 'You'}</span>
                                  {t.due_date && <span className="cx-mtg-chip">Due {fmtDue(t.due_date)}</span>}
                                  {t.done_at && <span className="cx-mtg-chip">Done</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <ul>
                            {todo.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        )}
                        {filed.length > 0 && <p className="cx-mtg-muted">On your Today list.</p>}
                      </Sub>
                    )}
                    {nums.length > 0 && (
                      <Sub title="Numbers mentioned">
                        <div className="cx-mtg-nums">
                          {nums.map((v) => (
                            <span key={v}>{v}</span>
                          ))}
                        </div>
                      </Sub>
                    )}
                    {n.transcript && (
                      <Sub title="Transcript">
                        <div className="cx-mtg-transcript">{n.transcript}</div>
                      </Sub>
                    )}
                    {!n.summary && !n.transcript && todo.length === 0 && <p className="cx-mtg-muted">Only the title came through for this meeting.</p>}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
