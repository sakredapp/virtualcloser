/**
 * Brief Before Every Meeting (Suite CXO), the server side. Runs on the
 * Hetzner worker (hetzner-worker/index.ts), checked about every 10 minutes.
 *
 * For each Suite CXO tenant (reps.brand = 'cxo'), each member whose Google
 * calendar is connected, each meeting starting in about 30 to 90 minutes
 * that has no brief yet: write one short brief into the SAME store the daily
 * queue and save_meeting_brief use (cxo_daily_queue_items, kind 'brief'), so
 * it shows on that person's Today the same way.
 *
 * Rules kept here:
 *  - Person-scoped. Every read and write carries rep_id AND member_id. A
 *    brief uses only what that member can see: meeting notes by the company
 *    search rule (canSeeHit) narrowed like the daily queue (an executive gets
 *    notes they own or nobody owns), their own to-dos, board cards they can
 *    see, and email from their own mailbox.
 *  - In-app only. Nothing here sends an email, a text or a push.
 *  - Model-free and cost 0: lib/mira/preMeetingBriefShared.ts builds the words.
 *  - Idempotent: the unique (rep_id, member_id, source_key) index and the key
 *    shared with the daily queue mean one brief per meeting per person.
 *  - No new tables or columns. Until cxo_daily_queue_items exists this is a
 *    quiet no-op (fail soft, like lib/people/data.ts).
 */
import { supabase } from '@/lib/supabase'
import { listConnectedGoogleAccounts } from '@/lib/google'
import { todaysMeetings, listTodos, type Todo } from '@/lib/today'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { buildScope } from '@/lib/knowledge/search'
import { canSeeHit, type SearchScope } from '@/lib/knowledge/searchShared'
import { dayInZone } from '@/lib/dueRemindersShared'
import {
  composeBrief,
  lastNoteFor,
  noteDecisions,
  noteItems,
  pickMeetings,
  resolveAttendees,
  todoMentions,
  type Attendee,
  type BriefEvent,
  type DirMember,
  type DirPartner,
  type PastNote,
} from './preMeetingBriefShared'

export type PreMeetingResult = { tenants: number; members: number; written: number; errors: number }

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()

type TenantRow = { id: string; brand: string | null; timezone: string | null }
type MemberRow = { id: string; email: string | null; display_name: string | null; role: string | null; timezone: string | null }

class TableMissing extends Error {}

/** Keys this person already has for these meetings (any writer). Throws TableMissing before the migration has run. */
async function existingKeys(repId: string, memberId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const { data, error } = await supabase.from('cxo_daily_queue_items').select('source_key').eq('rep_id', repId).eq('member_id', memberId).in('source_key', keys)
  if (error) {
    if (missing(error)) throw new TableMissing()
    throw new Error(error.message)
  }
  return new Set(((data ?? []) as Array<{ source_key: string }>).map((r) => r.source_key))
}

async function directory(repId: string): Promise<{ members: DirMember[]; partners: DirPartner[] }> {
  const [m, p] = await Promise.all([
    supabase.from('members').select('id, email, display_name').eq('rep_id', repId).eq('is_active', true).limit(1000),
    supabase.from('cxo_partners').select('id, name, org, email').eq('rep_id', repId).not('email', 'is', null).limit(5000),
  ])
  return {
    members: m.error ? [] : ((m.data ?? []) as DirMember[]),
    partners: p.error ? [] : ((p.data ?? []) as DirPartner[]),
  }
}

type NoteRow = PastNote & { rep_id: string; owner_member_id: string | null; triage_class: string | null }

/** Earlier meeting notes this member may see (last 120 days). */
async function visibleNotes(scope: SearchScope): Promise<NoteRow[]> {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('plaud_notes')
    .select('id, rep_id, title, occurred_at, calendar_event_id, attendees, owner_member_id, triage_class, mira_digest')
    .eq('rep_id', scope.repId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(200)
  if (error) return []
  return ((data ?? []) as NoteRow[]).filter(
    (n) =>
      canSeeHit({ source: 'meeting', id: n.id, rep_id: n.rep_id, title: '', body: '', when: null, owner_member_id: n.owner_member_id, attendees: n.attendees, triage_class: n.triage_class }, scope) &&
      // The daily queue's narrower rule for an executive: their own notes or nobody's.
      (!scope.isExec || !n.owner_member_id || n.owner_member_id === scope.memberId),
  )
}

/** Open to-dos filed from that note that this member can see (executive: anyone's; employee: their own). */
async function openFromNote(scope: SearchScope, noteId: string): Promise<string[]> {
  let q = supabase.from('cxo_todos').select('body').eq('rep_id', scope.repId).eq('note_id', noteId).is('done_at', null).is('deleted_at', null)
  if (!scope.isExec) q = q.eq('member_id', scope.memberId)
  const { data, error } = await q.limit(20)
  if (error) return []
  return ((data ?? []) as Array<{ body: string }>).map((t) => t.body).filter(Boolean)
}

/** Open board cards held by these people, on boards this member can see. */
async function cardsWith(scope: SearchScope, people: Attendee[]): Promise<string[]> {
  const partnerIds = people.filter((p) => p.kind === 'partner').map((p) => (p as { id: string }).id)
  const memberIds = people.filter((p) => p.kind === 'member').map((p) => (p as { id: string }).id)
  if (!partnerIds.length && !memberIds.length) return []
  const ors = [partnerIds.length ? `partner_id.in.(${partnerIds.join(',')})` : '', memberIds.length ? `member_id.in.(${memberIds.join(',')})` : ''].filter(Boolean).join(',')
  const { data, error } = await supabase
    .from('cxo_board_card_assignees')
    .select('card_id, board_id, cxo_board_cards!inner(title, done_at, rep_id, cxo_boards(name))')
    .eq('rep_id', scope.repId)
    .or(ors)
    .is('cxo_board_cards.done_at', null)
    .limit(100)
  if (error) return []
  type Row = { card_id: string; board_id: string; cxo_board_cards: { title: string; rep_id: string; cxo_boards: { name: string } | null } | null }
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of (data ?? []) as unknown as Row[]) {
    const c = r.cxo_board_cards
    if (!c || seen.has(r.card_id)) continue
    if (!canSeeHit({ source: 'card', id: r.card_id, rep_id: c.rep_id, title: '', body: '', when: null, board_id: r.board_id }, scope)) continue
    seen.add(r.card_id)
    out.push(c.cxo_boards?.name ? `${c.title} (${c.cxo_boards.name})` : c.title)
  }
  return out
}

/** The newest thread from a partner on the invite, in this member's own mailbox only (last 60 days). */
async function lastPartnerEmail(scope: SearchScope, people: Attendee[]): Promise<{ from: string; subject: string; date: string } | null> {
  const partners = people.filter((p): p is Extract<Attendee, { kind: 'partner' }> => p.kind === 'partner')
  const emails = partners.map((p) => p.email.replace(/[^a-z0-9@._+-]/g, '')).filter((e) => e.includes('@')).slice(0, 10)
  if (!emails.length) return null
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('email_threads')
    .select('subject, from_address, last_message_at')
    .eq('rep_id', scope.repId)
    .eq('owner_member_id', scope.memberId)
    .gte('last_message_at', since)
    .or(emails.map((e) => `from_address.ilike.%${e}%`).join(','))
    .order('last_message_at', { ascending: false })
    .limit(1)
  if (error) return null
  const t = ((data ?? []) as Array<{ subject: string | null; from_address: string | null; last_message_at: string | null }>)[0]
  if (!t?.subject || !t.last_message_at) return null
  const who = partners.find((p) => lower(t.from_address).includes(p.email))
  return { from: who?.name.split(/\s+/)[0] || 'them', subject: t.subject, date: t.last_message_at }
}

type MemberCtx = { tenant: TenantRow; member: MemberRow; tz: string; dir: { members: DirMember[]; partners: DirPartner[] }; selfEmails: string[] }

async function briefMember(c: MemberCtx, now: Date): Promise<number> {
  const repId = c.tenant.id
  const memberId = c.member.id
  const events = (await todaysMeetings(repId, memberId, c.tz, 2).catch(() => null)) ?? []
  const dayOf = (iso: string) => dayInZone(new Date(iso), c.tz)
  const candidates = pickMeetings(events as BriefEvent[], now.getTime(), dayOf, new Set())
  if (!candidates.length) return 0
  const have = await existingKeys(repId, memberId, candidates.map((e) => e.key))
  const todo = candidates.filter((e) => !have.has(e.key))
  if (!todo.length) return 0

  const isExec = !isEmployeeOnlyMember(c.member, c.tenant)
  const scope = await buildScope({ repId, memberId, email: c.member.email, displayName: c.member.display_name, isExec, timezone: c.tz })
  const [notes, myTodos] = await Promise.all([visibleNotes(scope), listTodos(repId, memberId).catch(() => [] as Todo[])])
  const time = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: c.tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()

  let written = 0
  for (const e of todo) {
    const people = resolveAttendees(e, c.selfEmails, c.dir.members.filter((m) => m.id !== memberId), c.dir.partners)
    const last = lastNoteFor(e, people.map((p) => p.email), notes)
    const [filed, cards, lastEmail] = await Promise.all([last ? openFromNote(scope, last.id) : Promise.resolve([]), cardsWith(scope, people), lastPartnerEmail(scope, people)])
    const stillOpen = filed.length ? filed : noteItems(last)
    const openTodos = myTodos.filter((t) => !t.done_at && todoMentions(t, people)).map((t) => t.body)
    const brief = composeBrief({
      title: e.title,
      time: time(e.start),
      people,
      last: last ? { date: last.occurred_at, title: last.title, decisions: noteDecisions(last) } : null,
      stillOpen: last ? stillOpen : [],
      todos: openTodos,
      cards,
      lastEmail,
    })
    // Nothing useful beyond the title: no brief (owner rule: no nothing-to-do notices).
    if (!brief) continue
    const { error } = await supabase.from('cxo_daily_queue_items').insert({
      rep_id: repId,
      member_id: memberId,
      source_key: e.key,
      kind: 'brief',
      day: e.day,
      title: brief.title.slice(0, 300),
      body: brief.body.slice(0, 6000),
      payload: { meeting_id: e.id, start: e.start, auto: 'pre_meeting', note_id: last?.id ?? null },
      needs_tap: false,
      via: 'app',
    })
    if (!error) written++
    else if (missing(error)) throw new TableMissing()
    else if (error.code !== '23505') console.error('[pre-meeting] keep', repId, error.message)
  }
  return written
}

/** One check across every Suite CXO tenant. Never throws. */
export async function runPreMeetingBriefTick(now = new Date()): Promise<PreMeetingResult> {
  const out: PreMeetingResult = { tenants: 0, members: 0, written: 0, errors: 0 }
  const { data, error } = await supabase.from('reps').select('id, brand, timezone').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[pre-meeting] tenants', error.message)
    out.errors++
    return out
  }
  for (const tenant of (data ?? []) as TenantRow[]) {
    try {
      const accounts = await listConnectedGoogleAccounts(tenant.id)
      if (!accounts.length) continue
      out.tenants++
      const { data: ms, error: mErr } = await supabase.from('members').select('id, email, display_name, role, timezone').eq('rep_id', tenant.id).eq('is_active', true).neq('role', 'assistant').limit(500)
      if (mErr) throw new Error(mErr.message)
      // Same account rule as Today (lib/today.todaysMeetings): their own account,
      // or the workspace account when they own the company or it is their login.
      const mine = (m: MemberRow) => accounts.filter((a) => a.memberId === m.id || (a.isShared && (m.role === 'owner' || (!!lower(a.email) && lower(a.email) === lower(m.email)))))
      const members = ((ms ?? []) as MemberRow[]).filter((m) => mine(m).length > 0)
      if (!members.length) continue
      const dir = await directory(tenant.id)
      for (const member of members) {
        out.members++
        try {
          const tz = member.timezone || tenant.timezone || 'America/New_York'
          const selfEmails = [member.email ?? '', ...mine(member).map((a) => a.email ?? '')]
          out.written += await briefMember({ tenant, member, tz, dir, selfEmails }, now)
        } catch (err) {
          if (err instanceof TableMissing) throw err
          out.errors++
          console.error('[pre-meeting] member', tenant.id, member.id, err instanceof Error ? err.message : err)
        }
      }
    } catch (err) {
      if (err instanceof TableMissing) return out // cxo_daily_queue.sql not applied yet: quiet
      out.errors++
      console.error('[pre-meeting] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
