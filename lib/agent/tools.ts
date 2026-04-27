/**
 * Tool definitions + handlers for the Telegram agent.
 *
 * Architecture:
 * - Each tool has a JSON-schema definition Anthropic sees and a handler
 *   that runs server-side. Handlers receive a `ctx` (caller's tenant +
 *   member + timezone) so tenancy is enforced HERE \u2014 the model NEVER
 *   passes rep_id / member_id; we wire those from the caller's session.
 *
 * - Read tools answer questions ("what tasks do I have?", "what's on my
 *   calendar?"). They cap result counts (default 25, max 100) so the
 *   agent context can't blow up.
 *
 * - One write proxy: `delegate_intents`. Instead of re-implementing all 30
 *   write paths the existing `executeIntent` switch handles (log_call,
 *   set_target, snooze_lead, schedule meetings, dm_member, etc.), the agent
 *   constructs structured TelegramIntent objects and we dispatch them
 *   through the existing machinery. Keeps the change surgical.
 *
 * - One UX tool: `propose_choice` \u2014 lets the agent ask the user to pick
 *   between options via a Telegram inline keyboard. The webhook converts
 *   this into actual buttons and resumes the conversation on tap.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import type { TelegramIntent } from '@/lib/claude'
import {
  getAllLeads,
  getBrainBuckets,
  getCallStats,
  getRecentCalls,
  refreshTargetProgress,
  supabase,
} from '@/lib/supabase'
import { listInbox, type DeferredItem, type DeferredStatus } from '@/lib/deferred'
import { listMembers } from '@/lib/members'
import { listUpcomingEvents } from '@/lib/google'
import { friendlyDate } from './format'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type AgentContext = {
  tenant: Tenant
  caller: Member
  timezone: string
  /** ISO 'YYYY-MM-DD' in caller's timezone. */
  todayIso: string
  /**
   * Tenant-wide vs personal scope. Today: caller is always scoped to their
   * own member_id for tasks/deferred (to prevent peer task leakage). Lead
   * and calendar reads are tenant-wide because the lead universe + the
   * Google connection are tenant-level.
   */
  ownerMemberId: string
}

// ---------------------------------------------------------------------------
// Choice (UX) signal \u2014 the agent emits this; the webhook renders buttons
// ---------------------------------------------------------------------------

export type ProposedChoice = {
  prompt: string
  options: Array<{ label: string; value: string }>
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ToolResultJson = Record<string, unknown> | { items: unknown[]; total: number; truncated: boolean }
export type ToolHandlerResult = {
  /** JSON-stringified payload sent back to the model as tool_result content. */
  text: string
  /** Side-effect signals the webhook needs to act on after the loop ends. */
  proposeChoice?: ProposedChoice
  /** Intents to feed into the existing executeIntent dispatch. */
  intents?: TelegramIntent[]
  /** Set true to abort the loop early with a final reply. */
  finalize?: boolean
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25

function clampLimit(n: unknown, fallback = DEFAULT_LIMIT): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(Math.floor(v), MAX_LIMIT)
}

function asJson(payload: unknown): string {
  return JSON.stringify(payload, null, 0)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handle_who_am_i(ctx: AgentContext): Promise<ToolHandlerResult> {
  return {
    text: asJson({
      member_id: ctx.caller.id,
      display_name: ctx.caller.display_name,
      role: ctx.caller.role,
      email: ctx.caller.email,
      timezone: ctx.timezone,
      today: ctx.todayIso,
      tenant: { id: ctx.tenant.id, display_name: ctx.tenant.display_name, tier: ctx.tenant.tier },
    }),
  }
}

async function handle_list_brain_items(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const window = (args.window as string | undefined) ?? 'all'
  const item_type = args.item_type as string | undefined
  const limit = clampLimit(args.limit, 50)

  const buckets = await getBrainBuckets(ctx.tenant.id, { memberIds: [ctx.ownerMemberId] })

  let items = (() => {
    switch (window) {
      case 'overdue':
        return buckets.overdue
      case 'today':
        return buckets.today
      case 'week':
        return [...buckets.overdue, ...buckets.today, ...buckets.thisWeek]
      case 'month':
        return [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.thisMonth]
      case 'goals':
        return buckets.goals
      case 'inbox':
        return buckets.inbox
      case 'all':
      default:
        return [
          ...buckets.overdue,
          ...buckets.today,
          ...buckets.thisWeek,
          ...buckets.thisMonth,
          ...buckets.longRange,
          ...buckets.goals,
          ...buckets.inbox,
        ]
    }
  })()

  if (item_type) items = items.filter((i) => i.item_type === item_type)

  const total = items.length
  const sliced = items.slice(0, limit)

  return {
    text: asJson({
      total,
      truncated: total > sliced.length,
      summary: {
        overdue: buckets.overdue.length,
        today: buckets.today.length,
        thisWeek: buckets.thisWeek.length,
        thisMonth: buckets.thisMonth.length,
        longRange: buckets.longRange.length,
        goals: buckets.goals.length,
        inbox: buckets.inbox.length,
      },
      items: sliced.map((i) => ({
        id: i.id,
        type: i.item_type,
        content: i.content,
        priority: i.priority,
        horizon: i.horizon,
        due_date: i.due_date,
        due_friendly: friendlyDate(i.due_date, ctx.todayIso),
      })),
    }),
  }
}

async function handle_list_deferred_items(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const status = (args.status as DeferredStatus | undefined) ?? 'open'
  const limit = clampLimit(args.limit, 50)
  const items: DeferredItem[] = await listInbox(ctx.tenant.id, ctx.ownerMemberId, { status, limit })
  return {
    text: asJson({
      total: items.length,
      items: items.map((d) => ({
        id: d.id,
        title: d.title,
        body: d.body,
        source: d.source,
        remind_at: d.remind_at,
        created_at: d.created_at,
      })),
    }),
  }
}

async function handle_list_leads(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const status = args.status as string | undefined
  const search = ((args.search as string | undefined) ?? '').trim().toLowerCase()
  const limit = clampLimit(args.limit, 25)

  let leads = await getAllLeads(ctx.tenant.id)
  if (status) leads = leads.filter((l) => l.status === status)
  if (search) {
    leads = leads.filter(
      (l) =>
        l.name.toLowerCase().includes(search) ||
        (l.company ?? '').toLowerCase().includes(search) ||
        (l.email ?? '').toLowerCase().includes(search),
    )
  }
  const total = leads.length
  const sliced = leads.slice(0, limit)
  return {
    text: asJson({
      total,
      truncated: total > sliced.length,
      items: sliced.map((l) => ({
        id: l.id,
        name: l.name,
        company: l.company,
        email: l.email,
        status: l.status,
        last_contact: l.last_contact,
        deal_value: l.deal_value,
        snoozed_until: l.snoozed_until,
      })),
    }),
  }
}

async function handle_list_calendar_events(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const window = (args.window as string | undefined) ?? 'today'
  const days = window === 'today' ? 1 : window === 'week' ? 7 : window === 'month' ? 31 : 1
  const fromIso = new Date().toISOString()
  const toIso = new Date(Date.now() + days * 86400000).toISOString()
  const events = await listUpcomingEvents(ctx.tenant.id, {
    fromIso,
    toIso,
    maxResults: clampLimit(args.limit, 25),
    timeZone: ctx.timezone,
  })
  if (events === null) {
    return { text: asJson({ connected: false, items: [], message: 'Google Calendar not connected.' }) }
  }
  return {
    text: asJson({
      connected: true,
      window,
      total: events.length,
      items: events.map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        attendees: (e.attendees ?? []).map((a) => a.email),
      })),
    }),
  }
}

async function handle_list_recent_calls(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const limit = clampLimit(args.limit, 20)
  const calls = await getRecentCalls(ctx.tenant.id, limit, { memberIds: [ctx.ownerMemberId] })
  return {
    text: asJson({
      total: calls.length,
      items: calls.map((c) => ({
        id: c.id,
        contact_name: c.contact_name,
        summary: c.summary,
        outcome: c.outcome,
        next_step: c.next_step,
        occurred_at: c.occurred_at,
      })),
    }),
  }
}

async function handle_get_call_stats(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const days = clampLimit(args.days ?? 7, 7)
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const stats = await getCallStats(ctx.tenant.id, since)
  return { text: asJson({ window_days: days, ...stats }) }
}

async function handle_list_targets(ctx: AgentContext): Promise<ToolHandlerResult> {
  const targets = await refreshTargetProgress(ctx.tenant.id)
  return {
    text: asJson({
      total: targets.length,
      items: targets.map((t) => ({
        id: t.id,
        period_type: t.period_type,
        period_start: t.period_start,
        metric: t.metric,
        target_value: t.target_value,
        current_value: t.current_value,
        scope: t.scope,
        status: t.status,
      })),
    }),
  }
}

async function handle_list_members(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const role = args.role as string | undefined
  let members = await listMembers(ctx.tenant.id)
  if (role) members = members.filter((m) => m.role === role)
  return {
    text: asJson({
      total: members.length,
      items: members.map((m) => ({
        id: m.id,
        display_name: m.display_name,
        email: m.email,
        role: m.role,
        timezone: m.timezone,
      })),
    }),
  }
}

// ---------------------------------------------------------------------------
// Special tools (UX + write proxy)
// ---------------------------------------------------------------------------

async function handle_propose_choice(
  _ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const prompt = String(args.prompt ?? '').trim() || 'Pick one:'
  const rawOptions = Array.isArray(args.options) ? (args.options as unknown[]) : []
  const options = rawOptions
    .map((o) => {
      if (typeof o !== 'object' || o === null) return null
      const obj = o as Record<string, unknown>
      const label = String(obj.label ?? '').trim()
      const value = String(obj.value ?? label).trim()
      if (!label || !value) return null
      return { label, value }
    })
    .filter((x): x is { label: string; value: string } => x !== null)
    .slice(0, 6)
    // callback_data = "agent:choice:" (13 chars) + value, Telegram max 64 total.
    // Truncate values here so the webhook never silently corrupts them.
    .map((o) => ({ ...o, value: o.value.length > 51 ? o.value.slice(0, 51) : o.value }))

  if (options.length === 0) {
    return { text: asJson({ ok: false, error: 'no valid options' }) }
  }

  return {
    text: asJson({ ok: true, presented: true, prompt, options }),
    proposeChoice: { prompt, options },
    finalize: true,
  }
}

async function handle_delegate_intents(
  _ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const intents = (Array.isArray(args.intents) ? args.intents : []) as TelegramIntent[]
  // We don't validate shapes here \u2014 the existing executeIntent switch is
  // strict and will throw on garbage. Surface the count back to the model
  // so it can react to partial failures in the next turn.
  return {
    text: asJson({ ok: true, queued: intents.length }),
    intents,
  }
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>

export const TOOL_HANDLERS: Record<string, Handler> = {
  who_am_i: handle_who_am_i,
  list_brain_items: handle_list_brain_items,
  list_deferred_items: handle_list_deferred_items,
  list_leads: handle_list_leads,
  list_calendar_events: handle_list_calendar_events,
  list_recent_calls: handle_list_recent_calls,
  get_call_stats: handle_get_call_stats,
  list_targets: handle_list_targets,
  list_members: handle_list_members,
  propose_choice: handle_propose_choice,
  delegate_intents: handle_delegate_intents,
}

// JSON-schema tool definitions for Anthropic.
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'who_am_i',
    description:
      "Return the caller's identity (member id, display name, role, timezone, and today's date in their timezone). ALWAYS call once at the start of a turn if you need to reason about role-gated actions.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_brain_items',
    description:
      "List the caller's open brain items (tasks, goals, plans, ideas, notes) \u2014 the SAME list shown on their /dashboard \"Open items\" card. Use this whenever they ask 'what tasks do I have', 'what's on my plate', 'what's overdue', 'what am I supposed to do', etc. Always returns a summary count of every bucket so you can mention totals even if you only render one.",
    input_schema: {
      type: 'object',
      properties: {
        window: {
          type: 'string',
          enum: ['overdue', 'today', 'week', 'month', 'all', 'goals', 'inbox'],
          description: "Which time bucket. 'all' returns everything open.",
        },
        item_type: {
          type: 'string',
          enum: ['task', 'goal', 'idea', 'plan', 'note'],
          description: 'Optional filter by item type.',
        },
        limit: { type: 'number', description: 'Max items to return (default 50, max 100).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_deferred_items',
    description:
      "List the caller's deferred-items inbox (the 'remind me later' queue \u2014 separate from tasks). Sources include walkie messages they parked, voice memos awaiting review, room messages, and self-reminders.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'snoozed'] },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_leads',
    description:
      "List leads in the tenant's CRM. Use to answer 'who's hot', 'which leads haven't I touched in a week', etc. Filter by status and/or search string. Snoozed leads are included \u2014 inspect snoozed_until to filter them out if needed.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['hot', 'warm', 'cold', 'dormant'] },
        search: { type: 'string', description: 'Substring match on name/company/email.' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_calendar_events',
    description:
      "List the tenant's upcoming Google Calendar events. Returns connected:false if Google isn't connected. NOTE: this is currently the tenant-level connection (one Google account per rep), not per-member. Asking 'what's on Nick's calendar' for a specific rep is NOT yet supported \u2014 explain that limitation.",
    input_schema: {
      type: 'object',
      properties: {
        window: { type: 'string', enum: ['today', 'week', 'month'], description: 'Default today.' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_recent_calls',
    description:
      "List the caller's recent logged calls (call_logs). Use for 'how have my conversations been', 'last call with X', etc.",
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'default 20, max 100' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_call_stats',
    description:
      "Aggregate call counts in a recent window. Returns total / conversations / meetingsBooked / closedWon / closedLost.",
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Lookback window in days (default 7).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_targets',
    description: "List the tenant's active goals/targets with current vs target progress.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_members',
    description:
      "List members of the tenant account. Use for 'who's on my team', name resolution, role lookups.",
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['owner', 'admin', 'manager', 'rep', 'observer'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_choice',
    description:
      "Ask the caller a multiple-choice question. The webhook will render this as a Telegram inline keyboard and pause the conversation until they tap an option. Use this when the answer would be too long otherwise (e.g. 'what's on my plate?' \u2192 offer All / Overdue / Today / Deferred / Everything as buttons). After calling this tool, end the turn \u2014 do not also emit a final text reply.",
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Short question shown above the buttons.' },
        options: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'string', description: 'Echoed back as the user reply when tapped.' },
            },
            required: ['label', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['prompt', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'delegate_intents',
    description:
      "Execute one or more structured ACTION intents through the existing dispatcher. This is your ONLY way to make changes (create tasks, log calls, set targets, snooze leads, schedule meetings, send DMs, etc.). Never just say 'I'll add that' \u2014 always call delegate_intents with the right intent shape. Each intent runs server-side with full safety checks (confirmation prompts where applicable).\n\nIntent shapes (one of, set 'kind' to the variant):\n\n- { kind:'add_lead', name, company?, email?, status?, note? }\n- { kind:'update_lead', lead_name, status?, note?, mark_contacted?, email?, company?, phone? }\n- { kind:'schedule_followup', lead_name, due_date:'YYYY-MM-DD', content, priority? }\n- { kind:'brain_item', item_type:'task'|'goal'|'idea'|'plan'|'note', content, priority?, horizon?, due_date? }\n- { kind:'log_call', lead_name, summary, outcome?, next_step?, duration_minutes? }\n- { kind:'book_meeting', lead_name?, contact_name?, email?, start_iso, duration_minutes?, summary, notes? }\n- { kind:'reschedule_meeting', lead_name?, contact_name?, original_when?, new_start_iso, new_duration_minutes? }\n- { kind:'cancel_meeting', lead_name?, contact_name?, original_when? }\n- { kind:'request_one_on_one', member_name, duration_minutes?, within?, purpose? }\n- { kind:'pipeline_triage', count? }\n- { kind:'snooze_lead', lead_name, until_date?, within? }\n- { kind:'set_deal_value', lead_name, deal_value, currency? }\n- { kind:'handoff_lead', lead_name, to_member_name }\n- { kind:'objection_coach', objection }\n- { kind:'rep_pulse', member_name, period? }\n- { kind:'leaderboard', period?, metric? }\n- { kind:'forecast', period? }\n- { kind:'winloss', period? }\n- { kind:'announce', message, audience?, team_name? }\n- { kind:'inbox_zero', days? }\n- { kind:'set_target', period_type, metric, target_value, scope?, team_name?, notes?, visibility? }\n- { kind:'report', report_type:'pipeline'|'today'|'week'|'calendar'|'goals'|'metrics'|'lead_history', lead_name? }\n- { kind:'dm_member', member_name, message }\n- { kind:'room_post', audience:'managers'|'owners'|'team', team_name?, message }\n- { kind:'commission_report', period? }\n- { kind:'defer_item', title, body?, remind_at_iso?, source_lead_name? }\n- { kind:'complete_task', query }\n- { kind:'move_task', query, new_due_date?, new_content?, new_priority? }\n- { kind:'assign_task', member_name, content, due_date?, priority?, timeframe? }\n- { kind:'arm_voice_send', member_name, flavor?, lead_name? }\n\nEmit multiple intents in one call when a message has multiple actions (e.g. 'just talked to Dana she's hot, follow up Thursday' \u2192 log_call + update_lead + schedule_followup).",
    input_schema: {
      type: 'object',
      properties: {
        intents: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Array of intent objects.',
        },
      },
      required: ['intents'],
      additionalProperties: false,
    },
  },
]
