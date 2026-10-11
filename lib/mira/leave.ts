/**
 * Leave it with Mira (owner 10-11), the server side. Built on
 * member_messages: anyone in the org leaves a message for anyone else, Mira
 * sorts it for the recipient and suggests ONE next step.
 *
 * Rules kept here:
 *  - Sorting only writes a member_message_triage row. It never replies,
 *    books, adds a to-do, a card or an agenda item. Those happen only in
 *    actOnMessage, which runs on the recipient's own request and checks the
 *    message is addressed to them.
 *  - The text model gets the message through forModel() (no names, amounts,
 *    emails, phones) and nothing about the recipient. Their calendar, goals
 *    and cards are matched here on the server.
 *  - The sender gets senderStatus() and nothing else from the triage row.
 *  - Fail soft: until supabase/cxo_leave_it_with_mira.sql has run the table
 *    is missing; messages still send and show, just unsorted.
 */
import { supabase } from '@/lib/supabase'
import { getAI, hasAIKey } from '@/lib/ai'
import { textModelId } from '@/lib/aiProvider'
import { addTodo, findLinkedTodo, todaysMeetings } from '@/lib/today'
import * as M from '@/lib/memberMessages'
import { openCards } from '@/lib/people/data'
import {
  CATEGORY_WORDS,
  SUGGESTION_WORDS,
  EMPTY_CONTEXT,
  LeaveRefused,
  TRIAGE_SYSTEM,
  asCategory,
  asOutcome,
  asSuggestion,
  bestMatch,
  buildTriage,
  classifyHeuristic,
  forModel,
  parseModel,
  senderStatus,
  sortInbox,
  type Outcome,
  type SenderStatus,
  type Triage,
  type TriageContext,
  type TriageView,
} from './leaveShared'

type Err = { code?: string } | null
export const triageMissing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
const soft = <T>(p: PromiseLike<T>, dflt: T, ms = 2500): Promise<T> =>
  Promise.race([Promise.resolve(p).catch(() => dflt), new Promise<T>((r) => setTimeout(() => r(dflt), ms))])

const dayIn = (tz: string, at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000)

type Pair = { ooId: string; next_date: string | null }

/** The 1:1 these two members have with each other (either one is the manager), if any. */
export async function oneOnOneBetween(repId: string, a: string, b: string): Promise<Pair | null> {
  const { data: emps, error } = await supabase.from('cxo_employees').select('id, member_id').eq('rep_id', repId).in('member_id', [a, b])
  if (error || !emps?.length) return null
  const byEmp = new Map((emps as Array<{ id: string; member_id: string }>).map((e) => [e.id, e.member_id]))
  const { data: oos, error: e2 } = await supabase.from('cxo_one_on_ones').select('id, employee_id, manager_member_id, next_date').eq('rep_id', repId).in('employee_id', [...byEmp.keys()])
  if (e2) return null
  const hit = ((oos ?? []) as Array<{ id: string; employee_id: string; manager_member_id: string | null; next_date: string | null }>).find((o) => {
    const emp = byEmp.get(o.employee_id)
    return (emp === a && o.manager_member_id === b) || (emp === b && o.manager_member_id === a)
  })
  return hit ? { ooId: hit.id, next_date: hit.next_date } : null
}

/** What Mira already has on the recipient. Every part is optional and capped; a slow calendar never holds up a send. */
export async function gatherContext(repId: string, from: M.OrgMember, to: M.OrgMember, body: string, tenantTz: string): Promise<TriageContext> {
  const tz = to.timezone || tenantTz || 'America/New_York'
  const today = dayIn(tz)
  const goals = async () => {
    const { data: emp } = await supabase.from('cxo_employees').select('id').eq('rep_id', repId).eq('member_id', to.id).maybeSingle()
    if (!emp) return []
    const { data } = await supabase.from('cxo_goals').select('title, current, target, status').eq('rep_id', repId).eq('employee_id', (emp as { id: string }).id).eq('status', 'active').limit(100)
    return ((data ?? []) as Array<{ title: string; current: unknown; target: unknown }>).map((g) => ({ title: String(g.title), current: Number(g.current) || 0, target: Number(g.target) || 0 }))
  }
  const [pair, meetings, goalRows, cards] = await Promise.all([
    soft(oneOnOneBetween(repId, from.id, to.id), null),
    soft(todaysMeetings(repId, to.id, tz), null),
    soft(goals(), []),
    soft(openCards(repId, [to.id]).then((r) => r[to.id] ?? []), []),
  ])
  return {
    senderFirst: M.firstName(from),
    meetingsToday: meetings ? meetings.length : null,
    hasOneOnOne: !!pair,
    oneOnOneInDays: pair?.next_date ? Math.max(0, daysBetween(today, pair.next_date)) : null,
    goalHit: bestMatch(body, goalRows),
    cardHit: bestMatch(body, cards),
  }
}

/** The model's read of the message. Null when the AI rail is off, slow or answers badly; the rules then sort it. */
async function askModel(body: string, kind: string) {
  if (!hasAIKey()) return null
  const call = getAI()
    .messages.create({
      model: textModelId(),
      max_tokens: 200,
      system: TRIAGE_SYSTEM,
      messages: [{ role: 'user', content: `Kind chosen by the app: ${kind}\nMessage:\n${forModel(body)}` }],
    })
    .then((msg) => {
      const text = (msg as { content?: Array<{ type: string; text?: string }> }).content?.find((b) => b.type === 'text')?.text ?? ''
      return parseModel(text)
    })
  return soft(call, null, 6000)
}

/**
 * Sort one new message for its recipient. Writes the triage row and nothing
 * else. Never throws: a message is delivered whether or not Mira sorted it.
 */
export async function triageMessage(message: M.MemberMessage, from: M.OrgMember, to: M.OrgMember, tenantTz = 'America/New_York'): Promise<Triage | null> {
  if (message.replied_to_id) return null
  try {
    const [ctx, model] = await Promise.all([gatherContext(message.rep_id, from, to, message.body, tenantTz).catch(() => ({ ...EMPTY_CONTEXT, senderFirst: M.firstName(from) })), askModel(message.body, message.kind)])
    const t = buildTriage(message.body, message.kind, ctx, model)
    const { error } = await supabase
      .from('member_message_triage')
      .upsert({ message_id: message.id, rep_id: message.rep_id, to_member_id: message.to_member_id, category: t.category, reason: t.reason, rank: t.rank, suggestion: t.suggestion, draft: t.draft }, { onConflict: 'message_id' })
    if (error && !triageMissing(error)) console.error('[leave] triage save', error)
    return t
  } catch (err) {
    console.error('[leave] triage', err instanceof Error ? err.message : err)
    return null
  }
}

type Row = { message_id: string; to_member_id: string; category: string; reason: string; rank: number; suggestion: string; draft: string | null; outcome: string | null }

async function triageRows(repId: string, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>()
  if (!ids.length) return out
  const { data, error } = await supabase.from('member_message_triage').select('message_id, to_member_id, category, reason, rank, suggestion, draft, outcome').eq('rep_id', repId).in('message_id', ids.slice(0, 300))
  if (error) {
    if (!triageMissing(error)) console.error('[leave] triage read', error)
    return out
  }
  for (const r of (data ?? []) as Row[]) out.set(r.message_id, r)
  return out
}

export type InboxItem = M.MessageView & { triage?: TriageView | null }
export type SentItem = M.MessageView & { status: SenderStatus }

/**
 * The Messages card for one member. Inbox: what was left for them, in Mira's
 * order, each with her read of it. Sent: what they left for others, with the
 * status line only (the triage row is read here just for its outcome).
 */
export async function listForMember(repId: string, memberId: string): Promise<{ inbox: InboxItem[]; sent: SentItem[]; members: M.OrgMember[] }> {
  const base = await M.listMessages(repId, memberId)
  const rows = await triageRows(repId, [...base.inbox, ...base.sent].map((m) => m.id))
  const ranked = base.inbox.map((m) => {
    const r = rows.get(m.id)
    const category = r && r.to_member_id === memberId ? asCategory(r.category) : null
    return { m, triage: category && r ? { category, reason: r.reason, suggestion: asSuggestion(r.suggestion) ?? 'reply', draft: r.draft, rank: r.rank } : null }
  })
  const inbox: InboxItem[] = sortInbox(ranked.map((x) => ({ ...x.m, triage: x.triage }))).map((x) => {
    const t = x.triage as (TriageView & { rank?: number }) | null
    return { ...x, triage: t ? { category: t.category, reason: t.reason, suggestion: t.suggestion, draft: t.draft } : null }
  })
  const sent: SentItem[] = base.sent.map((m) => ({
    ...m,
    status: senderStatus(m, asOutcome(rows.get(m.id)?.outcome), m.replies.some((r) => r.from_member_id === m.to_member_id)),
  }))
  return { inbox, sent, members: base.members }
}

/**
 * The same two views for Mira's list tool: on a message the caller sent, the
 * plain status; on one left for the caller, what it needs and the one step.
 */
export async function labelsFor(repId: string, memberId: string, items: Array<{ id: string; mine: boolean; read: boolean; delivers_at: string; reply_to: string | null }>): Promise<Map<string, { status?: string; needs?: string; suggested_step?: string }>> {
  const out = new Map<string, { status?: string; needs?: string; suggested_step?: string }>()
  const rows = await triageRows(repId, items.filter((i) => !i.reply_to).map((i) => i.id))
  for (const i of items) {
    if (i.reply_to) continue
    const r = rows.get(i.id)
    if (i.mine) out.set(i.id, { status: senderStatus({ deliver_at: i.delivers_at, read_at: i.read ? i.delivers_at : null }, asOutcome(r?.outcome), false).label })
    else if (r && r.to_member_id === memberId && asCategory(r.category)) out.set(i.id, { needs: CATEGORY_WORDS[asCategory(r.category)!], suggested_step: SUGGESTION_WORDS[asSuggestion(r.suggestion) ?? 'reply'] })
  }
  return out
}

/** Unread messages that may raise the badge or a browser alert. An FYI never does on its own. */
export async function loudUnread(repId: string, memberId: string): Promise<{ count: number; latest: { from: string; body: string } | null }> {
  const { data, error } = await supabase
    .from('member_messages')
    .select('id, body, from_member_id')
    .eq('rep_id', repId)
    .eq('to_member_id', memberId)
    .is('read_at', null)
    .lte('deliver_at', new Date().toISOString())
    .order('deliver_at', { ascending: false })
    .limit(100)
  if (error) throw error
  const unread = (data ?? []) as Array<{ id: string; body: string; from_member_id: string }>
  if (!unread.length) return { count: 0, latest: null }
  const rows = await triageRows(repId, unread.map((u) => u.id))
  const loud = unread.filter((u) => rows.get(u.id)?.category !== 'fyi')
  if (!loud.length) return { count: 0, latest: null }
  const from = (await M.orgMembers(repId)).find((m) => m.id === loud[0].from_member_id)
  return { count: loud.length, latest: { from: M.memberLabel(from), body: loud[0].body } }
}

async function setOutcome(repId: string, msg: { id: string; to_member_id: string; body: string; kind: string }, outcome: Outcome) {
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('member_message_triage').update({ outcome, outcome_at: now }).eq('rep_id', repId).eq('message_id', msg.id).select('message_id')
  if (error) {
    if (!triageMissing(error)) console.error('[leave] outcome', error)
    return
  }
  if (data?.length) return
  // Never sorted (sent before the table existed): keep the outcome so the sender still sees it.
  const { error: e2 } = await supabase
    .from('member_message_triage')
    .insert({ message_id: msg.id, rep_id: repId, to_member_id: msg.to_member_id, category: classifyHeuristic(msg.body, msg.kind), reason: '', rank: 0, suggestion: 'none', outcome, outcome_at: now })
  if (e2 && !triageMissing(e2)) console.error('[leave] outcome insert', e2)
}

export type LeaveAction = 'reply' | 'agenda' | 'todo' | 'card' | 'time' | 'seen'
export type Actor = { repId: string; memberId: string; name: string; tz: string; actedBy?: { acted_by_member_id?: string; acted_by_name?: string } | null }

async function myMessage(who: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new LeaveRefused('Message not found.', 404)
  const { data, error } = await supabase.from('member_messages').select('id, body, kind, from_member_id, to_member_id').eq('rep_id', who.repId).eq('id', id).maybeSingle()
  if (error) throw error
  const msg = data as { id: string; body: string; kind: string; from_member_id: string; to_member_id: string } | null
  // Only the person it was left for acts on it. The sender, or anyone else, gets the same "not found".
  if (!msg || msg.to_member_id !== who.memberId) throw new LeaveRefused('Message not found.', 404)
  return msg
}

/** Open slots on the recipient's own calendar for "Find a time". Read only. */
export async function slotsFor(who: Actor, messageId: string): Promise<Array<{ start: string; label: string }>> {
  await myMessage(who, messageId)
  try {
    const { findOpenSlots } = await import('@/lib/cxoCalendar')
    const from = new Date(Date.now() + 60 * 60_000)
    const r = await findOpenSlots(who.repId, { fromIso: from.toISOString(), toIso: new Date(from.getTime() + 5 * 86_400_000).toISOString(), durationMin: 30, tz: who.tz, count: 4 }, { memberId: who.memberId, ownOnly: true })
    return r.slots.map((s) => ({ start: s.startIso, label: s.label }))
  } catch {
    throw new LeaveRefused('Connect your Google calendar to find a time.', 409)
  }
}

/**
 * The recipient's tap. This is the only place a message turns into a reply,
 * an agenda item, a to-do, a card or a calendar event.
 */
export async function actOnMessage(who: Actor, input: { id: string; action: unknown; body?: unknown; slot?: unknown }): Promise<{ note: string; outcome: Outcome | null }> {
  const msg = await myMessage(who, String(input.id ?? ''))
  const from = (await M.orgMembers(who.repId)).find((m) => m.id === msg.from_member_id) ?? null
  const first = M.firstName(from)
  let outcome: Outcome | null = null
  let note = 'Done.'
  switch (String(input.action)) {
    case 'reply': {
      const body = typeof input.body === 'string' ? input.body.trim() : ''
      if (!body) throw new LeaveRefused('Write the reply first.')
      await M.replyToMessage(who.repId, who.memberId, msg.id, body, who.actedBy)
      outcome = 'answered'
      note = `Sent to ${first}.`
      break
    }
    case 'agenda': {
      const pair = await oneOnOneBetween(who.repId, who.memberId, msg.from_member_id)
      if (!pair) throw new LeaveRefused(`You have no 1:1 set up with ${first} yet.`, 409)
      const { error } = await supabase.from('cxo_one_on_one_items').insert({ rep_id: who.repId, one_on_one_id: pair.ooId, kind: 'agenda', body: `From ${first}: ${msg.body}`.slice(0, 2000), author_member_id: who.memberId, author_name: who.name })
      if (error) throw error
      outcome = 'agenda'
      note = `On the agenda for your 1:1 with ${first}.`
      break
    }
    case 'todo': {
      let todo = await findLinkedTodo(who.repId, who.memberId, 'message', msg.id)
      if (!todo) {
        try {
          todo = await addTodo(who.repId, who.memberId, msg.body.slice(0, 500), { source: 'message', source_label: M.memberLabel(from), kind: 'task', link_kind: 'message', link_id: msg.id })
        } catch (e) {
          if ((e as { code?: string })?.code !== '23505') throw e
        }
      }
      outcome = 'todo'
      note = 'On your to-do list.'
      break
    }
    case 'card': {
      const { addCard } = await import('@/lib/meetingLoop')
      const id = await addCard(who.repId, who.memberId, msg.body.replace(/\s+/g, ' ').slice(0, 120), `From ${M.memberLabel(from)}: ${msg.body}`, null)
      if (!id) throw new LeaveRefused('You have no board yet. Make one on Boards first.', 409)
      outcome = 'card'
      note = 'Added to your board.'
      break
    }
    case 'time': {
      const start = Date.parse(String(input.slot ?? ''))
      if (!Number.isFinite(start) || start < Date.now()) throw new LeaveRefused('Pick one of the open times.')
      try {
        const { createEventWithInvites } = await import('@/lib/cxoCalendar')
        await createEventWithInvites(
          who.repId,
          who.memberId,
          { title: `${who.name.split(/\s+/)[0]} and ${first}`, description: msg.body.slice(0, 1000), startIso: new Date(start).toISOString(), endIso: new Date(start + 30 * 60_000).toISOString(), tz: who.tz, attendees: from?.email ? [{ email: from.email, displayName: M.memberLabel(from) }] : [], addMeet: false },
          { ownOnly: true },
        )
      } catch (err) {
        throw new LeaveRefused(err instanceof Error && err.message ? err.message : 'That time could not be booked.', 409)
      }
      outcome = 'time_booked'
      note = `Booked with ${first}.`
      break
    }
    case 'seen':
      note = 'Got it.'
      break
    default:
      throw new LeaveRefused('Unknown action.')
  }
  await M.markRead(who.repId, who.memberId, msg.id)
  if (outcome) await setOutcome(who.repId, msg, outcome)
  return { note, outcome }
}

/** The login behind an employee record in this org (the person page's "Leave a message"). */
export async function memberForEmployee(repId: string, employeeId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return null
  const { data } = await supabase.from('cxo_employees').select('member_id').eq('rep_id', repId).eq('id', employeeId).eq('active', true).maybeSingle()
  return (data as { member_id: string | null } | null)?.member_id ?? null
}
