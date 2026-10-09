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
import { PARTNER_KINDS } from '@/lib/partners'
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

export function buildMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Suite CXO' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        `You are connected to Suite CXO, the executive dashboard for ${auth.tenant.company || auth.tenant.display_name}, a life insurance IMO (independent marketing organisation: carriers above, agencies and producers below). ` +
        'The person you are helping runs the business. Use their vocabulary: issued premium, placement, carriers, agencies, books of business, producers. ' +
        'Start broad with get_company_snapshot, then drill in. Every tool returns a one-line "summary" you can read out. ' +
        'Premium means annual issued premium bucketed by policy effective date. ' +
        'You can also rearrange their dashboard: set_dashboard_layout, pin_kpi, set_default_timeframe and add_note change what they see on screen immediately. ' +
        'Partners (list_partners, get_partner) and messages to them: compose_partner_message always drafts first; send_partner_message only when the executive explicitly says to send, after a one-line readback. Calendar writes (create_calendar_event, schedule_call_with_partner, update/cancel) are real Google events with invites; repeat the readback line they return.',
    },
  )

  const L = new Loader(auth.tenant)
  const author = auth.member.display_name || auth.member.email

  // ── Read tools ──────────────────────────────────────────────────────────

  server.registerTool(
    'get_company_snapshot',
    {
      title: 'Company snapshot',
      description:
        'The Monday-morning view in one call: year-to-date issued premium and pace vs last year, month-to-date and projected month end, trailing 3/6/12-month trend with direction, applications vs paid and the placement rate, product mix (Health / Life / Annuity), top 5 producers, carriers, states and agencies, and a watch list of anything that looks off. Answers "how is the business doing?"',
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
        'Issued premium year to date, month to date (with projected month end), and trailing 3, 6 and 12 months, each with the change vs the prior period; plus year-to-date product mix and the submitted → paid funnel. Answers "where are we on premium?"',
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
  const viaMira = (name: string, args: Record<string, unknown>) =>
    run(async () => {
      const r = await CXO_TOOL_HANDLERS[name](agentCtx, args)
      const out = JSON.parse(r.text) as Record<string, unknown>
      if (out.ok === false && typeof out.error === 'string' && !out.ask && !out.ambiguous) throw new Error(String(out.say ?? out.error))
      return out
    })
  const partnerArg = z.string().min(1).describe('Who, as the executive says it: a name, "Dana at Mutual of Omaha", or a company. If several match, the result lists candidates: ask which.')
  const whenArg = (what: string) => z.string().describe(`${what}, ISO 8601 (2026-10-09T14:00:00). No zone = the executive's timezone.`)

  server.registerTool(
    'list_partners',
    {
      title: 'Partners',
      description: 'The executive\'s partners: carrier reps, agency principals, board members, vendors and key producers. Optional search and kind filter.',
      inputSchema: { q: z.string().optional(), kind: z.enum(PARTNER_KINDS).optional() },
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
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => viaMira('compose_partner_message', args),
  )

  server.registerTool(
    'send_partner_message',
    {
      title: 'Send a saved draft to a partner',
      description:
        'Sends a draft from compose_partner_message as the executive, from their connected Gmail (or the Suite CXO mailer with them as reply-to). Only after they explicitly ask to send; read back to whom and the subject first. The send is recorded on the partner.',
      inputSchema: {
        draft_id: z.string().optional(),
        partner: partnerArg.optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        to: z.string().optional(),
        from_account: z.string().optional().describe('Connected Google account email to send from, when they have several.'),
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
        'A real Google Calendar event; attendees (emails or partner names) get the invite. Default calendar is the executive\'s primary. Refuses a time that clashes with anything on any connected calendar unless allow_conflict is true. Returns a one-line readback (who, when, which calendar) to repeat to them.',
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
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('create_calendar_event', args),
  )

  server.registerTool(
    'update_calendar_event',
    {
      title: 'Move or edit an event',
      description: 'Changes an existing event; attendees are notified. event_id comes from get_partner next_meetings or list_meetings.',
      inputSchema: {
        event_id: z.string().min(1),
        title: z.string().optional(),
        start: whenArg('New start').optional(),
        end: whenArg('New end').optional(),
        duration_min: z.number().int().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        add_attendees: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('update_calendar_event', args),
  )

  server.registerTool(
    'cancel_calendar_event',
    {
      title: 'Cancel an event',
      description: 'Cancels the event and notifies attendees. Pass partners involved so the cancellation is logged on them.',
      inputSchema: { event_id: z.string().min(1), partners: z.array(z.string()).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => viaMira('cancel_calendar_event', args),
  )

  server.registerTool(
    'schedule_call_with_partner',
    {
      title: 'Book a call with a partner',
      description:
        'End to end: resolves the partner, finds an open slot (or uses the exact start given), books it with a Google Meet link and sends the invite. With only a window it returns up to three open times to choose from unless pick_first is true. Returns a readback line with the exact time in the executive\'s timezone.',
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
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => viaMira('schedule_call_with_partner', args),
  )

  // ── Dashboard layout (write) ────────────────────────────────────────────

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
    async (patch) => run(async () => layoutResult(await setDashboardPrefs(auth.tenant.id, { ...(patch as DashboardPrefsPatch), updated_by: 'mcp' }), 'Layout updated.')),
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
      run(async () => {
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
      run(async () => layoutResult(await setDashboardPrefs(auth.tenant.id, { default_timeframe: timeframe, updated_by: 'mcp' }), `Default timeframe set to ${timeframe}.`)),
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
      run(async () => {
        const patch: DashboardPrefsPatch = { add_notes: [{ text, author }], updated_by: 'mcp' }
        if (as_headline) patch.headline_note = text.slice(0, 200)
        return layoutResult(await setDashboardPrefs(auth.tenant.id, patch), 'Note added.')
      }),
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
      run(async () => {
        const patch: DashboardPrefsPatch = { updated_by: 'mcp' }
        if (note_id) patch.remove_note_ids = [note_id]
        if (clear_headline) patch.headline_note = null
        return layoutResult(await setDashboardPrefs(auth.tenant.id, patch), note_id ? 'Note removed.' : 'Headline cleared.')
      }),
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
