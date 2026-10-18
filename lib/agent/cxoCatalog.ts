/**
 * Suite CXO tool catalog: what the ops agent can do, in plain words, and how
 * she picks a tool (owner 10-10: "training mira and tuning mira").
 *
 * Three things live here:
 *   1. CAPABILITIES: plain-words abilities, each tied to the tools behind it.
 *      "What can you do for me" is built ONLY from the caller's allowed tools,
 *      so an employee never sees an executive ability listed.
 *   2. ROUTING_HINTS: one line per common ops ask → the tool to use. A hint
 *      is shown only when the caller has its tool.
 *   3. CXO_SHARED_TOOL_OVERRIDES: sharper descriptions for the tools Suite
 *      CXO shares with Virtual Closer (tools.ts), applied for CXO tenants only
 *      so the VC sales agent is unchanged. CXO-only tools carry their tuned
 *      descriptions in their own files.
 *
 * HOOKS for tools built in parallel (follow-ups / approvals / audit, unified
 * search): a new tool needs no change here to work. Its capability line is
 * picked up by the `match` patterns below (or, failing that, from the first
 * sentence of its description), and it can add a routing hint by appending
 * to ROUTING_HINTS with its tool name. Access stays deny-by-default in
 * lib/agent/access.ts: add a tool to EMPLOYEE_TOOLS only if it is self-scoped.
 */
import type * as AI from '@/lib/aiTypes'

// ── 1. Capabilities ─────────────────────────────────────────────────────────

export type Capability = {
  id: string
  /** Plain words, second person ("your to-dos"). */
  label: string
  /** Shown when the caller has ANY of these tools. */
  tools?: string[]
  /** Or any tool whose name matches (hook for tools other builders add). */
  match?: RegExp
}

export const CAPABILITIES: Capability[] = [
  { id: 'todos', label: "What's on your plate: your to-dos and requests from coworkers; add one or tick one off", tools: ['list_my_todos', 'add_my_todo', 'complete_my_todo'] },
  { id: 'my_quota', label: 'Your own quota and bonus status: where you stand this month and quarter', tools: ['my_quota'] },
  { id: 'cards', label: 'Board cards assigned to you', tools: ['list_my_cards'] },
  { id: 'meetings', label: 'Your meeting notes: what was decided and who owes what', tools: ['list_my_meeting_notes'] },
  { id: 'decisions', label: 'The decision log: what we decided about anything, who made the call, in which meeting, and when a later meeting reversed it', tools: ['decision_log'] },
  { id: 'board_update', label: 'The monthly board update: headline numbers vs plan and last year, wins, misses, decisions and asks, drafted for the owner to edit and send', tools: ['board_update'] },
  { id: 'calendar', label: 'Your calendar: what is coming up, open times, booking, moving or cancelling a meeting', tools: ['list_calendar_events', 'find_free_time', 'find_team_free_time', 'find_open_slots', 'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'list_calendars'] },
  { id: 'calendar_conflicts', label: 'Calendar check: double-bookings, days with no break, meetings missing a video link or an agenda, with a fix for each', tools: ['calendar_conflicts'] },
  { id: 'leadership_agenda', label: 'The leadership meeting agenda: numbers that moved, decisions still owed, overdue to-dos by owner, blockers and items to raise, added to the invite after your yes', tools: ['leadership_agenda'] },
  { id: 'sheets', label: 'Put a table or report into a new Google Sheet in your Drive and send you the link', tools: ['create_sheet_report'] },
  { id: 'inbox', label: 'Your email: find and summarise threads, draft replies (sent only when you say so)', tools: ['list_inbox', 'read_thread', 'reply_to_thread'] },
  { id: 'messages', label: 'Messages to coworkers in the app: tell, ask or remind someone, and read what they sent you', tools: ['send_member_message', 'reply_member_message', 'list_member_messages'] },
  // Hooks: the follow-up engine, approvals, audit log and unified search land here by name.
  { id: 'followups', label: 'Follow-ups: who owes what, nudging people and closing the loop', match: /follow_?ups?|commitment/ },
  { id: 'approvals', label: 'Things waiting for your OK, and approving or rejecting them', match: /approv/ },
  { id: 'audit', label: 'A log of what I did and for whom', match: /audit/ },
  { id: 'search', label: 'Search across the notes, cards and files you can see', match: /^search_|_search_|unified_search|^search$/ },
  // Executive abilities. An employee is never offered these tools, so never sees these lines.
  { id: 'revenue', label: 'Revenue and production from the book: pace, rankings and trends', tools: ['pinnacle_revenue'] },
  { id: 'producers', label: 'Producer production: rank agents by submitted or issued AP, placement or persistency; one agent\'s numbers; who dropped vs last period; new agents; agent retention (who stopped selling, who went quiet); placement and issue rate by carrier or product', tools: ['producer_production'] },
  { id: 'slipping', label: "What's slipping: an agency, carrier, company pace or placement dropping vs last month (I also tell you in-app the morning it happens)", tools: ['whats_slipping'] },
  { id: 'people', label: "Team quotas: who's behind, who's on track for bonus, top performers (I also tell a manager in-app when someone on their team falls behind, with a 1:1 talking point)", tools: ['employee_quota_status', 'bonus_on_track', 'top_performers'] },
  { id: 'hr', label: 'Employee records: set quotas, update details, log time off', tools: ['set_employee_quota', 'update_employee', 'log_time_off'] },
  { id: 'plan', label: 'Sales plan pacing, carrier allowance tiers, comp spread and plan profit', tools: ['plan_pacing', 'next_allowance_unlock', 'comp_spread', 'plan_profit'] },
  { id: 'finance', label: 'Company financials from QuickBooks (read only)', tools: ['quickbooks_financials'] },
  { id: 'adoption', label: 'Who is using the app: active, quiet and not started (app usage only; owner and admins)', tools: ['team_adoption'] },
  { id: 'payroll', label: 'Commissions and carrier deposits: who is owed, what is unpaid', tools: ['payroll'] },
  { id: 'partners', label: 'Partners: the contact directory, emails and production reports (drafted first, sent when you say), booking calls', tools: ['list_partners', 'get_partner', 'add_partner', 'update_partner', 'compose_partner_message', 'send_partner_message', 'schedule_call_with_partner'] },
  { id: 'crm', label: 'Team list, leads, pipeline and CRM updates', tools: ['list_members', 'list_leads', 'list_pipeline_boards', 'list_pipeline_leads', 'delegate_intents'] },
  { id: 'sales', label: 'Sales-floor activity: calls, dialer runs, KPIs and targets', tools: ['list_recent_calls', 'get_call_stats', 'list_kpi_history', 'list_targets', 'list_dialer_calls', 'list_roleplay_sessions'] },
  // Everyone.
  { id: 'memory', label: 'Remember how you like things done, show you what I have learned, and forget it when you say', tools: ['remember', 'forget', 'list_learned'] },
  { id: 'web', label: 'Look things up on the web, and help you write, plan and think things through', tools: ['web_search'] },
  { id: 'feedback', label: 'Pass a bug or a missing feature to the product team', tools: ['report_issue'] },
  // Ciao in Slack (lib/slack): the same abilities, from a DM or an @mention, once an owner or admin adds Slack on Integrations.
  { id: 'slack', label: 'Ask me in Slack too, in a DM or with an @mention, once your company adds Slack. Anything that sends or changes something waits for your yes in the app', tools: ['remember'] },
]

/** Plumbing tools that are not abilities in their own right. */
const NOT_ABILITIES = new Set(['who_am_i', 'propose_choice', 'what_can_you_do', 'list_brain_items', 'list_deferred_items'])

function firstSentence(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  const cut = s.search(/[.!?](\s|$)/)
  return (cut > 0 ? s.slice(0, cut) : s).slice(0, 140)
}

/**
 * Plain-words abilities for exactly these tools. Unknown tools (a new tool
 * nobody catalogued) fall back to the first sentence of their description.
 */
export function capabilitiesFor(tools: Array<Pick<AI.Tool, 'name'> & { description?: string }>): string[] {
  const names = new Set(tools.map((t) => t.name))
  const covered = new Set<string>()
  const lines: string[] = []
  for (const cap of CAPABILITIES) {
    const hits = tools.filter((t) => cap.tools?.includes(t.name) || (cap.match && t.name !== 'web_search' && cap.match.test(t.name)))
    if (!hits.length) continue
    for (const h of hits) covered.add(h.name)
    lines.push(cap.label)
  }
  for (const t of tools) {
    if (covered.has(t.name) || NOT_ABILITIES.has(t.name) || !names.has(t.name)) continue
    if (t.description) lines.push(firstSentence(t.description))
  }
  return lines
}

/** The "what can you do for me" answer, from the caller's own tool list. */
export function whatCanYouDoText(tools: Array<Pick<AI.Tool, 'name'> & { description?: string }>, personFirstName: string): string {
  const lines = capabilitiesFor(tools)
  return [`Here is what I can do for you, ${personFirstName}:`, ...lines.map((l) => `- ${l}`)].join('\n')
}

export const WHAT_CAN_YOU_DO_TOOL: AI.Tool = {
  name: 'what_can_you_do',
  description:
    'Use when they ask "what can you do", "what can you help me with", "what are you for". Returns the exact list of what you can do for THIS person (built from their access). Relay it as given; never add abilities that are not on it.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

// ── 2. Routing hints (the ops playbook) ─────────────────────────────────────

export type RoutingHint = {
  /** Shown when the caller has this tool. */
  tool: string
  /** "When they say … → do …" in one line. */
  line: string
  /** Shown only when the caller does NOT have this tool (a fallback route). */
  unless?: string
}

export const ROUTING_HINTS: RoutingHint[] = [
  { tool: 'list_my_todos', line: '"What\'s on my plate / what do I have today / what\'s overdue" → list_my_todos, then list_calendar_events window=today. One short list: overdue first, then today.' },
  { tool: 'add_my_todo', line: '"Remind me at 2:30 to call Dana / ping me tomorrow at 9 / every Monday at 9 remind me to send the numbers" (a reminder for themselves) → add_my_todo with remind_at (local "YYYY-MM-DDTHH:MM") and, for a repeat, repeat = daily, weekdays or weekly. It pings them in the app at that minute. Read back its say line; never promise a reminder the tool did not confirm.' },
  { tool: 'calendar_conflicts', line: '"Any conflicts this week / am I double-booked / is my week overbooked" → calendar_conflicts. One line per issue with its fix; change nothing until they say yes, then update_calendar_event (move, add_video_link, decline) or cancel_calendar_event.' },
  { tool: 'leadership_agenda', line: '"Draft the agenda for Monday\'s leadership meeting / what is on the exec agenda / add X to the agenda" → leadership_agenda (draft, or raise with item). Show the agenda line for line. Put it on the invite only after they say yes (add_to_invite, confirmed: true). "That is our leadership meeting" → mark.' },
  { tool: 'list_my_meeting_notes', line: '"What did we decide in Tuesday\'s meeting / what came out of the board call" → list_my_meeting_notes with q = the meeting\'s words. Answer from the summary; if nothing matches, say so. Never invent a decision.' },
  { tool: 'decision_log', line: '"What did we decide about X / recent decisions / did we change our mind on X" → decision_log with query = the topic words (none for recent). Answer with who decided and which meeting; if one was reversed, say what replaced it. A single meeting\'s full rundown is list_my_meeting_notes.' },
  { tool: 'board_update', line: '"Draft this month\'s board update / investor update / redo the board update" → board_update (regenerate: true to redraw it). Show its text as given and never change a figure. You never send it: say it is on Today to edit, copy and send.' },
  { tool: 'send_member_message', line: '"Remind / tell / ask Dana …" (a coworker) → send_member_message (remind = kind request). They asked in their own latest message, so confirmed: true. Teammates are in-app, not email.' },
  { tool: 'reply_to_thread', line: '"Draft a reply to Marcus" → list_inbox partner or q = Marcus, read_thread, then reply_to_thread mode=draft. Show the draft and stop. Send only after "send it".' },
  { tool: 'my_quota', line: '"How am I doing on my quota / am I on track for my bonus / what is my target" (about themselves) → my_quota. Their own numbers only; anyone else\'s is employee_quota_status (executives).' },
  { tool: 'list_approvals', line: '"What needs my yes / any approvals waiting on me / what\'s waiting for my OK" → list_approvals first (then list_my_todos if they also mean their own tasks). Approve or decline one only when they say so for that item: decide_approval with its id and confirmed: true.' },
  { tool: 'list_members', line: '"Email / thank / 1:1 with Dana" and Dana is not a partner → she is probably a coworker: list_members to find her, then go on. Never ask "is Dana a coworker?" before checking.' },
  { tool: 'employee_quota_status', line: '"Who\'s behind this week / who\'s behind on quota" → employee_quota_status filter=behind. KPI and bonus status → bonus_on_track.' },
  { tool: 'pinnacle_revenue', line: '"How\'s revenue / are we ahead of last month / top teams / health vs life" → pinnacle_revenue.' },
  { tool: 'producer_production', line: '"Top producers / rank agents by AP / how is <agent> doing / which agents are behind or dropped vs last month / new agents this quarter / lowest placement" → producer_production (view rank, detail, slipping or new). "Agent retention / how many agents stopped selling / who went quiet / reactivated agents" → view retention. "Placement by carrier / which carrier places best / issue rate by product" → view placement (by carrier or product). Producers are agents writing the book, not office staff (employee_quota_status). Not set up → say so, never guess.' },
  { tool: 'whats_slipping', line: '"What\'s slipping / which agency is slipping / is anything dropping / what should I worry about this month" → whats_slipping. Read its items as given. People not using the app is team_adoption, not this.' },
  { tool: 'list_followups', unless: 'whats_slipping', line: '"What\'s slipping / what\'s falling behind / what should I worry about" means the BUSINESS, never app usage: list_followups view=overdue (what people owe and have not done), plus plan_pacing and employee_quota_status filter=behind when you have them. Never answer it with team_adoption.' },
  { tool: 'plan_pacing', line: '"Are we on plan / pacing vs plan" → plan_pacing.' },
  { tool: 'quickbooks_financials', line: '"Net margin / expenses / P&L" → quickbooks_financials.' },
  { tool: 'team_adoption', line: '"Who hasn\'t logged in this week / how is adoption / who isn\'t using the app" → team_adoption. App usage only: names and counts. Business slippage ("what\'s slipping") is never this tool.' },
  { tool: 'payroll', line: '"What\'s owed to Mike / unpaid commissions / unmatched deposits" → payroll.' },
  { tool: 'compose_partner_message', line: '"Email / send a report to <partner>" → compose_partner_message, show the draft, stop. Send only on "send it".' },
  { tool: 'schedule_call_with_partner', line: '"Set up a call with <partner>" → schedule_call_with_partner.' },
  { tool: 'find_free_time', line: '"When am I free / do I have time Thursday afternoon / open time this week" → find_free_time. Relay its say lines.' },
  { tool: 'find_team_free_time', line: '"Find an hour for me, Dana and Luis / when is the leadership team free / a slot where Sam and I are both open" → find_team_free_time with people. Relay its say line, name who could not be checked, never describe a busy block. Book with create_calendar_event (them as attendees) after they pick.' },
  { tool: 'create_calendar_event', line: '"Every Monday at 9 for 10 weeks / a weekly 1:1 / daily standup" → ONE create_calendar_event with recurrence (e.g. RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10), start = the first one. Never one event per date.' },
  { tool: 'find_open_slots', line: '"Give me three times I could book a call / find a slot to book" → find_open_slots.' },
  { tool: 'create_sheet_report', line: '"Put this in a Google Sheet / make me a spreadsheet / export that to Sheets" → get the real data with the right tool first, then create_sheet_report (header row, then rows). Reply with its say line and link.' },
  { tool: 'what_can_you_do', line: '"What can you do / what can you help with" → what_can_you_do, and relay its list.' },
  { tool: 'list_learned', line: '"What have you learned about me / what do you know about me" → list_learned.' },
  { tool: 'forget', line: '"Forget that" right after you saved something → forget last=true. "Forget the rule about X" → forget query=X.' },
]

export function routingHintsFor(toolNames: Iterable<string>): string[] {
  const have = new Set(toolNames)
  return ROUTING_HINTS.filter((h) => have.has(h.tool) && !(h.unless && have.has(h.unless))).map((h) => h.line)
}

// ── 3. Sharper descriptions for shared tools (CXO tenants only) ─────────────

type Override = { description: string | ((original: string) => string); input_schema?: AI.Tool['input_schema'] }

const REMEMBER_EXEC_SCHEMA: AI.Tool['input_schema'] = {
  type: 'object',
  properties: {
    rule: { type: 'string', description: 'The lasting rule, imperative and self-contained, under 160 characters. e.g. "Keep replies to two lines", "Dana runs Ops, not Sales".' },
    kind: { type: 'string', enum: ['avoid', 'prefer', 'correction', 'fact'], description: 'avoid = stop doing; prefer = do more of; correction = you got something wrong; fact = a lasting fact (title, who owns what). Default prefer.' },
    applies_to: { type: 'string', enum: ['me', 'company'], description: 'company (default) = a standing rule for the whole executive team ("never CC the whole team", "Ops owns vendor contracts"). me = only how you work with this one executive ("keep MY replies to two lines", "I hate early meetings").' },
    about: { type: 'string', description: 'Who the rule is about, when it is about one person or group ("the CFO", "Maria"). Omit otherwise.' },
  },
  required: ['rule'],
  additionalProperties: false,
}

const REMEMBER_SELF_SCHEMA: AI.Tool['input_schema'] = {
  type: 'object',
  properties: {
    rule: { type: 'string', description: 'The lasting rule, imperative and self-contained, under 160 characters. e.g. "Keep replies short", "I work 7 to 3".' },
    kind: { type: 'string', enum: ['avoid', 'prefer', 'correction', 'fact'], description: 'avoid = stop doing; prefer = do more of; correction = you got something wrong; fact = a lasting fact. Default prefer.' },
    about: { type: 'string', description: 'Who the rule is about, when it is about one person. Omit otherwise.' },
  },
  required: ['rule'],
  additionalProperties: false,
}

const FORGET_SCHEMA = (company: boolean): AI.Tool['input_schema'] => ({
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Words from the rule to drop ("short replies"). Omit when last=true.' },
    last: { type: 'boolean', description: 'true for "forget that" right after you saved something: drops the newest rule.' },
    ...(company ? { applies_to: { type: 'string', enum: ['me', 'company'], description: 'Where to look. Omit to check their own rules first, then company rules.' } } : {}),
  },
  additionalProperties: false,
})

const REMEMBER_USE =
  'Save a lasting preference or correction so you follow it from now on. Use when they correct you ("no, Dana runs Ops", "that\'s wrong, the board meets monthly") or state a standing rule ("keep replies short", "never CC the whole team"). Not for one-off tasks or reminders (add_my_todo). Confirm in one line.'

/** Exec memory tools (personal by default, company when they say so). */
export const EXEC_MEMORY_OVERRIDES: Record<string, Override> = {
  remember: { description: REMEMBER_USE + ' Set applies_to=me when the rule is about this executive personally ("I", "me", "my").', input_schema: REMEMBER_EXEC_SCHEMA },
  forget: { description: 'Drop a rule you learned: "forget that" (last=true), "stop doing X", "forget the rule about Dana". Confirm what you dropped in one line.', input_schema: FORGET_SCHEMA(true) },
  list_learned: { description: 'What you have learned: their own rules and the company rules. Use for "what have you learned about me", "what do you remember". Offer to forget any.' },
}

/** Employee memory tools: their own rules only, nothing about the company. */
export const SELF_MEMORY_OVERRIDES: Record<string, Override> = {
  remember: { description: REMEMBER_USE + ' Saved for this person only; nobody else sees it.', input_schema: REMEMBER_SELF_SCHEMA },
  forget: { description: 'Drop one of their own rules: "forget that" (last=true), "stop doing X". Confirm what you dropped in one line.', input_schema: FORGET_SCHEMA(false) },
  list_learned: { description: 'What you have learned about this person (their own rules only). Use for "what have you learned about me". Offer to forget any.' },
}

export const CXO_SHARED_TOOL_OVERRIDES: Record<string, Override> = {
  who_am_i: { description: 'Who is asking: name, role, timezone and today\'s date. Rarely needed: your instructions already say who they are.' },
  list_brain_items: { description: 'Their older dashboard notes, goals and ideas. Not their to-do list: "what\'s on my plate" → list_my_todos.' },
  list_deferred_items: { description: 'The "remind me later" parking queue (parked messages, voice memos). Not to-dos (list_my_todos) and not coworker messages (list_member_messages).' },
  list_calendar_events: {
    description:
      'Meetings on their own calendar: today, this week or this month, with event ids for update/cancel. Use for "what meetings do I have", "what\'s on today", and with list_my_todos for "what\'s on my plate". Never someone else\'s calendar. Free time → find_open_slots.',
  },
  list_members: { description: 'Who has a login in this company: names, roles, emails. Use to resolve a name ("which Dana?") or "who\'s on the team". Not performance (employee_quota_status).' },
  web_search: { description: 'Public web lookups: news, a restaurant, an address, a how-to. Never for company data (use the company tools) or for private details about a person.' },
  propose_choice: { description: 'Show 2 to 6 tappable options when they must pick one (which Dana, which slot, which calendar). End your turn after calling it.' },
  // Same intent kinds and shapes as the shared description, written compactly
  // (it rides on every turn; cost note in the 2026-10-18 QA fixes).
  delegate_intents: {
    description:
      'Last resort for CRM writes that have no tool of their own (leads, pipeline stages, follow-ups, dashboard tasks). NOT for: to-dos (add_my_todo), coworker messages (send_member_message), calendar (create_calendar_event), partner email (compose_partner_message), employee changes (update_employee / set_employee_quota / log_time_off). ' +
      'Pass intents: [{ kind, ...fields }], several in one call when one message asks for several (e.g. log_call + update_lead + schedule_followup). Runs server-side with its own safety checks; a change is done only when this tool returns it. ' +
      "Kinds (? = optional): add_lead{name, company?, email?, status?, note?}; update_lead{lead_name, status?, note?, mark_contacted?, email?, company?, phone?}; schedule_followup{lead_name, due_date 'YYYY-MM-DD', content, priority?}; " +
      "brain_item{item_type task|goal|idea|plan|note, content, priority?, horizon?, due_date?}; log_call{lead_name, summary, outcome?, next_step?, duration_minutes?}; " +
      'book_meeting{lead_name?, contact_name?, email?, start_iso, duration_minutes?, summary, notes?}; reschedule_meeting{lead_name?, contact_name?, original_when?, new_start_iso, new_duration_minutes?}; cancel_meeting{lead_name?, contact_name?, original_when?}; ' +
      'pipeline_triage{count?}; snooze_lead{lead_name, until_date?, within?}; set_deal_value{lead_name, deal_value, currency?}; handoff_lead{lead_name, to_member_name}; objection_coach{objection}; rep_pulse{member_name, period?}; leaderboard{period?, metric?}; forecast{period?}; winloss{period?}; inbox_zero{days?}; ' +
      'set_target{period_type, metric, target_value, scope?, team_name?, notes?, visibility?}; report{report_type pipeline|today|week|calendar|goals|metrics|lead_history, lead_name?}; commission_report{period?}; defer_item{title, body?, remind_at_iso?, source_lead_name?}; ' +
      'complete_task{query}; move_task{query, new_due_date?, new_content?, new_priority?}; move_lead_stage{lead_name, stage_name, note?}; bulk_import_leads{pipeline_name} (a pasted list of 3+ prospects: emit only this one, the server parses the list; do not ask which option); ' +
      "send_email{lead_name, subject, body, to_email?, recipient_kind? 'partner'|'member'} (from their connected Gmail; for a partner use compose_partner_message); send_sms{lead_name, message, to_phone?}.",
  },
  report_issue: { description: 'Flag a bug or a missing ability to the product team ("it should be able to …", something broken). Use when you cannot do what they want. Confirm in one line.' },
  payroll: {
    description:
      'Commissions and carrier deposits: owed vs paid per agent, unpaid commissions, unmatched deposits, money in vs out. Use for "what\'s owed to Mike", "any unmatched deposits". Not staff salaries, not the P&L (quickbooks_financials). Executive team only.',
  },
  pinnacle_revenue: { description: (orig) => orig + ' Not plan vs actual (plan_pacing) and not the P&L (quickbooks_financials).' },
  list_leads: { description: 'Sales leads in the CRM by status or name. Only for lead questions; staff and partners have their own tools.' },
  list_pipeline_boards: { description: 'The sales pipeline boards with stage counts. Only for pipeline questions.' },
  list_pipeline_leads: { description: (orig) => orig },
  list_recent_calls: { description: 'Sales calls logged by the caller. Only for sales-call questions.' },
  get_call_stats: { description: 'Sales call counts for a recent window. Only for sales-call questions.' },
  list_targets: { description: 'Sales targets and progress. For staff quotas use employee_quota_status; for the plan use plan_pacing.' },
  list_kpi_history: { description: 'The caller\'s own sales KPI card entries over recent days. Staff KPIs and bonus → bonus_on_track.' },
  list_roleplay_sessions: { description: 'Sales roleplay practice scores. Only when they ask about roleplay.' },
  list_dialer_calls: { description: 'AI dialer call outcomes. Only when they ask about the dialer.' },
}

function applyOverride(def: AI.Tool, o: Override | undefined): AI.Tool {
  if (!o) return def
  const description = typeof o.description === 'function' ? o.description(def.description ?? '') : o.description
  return { ...def, description, ...(o.input_schema ? { input_schema: o.input_schema } : {}) }
}

/**
 * CXO tenants: sharpen the shared tools' descriptions. Returns new objects;
 * never mutates. The exec memory tools (personal vs company rules, "forget
 * that") change only with the employee-ops switch on (lib/cxoFeatures.ts),
 * because only the ops prompt loads an executive's personal rules.
 */
export function tuneCxoToolDefs(defs: AI.Tool[], opts: { ops?: boolean } = {}): AI.Tool[] {
  return defs.map((d) => applyOverride(d, (opts.ops ? EXEC_MEMORY_OVERRIDES[d.name] : undefined) ?? CXO_SHARED_TOOL_OVERRIDES[d.name]))
}

/** Employee logins: memory tools speak only of their own rules. */
export function tuneSelfToolDefs(defs: AI.Tool[]): AI.Tool[] {
  return defs.map((d) => applyOverride(d, SELF_MEMORY_OVERRIDES[d.name]))
}
