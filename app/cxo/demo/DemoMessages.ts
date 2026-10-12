/**
 * "Leave it with Mira" on the public demo: invented messages between the
 * invented people, held in memory. Sorting, the one suggested step and the
 * sender's status line run through the SAME pure rules as the signed-in
 * product (lib/mira/leaveShared); only the text model is left out, so the
 * rule-based read stands in for it. Nothing is sent anywhere.
 */
import type { MessagesApi, MessagesData } from '@/app/dashboard/today/MessagesCard'
import type { MessageView, OrgMember } from '@/lib/memberMessages'
import { bestMatch, buildTriage, senderStatus, sortInbox, LeaveRefused, type Outcome, type Triage, type TriageContext } from '@/lib/mira/leaveShared'
import type { RawPeople } from '@/lib/people/shared'

type Msg = { id: string; from: string; to: string; body: string; kind: MessageView['kind']; at: string; read_at: string | null; reply_to: string | null; triage: Triage | null; outcome: Outcome | null }
export type DemoMsgStore = { msgs: Msg[]; n: number }

const NAMES: Record<string, string> = { m0: 'Andrew', m1: 'Jordan Pike', m2: 'Sam Okoro', m3: 'Nina Castell', m4: 'Elena Marsh', m5: 'Leo Brandt', m6: 'Maya Lindqvist', m7: 'Owen Farrow' }
/** Meetings on each person's calendar today (invented). */
const MEETINGS: Record<string, number> = { m0: 6, m1: 3, m2: 1 }
const first = (id: string) => (NAMES[id] ?? 'They').split(' ')[0]
const daysTo = (today: string, day: string) => Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000)

function pairOf(raw: RawPeople, a: string, b: string) {
  return (
    raw.oneOnOnes.find((o) => {
      const emp = raw.employees.find((e) => e.id === o.employee_id)?.member_id
      return (emp === a && o.manager_member_id === b) || (emp === b && o.manager_member_id === a)
    }) ?? null
  )
}

/** What Mira has on the recipient, from the demo's own invented data. */
function contextFor(raw: RawPeople, today: string, from: string, to: string, body: string): TriageContext {
  const oo = pairOf(raw, from, to)
  const emp = raw.employees.find((e) => e.member_id === to)
  return {
    senderFirst: first(from),
    meetingsToday: MEETINGS[to] ?? 2,
    hasOneOnOne: !!oo,
    oneOnOneInDays: oo?.next_date ? Math.max(0, daysTo(today, oo.next_date)) : null,
    goalHit: bestMatch(body, raw.goals.filter((g) => g.employee_id === emp?.id && g.status === 'active')),
    cardHit: bestMatch(body, raw.cards[to] ?? []),
  }
}

export function seedMessages(raw: RawPeople, today: string, at: (daysAgo: number, hour?: number) => string): DemoMsgStore {
  const store: DemoMsgStore = { msgs: [], n: 0 }
  const add = (from: string, to: string, body: string, kind: Msg['kind'], daysAgo: number, hour: number, extra: Partial<Msg> = {}) =>
    store.msgs.push({ id: `dm${++store.n}`, from, to, body, kind, at: at(daysAgo, hour), read_at: null, reply_to: null, triage: buildTriage(body, kind, contextFor(raw, today, from, to, body)), outcome: null, ...extra })
  // To the admin seat, from every level.
  add('m2', 'm0', 'Can we go ahead with the second regional event in November? I need your sign-off before I hold the venue.', 'question', 0, 14)
  add('m5', 'm0', 'Could we sit down for 30 min this week to walk you through the new statement layout?', 'message', 0, 13)
  add('m3', 'm0', 'All 65 contracts for the month are filed. Nothing needed from you.', 'note', 1, 16)
  // To the manager seat.
  add('m2', 'm1', 'What is the status of the producer onboarding playbook? Two agencies asked me this morning.', 'question', 0, 15)
  add('m3', 'm1', 'Should we move the contracting walkthrough to the first week for new hires? Your call.', 'question', 0, 12)
  add('m0', 'm1', 'Great quarter so far. Keep the weekly agency notes coming.', 'note', 1, 10)
  // To the employee seat.
  add('m1', 'm2', 'Where are you on the top-20 agency visit plan? Need it for Thursday.', 'question', 0, 11)
  add('m0', 'm2', 'Please send me the three agencies you think are closest to leaving.', 'request', 0, 9)
  // Already handled, so each seat's Sent shows what happened.
  add('m0', 'm4', 'Can you confirm the Q4 case backlog target?', 'question', 2, 10, { read_at: at(2, 12), outcome: 'answered' })
  add('m1', 'm0', 'I would like to talk through headcount for next year.', 'message', 2, 9, { read_at: at(2, 11), outcome: 'agenda' })
  add('m2', 'm1', 'Can you look at the activation checklist draft?', 'request', 3, 14, { read_at: at(3, 15), outcome: 'todo' })
  add('m2', 'm6', 'Thanks for the help with the stuck case last week.', 'note', 4, 10, { read_at: at(4, 12) })
  return store
}

/** Leave a message from the person page (the demo's PeopleApi.leave). */
export function demoLeave(store: DemoMsgStore, raw: RawPeople, today: string, me: string, to: string, body: string) {
  if (!NAMES[to] || to === me || !body.trim()) throw new LeaveRefused('Pick someone on your team.')
  store.msgs.push({ id: `dm${++store.n}`, from: me, to, body: body.trim(), kind: 'message', at: new Date().toISOString(), read_at: null, reply_to: null, triage: buildTriage(body, 'message', contextFor(raw, today, me, to, body)), outcome: null })
}

export function demoMessagesApi(store: DemoMsgStore, raw: RawPeople, today: string, me: string, meName: string): MessagesApi & { peek: () => MessagesData } {
  const members: OrgMember[] = Object.keys(NAMES).filter((id) => id !== me).map((id) => ({ id, display_name: NAMES[id], email: null, timezone: null }))
  const view = (m: Msg): MessageView => ({ id: m.id, rep_id: 'demo', from_member_id: m.from, to_member_id: m.to, body: m.body, kind: m.kind, deliver_at: m.at, read_at: m.read_at, replied_to_id: m.reply_to, created_at: m.at, from_name: NAMES[m.from] ?? 'Someone', to_name: NAMES[m.to] ?? 'Someone', replies: [] })
  const peek = (): MessagesData => {
    const inbox = sortInbox(store.msgs.filter((m) => m.to === me && !m.read_at).map((m) => ({ ...view(m), triage: m.triage })))
    const sent = store.msgs
      .filter((m) => m.from === me && !m.reply_to)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .map((m) => {
        const replies = store.msgs.filter((r) => r.reply_to === m.id).map(view)
        // The sender's line is built from delivery, seen and outcome only, exactly as on the server.
        return { ...view(m), replies, status: senderStatus({ deliver_at: m.at, read_at: m.read_at }, m.outcome, replies.some((r) => r.from_member_id === m.to)) }
      })
    return {
      inbox: inbox.map((m) => ({ ...m, triage: m.triage ? { category: m.triage.category, reason: m.triage.reason, suggestion: m.triage.suggestion, draft: m.triage.draft } : null })),
      sent,
      members,
    }
  }
  const now = () => new Date().toISOString()
  return {
    peek,
    load: async () => peek(),
    async op(b) {
      if (b.op === 'send') {
        demoLeave(store, raw, today, me, String(b.to ?? ''), String(b.body ?? ''))
        return { ok: true }
      }
      const m = store.msgs.find((x) => x.id === b.id && x.to === me)
      if (!m) throw new LeaveRefused('Message not found.', 404)
      if (b.op === 'slots') return { ok: true, slots: [{ start: 's1', label: 'Tomorrow 10:00 AM' }, { start: 's2', label: 'Tomorrow 2:30 PM' }, { start: 's3', label: 'Mon 9:00 AM' }] }
      const action = b.op === 'read' ? 'seen' : String(b.action ?? '')
      if (action === 'reply') {
        const body = String(b.body ?? '').trim()
        if (!body) throw new LeaveRefused('Write the reply first.')
        store.msgs.push({ id: `dm${++store.n}`, from: me, to: m.from, body, kind: 'message', at: now(), read_at: null, reply_to: m.id, triage: null, outcome: null })
        m.outcome = 'answered'
      } else if (action === 'agenda') {
        const oo = pairOf(raw, me, m.from)
        if (!oo) throw new LeaveRefused(`You have no 1:1 set up with ${first(m.from)} yet.`, 409)
        raw.items.push({ id: `i-msg-${m.id}`, one_on_one_id: oo.id, kind: 'agenda', body: `From ${first(m.from)}: ${m.body}`, author_member_id: me, author_name: meName, owner_member_id: null, owner_name: null, done_at: null, created_at: now() })
        m.outcome = 'agenda'
      } else if (action === 'todo') m.outcome = 'todo'
      else if (action === 'card') m.outcome = 'card'
      else if (action === 'time') m.outcome = 'time_booked'
      else if (action !== 'seen') throw new LeaveRefused('Unknown action.')
      m.read_at = now()
      return { ok: true }
    },
  }
}
