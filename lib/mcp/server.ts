/**
 * The Suite CXO MCP server: what an executive's own Claude or ChatGPT can do
 * once a key from the Integrations page is connected.
 *
 * One server instance per request (stateless Streamable HTTP). Every tool is
 * scoped to the authenticated account; nothing takes an account argument.
 *
 * Tool descriptions are written for an executive's assistant, not a
 * developer: each says which question it answers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { BREAKDOWN_DIMS } from '@/lib/pinnacle/rollup'
import {
  DASHBOARD_KPIS,
  DASHBOARD_TILES,
  DASHBOARD_TIMEFRAMES,
  describeDashboardCatalog,
  getDashboardPrefs,
  setDashboardPrefs,
  type DashboardPrefs,
  type DashboardPrefsPatch,
} from '@/lib/dashboardPrefs'
import type { McpAuthContext } from './auth'
import type { AgentContext } from '@/lib/agent/tools'
import { CXO_TOOL_HANDLERS } from '@/lib/agent/cxoTools'
import { inboxAllowed } from '@/lib/cxoFeatures'
import { PARTNER_KINDS } from '@/lib/partners'
import { CONFIRM_REFUSAL, isOutbound, outboundRefusal, withoutConfirm } from './confirm'
import { isGatedCall } from '@/lib/agent/confirmGateShared'
import { allowed } from '@/lib/settings/registryShared'
import { QUEUE_COMMAND } from '@/lib/mira/dailyQueueShared'
import {
  Loader,
  WINDOW_KEYS,
  comparePeriods,
  getAgencyBooks,
  getBreakdown,
  getCompanySnapshot,
  getEntity,
  getOverview,
  getStatusFunnel,
  getTrend,
  listMeetings,
  search,
} from './data'

export const MCP_SERVER_NAME = 'suite-cxo'
export const MCP_SERVER_VERSION = '1.0.0'

// ── Shared schemas ─────────────────────────────────────────────────────────

const windowSchema = z
  .union([
    z.enum(WINDOW_KEYS),
    z.object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
    }),
  ])
  .describe(
    'Period to measure. One of: mtd (month to date), qtd, ytd, 3m / 6m / 12m (trailing months), last_month, last_year, all, or {start, end} dates.',
  )

const lineSchema = z
  .enum(['All', 'Health', 'Life', 'Annuity'])
  .describe('Product line. All (default), Health, Life or Annuity.')

const bookSchema = z
  .string()
  .describe('Which book of business: "pinnacle" (the master book, default), "all" (every book combined), or a book name from get_agency_books.')

function json(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] }
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: msg, summary: `Could not complete that: ${msg}` }) }] }
}

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn())
  } catch (err) {
    return fail(err)
  }
}

function layoutResult(prefs: DashboardPrefs, changed: string) {
  return {
    ...prefs,
    catalog: describeDashboardCatalog(),
    summary: `${changed} Dashboard now shows ${prefs.tiles.length} tiles (${prefs.tiles.join(', ')}), default timeframe ${prefs.default_timeframe}, ${prefs.pinned_kpis.length} pinned KPIs, ${prefs.notes.length} notes.`,
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

/**
 * The agreement wall over MCP (lib/agreementWall.ts): a key made by someone who
 * has not signed still connects and lists its tools, but every tool call and
 * resource read answers with the sign link instead of data.
 */
export type McpBuildOptions = { agreementBlocked?: { message: string; signUrl: string } | null }

function blockEveryCall(server: McpServer, blocked: { message: string; signUrl: string }) {
  const toolResult = {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'agreement_required', sign_url: blocked.signUrl, summary: blocked.message }) }],
  }
  const regTool = server.registerTool.bind(server) as unknown as (name: string, config: unknown, cb: unknown) => unknown
  ;(server as unknown as { registerTool: unknown }).registerTool = (name: string, config: unknown) => regTool(name, config, async () => toolResult)
  const regRes = server.registerResource.bind(server) as unknown as (name: string, uri: unknown, meta: unknown, cb: unknown) => unknown
  ;(server as unknown as { registerResource: unknown }).registerResource = (name: string, uri: unknown, meta: unknown) =>
    regRes(name, uri, meta, async (u: URL) => ({ contents: [{ uri: u.href, mimeType: 'text/plain', text: blocked.message }] }))
}

export function buildMcpServer(auth: McpAuthContext, opts: McpBuildOptions = {}): McpServer {
  // The email inbox / Gmail: Pinnacle edition only on Suite CXO (owner 2026-10-17).
  const inbox = inboxAllowed(auth.tenant)
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Suite CXO' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        `You are connected to Suite CXO, the executive dashboard for ${auth.tenant.company || auth.tenant.display_name}, a life insurance IMO (independent marketing organisation: carriers above, agencies and producers below). ` +
        'The person you are helping runs the business. Use their vocabulary: issued premium, placement, carriers, agencies, books of business, producers. ' +
        'Start broad with get_company_snapshot, then drill in. Every tool returns a one-line "summary" you can read out. ' +
        'Premium means annual issued premium bucketed by policy effective date. ' +
        'You can also rearrange their dashboard: set_dashboard_layout, pin_kpi, set_default_timeframe and add_note change what they see on screen immediately (layout changes are for the owner or an admin). ' +
        'Settings and setup: never send them to find a setting. list_settings and explain_setting say what each setting is, where it lives and who may change it; change_setting and do_action change it for them (invite a co-admin, add their assistant, reminders, time zone, logo, assistant name...); setup_progress walks a new person through setup. Careful ones answer needs_confirmation: read back what will happen, get their yes, then call again with confirm: true. When the answer has a link, they do that step on the page. ' +
        'Partners (list_partners, get_partner) and messages to them: compose_partner_message always drafts first; send_partner_message only when the executive explicitly says to send, after a one-line readback. Calendar writes (create_calendar_event, schedule_call_with_partner, update/cancel) are real Google events with invites; repeat the readback line they return. ' +
        (inbox
          ? 'Their Gmail: list_inbox / read_thread read it; reply_to_thread drafts by default (Gmail Drafts) and sends only on an explicit ask. ' +
            'Anything that sends or books (send_partner_message, reply_to_thread mode=send, every calendar write, approve_queue_item) is refused without confirm: true. Pass it only after you have read back what will happen and the person has said yes in this conversation. '
          : 'There is no email inbox here: Suite CXO does not read their email. ' +
            'Anything that sends or books (send_partner_message, every calendar write, approve_queue_item) is refused without confirm: true. Pass it only after you have read back what will happen and the person has said yes in this conversation. ') +
        '"Run daily queue": get_daily_queue returns what is pending for them; you do the judgement and wording, save it with file_queue_todo, save_reply_draft, save_talking_points and save_meeting_brief (drafts and proposals only, nothing is sent), then finish_daily_queue.' +
        (opts.agreementBlocked
          ? ` IMPORTANT: this person has not signed their agreement yet, so every tool answers with an error until they do. Tell them: ${opts.agreementBlocked.message}`
          : ''),
    },
  )
  if (opts.agreementBlocked) blockEveryCall(server, opts.agreementBlocked)

  const L = new Loader(auth.tenant)
  const author = auth.member.display_name || auth.member.email

  // ── Read tools ──────────────────────────────────────────────────────────

  server.registerTool(
    'get_company_snapshot',
    {
      title: 'Company snapshot',
      description:
        'The Monday-morning view in one call: year-to-date issued premium and pace vs last year, month to date vs the same days last month (the same comparison the Revenue card shows), trailing 3/6/12-month trend with direction, applications vs paid and the placement rate, product mix (Health / Life / Annuity), top 5 producers, carriers, states and agencies, and a watch list of anything that looks off. Answers "how is the business doing?"',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(() => getCompanySnapshot(L)),
  )

  server.registerTool(
    'get_overview',
    {
      title: 'Premium overview',
      description:
        'Issued premium year to date, month to date vs the same days last month (plus a labelled straight-line estimate), and trailing 3, 6 and 12 months, each with the change vs the prior period; plus year-to-date product mix and the submitted → paid funnel. Answers "where are we on premium?"',
      inputSchema: { line: lineSchema.optional(), book: bookSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ line, book }) => run(() => getOverview(L, { line, book })),
  )

  server.registerTool(
    'get_trend',
    {
      title: 'Premium trend',
      description:
        'Issued premium and policies over time, by day, week or month, for any period. Says whether the trend is rising or falling and names the best period. Answers "is premium growing?" and "what did each month look like?"',
      inputSchema: {
        window: windowSchema.optional(),
        grain: z.enum(['day', 'week', 'month']).optional().describe('Bucket size. Default month.'),
        line: lineSchema.optional(),
        book: bookSchema.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ window, grain, line, book }) => run(() => getTrend(L, { window, grain, line, book })),
  )

  server.registerTool(
    'get_breakdown',
    {
      title: 'Breakdown by agency, producer, carrier, state or product',
      description:
        'Ranked table of issued premium, policies, share and placement by agency (team), producer (agent), carrier, state or product for a period. Answers "who are the top producers?", "which carriers do we place with?", "where are we writing business?"',
      inputSchema: {
        dim: z.enum(BREAKDOWN_DIMS).describe('team = agency, agent = producer, carrier, state, product'),
        window: windowSchema.optional(),
        line: lineSchema.optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Rows to return. Default 15.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ dim, window, line, limit }) => run(() => getBreakdown(L, { dim, window, line, limit })),
  )

  server.registerTool(
    'get_status_funnel',
    {
      title: 'Placement funnel',
      description:
        'Applications submitted, paid (placed), declined and lapsed for a period, with the placement rate and how it moved vs the prior period. Answers "what is our placement rate?" and "are declines or lapses rising?"',
      inputSchema: { window: windowSchema.optional(), line: lineSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ window, line }) => run(() => getStatusFunnel(L, { window, line })),
  )

  server.registerTool(
    'get_agency_books',
    {
      title: 'Books of business',
      description:
        'Every book of business side by side (the master book and each agency book): issued premium, policies, average premium, change vs prior period and product mix. Answers "how is each agency book doing?"',
      inputSchema: { window: windowSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ window }) => run(() => getAgencyBooks(L, { window })),
  )

  server.registerTool(
    'compare_periods',
    {
      title: 'Compare two periods',
      description:
        'Any two periods side by side — issued premium, policies, average premium, applications, placement and product mix — with the deltas. Answers "how does this quarter compare with last?" or "Q1 vs Q1 last year".',
      inputSchema: { a: windowSchema, b: windowSchema, line: lineSchema.optional(), book: bookSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ a, b, line, book }) => run(() => comparePeriods(L, { a, b, line, book })),
  )

  server.registerTool(
    'get_agent',
    {
      title: 'Producer deep dive',
      description:
        'One producer (agent) in depth: rank, issued premium and share of the book, policies, average premium, placement, Health / Life / Annuity split, and change vs the prior period. Answers "how is [producer] doing?"',
      inputSchema: { name: z.string().min(1).describe('Producer name, or part of it.'), window: windowSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ name, window }) => run(() => getEntity(L, { dim: 'agent', name, window })),
  )

  server.registerTool(
    'get_carrier',
    {
      title: 'Carrier deep dive',
      description:
        'One carrier in depth: rank, issued premium and share of the book, policies, placement, declines and lapses, Health / Life / Annuity split, and change vs the prior period. Answers "how much are we placing with [carrier]?"',
      inputSchema: { name: z.string().min(1).describe('Carrier name, or part of it.'), window: windowSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ name, window }) => run(() => getEntity(L, { dim: 'carrier', name, window })),
  )

  server.registerTool(
    'get_agency',
    {
      title: 'Agency deep dive',
      description:
        'One agency (team) in depth: rank, issued premium and share, policies, placement, product split and change vs the prior period. Answers "how is [agency] performing?"',
      inputSchema: { name: z.string().min(1).describe('Agency name, or part of it.'), window: windowSchema.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ name, window }) => run(() => getEntity(L, { dim: 'team', name, window })),
  )

  server.registerTool(
    'search',
    {
      title: 'Find a producer, carrier, agency or state',
      description:
        'Search producers, carriers, agencies and states by name and get each match with its rank and issued premium. Use it when you are not sure of the exact name before calling get_agent, get_carrier or get_agency.',
      inputSchema: {
        query: z.string().min(1),
        window: windowSchema.optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, window, limit }) => run(() => search(L, { query, window, limit })),
  )

  server.registerTool(
    'list_meetings',
    {
      title: 'Upcoming meetings',
      description: 'Meetings on the executive calendar for the next N days (default 7), in their local time. Answers "what is on my calendar?"',
      inputSchema: { days: z.number().int().min(1).max(60).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => run(() => listMeetings(L, { days })),
  )

  // ── Partners + calendar (same handlers Mira uses) ───────────────────────

  const agentCtx: AgentContext = {
    tenant: auth.tenant,
    caller: auth.member,
    timezone: auth.member.timezone || auth.tenant.timezone || 'America/New_York',
    todayIso: L.today,
    ownerMemberId: auth.member.id,
  }
  // Every write over MCP leaves a row in cxo_mira_audit (tool "mcp:<name>"), switch on or off.
  const mcpAudit = async (tool: string, args: Record<string, unknown>, result: 'ok' | 'not_done' | 'error' | 'refused') => {
    try {
      const { recordAudit } = await import('@/lib/ops/audit')
      await recordAudit({ repId: auth.tenant.id, memberId: auth.member.id, tool: `mcp:${tool}`, args: { ...args, key_label: auth.tokenLabel }, result })
    } catch {
      /* never blocks the call */
    }
  }
  const MCP_WRITES = new Set(['reply_to_thread', 'send_partner_message', 'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner', 'set_employee_quota', 'update_employee', 'log_time_off'])
  const viaMira = (name: string, rawArgs: Record<string, unknown>) =>
    run(async () => {
      // Sends and bookings need the person's yes: refused here, before any handler runs.
      const no = outboundRefusal(name, rawArgs)
      if (no) {
        if (MCP_WRITES.has(name)) await mcpAudit(name, withoutConfirm(rawArgs), 'refused')
        throw new Error(no)
      }
      const args = withoutConfirm(rawArgs)
      const r = await CXO_TOOL_HANDLERS[name](agentCtx, args)
      const out = JSON.parse(r.text) as Record<string, unknown>
      if (MCP_WRITES.has(name) && (name !== 'schedule_call_with_partner' || isOutbound(name, rawArgs))) await mcpAudit(name, args, out.ok === false ? 'not_done' : 'ok')
      if (out.ok === false && typeof out.error === 'string' && !out.ask && !out.ambiguous) throw new Error(String(out.say ?? out.error))
      return out
    })
  const partnerArg = z.string().min(1).describe('Who, as the executive says it: a name, "Dana at Mutual of Omaha", or a company. If several match, the result lists candidates: ask which.')
  const whenArg = (what: string) => z.string().describe(`${what}, ISO 8601 (2026-10-09T14:00:00). No zone = the executive's timezone.`)

  server.registerTool(
    'list_partners',
    {
      title: 'Partners',
      description: 'The team\'s shared contact directory: executive partners, carrier reps, vendors, other. q searches name, company, role, email, phone and tags; type filters.',
      inputSchema: { q: z.string().optional(), type: z.enum(['executive', 'carrier', 'vendor', 'other']).optional(), kind: z.enum(PARTNER_KINDS).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => viaMira('list_partners', args),
  )

  server.registerTool(
    'get_partner',
    {
      title: 'One partner',
      description: 'A partner in full: details, next meetings with us from the calendar, and the last notes, emails and reports sent to them.',
      inputSchema: { partner: partnerArg },
      annotations: { readOnlyHint: true },
    },
    async (args) => viaMira('get_partner', args),
  )

  server.registerTool(
    'compose_partner_message',
    {
      title: 'Draft a note, email or production report for a partner',
      description:
        'Writes the draft and saves it (nothing is sent). For a production report pass report_items, one per product line with its own window: "health premium for the last 3 months and life for the last 6" → [{line:"Health",window:"3m"},{line:"Life",window:"6m"}]. Figures come from the live book with exact periods and the data-through date; a window with no data is called out. Returns draft_id, subject, body and whether a send path is ready.',
      inputSchema: {
        partner: partnerArg,
        kind: z.enum(['note', 'email', 'report']),
        subject: z.string().optional(),
        body: z.string().optional().describe('For note/email: the full message in the executive\'s voice.'),
        report_items: z.array(z.object({ line: z.enum(['Health', 'Life', 'Annuity', 'All']), window: windowSchema })).optional(),
        intro: z.string().optional(),
        closing: z.string().optional(),
        from_account: z.string().optional().describe('Connected Google account email to draft on, when they have several.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => viaMira('compose_partner_message', args),
  )

  // The executive's Gmail: Pinnacle edition only on Suite CXO (owner 2026-10-17).
  if (inbox) {
    server.registerTool(
      'list_inbox',
      {
        title: 'The executive\'s Gmail inbox',
        description: 'Recent threads in their own Gmail (read-only). partner = only mail with that partner; q = a Gmail search ("is:unread", "subject:renewal"). Returns thread ids for read_thread / reply_to_thread.',
        inputSchema: { partner: partnerArg.optional(), q: z.string().optional(), limit: z.number().int().min(1).max(20).optional(), from_account: z.string().optional() },
        annotations: { readOnlyHint: true },
      },
      async (args) => viaMira('list_inbox', args),
    )

    server.registerTool(
      'read_thread',
      {
        title: 'Read one Gmail thread',
        description: 'Every message in the thread: from, when, text. Use before summarising or replying.',
        inputSchema: { thread_id: z.string().min(1), from_account: z.string().optional() },
        annotations: { readOnlyHint: true },
      },
      async (args) => viaMira('read_thread', args),
    )

    server.registerTool(
      'reply_to_thread',
      {
        title: 'Reply in a Gmail thread as the executive',
        description:
          'mode=draft (default) saves the reply in their Gmail Drafts and returns gmail_draft_id: show the text and stop. mode=send only after they explicitly say to send, with confirm: true (refused without it); pass gmail_draft_id (and action_id if returned) to send that exact draft, or thread_id + body to send straight away. Read back one line first. A reply to a partner is recorded on them.',
        inputSchema: {
          thread_id: z.string().optional(),
          body: z.string().optional(),
          mode: z.enum(['draft', 'send']).optional(),
          gmail_draft_id: z.string().optional(),
          action_id: z.string().optional(),
          to: z.string().optional(),
          from_account: z.string().optional(),
          confirm: z.boolean().optional().describe('Required for mode=send. true only after you read back what will happen and the person said yes.'),
        },
        annotations: { readOnlyHint: false },
      },
      async (args) => viaMira('reply_to_thread', args),
    )
  }

  server.registerTool(
    'send_partner_message',
    {
      title: 'Send a saved draft to a partner',
      description:
        'Sends a draft from compose_partner_message as the executive, from their connected Gmail (or the Suite CXO mailer with them as reply-to). Only after they explicitly ask to send; read back to whom and the subject first, then pass confirm: true (refused without it). The send is recorded on the partner.',
      inputSchema: {
        draft_id: z.string().optional(),
        partner: partnerArg.optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        to: z.string().optional(),
        from_account: z.string().optional().describe('Connected Google account email to send from, when they have several.'),
        confirm: z.boolean().optional().describe('Required to send or book. true only after you read back what will happen and the person said yes.'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('send_partner_message', args),
  )

  server.registerTool(
    'list_calendars',
    {
      title: 'Calendars the executive can book on',
      description: 'Every calendar with write access across the connected Google accounts.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => viaMira('list_calendars', {}),
  )

  server.registerTool(
    'find_open_slots',
    {
      title: 'Open times',
      description: 'Free slots across EVERY connected calendar inside working hours in the executive\'s timezone. Default: next 5 days, 9–17, 30 minutes.',
      inputSchema: {
        from: whenArg('Window start').optional(),
        to: whenArg('Window end').optional(),
        duration_min: z.number().int().min(5).max(480).optional(),
        start_hour: z.number().int().min(0).max(23).optional(),
        end_hour: z.number().int().min(1).max(24).optional(),
        count: z.number().int().min(1).max(20).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => viaMira('find_open_slots', args),
  )

  server.registerTool(
    'create_calendar_event',
    {
      title: 'Create a calendar event with invites',
      description:
        'A real Google Calendar event; attendees (emails or partner names) get the invite. Default calendar is the executive\'s primary. Refuses a time that clashes with anything on any connected calendar unless allow_conflict is true. Ask first, then pass confirm: true (refused without it). Returns a one-line readback (who, when, which calendar) to repeat to them.',
      inputSchema: {
        title: z.string().min(1),
        start: whenArg('Start'),
        end: whenArg('End').optional(),
        duration_min: z.number().int().optional(),
        attendees: z.array(z.string()).optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        video: z.boolean().optional().describe('Add a Google Meet link.'),
        calendar: z.string().optional().describe('Calendar name or account email.'),
        allow_conflict: z.boolean().optional(),
        confirm: z.boolean().optional().describe('Required to send or book. true only after you read back what will happen and the person said yes.'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('create_calendar_event', args),
  )

  server.registerTool(
    'update_calendar_event',
    {
      title: 'Move or edit an event',
      description: 'Changes an existing event; attendees are notified. Ask first, then pass confirm: true (refused without it). event_id comes from get_partner next_meetings or list_meetings.',
      inputSchema: {
        event_id: z.string().min(1),
        title: z.string().optional(),
        start: whenArg('New start').optional(),
        end: whenArg('New end').optional(),
        duration_min: z.number().int().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        add_attendees: z.array(z.string()).optional(),
        confirm: z.boolean().optional().describe('Required to send or book. true only after you read back what will happen and the person said yes.'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('update_calendar_event', args),
  )

  server.registerTool(
    'cancel_calendar_event',
    {
      title: 'Cancel an event',
      description: 'Cancels the event and notifies attendees. Ask first, then pass confirm: true (refused without it). Pass partners involved so the cancellation is logged on them.',
      inputSchema: { event_id: z.string().min(1), partners: z.array(z.string()).optional(), confirm: z.boolean().optional().describe('Required. true only after the person said yes to cancelling this event.') },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => viaMira('cancel_calendar_event', args),
  )

  server.registerTool(
    'schedule_call_with_partner',
    {
      title: 'Book a call with a partner',
      description:
        'End to end: resolves the partner, finds an open slot (or uses the exact start given), books it with a Google Meet link and sends the invite. With only a window it returns up to three open times to choose from unless pick_first is true. Booking (a start, or pick_first) needs confirm: true after the person says yes. Returns a readback line with the exact time in the executive\'s timezone.',
      inputSchema: {
        partner: partnerArg,
        start: whenArg('Exact start').optional(),
        window_from: whenArg('Earliest acceptable').optional(),
        window_to: whenArg('Latest acceptable').optional(),
        duration_min: z.number().int().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        calendar: z.string().optional(),
        video: z.boolean().optional(),
        pick_first: z.boolean().optional(),
        start_hour: z.number().int().optional(),
        end_hour: z.number().int().optional(),
        confirm: z.boolean().optional().describe('Required when it books (a start, or pick_first). Not needed to list open times. true only after you read back what will happen and the person said yes.'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('schedule_call_with_partner', args),
  )

  // ── Run daily queue (the person's own Claude does the thinking) ─────────
  //
  // Same gatherer the in-app run uses, no model call on our side. The save
  // tools are internal and reversible: a to-do on their own list, a draft, a
  // proposal, a brief. Nothing here sends; approve_queue_item is the tap, and
  // it is refused without confirm: true.

  const queueCtx = { tenant: auth.tenant, member: auth.member }
  const queue = async () => import('@/lib/mira/dailyQueue')

  server.registerTool(
    'get_daily_queue',
    {
      title: 'What is pending for them today',
      description:
        'Everything waiting on the person, as structured data: meeting notes not yet scanned, unanswered messages from coworkers (with ids), partner follow-ups, their own inbox counts (when they have the inbox), 1:1s due in the next 2 days or overdue (goals, open action items, recent messages), today\'s and tomorrow\'s meetings, to-dos and board cards due or overdue, and goals off pace. Their own items only. Names of clients and any pay are never included. has_draft / has_talking_points / has_brief = already done, skip it.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => ({ ...(await (await queue()).pendingForClaude(queueCtx)), summary: 'Pending items for the daily queue. Work them, save with the save tools, then call finish_daily_queue.' })),
  )

  server.registerTool(
    'file_queue_todo',
    {
      title: 'File a to-do on their own list',
      description: 'Adds one to-do to the person\'s OWN list (never anyone else\'s). Pass message_id to turn a coworker\'s request into a to-do, or body for a new one. The same to-do is never filed twice.',
      inputSchema: { body: z.string().max(500).optional(), message_id: z.string().optional(), due_date: z.string().max(10).optional().describe('YYYY-MM-DD') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a) => run(async () => (await queue()).saveFromClaude(queueCtx, { kind: 'todo', body: a.body, message_id: a.message_id, due_date: a.due_date })),
  )

  server.registerTool(
    'save_reply_draft',
    {
      title: 'Save a draft reply to a coworker\'s message',
      description: 'Saves a DRAFT reply on the message. It is not sent: the person sends it with one tap in Suite CXO (or approve_queue_item after they say yes). One draft per message.',
      inputSchema: { message_id: z.string().min(1), body: z.string().min(1).max(2000) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a) => run(async () => (await queue()).saveFromClaude(queueCtx, { kind: 'reply_draft', message_id: a.message_id, body: a.body })),
  )

  server.registerTool(
    'save_talking_points',
    {
      title: 'Propose talking points for a 1:1',
      description: 'Proposes up to 6 short talking points for one of their 1:1s. They are NOT put on the shared agenda: the person adds them with one tap. One proposal per 1:1 date.',
      inputSchema: { one_on_one_id: z.string().min(1), points: z.array(z.string().min(1).max(200)).min(1).max(6) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a) => run(async () => (await queue()).saveFromClaude(queueCtx, { kind: 'talking_points', one_on_one_id: a.one_on_one_id, points: a.points })),
  )

  server.registerTool(
    'save_meeting_brief',
    {
      title: 'Save a short brief for a meeting',
      description: 'Saves a short brief (who, what changed since last time, open items) for one of today\'s or tomorrow\'s meetings. Only the person sees it, on their Today. One brief per meeting per day.',
      inputSchema: { meeting_id: z.string().min(1), title: z.string().min(1).max(160), brief: z.string().min(1).max(1500) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a) => run(async () => (await queue()).saveFromClaude(queueCtx, { kind: 'brief', meeting_id: a.meeting_id, title: a.title, brief: a.brief })),
  )

  server.registerTool(
    'finish_daily_queue',
    {
      title: 'Finish the daily queue run',
      description: 'Call once when you have worked the queue. Stores the run and returns the report: what was done, and "needs" = the items still waiting on the person\'s yes (each with an id for approve_queue_item). Read "needs" out to them.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => run(async () => (await queue()).finishFromClaude(queueCtx)),
  )

  server.registerTool(
    'approve_queue_item',
    {
      title: 'Approve one "needs you" item',
      description: 'THIS SENDS: it sends the drafted reply or email, or puts the talking points on the shared 1:1 agenda. Only after you have read the item back and the person said yes to that item; then pass confirm: true. Refused without it. One item per call, never in bulk.',
      inputSchema: { id: z.string().min(1), confirm: z.boolean().optional().describe('Required. true only after the person said yes to this exact item.') },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (a) =>
      run(async () => {
        const no = outboundRefusal('approve_queue_item', a)
        if (no) {
          await mcpAudit('approve_queue_item', { id: a.id }, 'refused')
          throw new Error(no)
        }
        const out = await (await queue()).approveQueueItem(queueCtx, a.id)
        await mcpAudit('approve_queue_item', { id: a.id }, 'ok')
        return out
      }),
  )

  // ── Employees + quotas (same handlers Mira uses; pay only for comp viewers) ──

  const employeeArg = z.string().min(1).describe('The employee: first name, full name or email. If several match, the result lists candidates: ask which.')

  // Employee records, quotas and time off are the whole company's: owner or
  // admin only, the same rule as the dashboard layout below (security audit
  // 2026-10-29 finding 2: a manager or assistant key could change any record).
  // Refused before any handler runs, and the refusal is audited.
  const hrAllowed = allowed('owner_admin', auth.member, auth.tenant)
  const HR_REFUSAL = 'Not done. Only the owner or an admin can change employee records, quotas or time off.'
  const hrWrite = (name: 'set_employee_quota' | 'update_employee' | 'log_time_off', rawArgs: Record<string, unknown>) =>
    hrAllowed
      ? viaMira(name, rawArgs)
      : run(async () => {
          await mcpAudit(name, withoutConfirm(rawArgs), 'refused')
          throw new Error(HR_REFUSAL)
        })

  server.registerTool(
    'employee_quota_status',
    {
      title: 'Employee quotas',
      description: 'Employees (staff, not agents) and their quotas this period: % to quota, pace and status; the tier reached and the next tier (as % of quota) for members who may see comp; never bonus or pay dollars. Answers "who is behind on quota", "how is Joe tracking". filter: behind | on_track | no_quota | all.',
      inputSchema: { employee: z.string().optional(), department: z.string().optional(), filter: z.enum(['all', 'behind', 'on_track', 'no_quota']).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => viaMira('employee_quota_status', args),
  )

  server.registerTool(
    'set_employee_quota',
    {
      title: 'Set an employee quota',
      description: 'Owner or admin only. Create or change one quota: "set Joe\'s Q1 quota to 40 policies". type: revenue | premium | policies | recruits | appointments | custom (custom needs name). period: month | quarter | year or a key like 2027-Q1. actual = progress so far, only when given. from_book fills progress from the book (premium/policies).',
      inputSchema: {
        employee: employeeArg,
        type: z.enum(['revenue', 'premium', 'policies', 'recruits', 'appointments', 'custom']).optional(),
        name: z.string().max(120).optional(),
        target: z.number().positive(),
        period: z.string().max(40).optional(),
        actual: z.number().optional(),
        from_book: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => hrWrite('set_employee_quota', args),
  )

  server.registerTool(
    'update_employee',
    {
      title: 'Update an employee',
      description: 'Owner or admin only. Change an employee\'s basics: title, department, manager, start_date, email, hours_per_week, PTO, book_name. base_salary and hourly_rate only for members who may see comp; the reply says salary saved and never repeats the amount. Pass only what changes.',
      inputSchema: {
        employee: employeeArg,
        title: z.string().max(120).optional(),
        department: z.string().max(80).optional(),
        manager: z.string().max(120).optional(),
        start_date: z.string().max(20).optional(),
        email: z.string().max(200).optional(),
        hours_per_week: z.number().min(0).optional(),
        pto_allowed_days: z.number().min(0).optional(),
        pto_balance_days: z.number().optional(),
        base_salary: z.number().min(0).optional(),
        hourly_rate: z.number().min(0).optional(),
        book_name: z.string().max(120).optional(),
        book_is_team: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => hrWrite('update_employee', args),
  )

  server.registerTool(
    'log_time_off',
    {
      title: 'Log time off',
      description: 'Owner or admin only. Log vacation, sick, personal or other time off for an employee. Dates YYYY-MM-DD; days defaults to weekdays in the range.',
      inputSchema: {
        employee: employeeArg,
        start_date: z.string().max(20),
        end_date: z.string().max(20).optional(),
        kind: z.enum(['vacation', 'sick', 'personal', 'other']).optional(),
        days: z.number().min(0).optional(),
        note: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => hrWrite('log_time_off', args),
  )

  // ── Dashboard layout (write) ────────────────────────────────────────────
  //
  // The layout is the whole company's: owner or admin only (settings audit
  // 2026-10-22: these writes had no role check). Notes are open to the exec team.

  const layoutAllowed = allowed('owner_admin', auth.member, auth.tenant)
  const LAYOUT_REFUSAL = 'Not done. Only the owner or an admin can change the company dashboard.'
  const layoutWrite = (tool: string, args: Record<string, unknown>, fn: () => Promise<unknown>, needsAdmin = true) =>
    run(async () => {
      if (needsAdmin && !layoutAllowed) {
        await mcpAudit(tool, args, 'refused')
        throw new Error(LAYOUT_REFUSAL)
      }
      const out = await fn()
      await mcpAudit(tool, args, 'ok')
      return out
    })

  server.registerTool(
    'get_dashboard_layout',
    {
      title: 'Current dashboard layout',
      description:
        'What the dashboard shows right now: tiles and their order, default timeframe, pinned KPIs, pinned breakdowns, hidden sections, headline note and notes — plus the catalog of everything that can be shown. Call this before changing the layout.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => layoutResult(await getDashboardPrefs(auth.tenant.id), 'Current layout.')),
  )

  server.registerTool(
    'set_dashboard_layout',
    {
      title: 'Rearrange the dashboard',
      description:
        'Change what the executive sees on their dashboard, in real time: which tiles and in what order, the default timeframe, pinned KPIs, pinned breakdown dimensions, hidden sections and a one-line headline note. Only the fields you pass change; arrays replace the current list. Use it for "put the carrier table first", "hide meetings", "show the last 12 months by default".',
      inputSchema: {
        tiles: z.array(z.enum(DASHBOARD_TILES)).optional().describe('Visible tiles in display order. Omit to keep.'),
        default_timeframe: z.enum(DASHBOARD_TIMEFRAMES).optional(),
        pinned_kpis: z.array(z.enum(DASHBOARD_KPIS)).optional().describe('KPIs shown in the top strip, in order.'),
        pinned_breakdowns: z.array(z.enum(BREAKDOWN_DIMS)).optional().describe('Breakdown tables shown by default (team = agency, agent = producer).'),
        hidden_sections: z.array(z.string().max(60)).optional(),
        headline_note: z.string().max(200).nullable().optional().describe('One line shown at the top of the dashboard. null clears it.'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (patch) => layoutWrite('set_dashboard_layout', patch as Record<string, unknown>, async () => layoutResult(await setDashboardPrefs(auth.tenant.id, { ...(patch as DashboardPrefsPatch), updated_by: 'mcp' }), 'Layout updated.')),
  )

  server.registerTool(
    'pin_kpi',
    {
      title: 'Pin or unpin a KPI',
      description: 'Add a KPI to the top strip of the dashboard (or remove it). KPIs: ' + DASHBOARD_KPIS.join(', ') + '.',
      inputSchema: {
        kpi: z.enum(DASHBOARD_KPIS),
        pinned: z.boolean().optional().describe('true (default) pins, false unpins.'),
        position: z.number().int().min(1).optional().describe('1-based position in the strip. Default: end.'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ kpi, pinned, position }) =>
      layoutWrite('pin_kpi', { kpi, pinned, position }, async () => {
        const cur = await getDashboardPrefs(auth.tenant.id)
        let next = cur.pinned_kpis.filter((k) => k !== kpi)
        if (pinned !== false) {
          const at = position ? Math.min(Math.max(position - 1, 0), next.length) : next.length
          next = [...next.slice(0, at), kpi, ...next.slice(at)]
        }
        return layoutResult(await setDashboardPrefs(auth.tenant.id, { pinned_kpis: next, updated_by: 'mcp' }), pinned === false ? `Unpinned ${kpi}.` : `Pinned ${kpi}.`)
      }),
  )

  server.registerTool(
    'set_default_timeframe',
    {
      title: 'Set the default timeframe',
      description: 'The period the dashboard opens on: mtd, qtd, ytd, 3m, 6m, 12m or all.',
      inputSchema: { timeframe: z.enum(DASHBOARD_TIMEFRAMES) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ timeframe }) =>
      layoutWrite('set_default_timeframe', { timeframe }, async () => layoutResult(await setDashboardPrefs(auth.tenant.id, { default_timeframe: timeframe, updated_by: 'mcp' }), `Default timeframe set to ${timeframe}.`)),
  )

  server.registerTool(
    'add_note',
    {
      title: 'Leave a note on the dashboard',
      description: 'Pin a short note to the dashboard notes tile for the executive and their team to see (e.g. "Ask about the Q4 carrier bonus"). Signed with the connected member\'s name.',
      inputSchema: {
        text: z.string().min(1).max(600),
        as_headline: z.boolean().optional().describe('Also set it as the one-line headline at the top of the dashboard.'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ text, as_headline }) =>
      layoutWrite('add_note', { text, as_headline }, async () => {
        const patch: DashboardPrefsPatch = { add_notes: [{ text, author }], updated_by: 'mcp' }
        if (as_headline) patch.headline_note = text.slice(0, 200)
        return layoutResult(await setDashboardPrefs(auth.tenant.id, patch), 'Note added.')
      }, as_headline === true),
  )

  server.registerTool(
    'remove_note',
    {
      title: 'Remove a note',
      description: 'Remove a note from the dashboard by its id (see get_dashboard_layout), or clear the headline note.',
      inputSchema: {
        note_id: z.string().optional(),
        clear_headline: z.boolean().optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ note_id, clear_headline }) =>
      layoutWrite('remove_note', { note_id, clear_headline }, async () => {
        const patch: DashboardPrefsPatch = { updated_by: 'mcp' }
        if (note_id) patch.remove_note_ids = [note_id]
        if (clear_headline) patch.headline_note = null
        return layoutResult(await setDashboardPrefs(auth.tenant.id, patch), note_id ? 'Note removed.' : 'Headline cleared.')
      }),
  )

  // ── Settings and actions (lib/settings/registry, the same one Ciao uses) ──
  //
  // Each entry checks its own role rule against this key's member; risky ones
  // need confirm: true; every change and action is audited by the registry.

  const reg = () => import('@/lib/settings/registry')
  const regCtx = (confirmed: boolean) => ({
    tenant: auth.tenant,
    member: auth.member,
    via: 'mcp' as const,
    confirmed,
    // A key that maps to an existing tool runs it here, with that tool's own confirm rule.
    runTool: async (tool: string, rawArgs: Record<string, unknown>) => {
      const { authorizeToolCall } = await import('@/lib/agent/access')
      const refusal = authorizeToolCall(tool, { tenant: auth.tenant })
      if (refusal) return JSON.parse(refusal.text) as Record<string, unknown>
      const args = withoutConfirm(rawArgs)
      if (!confirmed && (isOutbound(tool, args) || isGatedCall(tool, args))) return { ok: false, needs_confirmation: true, say: CONFIRM_REFUSAL }
      const handler = CXO_TOOL_HANDLERS[tool] ?? (await import('@/lib/agent/tools')).TOOL_HANDLERS[tool]
      if (!handler) return { ok: false, error: 'not_available', say: 'That is not available over this connection.' }
      const r = await handler({ ...agentCtx, userConfirmed: confirmed }, args)
      return JSON.parse(r.text) as Record<string, unknown>
    },
  })
  const regRun = (fn: () => Promise<Record<string, unknown>>) =>
    run(async () => {
      const out = await fn()
      return { ...out, summary: String(out.say ?? (out.ok === false ? 'Not done.' : 'Done.')) }
    })

  server.registerTool(
    'list_settings',
    {
      title: 'List settings and actions',
      description: 'Every setting and action in Suite CXO, or the ones matching a question ("assistant name", "reminders", "invite"). Each says whether this person may change it and whether you can do it for them.',
      inputSchema: { query: z.string().max(120).optional(), kind: z.enum(['setting', 'action']).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind }) => regRun(async () => (await reg()).listSettings(regCtx(false), query, kind)),
  )

  server.registerTool(
    'explain_setting',
    {
      title: 'Explain a setting',
      description: 'What one setting or action is, where it lives on screen, who may change it, whether you can do it, and its current value.',
      inputSchema: { key: z.string().min(1).max(120).describe('A key from list_settings, or words like "my time zone".') },
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => regRun(async () => (await reg()).explainSetting(regCtx(false), key)),
  )

  server.registerTool(
    'change_setting',
    {
      title: 'Change a setting',
      description: 'Change one setting for the person: role checked, validated, saved and read back. Careful ones answer needs_confirmation: read back the change, get their yes, then call again with confirm: true. A link in the answer means they do it on the page.',
      inputSchema: {
        key: z.string().min(1).max(120),
        value: z.unknown().describe('The new value, as explain_setting describes. "Back to the default", "reset" or "clear" is "default", never "off".'),
        target: z.string().max(200).optional().describe('Only for a setting about another teammate: their name or email.'),
        confirm: z.boolean().optional().describe('true only after the person said yes to this exact change.'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ key, value, target, confirm }) => regRun(async () => (await reg()).changeSetting(regCtx(confirm === true), key, value, { target })),
  )

  server.registerTool(
    'do_action',
    {
      title: 'Do an action',
      description: 'Run one action for the person: invite or remove a co-admin, add or remove their executive assistant, give an employee a login, turn off a connected-AI key, a new meeting-notes inbox link, remove an outside calendar, and the everyday ones (to-dos, partners, meetings, praise). Careful ones answer needs_confirmation: read back, get their yes, call again with confirm: true.',
      inputSchema: {
        key: z.string().min(1).max(120),
        input: z.record(z.string(), z.unknown()).optional().describe('What the action needs, as explain_setting lists.'),
        confirm: z.boolean().optional().describe('true only after the person said yes to this exact action.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ key, input, confirm }) => regRun(async () => (await reg()).doAction(regCtx(confirm === true), key, input ?? {})),
  )

  server.registerTool(
    'setup_progress',
    {
      title: 'Setup progress',
      description: 'What this person has set up and what is left, each step with how: "ask_me" (do it with change_setting / do_action) or a link they click. Use for someone new or "how do I get set up". One step at a time.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => regRun(async () => (await reg()).setupProgress(regCtx(false))),
  )

  // ── Resources (read-only snapshots the connector UI can show) ──────────

  const resourceText = (uri: string, obj: unknown) => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(obj, null, 2) }] })

  server.registerResource(
    'overview',
    'cxo://overview',
    { title: 'Premium overview', description: 'Issued premium YTD, MTD, trailing 3/6/12 months, product mix and placement.', mimeType: 'application/json' },
    async (uri) => resourceText(uri.href, await getOverview(L)),
  )
  server.registerResource(
    'snapshot',
    'cxo://snapshot',
    { title: 'Company snapshot', description: 'Everything an owner wants on a Monday, in one document.', mimeType: 'application/json' },
    async (uri) => resourceText(uri.href, await getCompanySnapshot(L)),
  )
  server.registerResource(
    'trend-12m',
    'cxo://trend/12m',
    { title: 'Trailing 12-month trend', description: 'Monthly issued premium for the last 12 months.', mimeType: 'application/json' },
    async (uri) => resourceText(uri.href, await getTrend(L, { window: '12m', grain: 'month' })),
  )
  for (const dim of BREAKDOWN_DIMS) {
    server.registerResource(
      `breakdown-${dim}`,
      `cxo://breakdown/${dim}`,
      { title: `Breakdown by ${dim === 'team' ? 'agency' : dim === 'agent' ? 'producer' : dim}`, description: `Year-to-date ranked table by ${dim}.`, mimeType: 'application/json' },
      async (uri) => resourceText(uri.href, await getBreakdown(L, { dim, window: 'ytd', limit: 25 })),
    )
  }
  server.registerResource(
    'dashboard-layout',
    'cxo://dashboard/layout',
    { title: 'Dashboard layout', description: 'The current layout and the catalog of tiles, KPIs and timeframes.', mimeType: 'application/json' },
    async (uri) => resourceText(uri.href, layoutResult(await getDashboardPrefs(auth.tenant.id), 'Current layout.')),
  )

  // ── Prompts (show up in the connector UI as one-click asks) ────────────

  const prompt = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] })

  server.registerPrompt(
    'run_daily_queue',
    { title: QUEUE_COMMAND, description: 'Work everything pending for you today: to-dos filed, replies drafted, 1:1 talking points and meeting briefs. Nothing is sent without your yes.', argsSchema: {} },
    () =>
      prompt(
        'Run my daily queue. Call get_daily_queue once and work what it returns, in this order, skipping anything marked has_draft, has_talking_points or has_brief. ' +
          '1) Messages: a request I should act on becomes a to-do (file_queue_todo with its message_id); a question gets a short reply in my voice (save_reply_draft). ' +
          '2) 1:1s due in the next 2 days: propose up to 5 talking points from the goals, open action items and recent messages (save_talking_points). Name any overdue 1:1. ' +
          "3) Today's and tomorrow's meetings: a brief of at most 4 short lines each: who, what changed since last time, open items (save_meeting_brief). " +
          '4) List what is due or overdue, stale items first, and name any goal that is off pace with its number. ' +
          'Then call finish_daily_queue and show me a short report: "Done" as counts, and "Needs you" as a numbered list. ' +
          'Rules: only drafts, to-dos on my own list, proposals and briefs. Do not send, book, move or cancel anything, and do not call approve_queue_item or any send or calendar tool, unless I say yes to that specific item after you have read it back to me. Ask me first, every time. Keep it short: no paragraphs.',
      ),
  )
  server.registerPrompt(
    'monday_briefing',
    { title: 'Monday briefing', description: 'A short written briefing on the state of the business for the week.', argsSchema: {} },
    () =>
      prompt(
        'Give me a Monday briefing on the business. Call get_company_snapshot first, then get_status_funnel for the trailing 3 months. Write it as five short paragraphs an owner can read in two minutes: where issued premium stands year to date and vs last year; the trailing trend; placement and anything moving in declines or lapses; who and what is driving the numbers (top producers, carriers, agencies); and the two or three things to act on this week. Use plain English and round numbers.',
      ),
  )
  server.registerPrompt(
    'where_is_growth',
    { title: 'Where is growth coming from', description: 'Which producers, carriers, agencies, states and products are driving growth or dragging it.', argsSchema: {} },
    () =>
      prompt(
        'Where is our growth coming from? Compare the trailing 12 months with the 12 months before (compare_periods), then pull get_breakdown by agent, carrier, team, state and product for both the trailing 12 months and year to date. Tell me which producers, carriers, agencies, states and products are growing, which are shrinking, and how concentrated we are. End with three sentences on what to double down on.',
      ),
  )
  server.registerPrompt(
    'what_to_worry_about',
    { title: 'What should I worry about', description: 'Risks in the book: falling trend, placement, declines, lapses, concentration.', argsSchema: {} },
    () =>
      prompt(
        'What should I be worried about in the business right now? Use get_company_snapshot (read its watch_list), get_status_funnel for the trailing 3 and 12 months, and get_breakdown by carrier and agent for the trailing 12 months. Look for a falling trend, weakening placement, rising declines or lapses, and concentration in one carrier, agency or producer. Rank the concerns by dollars at stake and give one concrete next step for each.',
      ),
  )
  server.registerPrompt(
    'set_up_my_dashboard',
    {
      title: 'Set up my dashboard',
      description: 'Rearrange the dashboard around what matters to you.',
      argsSchema: { focus: z.string().describe('What you care most about, e.g. "carriers and placement" or "producer growth".') },
    },
    ({ focus }) =>
      prompt(
        `I want my dashboard arranged around: ${focus}. Call get_dashboard_layout to see what is available, then use set_dashboard_layout, pin_kpi and set_default_timeframe so the first screen answers that. Put the most relevant tile first, pin the three or four KPIs that matter for it, pin the matching breakdown tables, and set a sensible default timeframe. Then tell me in two sentences what you changed.`,
      ),
  )

  return server
}
