/**
 * Prep the Leadership Meeting Agenda (Suite CXO, Ciao): the database half.
 * Runs on the Hetzner worker (hetzner-worker/index.ts,
 * CXO_AGENDA_EVERY_N_TICKS); Ciao's leadership_agenda tool and the agenda
 * card on Today call the same functions.
 *
 *  - Find the meeting: the owner's and admins' own calendars, a week ahead,
 *    recurring series only (lib/meetings/agendaShared.pickLeadershipSeries).
 *    An exec can mark the series through Ciao (cxo_meeting_series).
 *  - About 24h before an instance (or as soon as it is found when booked
 *    later), Ciao drafts its agenda into cxo_meeting_agendas from rows only:
 *    last instance's digest (plaud_notes.mira_digest), overdue meeting
 *    to-dos by owner (cxo_todos), numbers that slipped (Pinnacle book),
 *    blockers from the weekly status (cxo_weekly_status), and items people
 *    asked to raise (Ciao, or a coworker message that says so). Then one
 *    in-app notice to the execs on the invite, with "Add to the invite".
 *  - The invite changes only after an exec's yes in Ciao (addAgendaToInvite).
 *  - After the meeting its digest is linked to the agenda (held_note_id),
 *    and the next draft starts from that digest: the loop closes.
 *
 * Rules kept here: rep_id on every read and write; the owner and admins see
 * and edit the agenda (company-wide to-dos and blockers). In-app only.
 * Model-free, cost 0. Once per instance: (rep_id, series_id, starts_at) is
 * unique and drafted_at is claimed with a conditional update; each notice
 * key is a lock too. Kill switch CXO_LEADERSHIP_AGENDA=off. Until the tables
 * exist, a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices } from '@/lib/followups/engine'
import { nameOf } from '@/lib/followups/shared'
import { isoWeekKey } from '@/lib/agent/weeklyLearningsSchedule'
import { lastWeekKey } from '@/lib/status/weeklyShared'
import { todayIn } from './followUp'
import {
  AGENDA_ANCHOR,
  AGENDA_ROLES,
  LEADER_ROLES,
  LOOKAHEAD_DAYS,
  agendaNoticeKey,
  agendaNoticeText,
  asksForMeeting,
  cleanBody,
  cleanRaised,
  cleanSections,
  composeAgenda,
  dayOf,
  emptySections,
  isDraftTime,
  matchesAsk,
  mergeIntoDescription,
  overdueByOwner,
  owedFromDigest,
  pickLeadershipSeries,
  recurringSeries,
  sectionCount,
  startLabel,
  type AgendaSections,
  type RaisedItem,
  type SeriesCandidate,
  type SeriesEvent,
  type SeriesMark,
} from './agendaShared'

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
export class AgendaTableMissing extends Error {}

export function agendaOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CXO_LEADERSHIP_AGENDA ?? '').trim().toLowerCase() !== 'off'
}

export type TenantRow = { id: string; brand?: string | null; timezone: string | null; settings?: unknown }
export type MemberRow = { id: string; rep_id: string; email: string | null; display_name: string | null; role: string | null; timezone: string | null; settings?: unknown; is_active: boolean }

export type AgendaRow = {
  id: string
  rep_id: string
  series_id: string
  event_id: string
  title: string
  starts_at: string
  organizer_email: string | null
  attendee_emails: string[]
  sections: AgendaSections
  body: string
  raised: RaisedItem[]
  prior_note_id: string | null
  drafted_at: string | null
  edited_at: string | null
  added_at: string | null
  held_note_id: string | null
}
const COLS = 'id, rep_id, series_id, event_id, title, starts_at, organizer_email, attendee_emails, sections, body, raised, prior_note_id, drafted_at, edited_at, added_at, held_note_id'

const tzOf = (tenant: TenantRow, member?: MemberRow | null) => member?.timezone || tenant.timezone || 'America/New_York'
const isAgendaRole = (role: string | null | undefined) => (AGENDA_ROLES as readonly string[]).includes(String(role ?? ''))

export async function activeMembers(repId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, rep_id, email, display_name, role, timezone, settings, is_active')
    .eq('rep_id', repId)
    .eq('is_active', true)
    .neq('role', 'assistant')
    .limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []) as MemberRow[]
}

export async function loadMarks(repId: string): Promise<SeriesMark[]> {
  const { data, error } = await supabase.from('cxo_meeting_series').select('series_id, choice').eq('rep_id', repId).limit(200)
  if (missing(error)) throw new AgendaTableMissing()
  if (error) throw new Error(error.message)
  return (data ?? []) as SeriesMark[]
}

/** Recurring meetings on the owner's and admins' own calendars, a week ahead. */
export async function execEvents(tenant: TenantRow, members: MemberRow[]): Promise<{ events: SeriesEvent[]; foundOn: Map<string, string> }> {
  const { todaysMeetings } = await import('@/lib/today')
  const events: SeriesEvent[] = []
  const foundOn = new Map<string, string>()
  const seen = new Set<string>()
  for (const m of members.filter((x) => isAgendaRole(x.role))) {
    const list = await todaysMeetings(tenant.id, m.id, tzOf(tenant, m), LOOKAHEAD_DAYS, { ownCalendarsOnly: true }).catch(() => null)
    for (const e of list ?? []) {
      if (!e.seriesId) continue
      const k = `${e.seriesId}|${e.start}`
      if (!foundOn.has(e.seriesId)) foundOn.set(e.seriesId, m.id)
      if (seen.has(k)) continue
      seen.add(k)
      events.push({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, attendees: e.attendees, seriesId: e.seriesId, organizer: e.organizer ?? null, notBusy: e.notBusy })
    }
  }
  return { events: events.filter((e) => !e.notBusy), foundOn }
}

const leaderEmails = (members: MemberRow[]) => members.filter((m) => (LEADER_ROLES as readonly string[]).includes(String(m.role ?? ''))).map((m) => m.email ?? '')

// ── Gathering ───────────────────────────────────────────────────────────────

type NoteRow = { id: string; title: string | null; occurred_at: string; calendar_event_id: string | null; mira_digest: unknown }

const likeSafe = (s: string) => s.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim()

/** The last instance's meeting note: same series by calendar id, else same title, before this start. */
export async function priorNote(repId: string, c: Pick<SeriesCandidate, 'seriesId' | 'title' | 'start'>): Promise<NoteRow | null> {
  const cols = 'id, title, occurred_at, calendar_event_id, mira_digest'
  const before = new Date(Date.parse(c.start) - 3_600_000).toISOString()
  const title = likeSafe(c.title)
  const [bySeries, byTitle] = await Promise.all([
    supabase.from('plaud_notes').select(cols).eq('rep_id', repId).like('calendar_event_id', `${c.seriesId.replace(/[%\\]/g, '')}%`).lt('occurred_at', before).order('occurred_at', { ascending: false }).limit(1),
    title.length >= 4
      ? supabase.from('plaud_notes').select(cols).eq('rep_id', repId).ilike('title', `%${title}%`).lt('occurred_at', before).order('occurred_at', { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as NoteRow[], error: null }),
  ])
  const rows = [...((bySeries.data ?? []) as NoteRow[]), ...((byTitle.data ?? []) as NoteRow[])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  return rows[0] ?? null
}

/** Numbers that moved: today's slip check on the book (Pinnacle edition) plus slip alerts since last time. */
async function numberLines(repId: string, tz: string, sinceIso: string): Promise<string[]> {
  const out: string[] = []
  try {
    const { pinnacleAllowed } = await import('@/lib/pinnacle/access')
    if (pinnacleAllowed(repId)) {
      const [{ Loader }, { loadSlipInput }, { detectSlipping }] = await Promise.all([import('@/lib/mcp/data'), import('@/lib/pinnacle/slippingData'), import('@/lib/pinnacle/slipping')])
      const input = await loadSlipInput(new Loader({ id: repId, timezone: tz } as never))
      if (input) out.push(...detectSlipping(input).map((i) => i.line))
    }
  } catch (err) {
    console.error('[agenda] numbers', repId, err instanceof Error ? err.message : err)
  }
  const { SLIP_KEY_PREFIX } = await import('@/lib/pinnacle/slipping')
  const { data } = await supabase.from('cxo_followup_notices').select('key, body, created_at').eq('rep_id', repId).like('key', `${SLIP_KEY_PREFIX}%`).gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(40)
  for (const n of (data ?? []) as Array<{ body: string | null }>) {
    for (const l of String(n.body ?? '').split('\n')) {
      const t = l.replace(/^\s*-\s*/, '').trim()
      if (t) out.push(t)
    }
  }
  return out
}

export async function gatherSections(
  tenant: TenantRow,
  c: SeriesCandidate,
  members: MemberRow[],
  raised: RaisedItem[],
  now: Date,
): Promise<{ sections: AgendaSections; priorNoteId: string | null }> {
  const repId = tenant.id
  const tz = tenant.timezone || 'America/New_York'
  const names = new Map(members.map((m) => [m.id, nameOf(m)]))
  const invited = new Set(c.attendeeEmails)
  const onInvite = members.filter((m) => m.email && invited.has(m.email.toLowerCase()))
  const prior = await priorNote(repId, c)
  const sinceIso = prior?.occurred_at ?? new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const today = todayIn(tz, now)

  const owners = onInvite.length ? onInvite.map((m) => m.id) : members.map((m) => m.id)
  const [numbers, todos, msgs] = await Promise.all([
    numberLines(repId, tz, sinceIso),
    supabase
      .from('cxo_todos')
      .select('member_id, body, due_date, meeting_title')
      .eq('rep_id', repId)
      .in('member_id', owners.slice(0, 500))
      .not('note_id', 'is', null)
      .is('done_at', null)
      .is('deleted_at', null)
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(300),
    onInvite.length
      ? supabase
          .from('member_messages')
          .select('from_member_id, body, created_at')
          .eq('rep_id', repId)
          .in('to_member_id', onInvite.map((m) => m.id))
          .in('kind', ['request', 'question', 'note', 'message'])
          .is('replied_to_id', null)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ])

  const overdue = overdueByOwner(
    ((todos.data ?? []) as Array<{ member_id: string; body: string; due_date: string; meeting_title: string | null }>)
      .filter((t) => names.has(t.member_id))
      .map((t) => ({ owner: names.get(t.member_id) as string, body: t.body, due_date: t.due_date, meeting_title: t.meeting_title })),
    today,
  )

  // Blockers: this week's statuses once collected (Friday), else last week's.
  const { weekRollupPeople } = await import('@/lib/status/weekly')
  let people = await weekRollupPeople(repId, isoWeekKey(now, tz), names).catch(() => [])
  if (!people.some((p) => p.blockers.length)) people = await weekRollupPeople(repId, lastWeekKey(now, tz), names).catch(() => [])
  const blockers = people.flatMap((p) => p.blockers.map((b) => `${p.name}: ${b}`))

  const asked = ((msgs.data ?? []) as Array<{ from_member_id: string; body: string }>)
    .filter((m) => asksForMeeting(m.body, c.title))
    .map((m) => `${names.get(m.from_member_id) ?? 'A colleague'}: ${m.body}`)

  return {
    sections: cleanSections({
      numbers,
      owed: owedFromDigest((prior?.mira_digest ?? null) as Parameters<typeof owedFromDigest>[0]),
      overdue,
      blockers,
      raised: [...raised.map((r) => (r.by ? `${r.by}: ${r.text}` : r.text)), ...asked],
    }),
    priorNoteId: prior?.id ?? null,
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** The instance's row, made when missing (no draft yet). */
export async function ensureAgendaRow(repId: string, c: SeriesCandidate): Promise<AgendaRow> {
  const base = { rep_id: repId, series_id: c.seriesId, event_id: c.eventId, title: c.title, starts_at: new Date(c.start).toISOString(), organizer_email: c.organizer, attendee_emails: c.attendeeEmails }
  const { error: uErr } = await supabase.from('cxo_meeting_agendas').upsert([base], { onConflict: 'rep_id,series_id,starts_at', ignoreDuplicates: true })
  if (missing(uErr)) throw new AgendaTableMissing()
  if (uErr) throw new Error(uErr.message)
  const { data, error } = await supabase.from('cxo_meeting_agendas').select(COLS).eq('rep_id', repId).eq('series_id', c.seriesId).eq('starts_at', base.starts_at).limit(1)
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as AgendaRow[])[0]
  if (!row) throw new Error('agenda row not found after upsert')
  return { ...row, raised: cleanRaised(row.raised) }
}

/** Draft (or redraft) the agenda text. An exec's edit is kept unless `redo`. Returns the row and whether this call claimed the first draft. */
export async function draftAgenda(tenant: TenantRow, c: SeriesCandidate, members: MemberRow[], now: Date, opts: { redo?: boolean; claim?: boolean } = {}): Promise<{ row: AgendaRow; claimed: boolean }> {
  const row = await ensureAgendaRow(tenant.id, c)
  if (opts.claim && row.drafted_at) return { row, claimed: false }
  const { sections, priorNoteId } = await gatherSections(tenant, c, members, row.raised, now)
  const keepEdit = !!row.edited_at && !opts.redo
  const patch: Record<string, unknown> = { sections, prior_note_id: priorNoteId, event_id: c.eventId, title: c.title, attendee_emails: c.attendeeEmails, organizer_email: c.organizer, updated_at: now.toISOString() }
  if (!keepEdit) patch.body = composeAgenda(sections)
  if (opts.redo) patch.edited_at = null
  if (!row.drafted_at) patch.drafted_at = now.toISOString()
  let q = supabase.from('cxo_meeting_agendas').update(patch).eq('rep_id', tenant.id).eq('id', row.id)
  if (opts.claim) q = q.is('drafted_at', null)
  const { data, error } = await q.select(COLS)
  if (error) throw new Error(error.message)
  const got = ((data ?? []) as AgendaRow[])[0]
  if (!got) return { row, claimed: false } // another check got there first
  return { row: { ...got, raised: cleanRaised(got.raised) }, claimed: opts.claim ? true : !row.drafted_at }
}

async function notifyExecs(tenant: TenantRow, row: AgendaRow, members: MemberRow[], foundOn: string | undefined): Promise<number> {
  if (!row.body.trim() || !sectionCount(cleanSections(row.sections ?? emptySections()))) return 0
  const invited = new Set([...(row.attendee_emails ?? []), row.organizer_email ?? ''].map((x) => x.toLowerCase()).filter(Boolean))
  let to = members.filter((m) => isAgendaRole(m.role) && m.email && invited.has(m.email.toLowerCase()))
  if (!to.length && foundOn) to = members.filter((m) => m.id === foundOn)
  if (!to.length) return 0
  const tz = tenant.timezone || 'America/New_York'
  const rows = await insertNotices(
    to.map((m) => {
      const text = agendaNoticeText(row.title, startLabel(row.starts_at, tzOf(tenant, m)), row.body)
      return {
        rep_id: tenant.id,
        member_id: m.id,
        key: agendaNoticeKey(row.id, m.id),
        kind: 'report',
        item_kind: 'report',
        item_id: row.id,
        title: text.title,
        body: text.body,
        href: `/dashboard#${AGENDA_ANCHOR}`,
        due_date: dayOf(row.starts_at, tz),
      }
    }),
  )
  return rows.length
}

/** After the meeting: link its note so the next agenda starts from its digest. */
async function linkHeldNotes(repId: string, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from('cxo_meeting_agendas')
    .select('id, event_id, title, starts_at')
    .eq('rep_id', repId)
    .is('held_note_id', null)
    .lt('starts_at', now.toISOString())
    .gt('starts_at', new Date(now.getTime() - 4 * 86_400_000).toISOString())
    .limit(20)
  if (error) return 0
  let n = 0
  for (const a of (data ?? []) as Array<{ id: string; event_id: string; title: string; starts_at: string }>) {
    const s = Date.parse(a.starts_at)
    const { data: notes } = await supabase
      .from('plaud_notes')
      .select('id, title, calendar_event_id')
      .eq('rep_id', repId)
      .gte('occurred_at', new Date(s - 3 * 3_600_000).toISOString())
      .lte('occurred_at', new Date(s + 6 * 3_600_000).toISOString())
      .limit(20)
    const list = (notes ?? []) as Array<{ id: string; title: string | null; calendar_event_id: string | null }>
    const t = a.title.toLowerCase()
    const hit = list.find((x) => x.calendar_event_id === a.event_id) ?? list.find((x) => t.length >= 4 && String(x.title ?? '').toLowerCase().includes(t))
    if (!hit) continue
    const { error: uErr } = await supabase.from('cxo_meeting_agendas').update({ held_note_id: hit.id, updated_at: now.toISOString() }).eq('rep_id', repId).eq('id', a.id).is('held_note_id', null)
    if (!uErr) n++
  }
  return n
}

// ── The tick ────────────────────────────────────────────────────────────────

/** Tenant + UTC hour already scanned in this process (calendar reads are not free). */
const scanned = new Set<string>()
let scannedHour = ''

export type AgendaTickResult = { tenants: number; checked: number; drafted: number; notices: number; linked: number; errors: number }

/** One check across every Suite CXO tenant. Never throws. */
export async function runLeadershipAgendaTick(now = new Date()): Promise<AgendaTickResult> {
  const out: AgendaTickResult = { tenants: 0, checked: 0, drafted: 0, notices: 0, linked: 0, errors: 0 }
  if (!agendaOn()) return out
  const hour = now.toISOString().slice(0, 13)
  if (hour !== scannedHour) {
    scanned.clear()
    scannedHour = hour
  }
  const { data, error } = await supabase.from('reps').select('id, brand, timezone, settings').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[agenda] tenants', error.message)
    out.errors++
    return out
  }
  for (const tenant of (data ?? []) as TenantRow[]) {
    if (scanned.has(tenant.id)) continue
    scanned.add(tenant.id)
    try {
      const members = await activeMembers(tenant.id)
      if (!members.some((m) => isAgendaRole(m.role))) continue
      out.tenants++
      const marks = await loadMarks(tenant.id)
      out.linked += await linkHeldNotes(tenant.id, now)
      const { events, foundOn } = await execEvents(tenant, members)
      const picks = pickLeadershipSeries({ events, leaderEmails: leaderEmails(members), marks, now })
      for (const c of picks) {
        out.checked++
        if (!isDraftTime(c.start, now, tenant.timezone)) continue
        const { row, claimed } = await draftAgenda(tenant, c, members, now, { claim: true })
        if (!claimed) continue
        out.drafted++
        out.notices += await notifyExecs(tenant, row, members, foundOn.get(c.seriesId))
      }
    } catch (err) {
      if (err instanceof AgendaTableMissing) return out
      out.errors++
      console.error('[agenda] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

// ── On demand (Ciao, the Today card) ────────────────────────────────────────

/** Recurring meetings on the execs' calendars, the leadership pick(s) first. */
export async function upcomingSeries(tenant: TenantRow, members: MemberRow[], now = new Date()): Promise<{ picks: SeriesCandidate[]; all: SeriesCandidate[] }> {
  const marks = await loadMarks(tenant.id)
  const { events } = await execEvents(tenant, members)
  const leaders = leaderEmails(members)
  const not = new Set(marks.filter((m) => m.choice === 'not').map((m) => m.series_id))
  return {
    picks: pickLeadershipSeries({ events, leaderEmails: leaders, marks, now }),
    all: recurringSeries(events, leaders, now, marks).filter((c) => !not.has(c.seriesId) && c.attendeeEmails.length >= 2),
  }
}

/** The meeting an ask points at ("Monday's leadership meeting"): a leadership pick first, else any recurring match. */
export function chooseSeries(s: { picks: SeriesCandidate[]; all: SeriesCandidate[] }, ask: string | null | undefined, tz: string): SeriesCandidate | null {
  const pick = s.picks.find((c) => matchesAsk(c, ask, tz))
  if (pick) return pick
  if (!ask?.trim()) return s.picks[0] ?? null
  return s.all.find((c) => matchesAsk(c, ask, tz)) ?? null
}

export async function markSeries(repId: string, c: Pick<SeriesCandidate, 'seriesId' | 'title'>, choice: 'leadership' | 'not', memberId: string): Promise<void> {
  const at = new Date().toISOString()
  const { error } = await supabase
    .from('cxo_meeting_series')
    .upsert([{ rep_id: repId, series_id: c.seriesId, title: c.title, choice, marked_by: memberId, updated_at: at }], { onConflict: 'rep_id,series_id' })
  if (missing(error)) throw new AgendaTableMissing()
  if (error) throw new Error(error.message)
}

/** Add an item someone asked to raise to the next instance's agenda (before or after the draft). */
export async function raiseItem(tenant: TenantRow, c: SeriesCandidate, text: string, by: string | null): Promise<AgendaRow> {
  const row = await ensureAgendaRow(tenant.id, c)
  const item: RaisedItem = { text: text.slice(0, 240), by, at: new Date().toISOString() }
  const raised = cleanRaised([...row.raised, item])
  const patch: Record<string, unknown> = { raised, updated_at: new Date().toISOString() }
  // Already drafted and not hand-edited: the item goes into the text now too.
  if (row.drafted_at && !row.edited_at && !row.added_at) {
    const sections = cleanSections({ ...(row.sections ?? emptySections()), raised: [...(row.sections?.raised ?? []), by ? `${by}: ${item.text}` : item.text] })
    patch.sections = sections
    patch.body = composeAgenda(sections)
  }
  const { data, error } = await supabase.from('cxo_meeting_agendas').update(patch).eq('rep_id', tenant.id).eq('id', row.id).select(COLS)
  if (error) throw new Error(error.message)
  const got = ((data ?? []) as AgendaRow[])[0] ?? row
  return { ...got, raised: cleanRaised(got.raised) }
}

export async function getAgenda(repId: string, id: string): Promise<AgendaRow | null> {
  const { data, error } = await supabase.from('cxo_meeting_agendas').select(COLS).eq('rep_id', repId).eq('id', id).limit(1)
  if (missing(error)) return null
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as AgendaRow[])[0]
  return row ? { ...row, raised: cleanRaised(row.raised) } : null
}

/** The next drafted agenda (until an hour after it starts). For the Today card. */
export async function nextDraftedAgenda(repId: string, now = new Date()): Promise<AgendaRow | null> {
  const { data, error } = await supabase
    .from('cxo_meeting_agendas')
    .select(COLS)
    .eq('rep_id', repId)
    .not('drafted_at', 'is', null)
    .gt('starts_at', new Date(now.getTime() - 3_600_000).toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
  if (missing(error)) return null
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as AgendaRow[])[0]
  return row ? { ...row, raised: cleanRaised(row.raised) } : null
}

/** An exec's edit of the text. */
export async function saveAgendaBody(repId: string, memberId: string, id: string, body: unknown): Promise<AgendaRow | null> {
  const at = new Date().toISOString()
  const { data, error } = await supabase
    .from('cxo_meeting_agendas')
    .update({ body: cleanBody(body), edited_at: at, edited_by: memberId, updated_at: at })
    .eq('rep_id', repId)
    .eq('id', id)
    .select(COLS)
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as AgendaRow[])[0]
  return row ? { ...row, raised: cleanRaised(row.raised) } : null
}

/**
 * Put the agenda in the invite's notes (after the exec's yes in Ciao). The
 * agenda replaces an earlier copy between the marker lines; the rest of the
 * notes stay. Uses the exec's own calendar tools (lib/cxoCalendar).
 */
export async function addAgendaToInvite(repId: string, memberId: string, row: AgendaRow, tz: string): Promise<{ link: string; calendar: string }> {
  const { findEventForMember, updateEventWithNotice, CalendarWriteError } = await import('@/lib/cxoCalendar')
  const ev = await findEventForMember(repId, memberId, row.event_id)
  if (!ev) throw new CalendarWriteError('google_error', 'I could not find that meeting on your calendars. Only someone with the meeting on their calendar can add the agenda.')
  if (ev.organizer && !ev.organizer.self && ev.organizer.email) {
    throw new CalendarWriteError('google_error', `${ev.organizer.email} organizes that meeting, so only they can change the invite. I can send them the agenda in a message instead.`)
  }
  const res = await updateEventWithNotice(repId, memberId, row.event_id, { description: mergeIntoDescription(ev.description, row.body), tz })
  const at = new Date().toISOString()
  await supabase.from('cxo_meeting_agendas').update({ added_at: at, added_by: memberId, updated_at: at }).eq('rep_id', repId).eq('id', row.id)
  // The draft notices are done: clear them for everyone.
  await supabase.from('cxo_followup_notices').update({ read_at: at }).eq('rep_id', repId).eq('item_id', row.id).like('key', `${agendaNoticeKey(row.id, '')}%`).is('read_at', null)
  return { link: res.htmlLink, calendar: res.calendar.name }
}

export { isAgendaRole }

// ── No calendar series (QA X-meeting_prep-01/02, 2026-10-18) ────────────────

/**
 * An agenda for "the leadership meeting" when Ciao cannot see a recurring
 * series (no Google, or the meeting is not on a connected calendar): built
 * from the same rows (overdue to-dos of the leaders, slipping numbers, this
 * week's blockers, open requests and questions to the leaders) and shown,
 * never saved and never put on an invite. No prior digest, since there is no
 * series to find it by.
 */
export async function draftAgendaWithoutCalendar(tenant: TenantRow, members: MemberRow[], now: Date): Promise<{ sections: AgendaSections; body: string; leaders: number }> {
  const repId = tenant.id
  const tz = tenant.timezone || 'America/New_York'
  const names = new Map(members.map((m) => [m.id, nameOf(m)]))
  const leaders = members.filter((m) => (LEADER_ROLES as readonly string[]).includes(String(m.role ?? '')))
  const owners = (leaders.length ? leaders : members).map((m) => m.id)
  const sinceIso = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const today = todayIn(tz, now)

  const [numbers, todos, msgs] = await Promise.all([
    numberLines(repId, tz, sinceIso),
    owners.length
      ? supabase
          .from('cxo_todos')
          .select('member_id, body, due_date, meeting_title')
          .eq('rep_id', repId)
          .in('member_id', owners.slice(0, 500))
          .is('done_at', null)
          .is('deleted_at', null)
          .lt('due_date', today)
          .order('due_date', { ascending: true })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
    leaders.length
      ? supabase
          .from('member_messages')
          .select('from_member_id, body, kind, created_at')
          .eq('rep_id', repId)
          .in('to_member_id', leaders.map((m) => m.id))
          .in('kind', ['request', 'question', 'note', 'message'])
          .is('replied_to_id', null)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ])

  const overdue = overdueByOwner(
    ((todos.data ?? []) as Array<{ member_id: string; body: string; due_date: string; meeting_title: string | null }>)
      .filter((t) => names.has(t.member_id))
      .map((t) => ({ owner: names.get(t.member_id) as string, body: t.body, due_date: t.due_date, meeting_title: t.meeting_title })),
    today,
  )

  const { weekRollupPeople } = await import('@/lib/status/weekly')
  let people = await weekRollupPeople(repId, isoWeekKey(now, tz), names).catch(() => [])
  if (!people.some((p) => p.blockers.length)) people = await weekRollupPeople(repId, lastWeekKey(now, tz), names).catch(() => [])
  const blockers = people.flatMap((p) => p.blockers.map((b) => `${p.name}: ${b}`))

  // Open asks to the leaders: the ones that name a meeting first, then requests and questions still waiting.
  const open = ((msgs.data ?? []) as Array<{ from_member_id: string; body: string; kind: string }>)
  const ranked = [...open.filter((m) => asksForMeeting(m.body, null)), ...open.filter((m) => !asksForMeeting(m.body, null) && (m.kind === 'request' || m.kind === 'question'))]
  const raised = ranked.map((m) => `${names.get(m.from_member_id) ?? 'A colleague'}: ${m.body}`)

  const sections = cleanSections({ numbers, owed: [], overdue, blockers, raised })
  return { sections, body: composeAgenda(sections), leaders: leaders.length }
}
