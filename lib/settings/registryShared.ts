/**
 * The settings and actions registry (owner 2026-10-22: "no user should ever
 * have to manually change a setting... either their MCP does it or our AI
 * bot"). Pure: no I/O, so the rules are unit-tested and the coverage spec
 * (__tests__/settings/registryCoverage.spec.ts) can read it.
 *
 * Every user-editable setting and every common user action in Suite CXO has
 * ONE entry here: what it is, where it lives on screen, who may change it
 * (the same role rule the page or server uses), whether it is risky (needs
 * the person's explicit yes), and how it changes:
 *   - fn:       the registry writes it (lib/settings/registry.ts), reusing the
 *               same server logic the page uses.
 *   - tool:     an existing Ciao tool already does it; the registry forwards.
 *   - link:     the person does it on the page, with the reason (OAuth, a
 *               password, a signature, a file upload, a delete).
 *   - operator: only our staff change it.
 *
 * `sources` ties an entry to the code a user reaches it through: a mutating
 * API route ('POST /api/me/about'), a server action
 * ('action:settings/page.tsx#actionInviteAssistant') or a form field
 * ('field:ExecAssistantSection.tsx#email'). A new route, action or field with
 * no entry and no reasoned exemption below fails the coverage spec.
 */
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { validateAssistantName } from '@/lib/assistantName'

export type WhoRule =
  /** Anyone signed in, on their own things. */
  | 'self'
  /** Anyone signed in as themself (not an assistant working as their exec). */
  | 'not_assistant'
  /** Owner, admin or manager on an executive org, signed in as themself; never an employee login. */
  | 'exec_team'
  /** Owner or admin, signed in as themself. */
  | 'owner_admin'
  /** The account owner only. */
  | 'owner'
  /** Only our staff (operator console or the database). */
  | 'operator'

export type How =
  | { mode: 'fn' }
  | { mode: 'tool'; tool: string; args?: string }
  | { mode: 'link'; url: string; reason: string }
  | { mode: 'operator'; reason: string }

export type ValueType = 'boolean' | 'string' | 'url' | 'timezone' | 'list' | 'object' | 'none'

export type RegistryEntry = {
  key: string
  kind: 'setting' | 'action'
  label: string
  aliases: string[]
  what: string
  where: { path: string; label: string }
  type: ValueType
  /** For actions and object values: what to pass, in plain words. */
  inputs?: string
  who: WhoRule
  risky: boolean
  riskWhy?: string
  scope: 'me' | 'company' | 'member'
  sources: string[]
  how: How
}

const S = '/dashboard/settings'
const I = '/dashboard/integrations'
const E = '/dashboard/employees'

export const REGISTRY: RegistryEntry[] = [
  // ── Settings: you ─────────────────────────────────────────────────────────
  {
    key: 'about.role_focus', kind: 'setting', label: 'About you: your role and what you keep an eye on',
    aliases: ['about you', 'my role', 'my focus', 'focus', 'role'],
    what: 'Your role and the few things you watch most. The assistant uses it to pick what to show and tell you first.',
    where: { path: S, label: 'Settings, About you' }, type: 'object',
    inputs: 'role, role_other, focus (list), focus_add, focus_remove: the same fields set_my_focus takes',
    who: 'not_assistant', risky: false, scope: 'me',
    sources: ['POST /api/me/about'], how: { mode: 'tool', tool: 'set_my_focus' },
  },
  {
    key: 'assistant_name.company', kind: 'setting', label: "The assistant's name for the whole company",
    aliases: ['company assistant name', 'rename the assistant', 'assistant name', 'bot name', 'ciao name'],
    what: 'What everyone in the company calls the assistant (default Ciao). A person can still pick their own name for it.',
    where: { path: S, label: 'Settings, Assistant name' }, type: 'string', who: 'owner_admin', risky: false, scope: 'company',
    sources: ['PUT /api/me/assistant-name'], how: { mode: 'fn' },
  },
  {
    key: 'assistant_name.personal', kind: 'setting', label: "Your own name for the assistant",
    aliases: ['my assistant name', 'call you', 'rename you'],
    what: 'What you call the assistant. Only you see it; empty goes back to the company name.',
    where: { path: S, label: 'Settings, Assistant name' }, type: 'string', who: 'self', risky: false, scope: 'me',
    sources: ['PUT /api/me/assistant-name'], how: { mode: 'fn' },
  },
  {
    key: 'reminders.in_app', kind: 'setting', label: 'Due-date reminders in the app',
    aliases: ['in-app reminders', 'due reminders', 'reminders'],
    what: 'A notice in the app when one of your cards or to-dos is coming due or overdue. On by default.',
    where: { path: S, label: 'Settings, Due-date reminders' }, type: 'boolean', who: 'self', risky: false, scope: 'me',
    sources: ['POST /api/me/due-reminders'], how: { mode: 'fn' },
  },
  {
    key: 'reminders.email', kind: 'setting', label: 'Due-date reminders by email',
    aliases: ['email reminders', 'reminder emails'],
    what: 'A daily email of what is coming due. Off by default.',
    where: { path: S, label: 'Settings, Due-date reminders' }, type: 'boolean', who: 'self', risky: false, scope: 'me',
    sources: ['POST /api/me/due-reminders'], how: { mode: 'fn' },
  },
  {
    key: 'profile.timezone', kind: 'setting', label: 'Your time zone',
    aliases: ['timezone', 'time zone', 'tz'],
    what: 'The time zone your calendar, reminders and times are shown in. Set from your browser the first time; you can change it.',
    where: { path: S, label: 'Settings (set automatically from your browser)' }, type: 'timezone', who: 'self', risky: false, scope: 'me',
    sources: ['POST /api/me/timezone'], how: { mode: 'fn' },
  },
  {
    key: 'schedule.work_hours', kind: 'setting', label: 'Your working hours',
    aliases: ['work hours', 'working hours', 'office hours', 'quiet hours'],
    what: 'The hours and days the assistant nudges you. Outside them it waits. Default Monday to Friday, 9:00 to 19:00.',
    where: { path: S, label: 'Ask the assistant (no page field)' }, type: 'object',
    inputs: '{ start: 0-23, end: 1-24, days: [0-6] } with 0 = Sunday',
    who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'fn' },
  },
  {
    key: 'notify.exec_email_digest', kind: 'setting', label: 'Executive email digest',
    aliases: ['exec digest', 'email digest', 'daily digest', 'morning email'],
    what: 'A short email digest of the company for owners and admins. Off unless you turn it on.',
    where: { path: S, label: 'Ask the assistant (no page field)' }, type: 'boolean', who: 'owner_admin', risky: false, scope: 'me',
    sources: [], how: { mode: 'fn' },
  },
  {
    key: 'ai.nudges_paused_until', kind: 'setting', label: 'Pause the follow-up nudges',
    aliases: ['pause nudges', 'stop nudging', 'snooze nudges', 'do not disturb'],
    what: 'Stops the assistant nudging you until a date.',
    where: { path: S, label: 'Ask the assistant (no page field)' }, type: 'string', who: 'self', risky: false, scope: 'me',
    sources: [], how: { mode: 'tool', tool: 'pause_my_nudges' },
  },
  {
    key: 'ai.memory.personal', kind: 'setting', label: 'What the assistant remembers about you',
    aliases: ['remember', 'forget', 'memory', 'my preferences'],
    what: 'Facts and preferences the assistant keeps about you. Say "remember ..." or "forget ...".',
    where: { path: S, label: 'Ask the assistant (no page field)' }, type: 'string', who: 'self', risky: false, scope: 'me',
    sources: [], how: { mode: 'tool', tool: 'remember', args: 'fact, applies_to: "me"' },
  },
  {
    key: 'ai.memory.company', kind: 'setting', label: 'Rules the assistant follows for the whole company',
    aliases: ['company rule', 'team rule', 'always do', 'never do'],
    what: 'Rules the assistant follows for everyone in the company ("always cc finance on carrier emails").',
    where: { path: S, label: 'Ask the assistant (no page field)' }, type: 'string', who: 'exec_team', risky: false, scope: 'company',
    sources: [], how: { mode: 'tool', tool: 'remember', args: 'fact, applies_to: "company"' },
  },
  {
    key: 'reports.recurring', kind: 'setting', label: 'Recurring reports',
    aliases: ['weekly report', 'scheduled report', 'recurring report'],
    what: 'A report the assistant sends you on a schedule.',
    where: { path: S, label: 'Ask the assistant (no page field)' }, type: 'object', who: 'self', risky: false, scope: 'me',
    sources: [], how: { mode: 'tool', tool: 'set_recurring_report' },
  },
  {
    key: 'account.password', kind: 'setting', label: 'Your password',
    aliases: ['password', 'change password', 'reset password'],
    what: 'The password you sign in with.',
    where: { path: `${S}#password`, label: 'Settings, Password' }, type: 'none', who: 'self', risky: true, riskWhy: 'A credential.', scope: 'me',
    sources: ['action:settings/page.tsx#onChangePassword', 'field:settings/page.tsx#current_password', 'field:settings/page.tsx#new_password', 'field:settings/page.tsx#confirm_password'],
    how: { mode: 'link', url: `${S}#password`, reason: 'A password is typed by you on the page, never through a chat.' },
  },
  {
    key: 'assistant.active_exec', kind: 'setting', label: 'Which executive you are working for (assistants)',
    aliases: ['switch exec', 'work as', 'switch executive'],
    what: 'For an executive assistant who works for more than one executive: whose calendar, mail and boards you are working in.',
    where: { path: '/dashboard/assistant', label: 'The assistant bar at the top' }, type: 'none', who: 'self', risky: false, scope: 'me',
    sources: ['POST /api/assistant/switch'],
    how: { mode: 'link', url: '/dashboard/assistant', reason: 'It changes which seat your browser session works in, so you pick it in the app.' },
  },

  // ── Settings: the company ───────────────────────────────────────────────
  {
    key: 'company.logo_url', kind: 'setting', label: 'Company logo',
    aliases: ['logo', 'brand logo', 'company logo'],
    what: 'The logo shown in the app for everyone in the company. An https link to an image; empty removes it.',
    where: { path: I, label: 'Integrations, Logo' }, type: 'url', who: 'owner_admin', risky: false, scope: 'company',
    sources: ['action:integrations/page.tsx#saveLogo', 'field:CxoIntegrations.tsx#logo_url', 'field:CxoIntegrations.tsx#clear'], how: { mode: 'fn' },
  },
  {
    key: 'company.values', kind: 'setting', label: 'Company values',
    aliases: ['values', 'core values', 'praise tags'],
    what: 'The values people tag when they praise each other. Up to 12, each up to 40 characters.',
    where: { path: '/dashboard/employees', label: 'Ask the assistant (no page field)' }, type: 'list', who: 'owner_admin', risky: false, scope: 'company',
    sources: [], how: { mode: 'fn' },
  },
  {
    key: 'dashboard.prefs', kind: 'setting', label: 'The company dashboard layout',
    aliases: ['dashboard', 'dashboard layout', 'pinned kpis', 'default timeframe', 'headline note'],
    what: 'Which tiles the dashboard shows and in what order, the default timeframe, pinned KPIs and the headline note. Changes it for everyone.',
    where: { path: '/dashboard', label: 'Dashboard (changed through the assistant or a connected AI)' }, type: 'object',
    inputs: '{ tiles?, default_timeframe?, pinned_kpis?, headline_note? }',
    who: 'owner_admin', risky: false, scope: 'company', sources: [], how: { mode: 'fn' },
  },
  {
    key: 'people.can_view_comp', kind: 'setting', label: 'Who may see pay and bonuses',
    aliases: ['comp access', 'see salaries', 'pay visibility', 'compensation access'],
    what: 'Lets one teammate see (or never see) pay, salary and bonus dollars. Default: owners and admins see it, nobody else.',
    where: { path: E, label: 'Ask the assistant (no page field)' }, type: 'string',
    inputs: 'target: the teammate; value: "allow", "deny" or "default"',
    who: 'owner', risky: true, riskWhy: 'Opens or closes pay data for a person.', scope: 'member', sources: [], how: { mode: 'fn' },
  },
  {
    key: 'team.employee_records', kind: 'setting', label: "An employee's record (title, department, manager, hours, PTO)",
    aliases: ['employee record', 'update employee', 'job title', 'department', 'manager'],
    what: "An employee's basics on the Employees page.",
    where: { path: E, label: 'Employees' }, type: 'object', who: 'exec_team', risky: false, scope: 'member',
    sources: ['POST /api/employees'], how: { mode: 'tool', tool: 'update_employee' },
  },

  // ── Settings: connections ───────────────────────────────────────────────
  {
    key: 'integrations.google', kind: 'setting', label: 'Google calendar (and email on Pinnacle)',
    aliases: ['google', 'calendar', 'gmail', 'connect google', 'disconnect google'],
    what: 'Connects your Google account so the assistant can see your day, find times and book meetings.',
    where: { path: I, label: 'Integrations, Google' }, type: 'none', who: 'self', risky: true, riskWhy: 'Gives access to your calendar (and mail).', scope: 'me',
    sources: ['POST /api/google/disconnect', 'POST /api/native/google-ticket', 'field:CxoIntegrations.tsx#account', 'field:CxoIntegrations.tsx#return'],
    how: { mode: 'link', url: '/api/google/oauth/start?return=/dashboard/integrations', reason: 'Google asks you to sign in and allow it yourself.' },
  },
  {
    key: 'integrations.google_client', kind: 'setting', label: "The company's own Google sign-in app",
    aliases: ['google client', 'oauth client', 'google client id'],
    what: "Lets the company use its own Google OAuth app instead of ours. Needs a client ID and secret from Google Cloud.",
    where: { path: I, label: 'Integrations, Your own Google app' }, type: 'none', who: 'owner_admin', risky: true, riskWhy: 'A secret key.', scope: 'company',
    sources: ['PUT /api/google/client', 'POST /api/google/client', 'DELETE /api/google/client'],
    how: { mode: 'link', url: I, reason: 'The client secret is pasted on the page, never through a chat.' },
  },
  {
    key: 'integrations.slack', kind: 'setting', label: 'Slack',
    aliases: ['slack', 'connect slack', 'disconnect slack'],
    what: 'Talk to the assistant in Slack.',
    where: { path: I, label: 'Integrations, Slack' }, type: 'none', who: 'owner_admin', risky: true, riskWhy: 'Disconnecting deletes the Slack history.', scope: 'company',
    sources: ['POST /api/slack/disconnect'],
    how: { mode: 'link', url: '/api/slack/oauth/start', reason: 'Slack asks an admin to approve the app; disconnecting deletes the history, so you do it on the page.' },
  },
  {
    key: 'integrations.quickbooks', kind: 'setting', label: 'QuickBooks',
    aliases: ['quickbooks', 'qbo', 'books', 'accounting connection'],
    what: 'Brings your QuickBooks numbers into the revenue view.',
    where: { path: I, label: 'Integrations, QuickBooks' }, type: 'none', who: 'owner', risky: true, riskWhy: 'Disconnecting deletes the synced data.', scope: 'company',
    sources: ['POST /api/integrations/quickbooks/disconnect', 'POST /api/integrations/quickbooks/sync'],
    how: { mode: 'link', url: '/api/integrations/quickbooks/start', reason: 'Intuit asks you to sign in and allow it; disconnecting deletes synced data, so the owner does it on the page.' },
  },
  {
    key: 'ai.mcp_keys', kind: 'setting', label: 'Connect your own AI (Claude or ChatGPT)',
    aliases: ['mcp', 'connect claude', 'connect chatgpt', 'api key', 'your ai'],
    what: 'A private key that lets your own Claude or ChatGPT read your numbers and act for you here.',
    where: { path: I, label: 'Integrations, Your AI' }, type: 'none', who: 'self', risky: true, riskWhy: 'Company data goes to an outside AI.', scope: 'me',
    sources: ['POST /api/me/mcp-token'],
    how: { mode: 'link', url: I, reason: 'The key is shown once and you copy it into your AI yourself; it is never put in a chat.' },
  },
  {
    key: 'ai.outside_consent', kind: 'setting', label: 'What an outside AI may see',
    aliases: ['outside ai', 'data sharing', 'ai consent'],
    what: 'The note you read before connecting an outside AI: what it can see and do.',
    where: { path: I, label: 'Integrations, Your AI' }, type: 'none', who: 'self', risky: true, riskWhy: 'A disclosure.', scope: 'me',
    sources: [], how: { mode: 'link', url: I, reason: 'It is a disclosure you read on the page, not a switch.' },
  },
  {
    key: 'calendar.ics_feed', kind: 'setting', label: 'Outside calendars (ICS links)',
    aliases: ['ics', 'calendar feed', 'outlook calendar', 'icloud calendar', 'subscribe calendar'],
    what: 'Adds a calendar from Outlook, iCloud or elsewhere by its private link, so its events show on your calendar.',
    where: { path: '/dashboard/calendar', label: 'Calendar, Outside calendars' }, type: 'none', who: 'self', risky: true, riskWhy: 'A private calendar link.', scope: 'me',
    sources: ['POST /api/calendar/ics'],
    how: { mode: 'link', url: '/dashboard/calendar', reason: 'The private calendar link is pasted on the page, never through a chat.' },
  },
  {
    key: 'legal.agreement', kind: 'setting', label: 'Your user agreement',
    aliases: ['agreement', 'terms', 'liability agreement', 'sign'],
    what: 'The agreement every user signs before using the app or a connected AI.',
    where: { path: '/dashboard', label: 'The agreement screen' }, type: 'none', who: 'self', risky: true, riskWhy: 'A legal signature.', scope: 'me',
    sources: ['POST /api/me/liability/sign', 'POST /api/onboard/[token]/sign'],
    how: { mode: 'link', url: '/dashboard', reason: 'Only you can sign it, on the page.' },
  },
  {
    key: 'dashboard.layout', kind: 'setting', label: 'Personal dashboard layout (Virtual Closer)',
    aliases: ['my dashboard layout', 'customize dashboard'],
    what: 'Virtual Closer only. On Suite CXO the dashboard is the company layout (dashboard.prefs).',
    where: { path: '/dashboard', label: 'Dashboard, Customize (Virtual Closer)' }, type: 'none', who: 'self', risky: false, scope: 'me',
    sources: ['POST /api/me/dashboard-layout'],
    how: { mode: 'link', url: '/dashboard', reason: 'Virtual Closer only; on Suite CXO use dashboard.prefs.' },
  },
  {
    key: 'ops.employee_ops', kind: 'setting', label: 'Employee approvals and the action log',
    aliases: ['employee ops', 'approvals', 'audit log'],
    what: "Turns on the approval queue for employees' actions and the full log of what the assistant did.",
    where: { path: '/dashboard/approvals', label: 'Approvals' }, type: 'boolean', who: 'operator', risky: true, riskWhy: 'Changes who must approve what.', scope: 'company',
    sources: [], how: { mode: 'operator', reason: 'Our team turns it on with you. Ask us through Report an issue or support.' },
  },
  {
    key: 'billing.plan', kind: 'setting', label: 'Plan, seats and billing',
    aliases: ['billing', 'plan', 'seats', 'invoice', 'upgrade', 'payment'],
    what: 'Your plan, number of seats and payment.',
    where: { path: `${S}/plan`, label: 'Settings, Plan' }, type: 'none', who: 'operator', risky: true, riskWhy: 'Money.', scope: 'company',
    sources: ['POST /api/me/addon-request'], how: { mode: 'operator', reason: 'Billing is set up with our team; payment is entered by you on the secure payment page we send.' },
  },

  // ── Actions: people ─────────────────────────────────────────────────────
  {
    key: 'team.co_admin.invite', kind: 'action', label: 'Invite a co-admin',
    aliases: ['invite admin', 'add admin', 'add co-admin', 'give access', 'invite teammate'],
    what: 'Gives someone full admin access to this account. They get an email with their sign-in. Uses a seat.',
    where: { path: S, label: 'Settings, Co-admins' }, type: 'object', inputs: '{ email, name }',
    who: 'owner_admin', risky: true, riskWhy: 'Gives full account access, uses a seat and emails them.', scope: 'member',
    sources: ['action:settings/page.tsx#actionInviteAssistant', 'field:settings/page.tsx#email', 'field:settings/page.tsx#display_name'], how: { mode: 'fn' },
  },
  {
    key: 'team.co_admin.remove', kind: 'action', label: 'Remove a co-admin',
    aliases: ['remove admin', 'revoke access', 'remove teammate access'],
    what: 'Turns off a co-admin\'s login. Never the owner or yourself.',
    where: { path: S, label: 'Settings, Co-admins' }, type: 'object', inputs: '{ who: name or email }',
    who: 'owner_admin', risky: true, riskWhy: 'Removes someone\'s access.', scope: 'member',
    sources: ['action:settings/page.tsx#actionRemoveAssistant', 'field:settings/page.tsx#member_id'], how: { mode: 'fn' },
  },
  {
    key: 'team.exec_assistant.add', kind: 'action', label: 'Add your executive assistant',
    aliases: ['add assistant', 'add my ea', 'executive assistant', 'my assistant'],
    what: 'Gives your assistant their own login that works in your calendar, mail and boards. Optionally emails them a set-password link.',
    where: { path: `${S}#assistant`, label: 'Settings, Your assistant' }, type: 'object', inputs: '{ email, name, send_email?: true }',
    who: 'owner_admin', risky: true, riskWhy: 'Shares your calendar, mail and boards with them.', scope: 'member',
    sources: ['action:settings/assistantActions.ts#actionAddExecAssistant', 'field:ExecAssistantSection.tsx#email', 'field:ExecAssistantSection.tsx#display_name', 'field:ExecAssistantSection.tsx#send_email'], how: { mode: 'fn' },
  },
  {
    key: 'team.exec_assistant.remove', kind: 'action', label: 'Remove your executive assistant',
    aliases: ['remove assistant', 'remove my ea'],
    what: 'Stops your assistant working for you. Their login turns off unless another executive still has them.',
    where: { path: `${S}#assistant`, label: 'Settings, Your assistant' }, type: 'object', inputs: '{ who: name or email }',
    who: 'owner_admin', risky: true, riskWhy: 'Removes someone\'s access.', scope: 'member',
    sources: ['action:settings/assistantActions.ts#actionRemoveExecAssistant', 'field:ExecAssistantSection.tsx#assistant_id'], how: { mode: 'fn' },
  },
  {
    key: 'team.employee.invite', kind: 'action', label: 'Invite an employee to sign in',
    aliases: ['invite employee', 'give employee a login', 'employee login'],
    what: 'Sends an employee on the Employees page their own login (they see only their own work).',
    where: { path: E, label: 'Employees, Invite' }, type: 'object', inputs: '{ who: employee name or email, email?: if their record has none }',
    who: 'owner_admin', risky: true, riskWhy: 'Creates a login and emails them.', scope: 'member',
    sources: ['POST /api/employees'], how: { mode: 'fn' },
  },
  {
    key: 'team.employee.remove', kind: 'action', label: 'Remove an employee',
    aliases: ['remove employee', 'delete employee', 'offboard'],
    what: 'Removes an employee record and their login.',
    where: { path: E, label: 'Employees' }, type: 'none', who: 'owner_admin', risky: true, riskWhy: 'Deletes data.', scope: 'member',
    sources: ['POST /api/employees'], how: { mode: 'link', url: E, reason: 'Deleting a person is done by you on the page, not through a chat.' },
  },
  {
    key: 'account.delete_request', kind: 'action', label: 'Delete the account',
    aliases: ['delete account', 'close account', 'cancel account'],
    what: 'Asks our team to delete the account and its data.',
    where: { path: S, label: 'Settings, Delete account' }, type: 'none', who: 'self', risky: true, riskWhy: 'Deletes everything.', scope: 'company',
    sources: ['action:settings/deleteAccountAction.ts#requestAccountDeletion', 'field:DeleteAccountSection.tsx#confirm'],
    how: { mode: 'link', url: S, reason: 'Deleting the account is only ever done by you on the page.' },
  },
  // ── Actions: connections and keys ───────────────────────────────────────
  {
    key: 'ai.mcp_key.revoke', kind: 'action', label: 'Turn off a connected-AI key',
    aliases: ['revoke key', 'disconnect claude', 'disconnect chatgpt', 'remove ai key'],
    what: 'Stops a Claude or ChatGPT key working right away. You can revoke your own keys; owners and admins any key.',
    where: { path: I, label: 'Integrations, Your AI' }, type: 'object', inputs: '{ key_id } or { label }',
    who: 'self', risky: true, riskWhy: 'Cuts off a connected AI.', scope: 'me',
    sources: ['DELETE /api/me/mcp-token'], how: { mode: 'fn' },
  },
  {
    key: 'integrations.wispr_link.rotate', kind: 'action', label: 'Make a new meeting-notes inbox link (Wispr Flow / Plaud)',
    aliases: ['wispr', 'plaud', 'meeting notes link', 'notes inbox', 'new inbox link'],
    what: 'Makes the private link that Wispr Flow or Plaud sends meeting notes to. A new link stops the old one.',
    where: { path: I, label: 'Integrations, Meeting notes inbox' }, type: 'none',
    who: 'owner_admin', risky: true, riskWhy: 'The old link stops working for everyone.', scope: 'company',
    sources: ['action:integrations/page.tsx#generatePlaudSecret', 'POST /api/webhooks/plaud/[repId]'], how: { mode: 'fn' },
  },
  {
    key: 'calendar.ics.remove', kind: 'action', label: 'Remove an outside calendar',
    aliases: ['remove ics', 'remove calendar feed'],
    what: 'Stops showing an outside calendar you added by link.',
    where: { path: '/dashboard/calendar', label: 'Calendar, Outside calendars' }, type: 'object', inputs: '{ label or feed_id }',
    who: 'self', risky: false, scope: 'me', sources: ['POST /api/calendar/ics'], how: { mode: 'fn' },
  },
  // ── Actions: onboarding ─────────────────────────────────────────────────
  {
    key: 'onboarding.progress', kind: 'action', label: 'Your setup checklist',
    aliases: ['onboarding', 'get set up', 'setup', 'what is left to set up', 'getting started'],
    what: 'What is done and what is left to set up, with a link for each step only you can do.',
    where: { path: '/dashboard', label: 'The first-day card on your home page' }, type: 'none',
    who: 'self', risky: false, scope: 'me', sources: ['POST /api/employees/me/onboarding'], how: { mode: 'tool', tool: 'setup_progress' },
  },
  {
    key: 'onboarding.abilities_seen', kind: 'action', label: 'Mark "see what the assistant can do" as done',
    aliases: ['got it', 'seen abilities'],
    what: 'Ticks the "see what the assistant can do" step on your first-day card.',
    where: { path: '/dashboard', label: 'The first-day card' }, type: 'none', who: 'not_assistant', risky: false, scope: 'me',
    sources: ['POST /api/employees/me/onboarding'], how: { mode: 'fn' },
  },
  // ── Actions: everyday work (forwarded to the existing tools) ─────────────
  { key: 'todo.add', kind: 'action', label: 'Add a to-do', aliases: ['add todo', 'remind me', 'task'], what: 'Adds a to-do to your list.', where: { path: '/dashboard', label: 'Today' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: ['POST /api/today'], how: { mode: 'tool', tool: 'add_my_todo' } },
  { key: 'todo.complete', kind: 'action', label: 'Complete a to-do', aliases: ['done', 'complete todo', 'tick off'], what: 'Marks one of your to-dos done.', where: { path: '/dashboard', label: 'Today' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: ['POST /api/today'], how: { mode: 'tool', tool: 'complete_my_todo' } },
  { key: 'partner.add', kind: 'action', label: 'Add a partner', aliases: ['add partner', 'add contact', 'new partner'], what: 'Adds a contact to the shared partner directory.', where: { path: '/dashboard/partners', label: 'Partners' }, type: 'object', who: 'exec_team', risky: false, scope: 'company', sources: ['POST /api/partners'], how: { mode: 'tool', tool: 'add_partner' } },
  { key: 'partner.update', kind: 'action', label: 'Update a partner', aliases: ['edit partner', 'update contact'], what: "Changes a partner's details.", where: { path: '/dashboard/partners', label: 'Partners' }, type: 'object', who: 'exec_team', risky: false, scope: 'company', sources: ['PATCH /api/partners/[id]', 'POST /api/partners/[id]/actions'], how: { mode: 'tool', tool: 'update_partner' } },
  { key: 'partner.message', kind: 'action', label: 'Message a partner', aliases: ['email partner', 'text partner', 'message partner'], what: 'Drafts and, after your yes, sends a message to a partner.', where: { path: '/dashboard/partners', label: 'Partners' }, type: 'object', who: 'exec_team', risky: false, scope: 'company', sources: ['POST /api/partners/[id]/compose'], how: { mode: 'tool', tool: 'send_partner_message' } },
  { key: 'partner.delete', kind: 'action', label: 'Delete a partner', aliases: ['delete partner', 'remove contact'], what: 'Deletes a partner from the directory.', where: { path: '/dashboard/partners', label: 'Partners' }, type: 'none', who: 'exec_team', risky: true, riskWhy: 'Deletes data.', scope: 'company', sources: ['DELETE /api/partners/[id]'], how: { mode: 'link', url: '/dashboard/partners', reason: 'Deleting is done by you on the page, not through a chat.' } },
  { key: 'partner.import', kind: 'action', label: 'Import partners from a file', aliases: ['import partners', 'upload contacts'], what: 'Adds many partners from a spreadsheet.', where: { path: '/dashboard/partners', label: 'Partners, Import' }, type: 'none', who: 'exec_team', risky: false, scope: 'company', sources: ['POST /api/partners/import'], how: { mode: 'link', url: '/dashboard/partners', reason: 'A file upload is done on the page.' } },
  { key: 'calendar.event.create', kind: 'action', label: 'Book a meeting', aliases: ['book', 'schedule', 'create event'], what: 'Creates a Google calendar event with invites, after your yes.', where: { path: '/dashboard/calendar', label: 'Calendar' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'tool', tool: 'create_calendar_event' } },
  { key: 'calendar.event.update', kind: 'action', label: 'Move a meeting', aliases: ['reschedule', 'move meeting'], what: 'Changes a calendar event, after your yes.', where: { path: '/dashboard/calendar', label: 'Calendar' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'tool', tool: 'update_calendar_event' } },
  { key: 'calendar.event.cancel', kind: 'action', label: 'Cancel a meeting', aliases: ['cancel meeting'], what: 'Cancels a calendar event, after your yes.', where: { path: '/dashboard/calendar', label: 'Calendar' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'tool', tool: 'cancel_calendar_event' } },
  { key: 'message.send', kind: 'action', label: 'Message a teammate', aliases: ['message', 'tell', 'dm'], what: 'Sends an in-app message to a coworker, after your yes.', where: { path: '/dashboard/inbox', label: 'Inbox' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: ['POST /api/messages'], how: { mode: 'tool', tool: 'send_member_message' } },
  { key: 'praise.give', kind: 'action', label: 'Praise a teammate', aliases: ['praise', 'shout out', 'kudos'], what: 'Posts praise for a teammate tagged with a company value, after your yes.', where: { path: '/dashboard/employees', label: 'People' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: ['POST /api/people'], how: { mode: 'tool', tool: 'give_praise' } },
  { key: 'one_on_one.talking_point', kind: 'action', label: 'Add a 1:1 talking point', aliases: ['talking point', '1:1', 'one on one'], what: 'Adds a point to your next 1:1.', where: { path: '/dashboard/employees', label: 'People, 1:1s' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'tool', tool: 'add_talking_point' } },
  { key: 'approval.decide', kind: 'action', label: 'Approve or decline a request', aliases: ['approve', 'decline', 'approval'], what: "Approves or declines an employee's request that is waiting for an executive.", where: { path: '/dashboard/approvals', label: 'Approvals' }, type: 'object', who: 'exec_team', risky: false, scope: 'company', sources: ['POST /api/approvals'], how: { mode: 'tool', tool: 'decide_approval' } },
  { key: 'export.sheet_report', kind: 'action', label: 'Export a report to Google Sheets', aliases: ['export', 'spreadsheet', 'download report', 'google sheet'], what: 'Makes a new Google Sheet in your Drive with the report you ask for.', where: { path: '/dashboard', label: 'Ask the assistant' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'tool', tool: 'create_sheet_report' } },
  { key: 'export.csv', kind: 'action', label: 'Download a CSV (employee template, bonus payouts)', aliases: ['csv', 'download csv', 'bonus payouts'], what: 'Downloads a CSV from the Employees page.', where: { path: E, label: 'Employees, Download' }, type: 'none', who: 'exec_team', risky: false, scope: 'company', sources: [], how: { mode: 'link', url: E, reason: 'A file download happens in your browser.' } },
  { key: 'employee.quota', kind: 'action', label: "Set an employee's quota", aliases: ['quota', 'target', 'goal'], what: 'Creates or changes a quota for an employee.', where: { path: E, label: 'Employees, Quotas' }, type: 'object', who: 'exec_team', risky: false, scope: 'member', sources: ['POST /api/employees'], how: { mode: 'tool', tool: 'set_employee_quota' } },
  { key: 'employee.time_off', kind: 'action', label: 'Log time off', aliases: ['pto', 'vacation', 'sick day', 'time off'], what: 'Logs vacation, sick or personal time for an employee.', where: { path: E, label: 'Employees, Time off' }, type: 'object', who: 'exec_team', risky: false, scope: 'member', sources: ['POST /api/employees'], how: { mode: 'tool', tool: 'log_time_off' } },
  { key: 'employee.import', kind: 'action', label: 'Import employees or payroll from a file', aliases: ['import employees', 'upload payroll'], what: 'Adds employees or payroll rows from a spreadsheet.', where: { path: E, label: 'Employees, Import' }, type: 'none', who: 'exec_team', risky: false, scope: 'company', sources: ['POST /api/employees/ingest', 'POST /api/payroll/sheets/import', 'POST /api/payroll/assistant'], how: { mode: 'link', url: E, reason: 'A file upload is done on the page.' } },
  { key: 'agenda.add_to_invite', kind: 'action', label: 'Put the leadership agenda on the invite', aliases: ['agenda', 'leadership meeting agenda'], what: 'Adds the drafted agenda to the leadership meeting invite, after your yes.', where: { path: '/dashboard/meetings', label: 'Meetings' }, type: 'object', who: 'owner_admin', risky: false, scope: 'company', sources: ['POST /api/meetings/agenda'], how: { mode: 'tool', tool: 'leadership_agenda' } },
  { key: 'board_update.draft', kind: 'action', label: 'Draft the board update', aliases: ['board update', 'investor update'], what: 'Drafts the periodic board update.', where: { path: '/dashboard/plan', label: 'Plan, Board update' }, type: 'object', who: 'exec_team', risky: false, scope: 'company', sources: ['POST /api/board-update'], how: { mode: 'tool', tool: 'board_update' } },
  { key: 'issue.report', kind: 'action', label: 'Report a problem to our team', aliases: ['bug', 'report issue', 'support', 'something is broken'], what: 'Sends a problem report to our team.', where: { path: '/support', label: 'Support' }, type: 'object', who: 'self', risky: false, scope: 'me', sources: [], how: { mode: 'tool', tool: 'report_issue' } },
]

/**
 * Reachable code that is not a user setting, with the reason. Exact source,
 * or a prefix ending in '*'. The coverage spec fails on anything that is in
 * neither REGISTRY nor here.
 */
export const REGISTRY_EXEMPT: Record<string, string> = {
  // Inbound from other services or our own jobs: no person changes these.
  'POST /api/webhooks/*': 'Inbound webhook from another service, signed by a secret.',
  'POST /api/cal/webhook': 'Inbound webhook from the calendar provider.',
  'POST /api/slack/events': 'Inbound Slack events.',
  'POST /api/meetings/inbound/[token]': 'Inbound meeting notes by private token.',
  'POST /api/cron/*': 'Scheduled job, secret-authenticated.',
  'POST /api/mcp': 'The MCP endpoint itself; its tools use this registry.',
  'DELETE /api/mcp': 'The MCP endpoint itself (session close).',
  'POST /api/admin/*': 'Our staff console.',
  'DELETE /api/admin/*': 'Our staff console.',
  'POST /api/ops/onboarding/actions': 'Our staff onboarding API (Bearer secret).',
  'POST /api/demo/voice-session': 'Public demo, no account.',
  // Session plumbing, not settings.
  'POST /api/native/session': 'Signs the phone app in.',
  'DELETE /api/native/session': 'Signs the phone app out.',
  'POST /api/native/push-token': 'The phone registers for push notices by itself.',
  'POST /api/me/activity': 'Usage heartbeat sent by the app.',
  'POST /api/mira/ask': 'Talking to the assistant itself.',
  'POST /api/mira/chats': 'The chat history list.',
  'POST /api/inbox/search': 'A search (read).',
  'POST /api/daily-queue': 'The daily queue run; its items are drafts the person approves on screen.',
  'POST /api/pinnacle/refresh': 'Refreshes the book of business; no setting.',
  'POST /api/employees/me/notices': 'Marks notices read.',
  'POST /api/feedback/request': 'Asks a teammate for feedback through the app UI; the assistant uses give_praise / send_member_message for the same.',
  'POST /api/status/weekly': 'The weekly status form a person fills in on the page.',
  'POST /api/meetings/send-to-owners': 'Sends meeting notes to the action owners from the meeting page after review.',
  'POST /api/recommendations/[id]': 'Dismiss or keep a recommendation card.',
  'PATCH /api/recommendations/[id]': 'Dismiss or keep a recommendation card.',
  'POST /api/me/integration-request': 'A request to our team for a new integration (support ticket).',
  // Content the person makes on the page (cards, grids, files): the assistant
  // adds and edits through its own tools; bulk grid edits and uploads stay on the page.
  'POST /api/boards': 'Board cards: dragged and edited on the board.',
  'POST /api/plan': 'The plan grid: edited cell by cell on the page.',
  'POST /api/plan/upload': 'A file upload.',
  'POST /api/today': 'To-dos and today items (todo.add / todo.complete cover the assistant side).',
  'POST /api/calendar/ics': 'Covered by calendar.ics_feed and calendar.ics.remove.',
  'POST /api/integrations/zapier': 'Virtual Closer only.',
  'POST /api/partners/[id]/actions': 'Covered by partner.update.',
  'POST /api/plaud/*': 'Meeting-note actions approved one by one on the Meetings page.',
  'DELETE /api/plaud/*': 'Meeting-note contacts and rules removed on the Meetings page.',
  'PATCH /api/plaud/*': 'Meeting-note rules edited on the Meetings page.',
  // Virtual Closer product (not on the Suite CXO host: lib/cxoRoutes).
  'POST /api/brain-dump': 'Virtual Closer only.',
  'POST /api/brain-item': 'Virtual Closer only.',
  'POST /api/call-logs': 'Virtual Closer only.',
  'POST /api/crm-leads*': 'Virtual Closer only (lead CRM).',
  'PATCH /api/crm-leads*': 'Virtual Closer only (lead CRM).',
  'DELETE /api/crm-leads*': 'Virtual Closer only (lead CRM).',
  'POST /api/pipeline*': 'Virtual Closer only (pipeline).',
  'PATCH /api/pipeline*': 'Virtual Closer only (pipeline).',
  'DELETE /api/pipeline*': 'Virtual Closer only (pipeline).',
  'POST /api/projects*': 'Virtual Closer only (projects).',
  'PATCH /api/projects*': 'Virtual Closer only (projects).',
  'DELETE /api/projects*': 'Virtual Closer only (projects).',
  'POST /api/roleplay/*': 'Virtual Closer only (roleplay).',
  'POST /api/me/roleplay-scenarios': 'Virtual Closer only (roleplay).',
  'PATCH /api/me/roleplay-scenarios': 'Virtual Closer only (roleplay).',
  'DELETE /api/me/roleplay-scenarios': 'Virtual Closer only (roleplay).',
  'POST /api/me/training-docs': 'Virtual Closer only (roleplay).',
  'PATCH /api/me/training-docs': 'Virtual Closer only (roleplay).',
  'DELETE /api/me/training-docs': 'Virtual Closer only (roleplay).',
  'POST /api/me/voice-prompts': 'Virtual Closer only (voice).',
  'POST /api/people': 'Covered by praise.give; the rest (1:1 done) is ticked on the page.',
  // Server actions that are not settings.
  'action:admin/login/page.tsx#*': 'Our staff sign-in.',
  'action:login/page.tsx#*': 'Sign-in.',
  'action:forgot-password/page.tsx#*': 'Sign-in recovery.',
  'action:reset-password/page.tsx#*': 'Sign-in recovery.',
  'action:set-password/page.tsx#*': 'Sign-in recovery.',
  'action:cxo/request-access/page.tsx#*': 'Public request-access form.',
  'action:dashboard/accounting/*': 'Accounting entries are typed on the Accounting page (commissions, deposits, notes).',
  'action:dashboard/inbox/*': 'Draft replies are approved one by one on the Inbox page.',
  'action:dashboard/page.tsx#*': 'Virtual Closer home only (Suite CXO renders CxoToday).',
  'action:integrations/page.tsx#generateKey': 'Virtual Closer only (Zapier key).',
  'action:integrations/page.tsx#rotateKey': 'Virtual Closer only (Zapier key).',
  'action:integrations/page.tsx#saveOutbound': 'Virtual Closer only (Zapier).',
  'action:integrations/page.tsx#saveSheet': 'Virtual Closer only (Sheets).',
  'action:integrations/page.tsx#disconnectSheet': 'Virtual Closer only (Sheets).',
  'action:integrations/page.tsx#saveTrelloToken': 'Virtual Closer only (Trello).',
  'action:integrations/page.tsx#disconnectTrello': 'Virtual Closer only (Trello).',
  // VC-only fields on the shared integrations page.
  'field:integrations/page.tsx#*': 'The Virtual Closer branch of the Integrations page (Suite CXO renders CxoIntegrations).',
}

const byKey = new Map(REGISTRY.map((e) => [e.key, e]))

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** An entry by its key, or by a label/alias match ("logo", "my assistant name"). */
export function findEntry(q: unknown): RegistryEntry | null {
  if (typeof q !== 'string' || !q.trim()) return null
  const exact = byKey.get(q.trim())
  if (exact) return exact
  const n = norm(q)
  if (!n) return null
  for (const e of REGISTRY) if (norm(e.key) === n || norm(e.label) === n || e.aliases.some((a) => norm(a) === n)) return e
  return null
}

/** Entries matching words in a question, best first (for list_settings / "where do I change X"). */
export function searchEntries(q: unknown, kind?: 'setting' | 'action'): RegistryEntry[] {
  const pool = kind ? REGISTRY.filter((e) => e.kind === kind) : REGISTRY
  if (typeof q !== 'string' || !q.trim()) return pool
  const words = norm(q).split(' ').filter((w) => w.length > 2)
  if (!words.length) return pool
  const scored = pool
    .map((e) => {
      const hay = norm([e.key, e.label, e.what, ...e.aliases].join(' '))
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) + (e.aliases.some((a) => norm(q).includes(norm(a))) ? 3 : 0)
      return { e, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.map((x) => x.e)
}

type Who = { role?: string | null; is_active?: boolean | null; acting_assistant?: unknown } | null | undefined
type TenantLike = { id: string; brand?: string | null } | null | undefined

/** May this person change it? The same role rule the page or server uses. */
export function allowed(rule: WhoRule, member: Who, tenant: TenantLike): boolean {
  if (!member || member.is_active === false) return false
  const role = String(member.role ?? '')
  const acting = !!member.acting_assistant
  switch (rule) {
    case 'self':
      return true
    case 'not_assistant':
      return !acting && role !== 'assistant'
    case 'exec_team':
      return !acting && ['owner', 'admin', 'manager'].includes(role) && !isEmployeeOnlyMember(member, tenant)
    case 'owner_admin':
      return !acting && (role === 'owner' || role === 'admin')
    case 'owner':
      return !acting && role === 'owner'
    case 'operator':
      return false
  }
}

export function whoText(rule: WhoRule): string {
  switch (rule) {
    case 'self': return 'You, for yourself.'
    case 'not_assistant': return 'You, signed in as yourself (an assistant working as you cannot).'
    case 'exec_team': return 'The owner, admins and managers.'
    case 'owner_admin': return 'The owner or an admin, signed in as themself.'
    case 'owner': return 'The account owner only.'
    case 'operator': return 'Only our team.'
  }
}

/** Ciao (change_setting / do_action) and MCP: does this exact call need the person's explicit yes? */
export function isRiskyRegistryCall(name: string, args: Record<string, unknown>): boolean {
  if (name !== 'change_setting' && name !== 'do_action') return false
  const e = findEntry(args.key)
  if (!e) return false
  if (name === 'change_setting' && e.kind !== 'setting') return false
  if (name === 'do_action' && e.kind !== 'action') return false
  return e.risky && (e.how.mode === 'fn')
}

// ── Validation (pure) ───────────────────────────────────────────────────────

export type Checked = { ok: true; value: unknown } | { ok: false; error: string }

const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  if (['on', 'yes', 'true', '1', 'enable', 'enabled'].includes(s)) return true
  if (['off', 'no', 'false', '0', 'disable', 'disabled'].includes(s)) return false
  return null
}

export function validTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

/** Check one value for a `fn` setting. Keys without a rule here are not writable by value. */
export function validateSettingValue(key: string, value: unknown): Checked {
  switch (key) {
    case 'assistant_name.company':
    case 'assistant_name.personal': {
      const v = validateAssistantName(value ?? '')
      return v.ok ? { ok: true, value: v.name } : { ok: false, error: v.error }
    }
    case 'reminders.in_app':
    case 'reminders.email':
    case 'notify.exec_email_digest': {
      const b = bool(value)
      return b === null ? { ok: false, error: 'Say on or off.' } : { ok: true, value: b }
    }
    case 'profile.timezone': {
      const tz = String(value ?? '').trim()
      return validTimezone(tz) ? { ok: true, value: tz } : { ok: false, error: 'That is not a time zone I know. Use a name like America/New_York.' }
    }
    case 'company.logo_url': {
      const url = value == null ? '' : String(value).trim()
      if (url.length > 2000) return { ok: false, error: 'That link is too long.' }
      if (url && !/^https:\/\/[^\s]+$/i.test(url)) return { ok: false, error: 'The logo must be an https:// link to an image.' }
      return { ok: true, value: url }
    }
    case 'schedule.work_hours': {
      const w = (value && typeof value === 'object' ? value : null) as { start?: unknown; end?: unknown; days?: unknown } | null
      if (!w) return { ok: false, error: 'Give start and end hours, and the days (0 = Sunday).' }
      const start = Number(w.start)
      const end = Number(w.end)
      const days = Array.isArray(w.days) ? w.days.map(Number) : [1, 2, 3, 4, 5]
      if (!Number.isInteger(start) || start < 0 || start > 23) return { ok: false, error: 'Start must be a whole hour from 0 to 23.' }
      if (!Number.isInteger(end) || end < 1 || end > 24 || end <= start) return { ok: false, error: 'End must be a whole hour after the start, up to 24.' }
      if (!days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { ok: false, error: 'Days are numbers 0 (Sunday) to 6 (Saturday).' }
      return { ok: true, value: { start, end, days: [...new Set(days)].sort() } }
    }
    case 'company.values': {
      const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : null
      if (!raw) return { ok: false, error: 'Give the values as a list.' }
      const list = raw.map((x) => String(x ?? '').trim()).filter(Boolean)
      if (!list.length) return { ok: false, error: 'Give at least one value.' }
      if (list.length > 12) return { ok: false, error: 'Up to 12 values.' }
      if (list.some((x) => x.length > 40)) return { ok: false, error: 'Each value is up to 40 characters.' }
      return { ok: true, value: [...new Set(list)] }
    }
    case 'people.can_view_comp': {
      const s = String(value ?? '').trim().toLowerCase()
      const b = bool(s)
      if (s === 'default' || s === 'reset') return { ok: true, value: null }
      if (s === 'allow' || s === 'grant') return { ok: true, value: true }
      if (s === 'deny' || s === 'never' || s === 'block') return { ok: true, value: false }
      return b === null ? { ok: false, error: 'Say allow, deny or default.' } : { ok: true, value: b }
    }
    case 'dashboard.prefs': {
      // Shape only here; the lists are checked against the catalog in lib/settings/registry.
      return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value } : { ok: false, error: 'Give the parts to change: tiles, default_timeframe, pinned_kpis, headline_note.' }
    }
    default:
      return { ok: false, error: 'That one is not changed by value.' }
  }
}

export type RegistryCounts = { settings: { total: number; covered: number; explainOnly: number }; actions: { total: number; covered: number; explainOnly: number } }

/** covered = the AI can do it (fn or tool); explain-only = it explains and links (link or operator). */
export function registryCounts(entries: RegistryEntry[] = REGISTRY): RegistryCounts {
  const of = (kind: 'setting' | 'action') => {
    const xs = entries.filter((e) => e.kind === kind)
    const covered = xs.filter((e) => e.how.mode === 'fn' || e.how.mode === 'tool').length
    return { total: xs.length, covered, explainOnly: xs.length - covered }
  }
  return { settings: of('setting'), actions: of('action') }
}

/** Is a discovered source registered or exempt? Exempt keys may end in '*' (prefix). */
export function sourceCovered(source: string, entries: RegistryEntry[] = REGISTRY, exempt: Record<string, string> = REGISTRY_EXEMPT): boolean {
  if (entries.some((e) => e.sources.includes(source))) return true
  if (exempt[source]) return true
  return Object.keys(exempt).some((k) => k.endsWith('*') && source.startsWith(k.slice(0, -1)))
}
