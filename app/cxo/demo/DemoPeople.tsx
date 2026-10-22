'use client'

import { useMemo, useRef, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import PeopleHub from '@/app/components/cxo/PeopleHub'
import MessagesCard from '@/app/dashboard/today/MessagesCard'
import { demoLeave, demoMessagesApi, seedMessages, type DemoMsgStore } from './DemoMessages'
import '@/app/components/cxo/cxo-employees.css'
import '@/app/components/cxo/cxo-people.css'
import { TODAY, dayOffset, isoDay } from './demoClock'
import { assembleHub, assertMay, nextAfter, PeopleRefused, type ItemRow, type PeopleApi, type RawPeople, type Viewer } from '@/lib/people/shared'

/**
 * Praise, 1:1s and goals on the public demo: seven invented people held in
 * memory, run through the SAME access rules as the signed-in product
 * (assembleHub for what a viewer gets, assertMay for what they may change).
 * The switch at the top shows the three seats: admin, manager, employee.
 * No network, nothing saved; a reload puts it back.
 */

/** A date `n` days from today (./demoClock), so goals and 1:1s never go stale. */
const d = (n: number) => isoDay(dayOffset(n))
const REP = 'demo'
const at = (daysAgo: number, hour = 15) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86400_000 + hour * 3600_000).toISOString()

type Seat = 'admin' | 'manager' | 'employee'
const SEATS: { key: Seat; label: string; name: string; viewer: Viewer }[] = [
  { key: 'admin', label: 'Admin', name: 'Andrew', viewer: { repId: REP, memberId: 'm0', role: 'owner', employeeId: null, employeeOnly: false } },
  { key: 'manager', label: 'Manager', name: 'Jordan Pike', viewer: { repId: REP, memberId: 'm1', role: 'manager', employeeId: 'e1', employeeOnly: false } },
  { key: 'employee', label: 'Employee', name: 'Sam Okoro', viewer: { repId: REP, memberId: 'm2', role: 'rep', employeeId: 'e2', employeeOnly: true } },
]
const SEAT_WORDS: Record<Seat, string> = {
  admin: 'An owner or admin sees every employee.',
  manager: 'A manager sees their own page and the people who report to them.',
  employee: 'An employee sees their own page and the company praise feed.',
}

function seed(): RawPeople {
  const item = (id: string, oo: string, kind: ItemRow['kind'], body: string, author: [string, string], daysAgo: number, extra: Partial<ItemRow> = {}): ItemRow => ({
    id, one_on_one_id: oo, kind, body, author_member_id: author[0], author_name: author[1], owner_member_id: null, owner_name: null, done_at: null, created_at: at(daysAgo), ...extra,
  })
  const EXEC: [string, string] = ['m0', 'Andrew']
  const JORDAN: [string, string] = ['m1', 'Jordan Pike']
  const SAM: [string, string] = ['m2', 'Sam Okoro']
  const NINA: [string, string] = ['m3', 'Nina Castell']
  const ELENA: [string, string] = ['m4', 'Elena Marsh']
  const LEO: [string, string] = ['m5', 'Leo Brandt']
  return {
    employees: [
      { id: 'e1', name: 'Jordan Pike', title: 'Head of Client Services', department: 'Client Services', manager_id: null, member_id: 'm1' },
      { id: 'e2', name: 'Sam Okoro', title: 'Client Success Manager', department: 'Client Services', manager_id: 'e1', member_id: 'm2' },
      { id: 'e3', name: 'Nina Castell', title: 'Proposal Specialist', department: 'Client Services', manager_id: 'e1', member_id: 'm3' },
      { id: 'e4', name: 'Elena Marsh', title: 'Head of Operations', department: 'Operations', manager_id: null, member_id: 'm4' },
      { id: 'e5', name: 'Leo Brandt', title: 'Billing Analyst', department: 'Operations', manager_id: 'e4', member_id: 'm5' },
      { id: 'e6', name: 'Maya Lindqvist', title: 'Project Coordinator', department: 'Operations', manager_id: 'e4', member_id: 'm6' },
      { id: 'e7', name: 'Owen Farrow', title: 'Marketing Lead', department: 'Marketing', manager_id: null, member_id: 'm7' },
    ],
    kpis: {
      e1: { att: 0.94, goals: [{ id: 'k1', title: 'Clients onboarded', unit: 'count', target: 18, current: 17, att: 0.94, period: 'This quarter', pace: 'on_pace' }] },
      e2: { att: 0.82, goals: [
        { id: 'k2', title: 'Client check-ins', unit: 'count', target: 40, current: 36, att: 0.9, period: 'This month', pace: 'on_pace' },
        { id: 'k3', title: 'New client projects kicked off', unit: 'count', target: 12, current: 8, att: 0.67, period: 'This month', pace: 'behind' },
      ] },
      e3: { att: 1.08, goals: [{ id: 'k4', title: 'Proposals completed', unit: 'count', target: 60, current: 65, att: 1.08, period: 'This month', pace: 'met' }] },
      e4: { att: 0.88, goals: [{ id: 'k5', title: 'Projects started inside 14 days', unit: 'pct', target: 80, current: 70.4, att: 0.88, period: 'This month', pace: 'on_pace' }] },
      e5: { att: 0.71, goals: [{ id: 'k6', title: 'Invoices reconciled', unit: 'count', target: 28, current: 20, att: 0.71, period: 'This month', pace: 'behind' }] },
      e6: { att: 0.97, goals: [{ id: 'k7', title: 'Open requests cleared', unit: 'count', target: 150, current: 146, att: 0.97, period: 'This month', pace: 'on_pace' }] },
    },
    goals: [
      { id: 'g1', employee_id: 'e1', title: 'Launch the client onboarding playbook', unit: 'pct', target: 100, current: 70, due_date: d(22), status: 'active' },
      { id: 'g2', employee_id: 'e2', title: 'Visit every top-20 client in person', unit: 'count', target: 20, current: 13, due_date: d(68), status: 'active' },
      { id: 'g3', employee_id: 'e2', title: 'Finish the project management certification', unit: 'pct', target: 100, current: 100, due_date: d(-8), status: 'done' },
      { id: 'g4', employee_id: 'e3', title: 'Cut proposal turnaround to 3 days', unit: 'count', target: 3, current: 2, due_date: d(38), status: 'active' },
      { id: 'g5', employee_id: 'e5', title: 'Automate the monthly invoice run', unit: 'pct', target: 100, current: 35, due_date: d(-6), status: 'active' },
      { id: 'g6', employee_id: 'e6', title: 'Train two backups on the request queue', unit: 'count', target: 2, current: 1, due_date: d(24), status: 'active' },
      { id: 'g7', employee_id: 'e7', title: 'Client webinar sign-ups', unit: 'count', target: 400, current: 268, due_date: d(23), status: 'active' },
    ],
    oneOnOnes: [
      { id: 'o1', employee_id: 'e1', manager_member_id: 'm0', manager_name: 'Andrew', cadence: 'biweekly', next_date: d(5), last_date: d(-9), calendar_event_id: 'demo' },
      { id: 'o2', employee_id: 'e2', manager_member_id: 'm1', manager_name: 'Jordan Pike', cadence: 'weekly', next_date: d(1), last_date: d(-6), calendar_event_id: 'demo' },
      { id: 'o3', employee_id: 'e3', manager_member_id: 'm1', manager_name: 'Jordan Pike', cadence: 'biweekly', next_date: d(-3), last_date: d(-17), calendar_event_id: null },
      { id: 'o4', employee_id: 'e4', manager_member_id: 'm0', manager_name: 'Andrew', cadence: 'biweekly', next_date: d(6), last_date: d(-8), calendar_event_id: 'demo' },
      { id: 'o5', employee_id: 'e5', manager_member_id: 'm4', manager_name: 'Elena Marsh', cadence: 'monthly', next_date: d(-10), last_date: d(-38), calendar_event_id: null },
      { id: 'o6', employee_id: 'e6', manager_member_id: 'm4', manager_name: 'Elena Marsh', cadence: 'weekly', next_date: d(4), last_date: d(-3), calendar_event_id: 'demo' },
    ],
    items: [
      item('i1', 'o1', 'agenda', 'Playbook launch date and who presents it', JORDAN, 2),
      item('i2', 'o1', 'action', 'Send the next quarter onboarding forecast', EXEC, 9, { owner_member_id: 'm1', owner_name: 'Jordan Pike' }),
      item('i3', 'o2', 'agenda', 'Project kick-offs are behind: what is in the way', JORDAN, 1),
      item('i4', 'o2', 'agenda', 'Travel budget for the last seven client visits', SAM, 1),
      item('i5', 'o2', 'action', 'Book the three Southeast client visits', JORDAN, 6, { owner_member_id: 'm2', owner_name: 'Sam Okoro' }),
      item('i6', 'o2', 'action', 'Share the kick-off checklist with new clients', JORDAN, 13, { owner_member_id: 'm2', owner_name: 'Sam Okoro', done_at: at(8) }),
      item('i7', 'o2', 'note', 'Agreed to pair on two client calls next week.', JORDAN, 6),
      item('i8', 'o2', 'feedback', 'Your client reviews are the clearest on the team. Next step: bring a recommendation with each one, not only the numbers.', JORDAN, 6),
      item('i9', 'o3', 'agenda', 'Turnaround goal: what the last two slow proposals had in common', NINA, 4),
      item('i10', 'o3', 'feedback', 'Great month. I would like you to lead the proposal walkthrough for the new hires.', JORDAN, 17),
      item('i11', 'o4', 'agenda', 'Request queue coverage over the holidays', ELENA, 3),
      item('i12', 'o5', 'agenda', 'Invoice automation is past its date: new plan', ELENA, 5),
      item('i13', 'o5', 'action', 'List the three manual steps that take longest', ELENA, 38, { owner_member_id: 'm5', owner_name: 'Leo Brandt' }),
      item('i14', 'o5', 'feedback', 'I need a heads-up earlier when a date is going to slip.', ELENA, 38),
      item('i15', 'o5', 'note', 'Leo asked for half a day a week with no tickets to finish the automation.', LEO, 38),
      item('i16', 'o6', 'agenda', 'Backup training: who is second', ELENA, 2),
    ],
    praise: [
      { id: 'p1', from_member_id: 'm0', from_name: 'Andrew', to_employee_id: 'e3', value: 'Ownership', body: 'Cleared a 40-proposal backlog in a week without anyone asking. The new clients noticed.', created_at: at(0, 13) },
      { id: 'p2', from_member_id: 'm2', from_name: 'Sam Okoro', to_employee_id: 'e6', value: 'Teamwork', body: 'Stayed late to walk one of my clients through a stuck project. They renewed their retainer the next day.', created_at: at(1) },
      { id: 'p3', from_member_id: 'm1', from_name: 'Jordan Pike', to_employee_id: 'e2', value: 'Client first', body: 'Drove four hours to sit with a client who was about to leave. They stayed.', created_at: at(3) },
      { id: 'p4', from_member_id: 'm4', from_name: 'Elena Marsh', to_employee_id: 'e7', value: 'Growth', body: 'The client webinar page is the best thing we have shipped this quarter.', created_at: at(6) },
      { id: 'p5', from_member_id: 'm5', from_name: 'Leo Brandt', to_employee_id: 'e1', value: null, body: 'Thanks for getting the onboarding numbers to me early. Month-end was painless.', created_at: at(11) },
      { id: 'p6', from_member_id: 'm6', from_name: 'Maya Lindqvist', to_employee_id: 'e2', value: 'Teamwork', body: 'Always answers the project questions the same day.', created_at: at(19) },
    ],
    cards: {
      m1: [{ id: 'c1', title: 'Client onboarding playbook', board: 'Quarter priorities', due_date: d(22) }],
      m2: [
        { id: 'c2', title: 'Top-20 client visit plan', board: 'Quarter priorities', due_date: d(8) },
        { id: 'c3', title: 'Kick-off checklist v2', board: 'Client services', due_date: null },
      ],
      m3: [{ id: 'c4', title: 'Proposal walkthrough for new hires', board: 'Client services', due_date: d(14) }],
      m5: [
        { id: 'c5', title: 'Invoice run automation', board: 'Operations', due_date: d(-6) },
        { id: 'c6', title: 'Month-end close checklist', board: 'Operations', due_date: d(20) },
      ],
      m7: [{ id: 'c7', title: 'Client webinar', board: 'Quarter priorities', due_date: d(12) }],
    },
  }
}

function demoApi(store: { raw: RawPeople; n: number; msgs: DemoMsgStore }, seat: (typeof SEATS)[number]): PeopleApi {
  const v = seat.viewer
  const nid = (p: string) => `${p}-new-${++store.n}`
  return {
    leave: async (employeeId, body) => demoLeave(store.msgs, store.raw, TODAY, v.memberId, store.raw.employees.find((e) => e.id === employeeId)?.member_id ?? '', body),
    load: async () => assembleHub(v, store.raw, { today: TODAY, viewerName: seat.name, calendarReady: true, ready: true }),
    act: async (a) => {
      const raw = store.raw
      const person = raw.employees.find((e) => e.id === (a.action === 'praise' ? a.to_employee_id : a.employee_id)) ?? null
      const oo = person ? raw.oneOnOnes.find((o) => o.employee_id === person.id) ?? null : null
      const item = 'id' in a && (a.action === 'item_toggle' || a.action === 'item_remove') ? raw.items.find((i) => i.id === a.id && i.one_on_one_id === oo?.id) ?? null : null
      assertMay(v, a, person, oo, item)
      if (!person) return {}
      const now = new Date(Date.parse(`${TODAY}T14:14:00Z`) + store.n * 1000).toISOString()
      switch (a.action) {
        case 'praise':
          raw.praise.push({ id: nid('p'), from_member_id: v.memberId, from_name: seat.name, to_employee_id: person.id, value: a.value ?? null, body: a.body.trim().slice(0, 600), created_at: now })
          return { note: `Posted. ${person.name.split(' ')[0]} gets a notice.` }
        case 'oo_save':
          if (oo) Object.assign(oo, { cadence: a.cadence, next_date: a.next_date, calendar_event_id: a.calendar ? 'demo' : oo.calendar_event_id })
          else raw.oneOnOnes.push({ id: nid('o'), employee_id: person.id, manager_member_id: v.memberId, manager_name: seat.name, cadence: a.cadence, next_date: a.next_date, last_date: null, calendar_event_id: a.calendar ? 'demo' : null })
          return { note: a.calendar ? 'Saved, and on the calendar.' : 'Saved.' }
        case 'oo_done':
          if (!oo) throw new PeopleRefused('Set up the 1:1 first.', 400)
          oo.last_date = TODAY
          oo.next_date = nextAfter(TODAY, oo.cadence)
          return {}
        case 'item_add': {
          if (!oo) throw new PeopleRefused('Set up the 1:1 first.', 400)
          const mgr = raw.employees.find((e) => e.member_id === oo.manager_member_id)
          const owner = a.kind !== 'action' ? null : a.owner === 'manager' ? { id: oo.manager_member_id, name: mgr?.name ?? oo.manager_name } : { id: person.member_id, name: person.name }
          raw.items.push({ id: nid('i'), one_on_one_id: oo.id, kind: a.kind, body: a.body.trim().slice(0, 2000), author_member_id: v.memberId, author_name: seat.name, owner_member_id: owner?.id ?? null, owner_name: owner?.name ?? null, done_at: null, created_at: now })
          return a.kind === 'action' && owner?.name ? { note: `Added to ${owner.name.split(' ')[0]}'s to-dos.` } : {}
        }
        case 'item_toggle':
          if (item) item.done_at = a.done ? now : null
          return {}
        case 'item_remove':
          raw.items = raw.items.filter((i) => i !== item)
          return {}
        case 'goal_save': {
          const g = a.id ? raw.goals.find((x) => x.id === a.id && x.employee_id === person.id) : null
          const next = { title: a.title.trim().slice(0, 200), unit: a.unit, target: a.target, current: a.current, due_date: a.due_date, status: a.current >= a.target ? ('done' as const) : ('active' as const) }
          if (g) Object.assign(g, next)
          else raw.goals.push({ id: nid('g'), employee_id: person.id, ...next })
          return {}
        }
        case 'goal_progress': {
          const g = raw.goals.find((x) => x.id === a.id && x.employee_id === person.id)
          if (g) Object.assign(g, { current: a.current, status: a.current >= g.target ? 'done' : 'active' })
          return {}
        }
        case 'goal_remove':
          raw.goals = raw.goals.filter((x) => !(x.id === a.id && x.employee_id === person.id))
          return {}
      }
    },
  }
}

export default function DemoPeople() {
  const store = useRef<{ raw: RawPeople; n: number; msgs: DemoMsgStore } | null>(null)
  if (!store.current) {
    const raw = seed()
    store.current = { raw, n: 0, msgs: seedMessages(raw, TODAY, at) }
  }
  const [seat, setSeat] = useState<Seat>('admin')
  const [tab, setTab] = useState<'people' | 'praise' | 'messages'>('people')
  const api = useMemo(() => demoApi(store.current!, SEATS.find((s) => s.key === seat)!), [seat])
  const who = SEATS.find((s) => s.key === seat)!
  // The real Messages card, run on invented messages held in memory.
  const msgApi = useMemo(() => demoMessagesApi(store.current!.msgs, store.current!.raw, TODAY, who.viewer.memberId, who.name), [who])

  return (
    <main className="wrap">
      <PageHeader title="Employees" subtitle="Goals, 1:1s and praise for every person." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center', margin: '0 0 12px' }}>
        <div className="cx-seg" role="group" aria-label="See it as">
          {SEATS.map((s) => (
            <button key={s.key} type="button" aria-pressed={seat === s.key} onClick={() => setSeat(s.key)}>{s.label}</button>
          ))}
        </div>
        <p className="cxp-note" style={{ margin: 0 }}>Seeing it as {who.name}. {SEAT_WORDS[seat]}</p>
      </div>
      <div className="cx-seg" role="tablist" aria-label="Employees" style={{ marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>1:1s and goals</button>
        <button type="button" role="tab" aria-selected={tab === 'praise'} onClick={() => setTab('praise')}>Praise</button>
        <button type="button" role="tab" aria-selected={tab === 'messages'} onClick={() => setTab('messages')}>Messages</button>
      </div>
      {tab === 'messages' ? (
        <MessagesCard key={seat} initial={msgApi.peek()} timezone="America/New_York" api={msgApi} messagesOnly />
      ) : (
        <PeopleHub key={`${seat}-${tab}`} api={api} show={[tab]} />
      )}
    </main>
  )
}

