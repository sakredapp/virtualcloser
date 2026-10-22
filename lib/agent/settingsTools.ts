/**
 * Ciao's settings tools (owner 2026-10-22: "no user should ever have to
 * manually change a setting... either their MCP does it or our AI bot").
 *
 *   list_settings   - every setting and action, or the ones matching a question
 *   explain_setting - what it is, where it lives, who may change it, its value now
 *   change_setting  - change one setting (role checked, validated, read back)
 *   do_action       - run one action (invite a co-admin, add your assistant, ...)
 *   setup_progress  - onboarding as a conversation: what is done, what is left
 *
 * All of it runs on the registry (lib/settings/registry). Risky ones go
 * through the confirm gate (isGatedCall in lib/agent/confirmGateShared), so
 * they run only after the person's yes; every change is audited by the
 * registry. Offered on Suite CXO only (toolDefsForTenant); everyone may call
 * them, the registry checks each entry's own role rule.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { gateApplies } from '@/lib/agent/confirmGateShared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>

const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

export const SETTINGS_TOOL_NAMES = ['list_settings', 'explain_setting', 'change_setting', 'do_action', 'setup_progress'] as const

export const SETTINGS_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'list_settings',
    description:
      'Every setting and action in the app, or the ones matching a question ("where do I change my logo", "can you add my assistant"). Each item says whether this person may change it and whether you can do it for them. Use it before telling anyone to go find a setting themselves.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words, e.g. "reminders", "assistant name", "slack". Omit for everything.' },
        kind: { type: 'string', enum: ['setting', 'action'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'explain_setting',
    description: 'What one setting or action is, where it lives on screen, who may change it, whether you can do it, and its current value.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The key from list_settings (e.g. "reminders.email"), or words like "my time zone".' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'change_setting',
    description:
      'Change one setting for the person: you do it, they never have to find the page. Checks their role, validates, saves and reads back. Careful ones (pay access) need their yes, which the app asks for. When the answer has use_tool, call that tool instead. When it has a link, the person does it on the page: give them the link.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The setting key from list_settings.' },
        value: { description: 'The new value: on/off, text, a time zone, a list, or an object as explain_setting describes.' },
        target: { type: 'string', description: 'Only for settings about another teammate (people.can_view_comp): their name or email.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'do_action',
    description:
      'Run one action for the person: invite or remove a co-admin, add or remove their executive assistant, give an employee a login, turn off a connected-AI key, make a new meeting-notes inbox link, remove an outside calendar. Actions that give or remove access need their yes, which the app asks for. When the answer has use_tool, call that tool instead. When it has a link, the person does it on the page.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The action key from list_settings (e.g. "team.exec_assistant.add").' },
        input: { type: 'object', description: 'What the action needs, as explain_setting lists (e.g. { "email": "...", "name": "..." }).' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'setup_progress',
    description:
      'Onboarding as a conversation: what this person has set up and what is left (agreement, role and focus, Google, time zone, first to-do; for owners and admins also logo, assistant name, team, executive assistant, Slack, QuickBooks, their own AI). Use it when someone is new, asks "how do I get set up" or "what is left". Do the "ask_me" steps for them with change_setting / do_action; give the link for "link" steps. One step at a time.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

async function regCtx(ctx: AgentContext) {
  return { tenant: ctx.tenant, member: ctx.caller, via: 'ciao' as const, confirmed: ctx.userConfirmed === true }
}

/** A risky change outside the app (Slack, or a tenant without the confirm gate) cannot get a yes here. */
function noYesHere(ctx: AgentContext, out: Record<string, unknown>): Record<string, unknown> {
  if (!out.needs_confirmation || gateApplies(ctx)) return out
  return { ...out, say: `${String(out.say ?? 'Not done.')} Ask me in the Suite CXO app, where you can say yes to it, or do it on the page.` }
}

const handle_list_settings: Handler = async (ctx, args) => {
  const { listSettings } = await import('@/lib/settings/registry')
  const kind = args.kind === 'setting' || args.kind === 'action' ? args.kind : undefined
  return j(listSettings(await regCtx(ctx), args.query, kind))
}

const handle_explain_setting: Handler = async (ctx, args) => {
  const { explainSetting } = await import('@/lib/settings/registry')
  return j(await explainSetting(await regCtx(ctx), args.key))
}

const handle_change_setting: Handler = async (ctx, args) => {
  const { changeSetting } = await import('@/lib/settings/registry')
  return j(noYesHere(ctx, await changeSetting(await regCtx(ctx), args.key, args.value, { target: args.target })))
}

const handle_do_action: Handler = async (ctx, args) => {
  const { doAction } = await import('@/lib/settings/registry')
  return j(noYesHere(ctx, await doAction(await regCtx(ctx), args.key, args.input ?? {})))
}

const handle_setup_progress: Handler = async (ctx) => {
  const { setupProgress } = await import('@/lib/settings/registry')
  return j(await setupProgress(await regCtx(ctx)))
}

export const SETTINGS_TOOL_HANDLERS: Record<string, Handler> = {
  list_settings: handle_list_settings,
  explain_setting: handle_explain_setting,
  change_setting: handle_change_setting,
  do_action: handle_do_action,
  setup_progress: handle_setup_progress,
}
