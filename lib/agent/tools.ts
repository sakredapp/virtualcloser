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
// Pipeline + KPI + Roleplay + Dialer read tools
// ---------------------------------------------------------------------------

async function handle_list_pipeline_boards(
  ctx: AgentContext,
): Promise<ToolHandlerResult> {
  const { getPipelinesForRep, getLeadsForPipeline, getItemsForPipeline } = await import(
    '@/lib/pipelines'
  )
  const pipelines = await getPipelinesForRep(ctx.tenant.id)
  if (!pipelines.length) {
    return { text: asJson({ total: 0, boards: [], message: 'No pipelines set up yet.' }) }
  }

  const boards = await Promise.all(
    pipelines.map(async (p) => {
      const stageCounts: Record<string, number> = {}
      if (p.kind === 'sales') {
        const leads = await getLeadsForPipeline(p.id, ctx.tenant.id)
        for (const l of leads) {
          const sid = l.pipeline_stage_id ?? '__unassigned__'
          stageCounts[sid] = (stageCounts[sid] ?? 0) + 1
        }
      } else {
        const items = await getItemsForPipeline(p.id, ctx.tenant.id)
        for (const i of items) {
          const sid = i.pipeline_stage_id ?? '__unassigned__'
          stageCounts[sid] = (stageCounts[sid] ?? 0) + 1
        }
      }
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        stages: p.stages.map((s) => ({
          id: s.id,
          name: s.name,
          position: s.position,
          count: stageCounts[s.id] ?? 0,
        })),
        unassigned_count: stageCounts['__unassigned__'] ?? 0,
      }
    }),
  )

  return { text: asJson({ total: boards.length, boards }) }
}

async function handle_list_pipeline_leads(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const pipeline_name = ((args.pipeline_name as string | undefined) ?? '').trim()
  const stage_name = ((args.stage_name as string | undefined) ?? '').trim()
  const lead_name = ((args.lead_name as string | undefined) ?? '').trim()
  const limit = clampLimit(args.limit, 50)

  const { getPipelinesForRep, getLeadsForPipeline, getItemsForPipeline } = await import(
    '@/lib/pipelines'
  )
  const pipelines = await getPipelinesForRep(ctx.tenant.id)
  if (!pipelines.length) {
    return { text: asJson({ error: 'no_pipelines', message: 'No pipelines set up yet.' }) }
  }

  // Pick the right pipeline — default to first (usually Sales Pipeline).
  let pipeline = pipelines[0]
  if (pipeline_name) {
    const lower = pipeline_name.toLowerCase()
    const match = pipelines.find(
      (p) =>
        p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()),
    )
    if (match) pipeline = match
  }

  // Filter to matching stage(s) — or all stages if none specified.
  const targetStageIds =
    stage_name
      ? pipeline.stages
          .filter(
            (s) =>
              s.name.toLowerCase().includes(stage_name.toLowerCase()) ||
              stage_name.toLowerCase().includes(s.name.toLowerCase()),
          )
          .map((s) => s.id)
      : pipeline.stages.map((s) => s.id)

  const stageMap = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name]))

  if (pipeline.kind === 'sales') {
    let leads = await getLeadsForPipeline(pipeline.id, ctx.tenant.id)
    if (targetStageIds.length < pipeline.stages.length) {
      leads = leads.filter(
        (l) => l.pipeline_stage_id && targetStageIds.includes(l.pipeline_stage_id),
      )
    }
    // Optional: filter to a specific lead by name (for "what stage is Dana in?")
    if (lead_name) {
      const ll = lead_name.toLowerCase()
      leads = leads.filter(
        (l) =>
          l.name.toLowerCase().includes(ll) ||
          (l.company ?? '').toLowerCase().includes(ll),
      )
    }
    const total = leads.length
    const sliced = leads.slice(0, limit)
    return {
      text: asJson({
        pipeline: pipeline.name,
        kind: pipeline.kind,
        total,
        truncated: total > sliced.length,
        items: sliced.map((l) => ({
          id: l.id,
          name: l.name,
          company: l.company,
          status: l.status,
          stage: l.pipeline_stage_id
            ? (stageMap[l.pipeline_stage_id] ?? 'Unknown')
            : 'Unassigned',
          deal_value: l.deal_value,
        })),
      }),
    }
  } else {
    let items = await getItemsForPipeline(pipeline.id, ctx.tenant.id)
    if (targetStageIds.length < pipeline.stages.length) {
      items = items.filter(
        (i) => i.pipeline_stage_id && targetStageIds.includes(i.pipeline_stage_id),
      )
    }
    if (lead_name) {
      const ll = lead_name.toLowerCase()
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(ll) ||
          (i.subtitle ?? '').toLowerCase().includes(ll),
      )
    }
    const total = items.length
    const sliced = items.slice(0, limit)
    return {
      text: asJson({
        pipeline: pipeline.name,
        kind: pipeline.kind,
        total,
        truncated: total > sliced.length,
        items: sliced.map((i) => ({
          id: i.id,
          title: i.title,
          subtitle: i.subtitle,
          status: i.status,
          stage: i.pipeline_stage_id
            ? (stageMap[i.pipeline_stage_id] ?? 'Unknown')
            : 'Unassigned',
          value: i.value,
        })),
      }),
    }
  }
}

async function handle_list_kpi_history(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const days = clampLimit(args.days ?? 7, 7)
  const metric_key = (args.metric_key as string | undefined) ?? undefined

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  let cardsQuery = supabase
    .from('kpi_cards')
    .select('id, label, metric_key, unit, period, goal_value')
    .eq('rep_id', ctx.tenant.id)
    .eq('member_id', ctx.ownerMemberId)
    .is('archived_at', null)
  if (metric_key) cardsQuery = cardsQuery.eq('metric_key', metric_key)

  const { data: cards } = await cardsQuery
  if (!cards?.length) {
    return { text: asJson({ window_days: days, message: 'No KPI cards found.', history: [] }) }
  }

  const cardIds = cards.map((c) => c.id)
  const { data: entries } = await supabase
    .from('kpi_entries')
    .select('kpi_card_id, day, value, note')
    .in('kpi_card_id', cardIds)
    .gte('day', since)
    .order('day', { ascending: false })

  const cardMap = Object.fromEntries(cards.map((c) => [c.id, c]))
  return {
    text: asJson({
      window_days: days,
      cards: cards.map((c) => ({
        id: c.id,
        label: c.label,
        metric_key: c.metric_key,
        period: c.period,
        goal_value: c.goal_value,
      })),
      history: (entries ?? []).map((e) => ({
        label: (cardMap[e.kpi_card_id] as { label?: string } | undefined)?.label ?? e.kpi_card_id,
        day: e.day,
        value: e.value,
        note: e.note,
      })),
    }),
  }
}

async function handle_list_roleplay_sessions(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const limit = clampLimit(args.limit, 10)
  const status = (args.status as string | undefined) ?? undefined

  let query = supabase
    .from('roleplay_sessions')
    .select(
      'id, status, started_at, completed_at, duration_seconds, ai_score, ai_summary, ai_strengths, ai_weaknesses, roleplay_scenarios(id, title, difficulty, objective)',
    )
    .eq('rep_id', ctx.tenant.id)
    .eq('member_id', ctx.ownerMemberId)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (status) query = query.eq('status', status)

  const { data: sessions, error } = await query
  if (error) return { text: asJson({ error: error.message, items: [] }) }

  return {
    text: asJson({
      total: sessions?.length ?? 0,
      items: (sessions ?? []).map((s) => {
        const scenario = s.roleplay_scenarios as
          | { id: string; title: string; difficulty: string | null; objective: string | null }
          | null
        return {
          id: s.id,
          status: s.status,
          started_at: s.started_at,
          completed_at: s.completed_at,
          duration_seconds: s.duration_seconds,
          ai_score: s.ai_score,
          ai_summary: s.ai_summary,
          ai_strengths: s.ai_strengths,
          ai_weaknesses: s.ai_weaknesses,
          scenario: scenario
            ? {
                id: scenario.id,
                title: scenario.title,
                difficulty: scenario.difficulty,
                objective: scenario.objective,
              }
            : null,
        }
      }),
    }),
  }
}

async function handle_list_dialer_calls(
  ctx: AgentContext,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const limit = clampLimit(args.limit ?? 20, 20)
  const days = args.days ? clampLimit(args.days as number, 7) : 7
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const { data: calls, error } = await supabase
    .from('voice_calls')
    .select(
      'id, direction, status, outcome, to_number, duration_sec, transcript, started_at, created_at, leads(name, company)',
    )
    .eq('rep_id', ctx.tenant.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { text: asJson({ error: error.message, items: [] }) }

  return {
    text: asJson({
      window_days: days,
      total: calls?.length ?? 0,
      items: (calls ?? []).map((c) => {
        const lead = c.leads as { name?: string; company?: string | null } | null
        return {
          id: c.id,
          direction: c.direction,
          status: c.status,
          outcome: c.outcome,
          contact: lead?.name
            ? `${lead.name}${lead.company ? ` (${lead.company})` : ''}`
            : (c.to_number ?? 'unknown'),
          duration_sec: c.duration_sec,
          started_at: c.started_at ?? c.created_at,
          transcript_snippet: c.transcript ? (c.transcript as string).slice(0, 200) : null,
        }
      }),
    }),
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
  list_pipeline_boards: (ctx) => handle_list_pipeline_boards(ctx),
  list_pipeline_leads: handle_list_pipeline_leads,
  list_kpi_history: handle_list_kpi_history,
  list_roleplay_sessions: handle_list_roleplay_sessions,
  list_dialer_calls: handle_list_dialer_calls,
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
    name: 'list_pipeline_boards',
    description:
      "List all kanban pipeline boards the tenant has, with their stages and card counts per stage. Use when the rep asks about their pipeline overview, which board exists, how many deals are in each stage, or just wants to see all boards at a glance.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_pipeline_leads',
    description:
      "List leads (or pipeline items for non-sales boards) for a specific pipeline, optionally filtered by stage name and/or lead/item name. Use for: 'what's in my Follow-Up stage', 'who's in Proposal', 'what stage is Dana in', 'show me everyone in Negotiation', 'who's in my recruiting pipeline'.",
    input_schema: {
      type: 'object',
      properties: {
        pipeline_name: {
          type: 'string',
          description: "Name (or partial name) of the pipeline. Omit to use the first/default pipeline.",
        },
        stage_name: {
          type: 'string',
          description: "Filter to this stage only (partial match). Omit to see all stages.",
        },
        lead_name: {
          type: 'string',
          description: "Filter by a specific lead/item name — use for 'what stage is Dana in'.",
        },
        limit: { type: 'number', description: 'Max items (default 50, max 100).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_kpi_history',
    description:
      "Return KPI entry history for the caller's KPI cards over the last N days. Use when they ask about trends — 'how many dials did I average this week', 'show me my convos vs last week', 'how am I tracking on appointments'.",
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 7, max 100).' },
        metric_key: {
          type: 'string',
          description: "Optional filter by metric_key (e.g. 'dials', 'conversations'). Omit to return all cards.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_roleplay_sessions',
    description:
      "List the caller's recent roleplay sessions with AI scores, summaries, and scenario info. Use for: 'what's my roleplay score', 'how did I do on my last session', 'what scenarios have I completed', 'what's my average score this week'.",
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of sessions to return (default 10, max 100).' },
        status: {
          type: 'string',
          enum: ['active', 'completed', 'abandoned'],
          description: "Filter by session status. Omit to return all.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_dialer_calls',
    description:
      "List recent AI dialer call history (voice_calls). Use when the rep asks about dialer activity: 'did the AI confirm Betty', 'what happened on my dialer runs today', 'any confirmed appointments', 'show me today's call outcomes'.",
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 7, max 100).' },
        limit: { type: 'number', description: 'Max calls to return (default 20, max 100).' },
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
      "Execute one or more structured ACTION intents through the existing dispatcher. This is your ONLY way to make changes (create tasks, log calls, set targets, snooze leads, schedule meetings, send DMs, send emails, send SMS, etc.). Never just say 'I'll add that' \u2014 always call delegate_intents with the right intent shape. Each intent runs server-side with full safety checks (confirmation prompts where applicable).\n\nIntent shapes (one of, set 'kind' to the variant):\n\n- { kind:'add_lead', name, company?, email?, status?, note? }\n- { kind:'update_lead', lead_name, status?, note?, mark_contacted?, email?, company?, phone? }\n- { kind:'schedule_followup', lead_name, due_date:'YYYY-MM-DD', content, priority? }\n- { kind:'brain_item', item_type:'task'|'goal'|'idea'|'plan'|'note', content, priority?, horizon?, due_date? }\n- { kind:'log_call', lead_name, summary, outcome?, next_step?, duration_minutes? }\n- { kind:'book_meeting', lead_name?, contact_name?, email?, start_iso, duration_minutes?, summary, notes? }\n- { kind:'reschedule_meeting', lead_name?, contact_name?, original_when?, new_start_iso, new_duration_minutes? }\n- { kind:'cancel_meeting', lead_name?, contact_name?, original_when? }\n- { kind:'request_one_on_one', member_name, duration_minutes?, within?, purpose? }\n- { kind:'pipeline_triage', count? }\n- { kind:'snooze_lead', lead_name, until_date?, within? }\n- { kind:'set_deal_value', lead_name, deal_value, currency? }\n- { kind:'handoff_lead', lead_name, to_member_name }\n- { kind:'objection_coach', objection }\n- { kind:'rep_pulse', member_name, period? }\n- { kind:'leaderboard', period?, metric? }\n- { kind:'forecast', period? }\n- { kind:'winloss', period? }\n- { kind:'announce', message, audience?, team_name? }\n- { kind:'inbox_zero', days? }\n- { kind:'set_target', period_type, metric, target_value, scope?, team_name?, notes?, visibility? }\n- { kind:'report', report_type:'pipeline'|'today'|'week'|'calendar'|'goals'|'metrics'|'lead_history', lead_name? }\n- { kind:'dm_member', member_name, message }\n- { kind:'room_post', audience:'managers'|'owners'|'team', team_name?, message }\n- { kind:'commission_report', period? }\n- { kind:'defer_item', title, body?, remind_at_iso?, source_lead_name? }\n- { kind:'complete_task', query }\n- { kind:'move_task', query, new_due_date?, new_content?, new_priority? }\n- { kind:'assign_task', member_name, content, due_date?, priority?, timeframe? }\n- { kind:'arm_voice_send', member_name, flavor?, lead_name? }\n- { kind:'move_lead_stage', lead_name, stage_name, note? } \u2014 moves a lead to a named pipeline stage and optionally drops a note in the CRM\n- { kind:'bulk_import_leads', pipeline_name } \u2014 USE THIS when the user pastes a long structured list of 3+ prospects and asks to track them / build a pipeline / set up a pipeline file. Emit JUST this intent (no add_lead spam). The dispatcher deep-parses the user's raw message and creates the pipeline + every lead + stage assignments. NEVER ask the user 'which option do you want' for these.\n- { kind:'send_email', lead_name, subject, body, to_email? } \u2014 sends an email to a prospect FROM the rep's connected Gmail account. to_email is optional (server looks up the lead's email). subject and body are required.\n- { kind:'send_sms', lead_name, message, to_phone? } \u2014 sends an SMS to a prospect via the tenant's Twilio account. to_phone is optional (server looks up the lead's phone). message is required.\n\nEmit multiple intents in one call when a message has multiple actions (e.g. 'just talked to Dana she's hot, follow up Thursday' \u2192 log_call + update_lead + schedule_followup).",
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
