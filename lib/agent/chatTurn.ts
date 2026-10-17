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
  channel?: AgentChannel
}): Promise<ChatTurnResult & { raw: RunAgentResult }> {
  const { tenant, member, text, history } = input
  const result = await runAgent({ tenant, caller: member, text, history, channel: input.channel ?? 'app' })
  const held = result.heldApprovals ?? []

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

  if (receipts.length > 0) reply = [reply, ...receipts].filter(Boolean).join('\n')
  if (!reply) reply = 'Done.'
  return { reply, listedItems: result.listedItems, held, raw: result }
}
