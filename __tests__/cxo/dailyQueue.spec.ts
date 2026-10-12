/**
 * Run daily queue (owner 10-11). These pin the rules of the run:
 *   - a run on its own only does what is internal and reversible: to-dos on
 *     the caller's own list, sorting, drafts, briefs, proposed talking points;
 *   - nothing is sent, booked or put in front of anyone else until the
 *     person's own tap (approveQueueItem), once per item;
 *   - a second run the same day makes no second to-do, draft or brief and
 *     reports only what is new;
 *   - a run only touches the caller's own items, and another person or
 *     another company can never see, approve or dismiss them;
 *   - an assistant cannot run someone else's queue;
 *   - the model is called at most MAX_MODEL_CALLS times and is given text
 *     with names, amounts, emails and phones removed;
 *   - until the tables exist the run still works and stores nothing.
 * Everything is mocked: no database, no Google, no model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const gone = new Set<string>()
let idSeq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`

const acts: Array<{ memberId: string; repId: string; id: string; action: string; body?: unknown }> = []
const todos: Array<{ repId: string; memberId: string; body: string; key: string }> = []
const sends: string[] = []
const agenda: Array<{ employee_id: string; body: string }> = []
const modelSaw: string[] = []
const usage: string[] = []
let modelCalls = 0
let scanned = 0
let hub: unknown = { ready: false, people: [] }
let meetings: unknown[] = []
let threads: Array<{ id: string; subject: string; needs_reply: boolean; draft?: { id: string; subject: string; body: string } }> = []
const scopes: unknown[] = []

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  let payload: Row | null = null
  let lim = Infinity
  let single = false
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (gone.has(table)) return { data: null, error: { code: '42P01', message: 'missing' } }
    if (op === 'insert') {
      if (table === 'cxo_daily_queue_items' && rows().some((r) => r.rep_id === payload!.rep_id && r.member_id === payload!.member_id && r.source_key === payload!.source_key)) {
        return { data: null, error: { code: '23505', message: 'duplicate' } }
      }
      const row = { id: uuid(), created_at: new Date().toISOString(), status: 'open', read_at: null, ...payload! }
      rows().push(row)
      return { data: single ? row : [row], error: null }
    }
    if (op === 'upsert') {
      const old = rows().find((r) => r.message_id === payload!.message_id)
      if (old) Object.assign(old, payload)
      else rows().push({ ...payload! })
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
    in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return b },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b },
    lte: () => b,
    gte: () => b,
    or: () => b,
    order: () => b,
    limit: (n: number) => { lim = n; return b },
    maybeSingle: () => { single = true; return b },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))
vi.mock('@/lib/ai', () => ({
  hasAIKey: () => true,
  getAI: () => ({
    messages: {
      create: async (req: { system: string; messages: Array<{ content: string }> }) => {
        modelCalls++
        modelSaw.push(req.messages[0].content)
        const text = req.system.includes('"replies"')
          ? '{"replies":[{"i":0,"reply":"Yes, I will confirm by Thursday."},{"i":1,"reply":"I will come back to you on that."}]}'
          : req.system.includes('"points"')
            ? '{"points":[{"i":0,"points":["Review the renewals goal","Close the open onboarding item"]}]}'
            : '{"items":[]}'
        return { content: [{ type: 'text', text }], usage: { input_tokens: 400, output_tokens: 100 } }
      },
    },
  }),
}))
vi.mock('@/lib/aiProvider', () => ({ textModelId: () => 'test-model', estimateCostUsd: (_m: unknown, i: number, o: number) => (i * 1.2 + o * 3.2) / 1e6 }))
vi.mock('@/lib/employees/access', () => ({ isEmployeeOnlyMember: () => false }))
vi.mock('@/lib/cxoUsage', () => ({ recordUsage: async (_c: unknown, k: string) => { usage.push(k) } }))
vi.mock('@/lib/memberMessages', () => ({
  orgMembers: async (repId: string) => (db.members ?? []).filter((m) => m.rep_id === repId).map((m) => ({ id: m.id, display_name: m.display_name, email: null, timezone: null })),
  firstName: (m: { display_name?: string | null } | undefined) => String(m?.display_name ?? 'Someone').split(' ')[0],
}))
vi.mock('@/lib/today', () => ({
  listTodos: async () => [],
  todaysMeetings: async () => meetings,
  addTodo: async (repId: string, memberId: string, body: string, o: { source_key: string }) => {
    if (todos.some((t) => t.key === o.source_key)) throw Object.assign(new Error('dup'), { code: '23505' })
    todos.push({ repId, memberId, body, key: o.source_key })
    return { id: `t${todos.length}` }
  },
}))
vi.mock('@/lib/boards', () => ({ cardsAssignedTo: async () => [] }))
vi.mock('@/lib/mira/leave', () => ({
  triageMissing: () => false,
  memberForEmployee: async () => null,
  gatherContext: async () => { throw new Error('no context in tests') },
  // The real one reads only what was left for this person in this org.
  listForMember: async (repId: string, memberId: string) => ({
    inbox: (db.member_messages ?? [])
      .filter((m) => m.rep_id === repId && m.to_member_id === memberId && !m.read_at)
      .map((m) => {
        const t = (db.member_message_triage ?? []).find((x) => x.message_id === m.id)
        return { ...m, replied_to_id: null, from_name: m.from_name, triage: t ? { category: t.category, reason: t.reason, suggestion: t.suggestion, draft: t.draft ?? null } : null }
      }),
    sent: [],
    members: [],
  }),
  actOnMessage: async (who: { repId: string; memberId: string }, input: { id: string; action: string; body?: unknown }) => {
    const msg = (db.member_messages ?? []).find((m) => m.id === input.id && m.rep_id === who.repId && m.to_member_id === who.memberId)
    if (!msg) throw Object.assign(new Error('Message not found.'), { status: 404 })
    acts.push({ ...who, ...input })
    if (input.action === 'todo') {
      const key = `message:${msg.id}`
      if (!todos.some((t) => t.key === key)) todos.push({ repId: who.repId, memberId: who.memberId, body: String(msg.body), key })
      return { note: 'On your to-do list.', outcome: 'todo' }
    }
    if (input.action === 'reply') {
      sends.push(`reply:${msg.id}:${String(input.body)}`)
      msg.read_at = new Date().toISOString()
      return { note: 'Reply sent.', outcome: 'replied' }
    }
    return { note: 'ok', outcome: null }
  },
}))
vi.mock('@/lib/meetingLoop', () => ({
  loopInbox: async () => ({ followups: [] }),
  scanMeetingNotes: async () => { scanned++; return { scanned: 0, added: 0, pending: 0 } },
  patchDigest: async () => {},
}))
vi.mock('@/lib/email/mailboxAccess', () => ({
  getMailboxScopeById: async (_rep: string, memberId: string) => ({ mailboxes: [{ kind: 'workspace', memberId: null }, { kind: 'own', memberId }] }),
}))
vi.mock('@/lib/email/inbox', () => ({
  listMailboxThreads: async (_s: unknown, box: { kind: string }) => {
    if (box.kind !== 'own') throw new Error('the run read a mailbox that is not the caller\'s own')
    return { threads, draftByThread: new Map(threads.filter((t) => t.draft).map((t) => [t.id, t.draft!])) }
  },
  approveDraft: async (scope: unknown, threadId: string, draftId: string) => { scopes.push(scope); sends.push(`email:${threadId}:${draftId}`); return { ok: true } },
}))
vi.mock('@/lib/people/data', () => ({
  loadPeopleHub: async () => hub,
  viewerFor: async () => ({}),
  runPeopleAction: async (_c: unknown, a: { employee_id: string; body: string }) => { agenda.push({ employee_id: a.employee_id, body: a.body }) },
}))
vi.mock('@/lib/partners', () => ({ getPartner: async () => null, createPartnerDraft: async () => ({ id: 'a1' }), getPartnerAction: async () => null, sendPartnerDraft: async () => { sends.push('partner'); return { outcome: { sent: true } } } }))
vi.mock('@/lib/todayMira', () => ({ writeEmail: async () => ({ subject: 's', body: 'b' }) }))
vi.mock('@/lib/dueReminders', () => ({ runDueReminders: async () => ({ planned: 0, written: 0 }) }))

import { approveQueueItem, dismissQueueItem, pendingForClaude, ranToday, runDailyQueue, saveFromClaude, todayReport, QueueRefused, type QueueCtx } from '@/lib/mira/dailyQueue'
import { MAX_MODEL_CALLS, NOTHING_LINE, QUEUE_COMMAND, isRunQueueText, needsTap, reportIsEmpty, summaryLine, dueList, onlyNew, seenKeys, DEMO_QUEUE } from '@/lib/mira/dailyQueueShared'

const ORG = 'org-a'
const OTHER_ORG = 'org-b'
const person = (id: string, name: string, rep = ORG, extra: Row = {}): QueueCtx =>
  ({ tenant: { id: rep, brand: 'cxo', timezone: 'America/New_York', display_name: 'Acme', company: 'Acme' }, member: { id, rep_id: rep, display_name: name, email: `${name.toLowerCase()}@example.com`, role: 'admin', timezone: 'America/New_York', ...extra } }) as unknown as QueueCtx
const DANA = person('11111111-1111-4111-8111-111111111111', 'Dana')
const MARCUS = person('22222222-2222-4222-8222-222222222222', 'Marcus')
const OUTSIDER = person('33333333-3333-4333-8333-333333333333', 'Olive', OTHER_ORG)

function leave(to: QueueCtx, from: QueueCtx, kind: string, body: string, triage?: { category: string; suggestion: string }) {
  const id = uuid()
  ;(db.member_messages ??= []).push({ id, rep_id: to.tenant.id, to_member_id: to.member.id, from_member_id: from.member.id, from_name: from.member.display_name, kind, body, read_at: null })
  if (triage) (db.member_message_triage ??= []).push({ message_id: id, rep_id: to.tenant.id, to_member_id: to.member.id, reason: '', rank: 1, draft: null, ...triage })
  return id
}
const items = (ctx: QueueCtx) => (db.cxo_daily_queue_items ?? []).filter((r) => r.rep_id === ctx.tenant.id && r.member_id === ctx.member.id)

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  gone.clear()
  for (const a of [acts, todos, sends, agenda, modelSaw, usage, scopes]) a.length = 0
  modelCalls = 0
  scanned = 0
  hub = { ready: false, people: [] }
  meetings = []
  threads = []
  db.members = [DANA, MARCUS].map((c) => ({ id: c.member.id, rep_id: ORG, display_name: c.member.display_name }))
})

/** A full day for Dana: a request, a question, a 1:1 tomorrow, a meeting and a drafted email. */
function fullDay() {
  const request = leave(DANA, MARCUS, 'request', 'Please sign off on the hiring plan by Friday', { category: 'answer', suggestion: 'todo' })
  const question = leave(DANA, MARCUS, 'message', 'Can you confirm the carrier call on Thursday?', { category: 'answer', suggestion: 'reply' })
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  hub = {
    ready: true,
    people: [{ id: 'emp-marcus', name: 'Marcus Lee', is_self: false, goals: [{ id: 'g1', source: 'goal', title: 'Renewals', att: 0.4, status: 'behind', unit: 'count', current: 4, target: 10 }], one_on_one: { id: 'oo-1', manager_member_id: DANA.member.id, manager_name: 'Dana', next_date: tomorrow, overdue: false, items: [{ kind: 'action', body: 'Finish onboarding', done_at: null }, { kind: 'feedback', body: 'PRIVATE FEEDBACK', done_at: null }] } }],
  }
  meetings = [{ id: 'ev1', title: 'Carrier review', start: new Date(Date.now() + 3_600_000).toISOString(), end: '', allDay: false, attendees: [{ email: 'pat@example.com', name: 'Pat' }] }]
  threads = [{ id: 'th1', subject: 'Renewal terms', needs_reply: true, draft: { id: 'dr1', subject: 'Re: Renewal terms', body: 'Thanks, that works.' } }, { id: 'th2', subject: 'Other', needs_reply: true }]
  return { request, question }
}

describe('what a run does on its own', () => {
  it('files the request, drafts the reply, proposes talking points and writes a brief; sends nothing', async () => {
    const { request, question } = fullDay()
    const r = await runDailyQueue(DANA)

    // The request became a to-do on Dana's own list: the run is her tap.
    expect(todos).toEqual([{ repId: ORG, memberId: DANA.member.id, body: 'Please sign off on the hiring plan by Friday', key: `message:${request}` }])
    // Nothing left her hands.
    expect(sends).toEqual([])
    expect(agenda).toEqual([])
    expect(acts.filter((a) => a.action !== 'todo')).toEqual([])

    const kinds = items(DANA).map((i) => i.kind).sort()
    expect(kinds).toEqual(['brief', 'inbox_draft', 'reply_draft', 'talking_points'])
    // Everything that would send or reach someone else waits for a tap; the brief does not.
    for (const i of items(DANA)) expect(i.needs_tap).toBe(i.kind !== 'brief')
    expect(r.needs.map((n) => n.kind).sort()).toEqual(['inbox_draft', 'reply_draft', 'talking_points'])
    expect(r.needs.find((n) => n.kind === 'reply_draft')?.body).toBe('Yes, I will confirm by Thursday.')
    expect(items(DANA).find((i) => i.kind === 'reply_draft')?.payload).toEqual({ message_id: question })
    expect(r.done.map((s) => s.key)).toEqual(expect.arrayContaining(['todos', 'reply_drafts', 'talking_points', 'briefs', 'due']))
    expect(usage).toEqual(['act:daily_queue_run'])
  })

  it('never reads private feedback, and gives the model no names, amounts, emails or phones', async () => {
    fullDay()
    leave(DANA, MARCUS, 'message', 'Did John Smith pay the $5,000? Call me on 555-201-3344 or j.smith@example.com', { category: 'answer', suggestion: 'reply' })
    await runDailyQueue(DANA)
    const seen = modelSaw.join('\n')
    expect(seen).not.toMatch(/PRIVATE FEEDBACK/)
    expect(seen).not.toMatch(/5,000|555-201-3344|j\.smith@example\.com|John Smith/)
    expect(seen).not.toMatch(/Thanks, that works/) // own-inbox email text never goes to the model
  })

  it('stays inside the model cap and logs the cost on the run', async () => {
    fullDay()
    const r = await runDailyQueue(DANA)
    expect(modelCalls).toBeLessThanOrEqual(MAX_MODEL_CALLS)
    expect(r.modelCalls).toBe(modelCalls)
    expect(modelCalls).toBe(2) // one batched call for replies, one for talking points
    const run = db.cxo_daily_queue_runs[0]
    expect(run).toMatchObject({ rep_id: ORG, member_id: DANA.member.id, via: 'app', model_calls: 2 })
    expect(Number(run.est_cost_usd)).toBeGreaterThan(0)
    expect(Number(run.est_cost_usd)).toBeLessThan(0.05)
  })

  it('says one line when nothing is pending', async () => {
    const r = await runDailyQueue(DANA)
    expect(reportIsEmpty(r)).toBe(true)
    expect(summaryLine(r)).toBe(NOTHING_LINE)
    expect(modelCalls).toBe(0)
    expect(await ranToday(DANA)).toBe(true)
  })
})

describe('a second run the same day', () => {
  it('makes no second to-do, draft, brief or talking points and reports nothing new', async () => {
    fullDay()
    await runDailyQueue(DANA)
    const before = { items: items(DANA).length, todos: todos.length, calls: modelCalls }
    const again = await runDailyQueue(DANA)
    expect(items(DANA).length).toBe(before.items)
    expect(todos.length).toBe(before.todos)
    expect(modelCalls).toBe(before.calls) // nothing left to word
    expect(again.done).toEqual([])
    expect(again.needs.length).toBe(3) // still waiting on her
    expect(sends).toEqual([])
  })

  it('picks up only what arrived since', async () => {
    fullDay()
    await runDailyQueue(DANA)
    leave(DANA, MARCUS, 'message', 'One more: are we still on for the review?', { category: 'answer', suggestion: 'reply' })
    const again = await runDailyQueue(DANA)
    expect(again.done.map((s) => s.key)).toEqual(['reply_drafts'])
    expect(again.done[0].lines).toHaveLength(1)
    expect(items(DANA).filter((i) => i.kind === 'reply_draft')).toHaveLength(2)
    // Today shows the whole day folded together.
    const day = await todayReport(DANA)
    expect(day?.done.find((s) => s.key === 'reply_drafts')?.lines).toHaveLength(2)
  })
})

describe('nothing goes out without the tap', () => {
  it('the tap sends that one reply, once', async () => {
    const { question } = fullDay()
    const r = await runDailyQueue(DANA)
    const reply = r.needs.find((n) => n.kind === 'reply_draft')!
    expect(sends).toEqual([])
    await approveQueueItem(DANA, reply.id, { body: 'Yes. Thursday at 2.' })
    expect(sends).toEqual([`reply:${question}:Yes. Thursday at 2.`])
    await expect(approveQueueItem(DANA, reply.id)).rejects.toMatchObject({ status: 404 })
    expect(sends).toHaveLength(1)
  })

  it('talking points reach the shared agenda only on the tap', async () => {
    fullDay()
    const r = await runDailyQueue(DANA)
    expect(agenda).toEqual([])
    await approveQueueItem(DANA, r.needs.find((n) => n.kind === 'talking_points')!.id)
    expect(agenda.map((a) => a.body)).toEqual(['Review the renewals goal', 'Close the open onboarding item'])
  })

  it('an inbox reply is sent from the caller\'s own mailbox only', async () => {
    fullDay()
    const r = await runDailyQueue(DANA)
    await approveQueueItem(DANA, r.needs.find((n) => n.kind === 'inbox_draft')!.id)
    expect(sends).toEqual(['email:th1:dr1'])
    expect(scopes).toEqual([{ mailboxes: [{ kind: 'own', memberId: DANA.member.id }] }])
  })

  it('a brief has nothing to approve, and a dismissed item is gone', async () => {
    fullDay()
    const r = await runDailyQueue(DANA)
    const brief = items(DANA).find((i) => i.kind === 'brief')!
    await expect(approveQueueItem(DANA, String(brief.id))).rejects.toMatchObject({ status: 400 })
    const reply = r.needs.find((n) => n.kind === 'reply_draft')!
    await dismissQueueItem(DANA, reply.id)
    await expect(approveQueueItem(DANA, reply.id)).rejects.toMatchObject({ status: 404 })
    expect(sends).toEqual([])
  })

  it('needsTap is false for a brief only', () => {
    expect((['reply_draft', 'email_draft', 'inbox_draft', 'talking_points', 'brief'] as const).map(needsTap)).toEqual([true, true, true, true, false])
  })
})

describe('a run only touches the caller\'s own items', () => {
  it('leaves a coworker\'s messages, to-dos and drafts alone', async () => {
    fullDay()
    const theirs = leave(MARCUS, DANA, 'request', 'Send me the Q4 plan', { category: 'answer', suggestion: 'todo' })
    await runDailyQueue(DANA)
    expect(acts.every((a) => a.memberId === DANA.member.id && a.id !== theirs)).toBe(true)
    expect(todos.every((t) => t.memberId === DANA.member.id)).toBe(true)
    expect(items(MARCUS)).toEqual([])
    expect((db.cxo_daily_queue_items ?? []).every((i) => i.member_id === DANA.member.id && i.rep_id === ORG)).toBe(true)
    expect((db.cxo_daily_queue_runs ?? []).every((i) => i.member_id === DANA.member.id)).toBe(true)
  })

  it('a coworker cannot see, approve or dismiss her items', async () => {
    fullDay()
    const r = await runDailyQueue(DANA)
    const id = r.needs[0].id
    await expect(approveQueueItem(MARCUS, id)).rejects.toBeInstanceOf(QueueRefused)
    await expect(approveQueueItem(MARCUS, id)).rejects.toMatchObject({ status: 404 })
    await expect(dismissQueueItem(MARCUS, id)).rejects.toMatchObject({ status: 404 })
    expect(await todayReport(MARCUS)).toBeNull()
    expect(await ranToday(MARCUS)).toBe(false)
    expect(sends).toEqual([])
    expect(items(DANA).every((i) => i.status === 'open')).toBe(true)
  })

  it('another company is refused the same way', async () => {
    fullDay()
    const r = await runDailyQueue(DANA)
    for (const n of r.needs) await expect(approveQueueItem(OUTSIDER, n.id)).rejects.toMatchObject({ status: 404 })
    // Same member id, different company: still nothing.
    const spoof = person(DANA.member.id, 'Dana', OTHER_ORG)
    await expect(approveQueueItem(spoof, r.needs[0].id)).rejects.toMatchObject({ status: 404 })
    expect(await todayReport(spoof)).toBeNull()
    // Their own run (their own empty day) never surfaces her items.
    hub = { ready: false, people: [] }
    meetings = []
    threads = []
    const mine = new Set(items(DANA).map((i) => i.id))
    const out = await runDailyQueue(OUTSIDER)
    expect(out.needs.filter((n) => mine.has(n.id))).toEqual([])
    expect(out.needs).toEqual([])
    expect(reportIsEmpty(out)).toBe(true)
    expect(sends).toEqual([])
  })

  it('an assistant cannot run or approve someone else\'s queue', async () => {
    const asAssistant = person(DANA.member.id, 'Dana', ORG, { acting_assistant: { id: 'x', display_name: 'Ali' } })
    await expect(runDailyQueue(asAssistant)).rejects.toMatchObject({ status: 403 })
    await expect(approveQueueItem(asAssistant, uuid())).rejects.toMatchObject({ status: 403 })
    await expect(runDailyQueue(person('44444444-4444-4444-8444-444444444444', 'Ali', ORG, { role: 'assistant' }))).rejects.toMatchObject({ status: 403 })
    expect(await todayReport(asAssistant)).toBeNull()
  })
})

describe('a connected Claude', () => {
  it('gets the pending items scrubbed, with head counts instead of guest lists', async () => {
    fullDay()
    leave(DANA, MARCUS, 'message', 'Did John Smith pay the $5,000?')
    const p = await pendingForClaude(DANA)
    const text = JSON.stringify(p)
    expect(text).not.toMatch(/John Smith|5,000|PRIVATE FEEDBACK|Thanks, that works|pat@example\.com|"Pat"/)
    expect(p.meetings[0]).toMatchObject({ meeting_id: 'ev1', people: 1, has_brief: false })
    expect(p.inbox).toEqual({ drafts_waiting: 1, need_a_reply: 1 })
    expect(modelCalls).toBe(0) // no model call on our side
  })

  it('can save drafts, to-dos and talking points, and none of it is sent', async () => {
    const { question } = fullDay()
    expect(await saveFromClaude(DANA, { kind: 'reply_draft', message_id: question, body: 'On it.' })).toMatchObject({ saved: true, item_needs_approval: true })
    expect(await saveFromClaude(DANA, { kind: 'reply_draft', message_id: question, body: 'On it again.' })).toMatchObject({ saved: false })
    expect(await saveFromClaude(DANA, { kind: 'talking_points', one_on_one_id: 'oo-1', points: ['Renewals pace'] })).toMatchObject({ saved: true, item_needs_approval: true })
    expect(await saveFromClaude(DANA, { kind: 'todo', body: 'Chase the contract' })).toMatchObject({ saved: true })
    expect(await saveFromClaude(DANA, { kind: 'todo', body: 'Chase the contract' })).toMatchObject({ saved: false })
    expect(todos.map((t) => t.memberId)).toEqual([DANA.member.id])
    expect(sends).toEqual([])
    expect(agenda).toEqual([])
    expect(items(DANA).every((i) => i.via === 'mcp' && i.status === 'open')).toBe(true)
    // The app run afterwards does not draft the same reply a second time.
    await runDailyQueue(DANA)
    expect(items(DANA).filter((i) => i.kind === 'reply_draft')).toHaveLength(1)
    expect(items(DANA).filter((i) => i.kind === 'talking_points')).toHaveLength(1)
  })

  it('cannot draft against a message or a 1:1 that is not the caller\'s', async () => {
    fullDay()
    const theirs = leave(MARCUS, DANA, 'message', 'For Marcus only')
    await expect(saveFromClaude(DANA, { kind: 'reply_draft', message_id: theirs, body: 'x' })).rejects.toMatchObject({ status: 404 })
    await expect(saveFromClaude(OUTSIDER, { kind: 'talking_points', one_on_one_id: 'oo-1', points: ['x'] })).rejects.toMatchObject({ status: 404 })
    await expect(saveFromClaude(DANA, { kind: 'todo', message_id: theirs })).rejects.toMatchObject({ status: 404 })
    expect(todos).toEqual([])
  })
})

describe('before the tables exist', () => {
  it('still files the request, stores nothing and says so', async () => {
    fullDay()
    gone.add('cxo_daily_queue_items')
    gone.add('cxo_daily_queue_runs')
    const r = await runDailyQueue(DANA)
    expect(todos).toHaveLength(1)
    expect(r.needs).toEqual([])
    expect(r.note).toMatch(/still being switched on/)
    expect(sends).toEqual([])
    expect(await ranToday(DANA)).toBe(false)
    expect(await todayReport(DANA)).toBeNull()
  })
})

describe('the pure helpers', () => {
  it('reads the command the bar sends, and nothing looser', () => {
    expect(isRunQueueText(QUEUE_COMMAND)).toBe(true)
    expect(isRunQueueText('  run daily queue. ')).toBe(true)
    expect(isRunQueueText('run my daily queue')).toBe(true)
    expect(isRunQueueText('what is in my daily queue?')).toBe(false)
    expect(isRunQueueText('do not run daily queue yet, first tell me about revenue')).toBe(false)
  })

  it('puts stale items first and names how late they are', () => {
    const list = dueList(
      [
        { kind: 'todo', id: 'a', title: 'Due today', due_date: '2026-10-11' },
        { kind: 'todo', id: 'b', title: 'Two weeks late', due_date: '2026-09-27' },
        { kind: 'card', id: 'c', title: 'Next month', due_date: '2026-11-20' },
        { kind: 'todo', id: 'd', title: 'Yesterday', due_date: '2026-10-10' },
      ],
      '2026-10-11',
    )
    expect(list.map((d) => d.id)).toEqual(['b', 'd', 'a'])
    expect(list[0].stale).toBe(true)
  })

  it('onlyNew drops what an earlier run already reported', () => {
    const first = [{ key: 'due' as const, lines: [{ key: 'todo:1', text: 'a' }] }]
    const second = [{ key: 'due' as const, lines: [{ key: 'todo:1', text: 'a' }, { key: 'todo:2', text: 'b' }] }]
    expect(onlyNew(second, seenKeys([{ done: first }]))).toEqual([{ key: 'due', lines: [{ key: 'todo:2', text: 'b' }] }])
    expect(onlyNew(first, seenKeys([{ done: first }]))).toEqual([])
  })

  it('the demo report is invented data in the real shape', () => {
    expect(DEMO_QUEUE.needs.length).toBeGreaterThan(0)
    expect(DEMO_QUEUE.done.every((s) => s.lines.length > 0)).toBe(true)
    expect(DEMO_QUEUE.modelCalls).toBeLessThanOrEqual(MAX_MODEL_CALLS)
  })
})
