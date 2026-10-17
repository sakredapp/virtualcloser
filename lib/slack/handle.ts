/**
 * Answer one Slack question as Ciao. Runs inside `after()` from the events
 * route, so Slack already has its 200.
 *
 *  1. The workspace -> its company (cxo_slack_installs). Unknown workspace: quiet.
 *  2. The Slack person -> their verified email (users.info) -> an active member
 *     of THAT company only. Anyone else gets one polite line.
 *  3. runChatTurn with channel 'slack': same tools, same role scope, same
 *     approvals as the in-app chat. Anything that sends or changes something
 *     is held for a yes in the app; the reply carries the link.
 *  4. The reply goes back in the thread, plain text; the thread keeps a short
 *     history so follow-ups make sense.
 */
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { memberHomeHost } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { runChatTurn } from '@/lib/agent/chatTurn'
import { isEmployeeCaller } from '@/lib/agent/access'
import {
  NO_EMAIL_REPLY,
  approveInAppLine,
  askFromEnvelope,
  matchMemberByEmail,
  openSlackToken,
  toSlackText,
  unknownPersonReply,
  type SlackEnvelope,
} from '@/lib/slack/shared'
import { assistantNameFromSettings } from '@/lib/assistantNameFromRows'
import { getInstallByTeam, loadThread, postSlackReply, saveThread, slackUserEmail } from '@/lib/slack/data'

export type SlackDeps = {
  getInstallByTeam: typeof getInstallByTeam
  slackUserEmail: typeof slackUserEmail
  postSlackReply: typeof postSlackReply
  loadThread: typeof loadThread
  saveThread: typeof saveThread
  loadTenant: (repId: string) => Promise<Tenant | null>
  loadMembers: (repId: string) => Promise<Member[]>
  runChatTurn: typeof runChatTurn
  openToken: (enc: string) => string | null
}

async function loadTenant(repId: string): Promise<Tenant | null> {
  const { data } = await supabase.from('reps').select('*').eq('id', repId).eq('is_active', true).maybeSingle()
  return (data as Tenant | null) ?? null
}

async function loadMembers(repId: string): Promise<Member[]> {
  const { data } = await supabase.from('members').select('*').eq('rep_id', repId).eq('is_active', true)
  return (data ?? []) as Member[]
}

const DEFAULT_DEPS: SlackDeps = {
  getInstallByTeam,
  slackUserEmail,
  postSlackReply,
  loadThread,
  saveThread,
  loadTenant,
  loadMembers,
  runChatTurn,
  openToken: (enc) => openSlackToken(enc),
}

/** Where the asker says yes: their own home page on their company's host. */
export function approvalUrl(tenant: Tenant, member: Member): string {
  const host = memberHomeHost(tenant, (member as { home_subdomain?: string | null }).home_subdomain)
  const path = isEmployeeCaller(member, tenant) ? '/dashboard/me' : '/dashboard'
  return `https://${host}.suitecxo.com${path}`
}

export type SlackOutcome = 'ignored' | 'no_install' | 'unknown_person' | 'no_email' | 'answered' | 'failed'

export async function handleSlackEvent(env: SlackEnvelope, opts: { retryNum?: string | null } = {}, deps: SlackDeps = DEFAULT_DEPS): Promise<SlackOutcome> {
  if (opts.retryNum) return 'ignored'
  const install = await deps.getInstallByTeam(env.team_id ?? '')
  if (!install) return 'no_install'
  const ask = askFromEnvelope(env, { retryNum: opts.retryNum, botUserId: install.bot_user_id })
  if (!ask) return 'ignored'
  const token = deps.openToken(install.bot_token_enc)
  if (!token) return 'failed'
  const reply = (text: string) => deps.postSlackReply(token, ask.channel, ask.threadTs, text)

  const tenant = await deps.loadTenant(install.rep_id)
  if (!tenant || (tenant.brand ?? null) !== 'cxo') return 'no_install'

  const email = await deps.slackUserEmail(token, ask.slackUserId)
  if (!email) {
    await reply(NO_EMAIL_REPLY)
    return 'no_email'
  }
  const member = matchMemberByEmail(await deps.loadMembers(install.rep_id), install.rep_id, email)
  if (!member) {
    // Not one of theirs: the company's name for the assistant.
    await reply(unknownPersonReply(assistantNameFromSettings((tenant as { settings?: unknown }).settings)))
    return 'unknown_person'
  }

  const key = { repId: install.rep_id, teamId: ask.teamId, channel: ask.channel, threadTs: ask.threadTs, memberId: member.id }
  try {
    const prev = await deps.loadThread(key)
    const history = prev.map((h) => ({ role: h.role, content: h.content }))
    const turn = await deps.runChatTurn({ tenant, member, text: ask.text, history, channel: 'slack' })
    let text = turn.reply
    if (turn.choice) {
      const opts = (turn.choice.options ?? []).map((o, i) => `${i + 1}. ${o.label}`)
      text = [turn.choice.prompt, ...opts, opts.length ? 'Reply with the one you want.' : ''].filter(Boolean).join('\n')
    }
    if (turn.held.length > 0) text = `${text}\n\n${approveInAppLine(approvalUrl(tenant, member), assistantNameFromSettings((tenant as { settings?: unknown }).settings, (member as { settings?: unknown }).settings))}`
    const out = toSlackText(text)
    await reply(out)
    await deps.saveThread(key, prev, ask.text, out)
    return 'answered'
  } catch (err) {
    console.error('[slack] turn failed', err)
    await reply("Something went wrong on my side. Ask me again in a minute.").catch(() => null)
    return 'failed'
  }
}
