import { randomBytes } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { listConnectedGoogleAccounts, listUpcomingEvents, type GoogleCalEvent } from '@/lib/google'

/**
 * Meeting notes that arrive from outside (Zapier webhook today; email forward
 * later) and get attached to the matching calendar meeting.
 */

export type InboundNote = {
  title: string | null
  startedAt: string | null
  attendees: string[]
  summary: string | null
  transcript: string | null
  source: string
}

const MIN = 60_000

/** The member's own inbound URL token, created on first ask. */
export async function getOrCreateInboundToken(repId: string, memberId: string): Promise<string | null> {
  const { data } = await supabase
    .from('meeting_inbound_tokens')
    .select('token')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (data?.token) return data.token as string
  const token = randomBytes(24).toString('base64url')
  const { error } = await supabase.from('meeting_inbound_tokens').insert({ token, rep_id: repId, member_id: memberId })
  if (error) {
    // Lost a race with another render: read the winner.
    const { data: again } = await supabase
      .from('meeting_inbound_tokens')
      .select('token')
      .eq('rep_id', repId)
      .eq('member_id', memberId)
      .maybeSingle()
    return (again?.token as string | undefined) ?? null
  }
  return token
}

export async function resolveInboundToken(token: string): Promise<{ repId: string; memberId: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const { data } = await supabase
    .from('meeting_inbound_tokens')
    .select('rep_id, member_id')
    .eq('token', token)
    .maybeSingle()
  if (!data) return null
  return { repId: data.rep_id as string, memberId: data.member_id as string }
}

function emailsOf(list: string[]): Set<string> {
  const out = new Set<string>()
  for (const s of list) {
    const m = s.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)
    for (const e of m ?? []) out.add(e)
  }
  return out
}

/**
 * The calendar meeting a note belongs to: same person's calendars, start
 * within 3 hours, scored by shared attendee emails first, then closeness in
 * time. With no attendee overlap it only matches a meeting that started
 * within 20 minutes of the note.
 */
export async function matchCalendarEvent(
  repId: string,
  memberId: string,
  startedAt: string,
  attendees: string[],
): Promise<GoogleCalEvent | null> {
  const t = Date.parse(startedAt)
  if (!Number.isFinite(t)) return null
  const accounts = (await listConnectedGoogleAccounts(repId).catch(() => [])).filter(
    (a) => a.memberId === memberId || a.isShared,
  )
  if (accounts.length === 0) return null
  const lists = await Promise.all(
    accounts.map((a) =>
      listUpcomingEvents(repId, {
        fromIso: new Date(t - 3 * 60 * MIN).toISOString(),
        toIso: new Date(t + 3 * 60 * MIN).toISOString(),
        maxResults: 50,
        memberId: a.memberId,
        accountId: a.accountId,
      }).catch(() => null),
    ),
  )
  const want = emailsOf(attendees)
  let best: { ev: GoogleCalEvent; score: number } | null = null
  for (const list of lists) {
    for (const ev of list ?? []) {
      if (ev.start.length === 10) continue // all-day
      if (ev.eventType && ev.eventType !== 'default') continue
      const diff = Math.abs(Date.parse(ev.start) - t)
      const overlap = want.size > 0 ? (ev.attendees ?? []).filter((a) => want.has(a.email.toLowerCase())).length : 0
      if (overlap === 0 && diff > 20 * MIN) continue
      const score = overlap * 1000 - diff / MIN
      if (!best || score > best.score) best = { ev, score }
    }
  }
  return best?.ev ?? null
}

/** Store the note, attached to its calendar meeting when one matches. */
export async function ingestMeetingNote(
  repId: string,
  memberId: string,
  note: InboundNote,
): Promise<{ id: string | null; matched: GoogleCalEvent | null; error?: string }> {
  const startedAt = note.startedAt && Number.isFinite(Date.parse(note.startedAt)) ? new Date(note.startedAt).toISOString() : new Date().toISOString()
  const matched = await matchCalendarEvent(repId, memberId, startedAt, note.attendees).catch(() => null)
  const { data, error } = await supabase
    .from('plaud_notes')
    .insert({
      rep_id: repId,
      owner_member_id: memberId,
      title: note.title || matched?.summary || 'Meeting notes',
      summary: note.summary,
      transcript: note.transcript,
      action_items: [],
      // On the meeting's own start so the Meetings page lines them up.
      occurred_at: matched ? new Date(matched.start).toISOString() : startedAt,
      source: note.source,
      calendar_event_id: matched?.id ?? null,
      attendees: note.attendees.length > 0 ? note.attendees : null,
    })
    .select('id')
    .maybeSingle()
  if (error) return { id: null, matched, error: error.message }
  return { id: (data?.id as string | undefined) ?? null, matched }
}
