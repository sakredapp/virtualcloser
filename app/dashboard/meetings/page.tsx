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
import Markdown from '@/app/components/cxo/Markdown'
import NoteTakerConnect, { type NoteTakerStatus } from '@/app/components/cxo/NoteTakerConnect'
import SendToOwnersButton from './SendToOwnersButton'
import { activeTeam, matchOwner, noteItems, ownerSourceKey, type TeamMember } from '@/lib/meetings/sendToOwners'
import type { MeetingDigest } from '@/lib/meetingLoop'
import { getOrCreateInboundToken } from '@/lib/meetings/inbound'
import { noteForEvent } from '@/lib/meetings/noteMatch'

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
  calendar_event_id: string | null
  mira_digest: MeetingDigest | null
}

const NOTE_COLS = 'id, title, transcript, summary, action_items, occurred_at, duration_seconds, calendar_event_id, mira_digest'

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

/** "MS" from "Mike Spencer", "?" when nobody was named. */
function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function firstName(name: string | null | undefined): string | null {
  return (name ?? '').trim().split(/\s+/)[0] || null
}

function StatusChip({ status, ended }: { status: TodayRow['status']; ended: boolean }) {
  if (status === 'recorded') return <span className="cx-mtg-chip">Recorded</span>
  if (status === 'recording') return <span className="cx-mtg-chip cx-mtg-chip-live">Recording</span>
  return <span className="cx-mtg-chip cx-mtg-chip-missing">{ended ? 'Not recorded' : 'Not yet'}</span>
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="cx-details">
      <summary>{title}</summary>
      <div className="cx-details-body">{children}</div>
    </details>
  )
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ note?: string; day?: string; notes?: string }>
}) {
  const sp = (await searchParams) ?? {}
  const openNote = sp.note ?? null
  // "Open notes (N)" from the Calendar: several notes started at the same
  // time as one event, so list just those (from that day) and let the
  // person pick, instead of opening one that may be the wrong meeting.
  const pickIds = (sp.notes ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
    .slice(0, 20)
  const pickDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null
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
    .select(NOTE_COLS)
    .eq('rep_id', tenant.id)
    .order('occurred_at', { ascending: false })
    .limit(100)
  const notes = (noteData ?? []) as NoteRow[]
  // "Open notes" from the Calendar can point at a meeting older than the
  // newest 100: fetch that one so the link always lands on its notes.
  if (openNote && /^[0-9a-f-]{36}$/i.test(openNote) && !notes.some((n) => n.id === openNote)) {
    const { data: one } = await supabase.from('plaud_notes').select(NOTE_COLS).eq('rep_id', tenant.id).eq('id', openNote).maybeSingle()
    if (one) notes.unshift(one as NoteRow)
  }
  let shown = notes

  // ── Note-taker status: from notes that really arrived, never assumed ──
  const { data: lastRows } = await supabase
    .from('plaud_notes')
    .select('created_at, source')
    .eq('rep_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(1)
  const last = ((lastRows ?? []) as Array<{ created_at: string; source: string | null }>)[0] ?? null
  const lastLabel = last ? new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(last.created_at)) : null
  const noteTaker: NoteTakerStatus = {
    state: last ? (Date.now() - Date.parse(last.created_at) <= 30 * MS_DAY ? 'connected' : 'quiet') : inboxReady ? 'ready' : 'none',
    source: last?.source ? last.source.replace(/^webhook\//, '') : null,
    lastLabel,
  }
  if (pickIds.length) {
    const { data: picked } = await supabase
      .from('plaud_notes')
      .select(NOTE_COLS)
      .eq('rep_id', tenant.id)
      .in('id', pickIds)
      .order('occurred_at', { ascending: false })
    shown = (picked ?? []) as NoteRow[]
  }
  const pickLabel =
    pickIds.length && pickDay
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${pickDay}T12:00:00Z`))
      : null

  // ── Action items Mira filed from these notes (owner + due date) ───────
  // The viewer's own to-dos only: the same rows their Today list shows.
  const filedByNote = new Map<string, FiledItem[]>()
  if (shown.length) {
    const { data: filed } = await supabase
      .from('cxo_todos')
      .select('id, body, note_id, assignee_name, partner_name, due_date, done_at, created_at')
      .eq('rep_id', tenant.id)
      .eq('member_id', member.id)
      .is('deleted_at', null)
      .in('note_id', shown.map((n) => n.id))
      .order('created_at')
      .limit(500)
    for (const t of (filed ?? []) as FiledItem[]) {
      if (!t.note_id) continue
      const list = filedByNote.get(t.note_id) ?? []
      list.push(t)
      filedByNote.set(t.note_id, list)
    }
  }

  // ── Sent to owners: which items are on whose Today, and done or not ──
  const team: TeamMember[] = shown.length ? await activeTeam(tenant.id).catch(() => []) : []
  const sentByKey = new Map<string, { member_id: string; done_at: string | null }>()
  if (shown.length) {
    const { data: sentRows } = await supabase
      .from('cxo_todos')
      .select('member_id, source_key, done_at')
      .eq('rep_id', tenant.id)
      .is('deleted_at', null)
      .in('note_id', shown.map((n) => n.id))
      .like('source_key', 'note:%:owner:%')
      .limit(1000)
    for (const r of (sentRows ?? []) as Array<{ member_id: string; source_key: string; done_at: string | null }>) {
      sentByKey.set(`${r.source_key}|${r.member_id}`, r)
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
        const note = noteForEvent({ eventId: e.id, startIso, endIso, title, allDay }, notes)
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

  const renderedAt = Date.now()
  const todayLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  return (
    <main className="wrap">
      <div className="cx-mtg-head">
        <PageHeader title="Meetings" subtitle="Every meeting's recording and notes, read by Mira.">
          <NoteTakerConnect status={noteTaker} inHeader zapierUrl={zapierUrl} />
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
                  <StatusChip status={ev.status} ended={!ev.allDay && Date.parse(ev.endIso) < renderedAt} />
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
        {pickIds.length > 0 && (
          <p className="cx-mtg-pick" data-testid="notes-filter">
            <span>
              {shown.length} {shown.length === 1 ? 'note' : 'notes'}
              {pickLabel ? ` from ${pickLabel}` : ''} at the same time. Pick the one for this meeting.
            </span>
            <a href="/dashboard/meetings#mtg-past">Show all</a>
          </p>
        )}
        {shown.length === 0 && pickIds.length === 0 ? (
          /* Same shape as ConnectState (icon, one sentence, one red button) — the button here is the Connect expandable itself. */
          <section className="cx-connect" role="region" aria-label="Connect a note-taker">
            <span className="cx-connect-icon">
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </span>
            <p className="cx-connect-line">No meetings yet. Connect your note-taker and every call lands here for Mira.</p>
            <NoteTakerConnect status={noteTaker} zapierUrl={zapierUrl} />
          </section>
        ) : (
          <div className="cx-mtg-past">
            {shown.map((n) => {
              const filed = filedByNote.get(n.id) ?? []
              const owned = n.mira_digest?.items?.length ? noteItems(n.mira_digest, null) : []
              const todo = owned.length ? owned.map((t) => t.text) : filed.length ? filed.map((t) => t.body) : items(n.action_items)
              const sendable = owned.length ? owned : noteItems(null, n.action_items)
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
                        <Markdown text={n.summary} className="cx-md cx-mtg-summary" />
                      </Sub>
                    )}
                    {todo.length > 0 && (
                      <Sub title={`Action items (${todo.length})`}>
                        {owned.length > 0 ? (
                          <ul className="cx-mtg-items" data-testid="owned-items">
                            {owned.map((it, i) => {
                              const m = matchOwner(it.owner, team)
                              const sent = m.kind === 'member' ? sentByKey.get(`${ownerSourceKey(n.id, it.text)}|${m.member.id}`) : undefined
                              const ownerName = it.owner ?? 'No owner'
                              return (
                                <li key={i} className={sent?.done_at ? 'is-done' : ''}>
                                  <span className="b">{it.text}</span>
                                  <span className="cx-mtg-item-chips">
                                    <span className="cx-mtg-owner">
                                      <span className={`cx-mtg-avatar${it.owner ? '' : ' is-none'}`} aria-hidden>{initials(it.owner)}</span>
                                      {ownerName}
                                    </span>
                                    {it.due && <span className="cx-mtg-due">Due {fmtDue(it.due)}</span>}
                                    {sent && m.kind === 'member' && (
                                      <span className="cx-mtg-track">{sent.done_at ? 'Done' : `On ${firstName(m.member.display_name) ? `${firstName(m.member.display_name)}'s` : 'their'} Today`}</span>
                                    )}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        ) : filed.length > 0 ? (
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
                        {!owned.length && filed.length > 0 && <p className="cx-mtg-muted">On your Today list.</p>}
                        {sendable.length > 0 && <SendToOwnersButton noteId={n.id} itemCount={sendable.length} />}
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
