/**
 * One Ciao chat turn for a signed-in member: runAgent, then the agent's write
 * intents through the Mira dispatcher, exactly as the in-app chat does.
 * Used by the in-app chat (app/api/mira/ask) and Ciao in Slack
 * (lib/slack/handle), so role visibility, the employee allow-list
 * (lib/agent/access) and the approvals hold are the same everywhere.
 *
 * It does not store the turn: each caller keeps its own history (agent_history
 * in the app, cxo_slack_threads in Slack).
 */
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { runAgent, type AgentHistoryEntry, type RunAgentResult } from '@/lib/agent/runAgent'
import type { AgentChannel, ProposedChoice } from '@/lib/agent/tools'
import { isEmployeeCaller } from '@/lib/agent/access'
import { SLACK_HELD_INTENT_KINDS, SLACK_INTENT_HELD_LINE } from '@/lib/ops/approvalsShared'
import { EXPIRED_LINE, GATED_INTENT_KINDS, NOT_DONE_LINE, decidePending, gateApplies, intentSummary, proposalText, type PendingAction } from '@/lib/agent/confirmGateShared'
import { fmtInTz } from '@/lib/cxoCalendar'

export const FRIENDLY_ERRORS: Record<string, string> = {
  no_api_key: "I'm not switched on for this workspace yet. Ask your admin to add the AI key and I'll be right here.",
  quota_exceeded: "You've hit today's limit on questions for me. I'll be back tomorrow, or your admin can raise it.",
  timeout: 'That one took longer than I allow myself. Ask it again, or break it into smaller steps.',
  api_error: "Couldn't reach my brain just now. Give it a few seconds and ask again.",
}

export type ChatTurnResult = {
  reply: string
  choice?: ProposedChoice
  error?: RunAgentResult['error']
  listedItems?: Array<{ id: string; content: string }>
  /** Approval rows this turn put on hold (Slack: they wait for a yes in the app). */
  held: string[]
}

export async function runChatTurn(input: {
  tenant: Tenant
  member: Member
  text: string
  history: AgentHistoryEntry[]
  /** The running summary of this chat's older messages (lib/agent/chatMemory). */
  conversationSummary?: string | null
  channel?: AgentChannel
  /** The chat this turn belongs to (app): a pending proposal only counts in the conversation it was made in. */
  conversationId?: string | null
  /** Tests: the confirm-gate store. Default lib/agent/confirmGate. */
  gate?: GateStore
  /** Tests: the agent. Default runAgent. */
  run?: typeof runAgent
}): Promise<ChatTurnResult & { raw: RunAgentResult }> {
  const { tenant, member, text, history } = input
  const channel = input.channel ?? 'app'
  const gated = gateApplies({ tenant, channel })
  const gate = gated ? input.gate ?? (await defaultGate()) : null
  const conversationId = input.conversationId ?? null
  const plain = (reply: string): ChatTurnResult & { raw: RunAgentResult } => ({ reply, held: [], raw: { replyText: reply, intentsToExecute: [] } })

  // Confirm before write: is this the yes (or no) to a proposal waiting for them?
  if (gate) {
    const pending = await gate.load(tenant.id, member.id)
    const decision = decidePending(pending, text, conversationId, Date.now())
    if (pending && decision === 'execute') {
      const claimed = await gate.claim(tenant.id, member.id, pending.id)
      if (!claimed) return plain('That one was already handled. Nothing else was done.')
      const lines = await gate.execute({ tenant, member, actions: claimed.actions, text })
      return plain(lines.join('\n') || 'Done.')
    }
    if (pending && decision !== 'none') await gate.clear(tenant.id, member.id)
    if (decision === 'expired') return plain(EXPIRED_LINE)
    if (decision === 'cancel') return plain(NOT_DONE_LINE)
  }

  const result = await (input.run ?? runAgent)({
    tenant,
    caller: member,
    text,
    history,
    channel,
    ...(input.conversationSummary ? { conversationSummary: input.conversationSummary } : {}),
  })
  const held = result.heldApprovals ?? []

  // Confirm before write: the dispatcher's own writes (book, move, cancel, email, hand off) wait for the yes too.
  const proposals: PendingAction[] = [...(result.proposals ?? [])]
  let agentIntents = result.intentsToExecute
  if (gate && !result.error && !isEmployeeCaller(member, tenant)) {
    const tz = member.timezone || tenant.timezone || 'America/New_York'
    for (const i of agentIntents) {
      const kind = String((i as { kind?: string }).kind)
      if (GATED_INTENT_KINDS.has(kind)) proposals.push({ kind: 'intent', intent: i as unknown as Record<string, unknown>, summary: intentSummary(i as unknown as Record<string, unknown>, (iso) => fmtInTz(iso, tz)) })
    }
    agentIntents = agentIntents.filter((i) => !GATED_INTENT_KINDS.has(String((i as { kind?: string }).kind)))
  }
  if (gate && proposals.length && !result.error) {
    const proposal = proposalText(proposals)
    const saved = await gate.save({ repId: tenant.id, memberId: member.id, conversationId, actions: proposals, proposal })
    if (!saved) return { ...plain("I couldn't set that up for your yes just now, so I did not do it. Nothing was changed or sent. Ask me again in a moment."), raw: result }
    result.intentsToExecute = agentIntents
    // The reply is now the server's proposal, not the checked model answer.
    if (result.answerCheck) result.answerCheck = { checked: false, revised: false, reason: 'skipped' }
    // Internal intents (their own to-dos, notes) still run now; the proposal follows.
    const own = isEmployeeCaller(member, tenant) ? [] : await runIntents(agentIntents, tenant, member, text, '')
    return { reply: [...own, proposal].join('\n\n'), held, raw: result }
  }
  result.intentsToExecute = agentIntents

  // A choice: show the prompt and the chips, run nothing yet.
  if (result.choice) return { reply: result.choice.prompt, choice: result.choice, held, raw: result }

  let reply = result.replyText || ''
  // Never write on a failed turn: partial writes leave inconsistent state.
  if (result.error) return { reply: FRIENDLY_ERRORS[result.error] ?? reply ?? FRIENDLY_ERRORS.api_error, error: result.error, held, raw: result }

  // Never for an employee login: delegate_intents is refused for them in the
  // tool executor; this is the second lock (owner 10-10).
  const receipts: string[] = []
  let intents = isEmployeeCaller(member, tenant) ? [] : result.intentsToExecute
  // Slack: anything that books, calls or sends is never run from there.
  if (input.channel === 'slack' && intents.some((i) => SLACK_HELD_INTENT_KINDS.has(String((i as { kind?: string }).kind)))) {
    intents = intents.filter((i) => !SLACK_HELD_INTENT_KINDS.has(String((i as { kind?: string }).kind)))
    receipts.push(SLACK_INTENT_HELD_LINE)
  }
  receipts.push(...(await runIntents(intents, tenant, member, text, reply)))

  if (receipts.length > 0) reply = [reply, ...receipts].filter(Boolean).join('\n')
  if (!reply) reply = 'Done.'
  return { reply, listedItems: result.listedItems, held, raw: result }
}

/** Run the dispatcher intents; returns one receipt line each. */
async function runIntents(intents: RunAgentResult['intentsToExecute'], tenant: Tenant, member: Member, text: string, reply: string): Promise<string[]> {
  const receipts: string[] = []
  if (intents.length > 0) {
    const [{ executeIntent }, { createBrainDump, createBrainItems, getRecentLeadNames }] = await Promise.all([import('@/lib/mira/intents'), import('@/lib/supabase')])
    const knownLeads = await getRecentLeadNames(tenant.id, 40)
    const queued: Array<{
      item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
      content: string
      priority?: 'low' | 'normal' | 'high'
      horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
      due_date?: string | null
      lead_id?: string | null
    }> = []
    for (const intent of intents) {
      try {
        const r = await executeIntent(intent, tenant, knownLeads, queued, member.id, member, text)
        if (r) receipts.push(r)
      } catch (err) {
        console.error('[chatTurn] intent failed', intent, err)
        receipts.push("Couldn't process one item. Check your dashboard.")
      }
    }
    if (queued.length > 0) {
      const dump = await createBrainDump({ repId: tenant.id, rawText: text, summary: reply, source: 'mic', ownerMemberId: member.id })
      await createBrainItems(tenant.id, dump.id, queued, member.id)
    }
  }
  return receipts
}

export type GateStore = {
  load: typeof import('@/lib/agent/confirmGate').loadPending
  save: typeof import('@/lib/agent/confirmGate').savePending
  claim: typeof import('@/lib/agent/confirmGate').claimPending
  clear: typeof import('@/lib/agent/confirmGate').clearPending
  execute: typeof import('@/lib/agent/confirmGate').executePending
}

async function defaultGate(): Promise<GateStore> {
  const G = await import('@/lib/agent/confirmGate')
  return { load: G.loadPending, save: G.savePending, claim: G.claimPending, clear: G.clearPending, execute: G.executePending }
}
