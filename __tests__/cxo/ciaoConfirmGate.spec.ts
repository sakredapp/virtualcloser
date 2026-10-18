/**
 * Confirm before write (owner 10-18, Pinnacle release blocker). No model, no
 * network, no DB: the pure rules, the central gate in runToolWithOps, and a
 * full chat turn with the agent and the pending store faked.
 *
 * The promise under test: nothing that writes to Google or reaches another
 * person runs until the person's yes in a LATER message, and the yes runs
 * exactly the stored proposal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in tests') } } }))
// The read-only describer resolves real events; here it just echoes the call.
vi.mock('@/lib/agent/cxoTools', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  describeCxoCall: async (_ctx: unknown, name: string, args: Record<string, unknown>) =>
    name === 'create_calendar_event' || name === 'send_member_message' || name === 'cancel_calendar_event'
      ? { ok: true, lines: [`${name}: ${String(args.title ?? args.body ?? args.event_id ?? '')}`, 'When: Tue, Oct 20, 9:00 to 10:00 AM (America/New York)'], args }
      : null,
}))
vi.mock('@/lib/agent/cxoPeopleTools', async (orig) => ({ ...(await orig<Record<string, unknown>>()), describePeopleCall: async () => null }))

import {
  CONFIRM_GATE_RULES,
  EXPIRED_LINE,
  NOT_DONE_LINE,
  PENDING_TTL_MS,
  decidePending,
  gateApplies,
  isAffirmative,
  isGatedCall,
  isNegative,
  proposalText,
  type PendingAction,
  type PendingRecord,
} from '@/lib/agent/confirmGateShared'
import { runToolWithOps } from '@/lib/ops/agentGate'
import { runChatTurn, type GateStore } from '@/lib/agent/chatTurn'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import type { RunAgentResult } from '@/lib/agent/runAgent'
import type { Tenant } from '@/lib/tenant'
import type { Member } from '@/types'

const tz = 'America/New_York'
const CXO = { id: 'rep-acme', slug: 'acme', display_name: 'Acme', brand: 'cxo', tier: 'enterprise', timezone: tz, settings: {} } as unknown as Tenant
const VC = { ...CXO, id: 'rep-vc', brand: 'virtualcloser' } as unknown as Tenant
const DANA = { id: 'm-dana', rep_id: 'rep-acme', display_name: 'Dana Exec', email: 'dana@acme.test', role: 'owner', timezone: tz } as unknown as Member
const ctxFor = (extra: Partial<AgentContext> = {}): AgentContext => ({ tenant: CXO, caller: DANA, timezone: tz, todayIso: '2026-10-18', ownerMemberId: DANA.id, channel: 'app', ...extra })
const BOOK = { title: 'Q4 Planning Meeting', start: '2026-10-20T09:00', duration_minutes: 60, attendees: ['erin@acme.test'] }

describe('isAffirmative / isNegative', () => {
  it.each(['yes', 'Yes!', 'yep', 'ok', 'Okay, go ahead', 'yes please', 'sounds good', 'do it', 'confirm', 'Book it', 'send it', 'go for it', 'yes go ahead thanks', "let's do it"])('%s is a yes', (t) => {
    expect(isAffirmative(t)).toBe(true)
  })
  it.each(['', 'please', 'thanks', 'it', 'that', 'yes but make it 3pm', 'no', 'cancel it', 'decline it', 'what time is it', 'book a meeting with erin tomorrow at 9', 'yes yes yes yes yes yes yes yes yes'])('%s is not a yes', (t) => {
    expect(isAffirmative(t)).toBe(false)
  })
  it.each(['no', 'Nope', 'cancel', 'cancel that', "don't", 'never mind', 'no thanks', 'hold off', 'forget it'])('%s is a no', (t) => {
    expect(isNegative(t)).toBe(true)
  })
  it.each(['yes', 'please', 'no, move it to 3pm instead of 9am', 'cancel the 9am with erin'])('%s is not a plain no', (t) => {
    expect(isNegative(t)).toBe(false)
  })
})

describe('decidePending', () => {
  const now = Date.parse('2026-10-18T15:00:00Z')
  const row = { conversation_id: 'c1', expires_at: new Date(now + 60_000).toISOString() }
  it('no row: run the turn normally', () => expect(decidePending(null, 'yes', 'c1', now)).toBe('none'))
  it('a yes in time, same conversation: execute', () => expect(decidePending(row, 'yes', 'c1', now)).toBe('execute'))
  it('a yes after the expiry: expired', () => expect(decidePending(row, 'yes', 'c1', now + 120_000)).toBe('expired'))
  it('a yes in another conversation: dropped, never executed', () => expect(decidePending(row, 'yes', 'c2', now)).toBe('drop'))
  it('a no: cancel', () => expect(decidePending(row, 'no', 'c1', now)).toBe('cancel'))
  it('a change or a new question: dropped', () => {
    expect(decidePending(row, 'yes but make it 3pm', 'c1', now)).toBe('drop')
    expect(decidePending(row, 'what is on my calendar tomorrow', 'c1', now)).toBe('drop')
  })
  it('the TTL is short', () => expect(PENDING_TTL_MS).toBeLessThanOrEqual(15 * 60_000))
})

describe('which calls are gated', () => {
  it('Google writes and messages to others are gated', () => {
    for (const t of ['create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner', 'send_partner_message', 'send_member_message', 'decide_approval', 'give_praise']) expect(isGatedCall(t, {})).toBe(true)
  })
  it('own things and drafts are not', () => {
    expect(isGatedCall('add_todo', {})).toBe(false)
    expect(isGatedCall('reply_to_thread', { mode: 'draft' })).toBe(false)
    expect(isGatedCall('reply_to_thread', { mode: 'send' })).toBe(true)
    expect(isGatedCall('leadership_agenda', { action: 'draft' })).toBe(false)
    expect(isGatedCall('leadership_agenda', { action: 'add_to_invite' })).toBe(true)
  })
  it('the gate is the Suite CXO app; Slack keeps its own hold', () => {
    expect(gateApplies({ tenant: CXO, channel: 'app' })).toBe(true)
    expect(gateApplies({ tenant: CXO, channel: 'slack' })).toBe(false)
    expect(gateApplies({ tenant: VC, channel: 'app' })).toBe(false)
  })
  it('the prompt says "book it" still gets a proposal and find-and-book offers slots first', () => {
    const rules = CONFIRM_GATE_RULES.join('\n')
    expect(rules).toMatch(/Book it/)
    expect(rules).toMatch(/propose_choice/)
  })
})

describe('proposalText', () => {
  it('says nothing is done yet and asks for the yes', () => {
    const t = proposalText([{ kind: 'tool', tool: 'create_calendar_event', args: {}, summary: 'Create "Q4"\nWhen: Tue' }])
    expect(t).toMatch(/Nothing is done yet/)
    expect(t).toMatch(/Reply yes to go ahead/)
    expect(t).toContain('Create "Q4"')
  })
  it('numbers several actions', () => {
    const a: PendingAction = { kind: 'tool', tool: 'x', args: {}, summary: 'one' }
    expect(proposalText([a, { ...a, summary: 'two' }])).toMatch(/1\. one[\s\S]*2\. two/)
  })
})

describe('runToolWithOps: the central gate', () => {
  it('never calls the handler for a gated call; a model-set confirmed: true changes nothing', async () => {
    const handler = vi.fn(async (): Promise<ToolHandlerResult> => ({ text: JSON.stringify({ ok: true, readback: 'Booked' }) }))
    const ctx = ctxFor()
    for (const args of [BOOK, { ...BOOK, confirmed: true }]) {
      const out = await runToolWithOps('create_calendar_event', ctx, args, handler)
      const j = JSON.parse(out.text)
      expect(j).toMatchObject({ ok: false, needs_confirmation: true, not_done: true })
      expect(out.finalize).toBe(true)
    }
    expect(handler).not.toHaveBeenCalled()
    expect(ctx.proposals).toHaveLength(2)
    // The stored args never carry the model's confirmed flag.
    expect(ctx.proposals![1]).toMatchObject({ kind: 'tool', tool: 'create_calendar_event' })
    expect((ctx.proposals![1] as { args: Record<string, unknown> }).args.confirmed).toBeUndefined()
  })
  it('runs the handler only on the server replay (userConfirmed)', async () => {
    const handler = vi.fn(async (): Promise<ToolHandlerResult> => ({ text: '{"ok":true}' }))
    await runToolWithOps('create_calendar_event', ctxFor({ userConfirmed: true }), BOOK, handler)
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('own things run straight away', async () => {
    const handler = vi.fn(async (): Promise<ToolHandlerResult> => ({ text: '{"ok":true}' }))
    await runToolWithOps('add_todo', ctxFor(), { body: 'call mom' }, handler)
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('outside Suite CXO the gate does not apply', async () => {
    const handler = vi.fn(async (): Promise<ToolHandlerResult> => ({ text: '{"ok":true}' }))
    await runToolWithOps('create_calendar_event', ctxFor({ tenant: VC }), BOOK, handler)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

// ── A full chat turn: the agent is faked, the pending store is in memory ──

let writes: Array<{ tool: string; args: Record<string, unknown> }>
let rows: PendingRecord[]
let clock: number
let executed: PendingAction[][]

function memoryGate(): GateStore {
  return {
    load: async () => rows[rows.length - 1] ?? null,
    save: async (i) => {
      rows = [{ id: `p${Math.random()}`, conversation_id: i.conversationId, actions: i.actions, proposal: i.proposal, expires_at: new Date(clock + PENDING_TTL_MS).toISOString() }]
      return true
    },
    claim: async (_r, _m, id) => {
      const hit = rows.find((r) => r.id === id) ?? null
      rows = rows.filter((r) => r.id !== id)
      return hit
    },
    clear: async () => {
      rows = []
    },
    // The server replay: each stored action through the same gate, with userConfirmed.
    execute: async ({ actions }) => {
      executed.push(actions)
      const lines: string[] = []
      for (const a of actions) {
        if (a.kind !== 'tool') continue
        const out = await runToolWithOps(a.tool, ctxFor({ userConfirmed: true }), { ...a.args, confirmed: true }, writeHandler(a.tool))
        lines.push(JSON.parse(out.text).readback)
      }
      return lines
    },
  }
}

const writeHandler = (tool: string) => async (_ctx: AgentContext, args: Record<string, unknown>): Promise<ToolHandlerResult> => {
  writes.push({ tool, args })
  return { text: JSON.stringify({ ok: true, readback: `Booked "${String(args.title)}".` }) }
}

/** A model that always tries to write in its first turn, and claims it did. */
function eagerAgent(tool = 'create_calendar_event', args: Record<string, unknown> = BOOK) {
  return vi.fn(async (input: { tenant: Tenant; caller: Member; channel?: string }): Promise<RunAgentResult> => {
    const ctx: AgentContext = { ...ctxFor(), tenant: input.tenant, proposals: [] }
    await runToolWithOps(tool, ctx, { ...args, confirmed: true }, writeHandler(tool))
    return { replyText: 'Done, it is booked!', intentsToExecute: [], ...(ctx.proposals!.length ? { proposals: ctx.proposals } : {}) }
  })
}

const turn = (text: string, run: ReturnType<typeof eagerAgent>, conversationId = 'c1', gate = memoryGate()) =>
  runChatTurn({ tenant: CXO, member: DANA, text, history: [], channel: 'app', conversationId, gate, run: run as never })

beforeEach(() => {
  writes = []
  rows = []
  executed = []
  clock = Date.now()
})

describe('runChatTurn with the gate', () => {
  it('"book it" in the first message: a proposal, no write, and the model\'s "booked" is never shown', async () => {
    const run = eagerAgent()
    const r = await turn('Book a Q4 planning meeting with Erin Tuesday 9am. Book it.', run)
    expect(writes).toHaveLength(0)
    expect(r.reply).toMatch(/Nothing is done yet/)
    expect(r.reply).toContain('Q4 Planning Meeting')
    expect(r.reply).not.toMatch(/it is booked/)
    expect(rows).toHaveLength(1)
    expect(rows[0].conversation_id).toBe('c1')
  })

  it('the yes in the next message runs exactly the stored proposal, once, without the agent', async () => {
    const run = eagerAgent()
    await turn('book it', run)
    expect(writes).toHaveLength(0)
    const r = await turn('yes', run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([{ tool: 'create_calendar_event', args: { ...BOOK, confirmed: true } }])
    expect(r.reply).toBe('Booked "Q4 Planning Meeting".')
    expect(rows).toHaveLength(0)
    // A second yes does not run it again.
    const again = await turn('yes', vi.fn(async () => ({ replyText: 'Nothing pending.', intentsToExecute: [] })) as never)
    expect(writes).toHaveLength(1)
    expect(again.reply).toBe('Nothing pending.')
  })

  it('a no runs nothing and says so', async () => {
    await turn('book it', eagerAgent())
    const r = await turn('no', eagerAgent())
    expect(writes).toHaveLength(0)
    expect(executed).toHaveLength(0)
    expect(r.reply).toBe(NOT_DONE_LINE)
    expect(rows).toHaveLength(0)
  })

  it('anything else drops the proposal and runs a normal turn (which proposes again, never writes)', async () => {
    await turn('book it', eagerAgent())
    const second = eagerAgent('create_calendar_event', { ...BOOK, start: '2026-10-20T15:00' })
    const r = await turn('yes but make it 3pm', second)
    expect(second).toHaveBeenCalledTimes(1)
    expect(executed).toHaveLength(0)
    expect(writes).toHaveLength(0)
    expect(r.reply).toMatch(/Nothing is done yet/)
    expect((rows[0].actions[0] as unknown as { args: { start: string } }).args.start).toBe('2026-10-20T15:00')
  })

  it('a yes after the expiry runs nothing', async () => {
    await turn('book it', eagerAgent())
    rows[0].expires_at = new Date(Date.now() - 1000).toISOString()
    const r = await turn('yes', eagerAgent())
    expect(writes).toHaveLength(0)
    expect(executed).toHaveLength(0)
    expect(r.reply).toBe(EXPIRED_LINE)
  })

  it('a yes in a different conversation runs nothing', async () => {
    await turn('book it', eagerAgent(), 'c1')
    const run = eagerAgent('add_todo', { body: 'x' })
    await turn('yes', run, 'c2')
    expect(executed).toHaveLength(0)
    expect(writes.filter((w) => w.tool === 'create_calendar_event')).toHaveLength(0)
  })

  it('a message to a coworker is proposed, not sent', async () => {
    const r = await turn('tell erin the deck is late, send it', eagerAgent('send_member_message', { to: 'erin', body: 'The deck is late' }))
    expect(writes).toHaveLength(0)
    expect(r.reply).toMatch(/send_member_message: The deck is late/)
  })

  it('if the proposal cannot be stored, nothing runs and the reply says so', async () => {
    const gate = { ...memoryGate(), save: async () => false }
    const r = await turn('book it', eagerAgent(), 'c1', gate)
    expect(writes).toHaveLength(0)
    expect(r.reply).toMatch(/did not do it/)
  })
})
