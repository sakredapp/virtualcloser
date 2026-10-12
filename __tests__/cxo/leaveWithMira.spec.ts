/**
 * Leave it with Mira (owner 10-11). These pin the rules of the channel:
 *   - any member (an employee login included) can leave a message for any
 *     other member of the same org, the owner included;
 *   - nothing crosses orgs;
 *   - sorting a message only files Mira's read of it: no reply, to-do,
 *     agenda item, card or calendar event until the recipient asks, and only
 *     the recipient can ask;
 *   - the sender's status line carries delivery, seen and outcome, never the
 *     recipient's calendar, goals, cards or Mira's reason;
 *   - the text model is given the message with names, amounts, emails and
 *     phones removed and nothing about the recipient;
 *   - an FYI never raises the badge on its own.
 * Everything is mocked: no database, no Google, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const todos: Array<{ repId: string; memberId: string; text: string }> = []
const events: unknown[] = []
const cards: unknown[] = []
const modelSaw: string[] = []
let modelSays: string | null = null
let idSeq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  let payload: Row | null = null
  let lim = Infinity
  let single = false
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op === 'insert') {
      const row = { id: uuid(), created_at: new Date().toISOString(), read_at: null, ...payload! }
      rows().push(row)
      return { data: single ? row : [row], error: null }
    }
    if (op === 'upsert') {
      const old = rows().find((r) => r.message_id === payload!.message_id)
      if (old) Object.assign(old, payload)
      else rows().push({ outcome: null, ...payload! })
      return { data: null, error: null }
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      for (const r of hit) Object.assign(r, payload)
      return { data: hit, error: null }
    }
    const out = hit.slice(0, lim)
    return { data: single ? out[0] ?? null : out, error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row) => { op = 'insert'; payload = p; return b },
    update: (p: Row) => { op = 'update'; payload = p; return b },
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return b },
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b },
    lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return b },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return b },
    order: () => b,
    limit: (n: number) => { lim = n; return b },
    single: () => { single = true; return b },
    maybeSingle: () => { single = true; return b },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))
vi.mock('@/lib/today', () => ({
  addTodo: async (repId: string, memberId: string, text: string) => {
    todos.push({ repId, memberId, text })
    return { id: `todo${todos.length}` }
  },
  findLinkedTodo: async () => null,
  // The recipient's day: five meetings, with titles that must never reach the sender.
  todaysMeetings: async () => [{ title: 'BOARD-PREP' }, { title: 'CAL-SECRET' }, { title: 'c' }, { title: 'd' }, { title: 'e' }],
}))
vi.mock('@/lib/people/data', () => ({ openCards: async (_rep: string, ids: string[]) => ({ [ids[0]]: [{ title: 'Carrier contract renewal', board: 'CARD-BOARD', due_date: '2026-10-20' }] }) }))
vi.mock('@/lib/cxoCalendar', () => ({
  findOpenSlots: async () => ({ slots: [] }),
  createEventWithInvites: async (...a: unknown[]) => { events.push(a); return { ok: true } },
}))
vi.mock('@/lib/meetingLoop', () => ({ addCard: async (...a: unknown[]) => { cards.push(a); return 'card1' } }))
vi.mock('@/lib/ai', () => ({
  hasAIKey: () => modelSays !== null,
  getAI: () => ({
    messages: {
      create: async (req: { system: string; messages: Array<{ content: string }> }) => {
        modelSaw.push(req.system + '\n' + req.messages.map((m) => m.content).join('\n'))
        return { content: [{ type: 'text', text: modelSays }] }
      },
    },
  }),
}))
vi.mock('@/lib/aiProvider', () => ({ textModelId: () => 'test-model' }))

import { employeePathAllowed } from '@/lib/employees/access'
import * as M from '@/lib/memberMessages'
import * as L from '@/lib/mira/leave'
import { EMPTY_CONTEXT, LeaveRefused, OUTCOME_WORDS, buildTriage, classifyHeuristic, forModel, parseModel, pickSuggestion, senderStatus, sortInbox, type TriageContext } from '@/lib/mira/leaveShared'

const ACME = 'rep-acme'
const OTHER = 'rep-other'
const member = (id: string, rep: string, name: string, role: string) => ({ id, rep_id: rep, display_name: name, email: `${name.toLowerCase().split(' ')[0]}@example.test`, timezone: 'America/New_York', is_active: true, role })
const OLIVIA = '00000000-0000-4000-9000-000000000001' // owner
const MONA = '00000000-0000-4000-9000-000000000002' // manager
const ERIN = '00000000-0000-4000-9000-000000000003' // employee login
const XAVIER = '00000000-0000-4000-9000-000000000009' // another org
const EMP_ERIN = '00000000-0000-4000-9000-0000000000e3'

const actor = (memberId: string, name: string, repId = ACME): L.Actor => ({ repId, memberId, name, tz: 'America/New_York' })
const send = (fromId: string, toId: string, body: string, kind = 'message', repId = ACME) => M.sendMemberMessage({ repId, fromId, toId, body, kind })

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  todos.length = events.length = cards.length = modelSaw.length = 0
  modelSays = null
  db.members = [member(OLIVIA, ACME, 'Olivia Hart', 'owner'), member(MONA, ACME, 'Mona Reed', 'manager'), member(ERIN, ACME, 'Erin Vale', 'rep'), member(XAVIER, OTHER, 'Xavier Poe', 'owner')]
  db.cxo_employees = [{ id: EMP_ERIN, rep_id: ACME, member_id: ERIN, active: true }]
  db.cxo_goals = [{ rep_id: ACME, employee_id: 'nobody', title: 'GOAL-SECRET', current: 1, target: 2, status: 'active' }]
  db.cxo_one_on_ones = [{ id: 'oo1', rep_id: ACME, employee_id: EMP_ERIN, manager_member_id: MONA, next_date: '2099-01-01' }]
  db.cxo_one_on_one_items = []
})

describe('anyone can leave a message for anyone in their org', () => {
  it('lets an employee login reach the messages route', () => {
    expect(employeePathAllowed('/api/messages')).toBe(true)
    expect(employeePathAllowed('/api/messagesx')).toBe(false)
    expect(employeePathAllowed('/api/boards')).toBe(false)
  })

  it('employee to owner, owner to employee, employee to a manager who is not theirs', async () => {
    for (const [from, to] of [[ERIN, OLIVIA], [OLIVIA, ERIN], [ERIN, MONA], [MONA, OLIVIA]]) {
      const r = await send(from, to, 'The carrier contract is stuck.')
      expect(r.message.to_member_id).toBe(to)
    }
    expect(db.member_messages).toHaveLength(4)
  })

  it('refuses a person in another org, either way round', async () => {
    await expect(send(ERIN, XAVIER, 'hello')).rejects.toThrow('They are not on your team in Suite CXO.')
    await expect(send(XAVIER, ERIN, 'hello', 'message', OTHER)).rejects.toThrow('They are not on your team in Suite CXO.')
    await expect(send(XAVIER, ERIN, 'hello', 'message', ACME)).rejects.toThrow('They are not on your team in Suite CXO.')
    expect(db.member_messages ?? []).toHaveLength(0)
  })

  it('finds the login behind an employee record only inside the org', async () => {
    expect(await L.memberForEmployee(ACME, EMP_ERIN)).toBe(ERIN)
    expect(await L.memberForEmployee(OTHER, EMP_ERIN)).toBeNull()
    expect(await L.memberForEmployee(ACME, 'not-an-id')).toBeNull()
  })

  it('another org never sees the message or its sorting', async () => {
    await send(ERIN, OLIVIA, 'Can we approve the venue?')
    const theirs = await L.listForMember(OTHER, XAVIER)
    expect(theirs.inbox).toHaveLength(0)
    expect(theirs.sent).toHaveLength(0)
    expect(theirs.members.map((m) => m.id)).not.toContain(OLIVIA)
  })
})

describe('Mira sorts it; nothing happens until the recipient asks', () => {
  it('sorting writes her read of it and nothing else', async () => {
    await send(ERIN, OLIVIA, 'Can we approve the carrier contract renewal? Could we also meet about it and turn it into a project?')
    expect(db.member_message_triage).toHaveLength(1)
    const t = db.member_message_triage[0]
    expect(t.to_member_id).toBe(OLIVIA)
    expect(t.category).toBe('decision')
    expect(String(t.reason)).toContain('Carrier contract renewal')
    expect(t.outcome ?? null).toBeNull()
    // No reply, to-do, agenda item, card or calendar event was made for the recipient.
    expect(db.member_messages).toHaveLength(1)
    expect(db.member_messages[0].read_at).toBeNull()
    expect(todos).toHaveLength(0)
    expect(db.cxo_one_on_one_items).toHaveLength(0)
    expect(cards).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('a request puts no to-do on the recipient at send time; their tap does (owner 10-11)', async () => {
    const { message, todoId } = await send(ERIN, OLIVIA, 'Please update the onboarding deck by Friday', 'request')
    expect(message.kind).toBe('request')
    expect(todoId).toBeNull()
    expect(todos).toHaveLength(0)
    // Mira only suggests the step.
    expect(db.member_message_triage[0].suggestion).toBe('todo')
    // The recipient's own tap is what files it, on their own list.
    await L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: message.id, action: 'todo' })
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ repId: ACME, memberId: OLIVIA })
  })

  it('even when the model proposes a step, the step is only stored as a suggestion', async () => {
    modelSays = '{"category":"time","suggestion":"time","why":"wants to meet"}'
    await send(ERIN, OLIVIA, 'Could we sit down this week?')
    expect(db.member_message_triage[0].suggestion).toBe('time')
    expect(events).toHaveLength(0)
    expect(db.member_messages).toHaveLength(1)
  })

  it('the sender, a bystander and another org cannot act on it', async () => {
    const { message } = await send(ERIN, OLIVIA, 'Can we approve the venue?')
    for (const who of [actor(ERIN, 'Erin Vale'), actor(MONA, 'Mona Reed'), actor(XAVIER, 'Xavier Poe', OTHER), actor(OLIVIA, 'Olivia Hart', OTHER)]) {
      for (const action of ['reply', 'agenda', 'todo', 'card', 'time', 'seen']) {
        await expect(L.actOnMessage(who, { id: message.id, action, body: 'yes', slot: '2099-01-01T15:00:00Z' })).rejects.toMatchObject({ status: 404 })
      }
      await expect(L.slotsFor(who, message.id)).rejects.toBeInstanceOf(LeaveRefused)
    }
    expect(db.member_messages).toHaveLength(1)
    expect(db.member_messages[0].read_at).toBeNull()
    expect(todos).toHaveLength(0)
    expect(cards).toHaveLength(0)
    expect(events).toHaveLength(0)
    expect(db.member_message_triage[0].outcome ?? null).toBeNull()
  })

  it('the recipient taps and that one step runs', async () => {
    const a = await send(ERIN, OLIVIA, 'Can we approve the venue?')
    const r = await L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: a.message.id, action: 'reply', body: 'Yes, go ahead.' })
    expect(r.outcome).toBe('answered')
    expect(db.member_messages.filter((m) => m.replied_to_id === a.message.id)).toHaveLength(1)
    expect(db.member_messages.find((m) => m.id === a.message.id)!.read_at).not.toBeNull()

    const b = await send(ERIN, MONA, 'I would like to talk about my territory.')
    await L.actOnMessage(actor(MONA, 'Mona Reed'), { id: b.message.id, action: 'agenda' })
    expect(db.cxo_one_on_one_items).toHaveLength(1)
    expect(db.cxo_one_on_one_items[0]).toMatchObject({ one_on_one_id: 'oo1', kind: 'agenda', author_member_id: MONA })

    const c = await send(ERIN, OLIVIA, 'Please look at the event budget.')
    await L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: c.message.id, action: 'todo' })
    expect(todos).toEqual([{ repId: ACME, memberId: OLIVIA, text: 'Please look at the event budget.' }])
  })

  it('refuses the agenda step when the two have no 1:1, and a time that is not a real slot', async () => {
    const { message } = await send(ERIN, OLIVIA, 'Could we meet?')
    await expect(L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: message.id, action: 'agenda' })).rejects.toMatchObject({ status: 409 })
    await expect(L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: message.id, action: 'time', slot: 'soon' })).rejects.toBeInstanceOf(LeaveRefused)
    expect(events).toHaveLength(0)
  })
})

describe('the sender sees a plain status and nothing about the recipient', () => {
  it('sent rows carry the status only', async () => {
    const { message } = await send(ERIN, OLIVIA, 'What is the status of the carrier contract renewal?')
    const mine = await L.listForMember(ACME, ERIN)
    expect(mine.inbox).toHaveLength(0)
    expect(mine.sent).toHaveLength(1)
    expect(mine.sent[0].status).toEqual({ key: 'delivered', label: 'Delivered' })
    expect('triage' in mine.sent[0]).toBe(false)
    // Mira's reason and draft were built from the recipient's card; none of it reaches the sender.
    const stored = db.member_message_triage[0]
    expect(String(stored.reason)).toContain('Carrier contract renewal')
    expect(String(stored.draft)).toContain('CARD-BOARD')
    const wire = JSON.stringify(mine)
    for (const secret of ['CARD-BOARD', 'CAL-SECRET', 'BOARD-PREP', 'GOAL-SECRET', 'meetings today', 'About your card', String(stored.reason)]) expect(wire).not.toContain(secret)

    // The recipient does see it.
    const theirs = await L.listForMember(ACME, OLIVIA)
    expect(theirs.inbox[0].triage).toMatchObject({ category: 'answer', suggestion: 'reply' })
    expect(theirs.inbox[0].triage!.draft).toContain('CARD-BOARD')
    expect('rank' in theirs.inbox[0].triage!).toBe(false)

    await L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: message.id, action: 'seen' })
    expect((await L.listForMember(ACME, ERIN)).sent[0].status).toEqual({ key: 'seen', label: 'Seen' })
    await L.actOnMessage(actor(OLIVIA, 'Olivia Hart'), { id: message.id, action: 'card' })
    const after = await L.listForMember(ACME, ERIN)
    expect(after.sent[0].status).toEqual({ key: 'card', label: 'Turned into a project card' })
    expect(JSON.stringify(after)).not.toContain('CARD-BOARD')
  })

  it('senderStatus can only say one of the fixed lines', () => {
    const m = { deliver_at: '2026-10-10T12:00:00Z', read_at: null as string | null }
    const now = Date.parse('2026-10-11T12:00:00Z')
    const allowed = new Set(['Scheduled', 'Delivered', 'Seen', ...Object.values(OUTCOME_WORDS)])
    const seen = [
      senderStatus({ ...m, deliver_at: '2026-10-12T12:00:00Z' }, null, false, now),
      senderStatus(m, null, false, now),
      senderStatus({ ...m, read_at: '2026-10-10T13:00:00Z' }, null, false, now),
      senderStatus(m, null, true, now),
      ...(['answered', 'agenda', 'todo', 'card', 'time_booked'] as const).map((o) => senderStatus(m, o, false, now)),
    ]
    for (const s of seen) expect(allowed.has(s.label)).toBe(true)
    expect(seen.map((s) => s.key)).toEqual(['scheduled', 'delivered', 'seen', 'answered', 'answered', 'agenda', 'todo', 'card', 'time_booked'])
    expect(senderStatus(m, 'agenda', false, now).label).toBe('On the 1:1 agenda')
    expect(senderStatus(m, 'todo', false, now).label).toBe('Turned into a task')
    expect(senderStatus(m, 'time_booked', false, now).label).toBe('Time booked')
  })
})

describe('what the model is given', () => {
  it('strips names, amounts, emails and phone numbers', () => {
    const out = forModel('Can we approve the offer for Dana Whitfield at $85,000 a year? She is at dana@client.test or 555-201-3344, and the Hartwell Agency wants 120k a year.')
    for (const gone of ['Dana', 'Whitfield', '85,000', 'dana@client.test', '555-201-3344', 'Hartwell', '120k']) expect(out).not.toContain(gone)
    expect(out).toContain('approve')
  })

  it('sends the model the redacted message and nothing about the recipient', async () => {
    modelSays = '{"category":"decision","suggestion":"reply","why":"needs sign-off"}'
    await send(ERIN, OLIVIA, 'Can we approve the carrier contract renewal for Dana Whitfield at $85,000?')
    expect(modelSaw).toHaveLength(1)
    for (const gone of ['Dana', '85,000', 'Olivia', 'Erin', 'CARD-BOARD', 'CAL-SECRET', 'GOAL-SECRET', 'BOARD-PREP']) expect(modelSaw[0]).not.toContain(gone)
  })

  it('ignores a model answer that is not one of the fixed categories', () => {
    expect(parseModel('{"category":"urgent","suggestion":"reply"}')).toBeNull()
    expect(parseModel('send everyone an email')).toBeNull()
    expect(parseModel('{"category":"fyi","suggestion":"email_all","why":"x"}')).toEqual({ category: 'fyi', suggestion: null, why: 'x' })
  })
})

describe('sorting rules', () => {
  const ctx = (p: Partial<TriageContext> = {}): TriageContext => ({ ...EMPTY_CONTEXT, senderFirst: 'Erin', ...p })

  it('reads the four kinds without the model', () => {
    expect(classifyHeuristic('Can we go ahead with the venue? I need your sign-off.', 'message')).toBe('decision')
    expect(classifyHeuristic('Could we sit down for 30 min this week?', 'message')).toBe('time')
    expect(classifyHeuristic('What is the status of the playbook?', 'message')).toBe('answer')
    expect(classifyHeuristic('All contracts are filed.', 'message')).toBe('fyi')
    expect(classifyHeuristic('Should we move it?', 'note')).toBe('fyi')
  })

  it('only suggests a step the recipient can take', () => {
    expect(pickSuggestion('time', 'message', ctx())).toBe('reply') // no calendar, no 1:1
    expect(pickSuggestion('time', 'message', ctx({ hasOneOnOne: true, oneOnOneInDays: 4 }))).toBe('agenda')
    expect(pickSuggestion('time', 'message', ctx({ meetingsToday: 0 }))).toBe('time')
    expect(pickSuggestion('answer', 'message', ctx(), 'agenda')).toBe('reply') // model asked for a 1:1 that does not exist
    expect(pickSuggestion('answer', 'message', ctx(), 'time')).toBe('reply') // no calendar connected
    // Tap-only (owner 10-11): a request is not on their list yet, so the to-do is the step.
    expect(pickSuggestion('answer', 'request', ctx(), 'todo')).toBe('todo')
    expect(pickSuggestion('answer', 'request', ctx())).toBe('todo')
    expect(pickSuggestion('decision', 'request', ctx(), 'reply')).toBe('reply')
    expect(pickSuggestion('fyi', 'message', ctx({ meetingsToday: 0 }), 'time')).toBe('none')
  })

  it('puts decisions first and FYIs last, and says why', () => {
    const rows = [
      { id: 'fyi', deliver_at: '2026-10-10T15:00:00Z', triage: buildTriage('All filed.', 'note', ctx()) },
      { id: 'unsorted', deliver_at: '2026-10-10T14:00:00Z', triage: null },
      { id: 'answer', deliver_at: '2026-10-10T13:00:00Z', triage: buildTriage('What is the status?', 'question', ctx()) },
      { id: 'decision', deliver_at: '2026-10-10T12:00:00Z', triage: buildTriage('Need your sign-off.', 'message', ctx()) },
    ]
    expect(sortInbox(rows).map((r) => r.id)).toEqual(['decision', 'answer', 'unsorted', 'fyi'])
    expect(rows[3].triage!.reason).toBe('Erin is waiting on your decision.')
    expect(buildTriage('Quick question?', 'question', ctx({ hasOneOnOne: true, oneOnOneInDays: 1 })).reason).toBe('Erin is waiting on an answer. Your 1:1 with Erin is tomorrow.')
  })
})

describe('no extra noise', () => {
  it('an FYI never raises the badge on its own', async () => {
    await send(ERIN, OLIVIA, 'All 65 contracts are filed.', 'note')
    expect(await L.loudUnread(ACME, OLIVIA)).toEqual({ count: 0, latest: null })
    await send(MONA, OLIVIA, 'Can we approve the venue?')
    const loud = await L.loudUnread(ACME, OLIVIA)
    expect(loud.count).toBe(1)
    expect(loud.latest).toEqual({ from: 'Mona Reed', body: 'Can we approve the venue?' })
    // The FYI is still on the card, below the decision.
    expect((await L.listForMember(ACME, OLIVIA)).inbox.map((m) => m.triage?.category)).toEqual(['decision', 'fyi'])
  })

  it('this channel sends no email, text or push', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('lib/mira/leave.ts', 'utf8') + fs.readFileSync('lib/mira/leaveShared.ts', 'utf8')
    for (const banned of ['sendEmail', 'resend', 'sendSms', 'telnyx', 'web-push', 'sendPush', 'telegram']) expect(src.toLowerCase()).not.toContain(banned.toLowerCase())
  })
})
