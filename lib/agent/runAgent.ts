/**
 * Tool-using agent loop for the Telegram bot.
 *
 * Replaces the rigid `interpretTelegramMessage` classifier on the free-text
 * path. The agent gets the same tenant data the dashboard sees (via the
 * read tools defined in tools.ts), and any write actions it wants to take
 * are delegated back through the existing `executeIntent` switch in the
 * webhook \u2014 keeping the change surgical.
 *
 * Cost & safety:
 * - Sonnet only (no Opus), max 5 tool-use turns per message
 * - Hard wall-clock cap (~25s) so we never exceed Telegram's 60s window
 * - Daily per-member quota tracked via agent_usage_increment() RPC
 * - All read tools enforce tenancy via ctx.tenant.id (model never passes IDs)
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import type { TelegramIntent } from '@/lib/claude'
import { supabase } from '@/lib/supabase'
import { getAnthropic, hasAnthropicKey, runWithClaudeKey } from '@/lib/anthropic'
import { loadGuidance, renderGuidance } from '@/lib/plaud/guidance'
import {
  TOOL_HANDLERS,
  toolDefsForTenant,
  type AgentContext,
  type ProposedChoice,
  type ToolHandlerResult,
} from './tools'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'

// Sonnet only \u2014 user policy: no Opus anywhere.
const AGENT_MODEL =
  process.env.ANTHROPIC_MODEL_AGENT ||
  process.env.ANTHROPIC_MODEL_SMART ||
  'claude-sonnet-4-5'

const MAX_TURNS = 8
const HARD_TIMEOUT_MS = 35_000

const QUOTA_BY_TIER: Record<Tenant['tier'], number> = {
  individual: 200,
  enterprise: 2000,
}

export type RunAgentInput = {
  tenant: Tenant
  caller: Member
  text: string
  /** Recent conversation context — entries may include listed_tasks metadata (stripped before Anthropic API). */
  history?: Array<AgentHistoryEntry>
}

export type RunAgentResult = {
  /** Final text reply to send to the user. May be empty if a choice was emitted. */
  replyText: string
  /** Intents to feed through executeIntent after sending replyText. */
  intentsToExecute: TelegramIntent[]
  /** If set, the webhook should render an inline keyboard. */
  choice?: ProposedChoice
  /** Set when the agent failed/quota-exceeded \u2014 webhook may want to fall back. */
  error?: 'quota_exceeded' | 'timeout' | 'api_error' | 'no_api_key'
  /** Brain items listed by list_brain_items this turn — embedded into the saved history entry. */
  listedItems?: Array<{ id: string; content: string }>
}

/** History entry stored in member.settings.agent_history. */
export type AgentHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
  /** IDs + labels from a list_brain_items call in this turn, if any. */
  listed_tasks?: Array<{ id: string; content: string }>
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

async function checkAndIncrementQuota(
  ctx: AgentContext,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit =
    Number((ctx.tenant.settings as Record<string, unknown>)?.agent_quota_daily) ||
    QUOTA_BY_TIER[ctx.tenant.tier] ||
    200

  // Read current count WITHOUT incrementing — recordUsage() handles the
  // single increment after the agent completes with real token metrics.
  // Calling the increment RPC here AND again at end was double-counting.
  const { data, error } = await supabase
    .from('agent_usage')
    .select('requests')
    .eq('rep_id', ctx.tenant.id)
    .eq('member_id', ctx.caller.id)
    .eq('day', ctx.todayIso)
    .maybeSingle()
  if (error) {
    // Fail open — don't block reps over a metrics outage.
    console.error('[agent] quota check failed:', error.message)
    return { ok: true, used: 0, limit }
  }
  const used = Number((data as { requests?: number } | null)?.requests) || 0
  // used < limit (not <=) because recordUsage will add 1 more after the run.
  return { ok: used < limit, used, limit }
}

async function recordUsage(
  ctx: AgentContext,
  inputTokens: number,
  outputTokens: number,
  toolCalls: number,
  errors: number,
): Promise<void> {
  try {
    await supabase.rpc('agent_usage_increment', {
      p_rep_id: ctx.tenant.id,
      p_member_id: ctx.caller.id,
      p_day: ctx.todayIso,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_tool_calls: toolCalls,
      p_errors: errors,
    })
  } catch (err) {
    console.error('[agent] recordUsage failed:', err)
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const MEMORY_TOOLS_INSTRUCTIONS = [
  '',
  '## Your memory (learn and change in real time)',
  'You can remember durable preferences/corrections so you AND the rest of their assistant (daily plan, email drafts, prepared actions) improve over time:',
  "- When they state a standing rule or correct you in a lasting way (\"always send my drafts before 9am\", \"never CC the whole team\", \"my title is COO\", \"keep replies short\"), call `remember` with a crisp rule, then confirm in ONE line (\"Got it — I'll keep replies short.\").",
  '- When they say "forget that", "stop doing X", or change a rule, call `forget` with what to drop, then confirm what you forgot.',
  '- If they ask what you\'ve learned or "what do you know about me", call `list_learned` and tell them; offer to forget any.',
  "- If they say the app/bot itself is broken or want a change you can't make yourself, call `report_issue` so the team gets it.",
  '- NEVER remember one-off requests or normal tasks — only durable rules. Keep confirmations to one short line; don\'t lecture.',
].join('\n')

function buildSystemPrompt(ctx: AgentContext, guidanceBlock = ''): string {
  const parts = [buildBaseSystemPrompt(ctx)]
  if (guidanceBlock) parts.push(guidanceBlock)
  parts.push(MEMORY_TOOLS_INSTRUCTIONS)
  return parts.join('\n')
}

function buildBaseSystemPrompt(ctx: AgentContext): string {
  if ((ctx.tenant.brand ?? 'virtualcloser') === 'cxo') {
    return buildExecSystemPrompt(ctx)
  }
  const m = ctx.caller
  return [
    `You are the Virtual Closer AI — ${m.display_name}'s personal AI assistant living in their Telegram.`,
    '',
    `Who you're talking to: ${m.display_name} (role: ${m.role}, tz: ${ctx.timezone}, today: ${ctx.todayIso})`,
    `Their company: ${ctx.tenant.display_name}`,
    '',
    '## What you are',
    'You are a full AI — like having Claude or ChatGPT directly in Telegram, except you also know this person\'s CRM, calendar, tasks, and leads.',
    'You can do ANYTHING a smart AI assistant can do:',
    '- Have a real conversation. If they want to chat, chat. If they want to vent, listen.',
    '- Answer any question — sales strategy, objection handling, pricing, personal advice, life stuff, whatever.',
    '- Help write things — cold emails, follow-up texts, scripts, proposals, LinkedIn DMs, apology messages, anything.',
    '- Coach and role-play — "practice pitching me", "help me handle this objection", "give me a rebuttal for X", "quiz me on the product".',
    '- Explain, analyze, brainstorm — "why did that deal fall apart?", "how should I structure my week?", "what\'s the best way to follow up after a no-show?".',
    '- Log CRM stuff when asked — calls, prospects, meetings, tasks, goals, follow-ups.',
    '- Read back their data — tasks, pipeline, calendar, call history, goals.',
    '',
    '## When to act vs when to talk',
    '- Clear CRM action ("log a call with Joe", "add Dana as a lead", "book a meeting Friday at 2pm") — do it immediately via delegate_intents.',
    '- Clear data question ("what tasks do I have?", "who\'s in my pipeline?") — read with tools, then answer conversationally.',
    '- EVERYTHING ELSE — conversation, writing help, coaching, venting, random questions, brainstorming — just respond like a real person. Do NOT force a CRM action where none was asked for. Do NOT deflect or say "I can only help with sales stuff." You are a full AI.',
    '- Real-world lookups ("find me a sushi spot in Dallas", "what\'s the weather", "best gyms near me", "how do I get to X") → call web_search immediately. Never say you can\'t access the internet.',
    '',
    '## Corrections and context',
    'You have full conversation history. Use it. If someone says "that\'s wrong", "I meant something different", "no that\'s a separate meeting" — understand the correction from context and fix it. Never make them repeat themselves.',
    '',
    '## Writing help (very common)',
    'When asked to draft or improve something, write the whole thing cleanly — don\'t outline it, just write it. Make it something they can actually send. Match their voice based on how they text you.',
    '',
    '## CRM capabilities (for when they need it)',
    '- Tasks / goals / notes → dashboard brain widget (auto-created)',
    '- Leads / prospects → pipeline + lead history (auto-created)',
    '- Kanban pipeline → auto-created on first use',
    '- Call logs → inbox + lead history',
    '- Calendar events → Google Calendar (requires OAuth)',
    '- Never say "go set it up first" — just do it.',
    '',
    '## CRM rules (only relevant when doing CRM actions)',
    '- If it\'s clear what they want, just do it. Don\'t ask for confirmation.',
    '- All writes go through delegate_intents — never claim to have done something you didn\'t actually delegate.',
    '- Dates: assume caller\'s timezone. Resolve "Thursday" / "next week" to ISO dates before delegating.',
    '- Read tools before answering data questions — never fabricate numbers or names.',
    '- Bulk pipeline import (3+ prospects pasted as a list with "track these / build a pipeline / etc.") → emit { kind: "bulk_import_leads" } immediately.',
    '',
    '## Style',
    '- Sound like a real, smart person texting — not a corporate bot, not a help desk.',
    '- Warm when the situation calls for it. Direct when it doesn\'t. Match their energy.',
    '- NEVER open with: "Great!", "Sure!", "Absolutely!", "Of course!", "Happy to help!", "Certainly!".',
    '- NEVER end with: "Let me know if you have any questions!" or "Feel free to reach out!".',
    '- ONE question max per reply, at the end.',
    '- Bullets only when listing 3+ actual items. Not for conversational replies.',
    '- After a CRM action: short confirmation only. "Logged. Follow-up set for Thu." No recap.',
    '- Be specific: "4 overdue tasks" not "a few things". "Call her by Thursday" not "follow up soon".',
  ].join('\n')
}

// CXO Suite persona — same tools and data backend, but the framing is an
// executive chief of staff, not a sales SDR. Spencer (and CXO clients) are
// operators/executives: they care about meetings, yesterday's revenue, deals
// in motion, decisions waiting on them, and what to focus on today — not cold
// emails or objection-handling drills.
function buildExecSystemPrompt(ctx: AgentContext): string {
  const m = ctx.caller
  // Pinnacle-viewer tenants only (Spencer). Other CXO clients never see this
  // line, so their bot won't reference revenue tracking it can't back up.
  const pinnacleLine = isPinnacleViewer(ctx.tenant.id)
    ? [
        '',
        '## Revenue / book of business (Pinnacle)',
        "You can pull live Pinnacle Wellness production numbers via the pinnacle_revenue tool — premium by month, projected month-end, pace vs last month, placement/decline/lapse health, and rankings by team/agent/carrier/state/product across Health and Life. Use it for ANY revenue, premium, production, or 'who's top' question. Read it before answering — never guess the numbers.",
      ].join('\n')
    : ''
  return [
    `You are ${m.display_name}'s AI Chief of Staff — their executive assistant living in their Telegram, part of CXO Suite.`,
    '',
    `Who you're talking to: ${m.display_name} (role: ${m.role}, tz: ${ctx.timezone}, today: ${ctx.todayIso})`,
    `Their company: ${ctx.tenant.display_name}`,
    '',
    '## What you are',
    "You are a full AI — like having Claude directly in Telegram, except you also know this executive's calendar, meetings, deals/pipeline, revenue, email, tasks, and team.",
    'You operate like a sharp chief of staff for a busy operator:',
    '- Brief them. "How did yesterday go?", "what does today look like?", "what needs me?" → pull the real data and give a tight executive summary.',
    "- Track the business. Meetings, revenue, deals in motion, what closed, what's stalled, what's overdue.",
    '- Surface decisions. Flag what is waiting on them, what is at risk, and what they should focus on first.',
    '- Handle correspondence. Draft and refine emails, messages, agendas, briefs, talking points — ready to send.',
    '- Think with them. Strategy, prioritization, prep for a meeting, "how should I handle this conversation", analysis, brainstorming.',
    '- Log and read CRM/ops data when asked — meetings, contacts, tasks, deals, notes, follow-ups.',
    '',
    '## When to act vs when to talk',
    '- Clear action ("book a meeting Friday at 2pm", "add Dana as a contact", "remind me to review the deck Thursday") — do it immediately via delegate_intents.',
    '- Clear data question ("what meetings do I have?", "how much did we book yesterday?", "what\'s waiting on me?") — read with tools, then answer in a crisp executive brief.',
    '- EVERYTHING ELSE — strategy, drafting, prep, analysis, thinking out loud — just respond like a sharp operator. Do NOT force a CRM action where none was asked for. You are a full AI, not a form.',
    '- Real-world lookups ("find a steakhouse near the office for a dinner", "what\'s the weather in NYC Thursday", "directions to X") → call web_search immediately. Never say you can\'t access the internet.',
    '',
    '## Corrections and context',
    'You have full conversation history. Use it. If they say "that\'s wrong" or "I meant the board meeting" — understand the correction from context and fix it. Never make them repeat themselves.',
    '',
    '## Writing help (very common)',
    "When asked to draft or improve something, write the whole thing cleanly — don't outline it, just write it. Make it something they can actually send. Executive tone: clear, concise, no filler. Match their voice based on how they text you.",
    '',
    '## Capabilities (for when they need it)',
    '- Tasks / reminders / notes → dashboard brain widget (auto-created)',
    '- Contacts / deals / pipeline → pipeline + history (auto-created)',
    '- Meetings / calendar events → Google Calendar (requires OAuth)',
    '- Call & meeting logs, email threads → inbox + history',
    '- Never say "go set it up first" — just do it.',
    pinnacleLine,
    '',
    '## Rules (only relevant when doing actions)',
    '- If it\'s clear what they want, just do it. Don\'t ask for confirmation.',
    '- All writes go through delegate_intents — never claim to have done something you didn\'t actually delegate.',
    '- Dates: assume the executive\'s timezone. Resolve "Thursday" / "next week" to ISO dates before delegating.',
    '- Read tools before answering data questions — never fabricate numbers, names, or revenue.',
    '',
    '## Style',
    '- Sound like a trusted, switched-on chief of staff texting their principal — not a corporate bot, not a help desk.',
    '- Direct and efficient. Respect their time. Lead with the answer, then detail if needed.',
    '- NEVER open with: "Great!", "Sure!", "Absolutely!", "Of course!", "Happy to help!", "Certainly!".',
    '- NEVER end with: "Let me know if you have any questions!" or "Feel free to reach out!".',
    '- ONE question max per reply, at the end.',
    '- Bullets only when listing 3+ actual items. Not for conversational replies.',
    '- After an action: short confirmation only. "Booked. Friday 2pm, calendar updated." No recap.',
    '- Be specific: "$48k booked yesterday across 3 deals" not "a good day". "2 decisions waiting on you" not "some things".',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  // BYOK: run the whole agent under the tenant's own Anthropic key (if set)
  // so their usage bills to their account. Falls back to the platform key.
  return runWithClaudeKey(input.tenant.claude_api_key, () => runAgentInner(input))
}

async function runAgentInner(input: RunAgentInput): Promise<RunAgentResult> {
  if (!hasAnthropicKey()) {
    return {
      replyText: "I'm not configured with an AI key right now. Try a slash command (/help).",
      intentsToExecute: [],
      error: 'no_api_key',
    }
  }

  const tz = input.caller.timezone || input.tenant.timezone || 'America/New_York'
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: tz }) // 'YYYY-MM-DD'
  const ctx: AgentContext = {
    tenant: input.tenant,
    caller: input.caller,
    timezone: tz,
    todayIso,
    ownerMemberId: input.caller.id,
  }

  // Quota
  const quota = await checkAndIncrementQuota(ctx)
  if (!quota.ok) {
    return {
      replyText: `Daily AI quota hit (${quota.used}/${quota.limit}). Try again tomorrow, or use slash commands.`,
      intentsToExecute: [],
      error: 'quota_exceeded',
    }
  }

  // Inject the learned guidance so the bot honors the same durable rules the
  // rest of the nucleus learned (e.g. "never CC the whole team", "my title is COO").
  const guidance = await loadGuidance(ctx.tenant.id, 'planner').catch(() => [])
  const systemPrompt = buildSystemPrompt(ctx, renderGuidance(guidance))

  // Build initial conversation — up to 38 entries (19 exchanges) from the
  // DB-backed agent_history table. Large window so the agent can resolve
  // back-references and maintain context across a full working session.
  // Claude Sonnet has a 200k token context; 40 short Telegram turns is ~4k tokens.
  const messages: Anthropic.MessageParam[] = []
  if (input.history && input.history.length > 0) {
    for (const h of input.history.slice(-38)) {
      messages.push({ role: h.role, content: h.content })
    }
  }
  messages.push({ role: 'user', content: input.text })

  const collectedIntents: TelegramIntent[] = []
  let collectedChoice: ProposedChoice | undefined
  let collectedListedItems: Array<{ id: string; content: string }> | undefined
  let totalInput = 0
  let totalOutput = 0
  let toolCalls = 0
  let errors = 0
  const startedAt = Date.now()

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      await recordUsage(ctx, totalInput, totalOutput, toolCalls, errors + 1)
      return {
        replyText: 'Hit my time limit on that one \u2014 try again or break it into smaller steps.',
        intentsToExecute: collectedIntents,
        choice: collectedChoice,
        error: 'timeout',
      }
    }

    let response: Anthropic.Message
    try {
      response = await getAnthropic().messages.create({
        model: AGENT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolDefsForTenant(input.tenant),
        tool_choice: { type: 'auto' },
        messages,
      })
    } catch (err) {
      console.error('[agent] anthropic call failed:', err)
      await recordUsage(ctx, totalInput, totalOutput, toolCalls, errors + 1)
      return {
        replyText: "Couldn't reach my brain just now. Try again in a sec, or use a slash command.",
        intentsToExecute: collectedIntents,
        choice: collectedChoice,
        error: 'api_error',
      }
    }

    totalInput += response.usage?.input_tokens ?? 0
    totalOutput += response.usage?.output_tokens ?? 0

    // Append assistant response to history (must include tool_use blocks for the loop)
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      // Final answer
      const replyText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      await recordUsage(ctx, totalInput, totalOutput, toolCalls, errors)
      return {
        replyText: replyText || (collectedChoice ? '' : 'Done.'),
        intentsToExecute: collectedIntents,
        choice: collectedChoice,
        listedItems: collectedListedItems,
      }
    }

    // Handle tool_use blocks
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    let earlyFinalize = false

    for (const tu of toolUses) {
      toolCalls++
      const handler = TOOL_HANDLERS[tu.name]
      if (!handler) {
        errors++
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ error: `unknown tool: ${tu.name}` }),
          is_error: true,
        })
        continue
      }
      try {
        const result: ToolHandlerResult = await handler(
          ctx,
          (tu.input ?? {}) as Record<string, unknown>,
        )
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.text,
        })
        if (result.intents && result.intents.length > 0) {
          collectedIntents.push(...result.intents)
        }
        if (result.proposeChoice) {
          collectedChoice = result.proposeChoice
        }
        // Capture IDs from list_brain_items so the webhook can cache them
        // as last_listed_tasks for back-reference ("those are done") resolution.
        if (tu.name === 'list_brain_items') {
          try {
            const parsed = JSON.parse(result.text) as { items?: Array<{ id: string; content: string }> }
            if (Array.isArray(parsed.items) && parsed.items.length > 0) {
              collectedListedItems = parsed.items.map((i) => ({ id: i.id, content: i.content }))
            }
          } catch { /* non-fatal */ }
        }
        if (result.finalize) earlyFinalize = true
      } catch (err) {
        errors++
        const msg = err instanceof Error ? err.message : String(err)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ error: msg }),
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })

    if (earlyFinalize) {
      // propose_choice was called \u2014 we stop the loop and let the webhook
      // render the keyboard. No follow-up text (the prompt itself is shown).
      await recordUsage(ctx, totalInput, totalOutput, toolCalls, errors)
      return {
        replyText: '',
        intentsToExecute: collectedIntents,
        choice: collectedChoice,
        listedItems: collectedListedItems,
      }
    }
  }

  // Hit MAX_TURNS without final answer
  await recordUsage(ctx, totalInput, totalOutput, toolCalls, errors + 1)
  return {
    replyText: 'I went in circles on that one \u2014 try rephrasing or break it into smaller asks.',
    intentsToExecute: collectedIntents,
    choice: collectedChoice,    listedItems: collectedListedItems,    error: 'timeout',
  }
}
