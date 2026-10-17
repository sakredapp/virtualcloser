/**
 * Ciao in Slack, the DB and Slack Web API half. One Slack workspace per
 * company (cxo_slack_installs); a short history per thread
 * (cxo_slack_threads). Every read is fenced by rep_id. A missing table
 * (42P01 / PGRST205) is a quiet no-op: no install, no history.
 */
import { supabase } from '@/lib/supabase'
import { appendTurns, openSlackToken, sealSlackToken, type SlackConfig, type ThreadTurn } from '@/lib/slack/shared'

export type SlackInstall = { rep_id: string; team_id: string; team_name: string | null; bot_user_id: string; bot_token_enc: string; installed_by: string | null; created_at?: string }

const COLS = 'rep_id, team_id, team_name, bot_user_id, bot_token_enc, installed_by, created_at'

function missing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

export async function getInstallForRep(repId: string): Promise<SlackInstall | null> {
  const { data, error } = await supabase.from('cxo_slack_installs').select(COLS).eq('rep_id', repId).maybeSingle()
  if (error) {
    if (!missing(error)) console.error('[slack] install read', error.message)
    return null
  }
  return (data as SlackInstall | null) ?? null
}

export async function getInstallByTeam(teamId: string): Promise<SlackInstall | null> {
  if (!teamId) return null
  const { data, error } = await supabase.from('cxo_slack_installs').select(COLS).eq('team_id', teamId).maybeSingle()
  if (error) {
    if (!missing(error)) console.error('[slack] install read', error.message)
    return null
  }
  return (data as SlackInstall | null) ?? null
}

export class SlackInstallError extends Error {}

/** Store (or replace) the company's workspace. A workspace already tied to another company is refused. */
export async function saveInstall(input: { repId: string; teamId: string; teamName: string | null; botUserId: string; botToken: string; installedBy: string }): Promise<void> {
  const enc = sealSlackToken(input.botToken)
  if (!enc) throw new SlackInstallError('no_key')
  const other = await getInstallByTeam(input.teamId)
  if (other && other.rep_id !== input.repId) throw new SlackInstallError('taken')
  const { error } = await supabase.from('cxo_slack_installs').upsert(
    { rep_id: input.repId, team_id: input.teamId, team_name: input.teamName, bot_user_id: input.botUserId, bot_token_enc: enc, installed_by: input.installedBy, updated_at: new Date().toISOString() },
    { onConflict: 'rep_id' },
  )
  if (error) throw error
}

/** Remove the company's workspace: revoke the token at Slack, delete the row and its threads. */
export async function deleteInstall(repId: string): Promise<void> {
  const inst = await getInstallForRep(repId)
  if (!inst) return
  const token = openSlackToken(inst.bot_token_enc)
  if (token) await slackApi(token, 'auth.revoke', {}).catch(() => null)
  await supabase.from('cxo_slack_threads').delete().eq('rep_id', repId)
  await supabase.from('cxo_slack_installs').delete().eq('rep_id', repId)
}

// ── Slack Web API ───────────────────────────────────────────────────────

type SlackResp = { ok: boolean; error?: string; [k: string]: unknown }

export async function slackApi(token: string, method: string, body: Record<string, unknown>, opts: { form?: boolean } = {}): Promise<SlackResp> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: opts.form
      ? { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }
      : { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: opts.form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
  })
  return (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as SlackResp
}

/** OAuth v2 code exchange. */
export async function exchangeSlackCode(cfg: SlackConfig, code: string): Promise<{ teamId: string; teamName: string | null; botUserId: string; botToken: string } | null> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri }).toString(),
  })
  const j = (await res.json().catch(() => null)) as { ok?: boolean; access_token?: string; token_type?: string; bot_user_id?: string; team?: { id?: string; name?: string } } | null
  if (!j?.ok || !j.access_token || j.token_type !== 'bot' || !j.bot_user_id || !j.team?.id) return null
  return { teamId: j.team.id, teamName: j.team.name ?? null, botUserId: j.bot_user_id, botToken: j.access_token }
}

/** The person's verified Slack email (users:read.email). Null when hidden, a bot, or deleted. */
export async function slackUserEmail(token: string, userId: string): Promise<string | null> {
  const r = await slackApi(token, 'users.info', { user: userId }, { form: true })
  const u = r.user as { deleted?: boolean; is_bot?: boolean; profile?: { email?: string } } | undefined
  if (!r.ok || !u || u.deleted || u.is_bot) return null
  const e = String(u.profile?.email ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

export async function postSlackReply(token: string, channel: string, threadTs: string, text: string): Promise<boolean> {
  const r = await slackApi(token, 'chat.postMessage', { channel, thread_ts: threadTs, text, unfurl_links: false, unfurl_media: false })
  if (!r.ok) console.error('[slack] postMessage', r.error)
  return r.ok
}

// ── Thread history ──────────────────────────────────────────────────────

type ThreadKey = { repId: string; teamId: string; channel: string; threadTs: string; memberId: string }

export async function loadThread(k: ThreadKey): Promise<ThreadTurn[]> {
  const { data, error } = await supabase
    .from('cxo_slack_threads')
    .select('history')
    .eq('rep_id', k.repId)
    .eq('team_id', k.teamId)
    .eq('channel', k.channel)
    .eq('thread_ts', k.threadTs)
    .eq('member_id', k.memberId)
    .maybeSingle()
  if (error) {
    if (!missing(error)) console.error('[slack] thread read', error.message)
    return []
  }
  const h = (data as { history?: unknown } | null)?.history
  return Array.isArray(h) ? (h as ThreadTurn[]) : []
}

export async function saveThread(k: ThreadKey, prev: ThreadTurn[], user: string, assistant: string): Promise<void> {
  const { error } = await supabase.from('cxo_slack_threads').upsert(
    { rep_id: k.repId, team_id: k.teamId, channel: k.channel, thread_ts: k.threadTs, member_id: k.memberId, history: appendTurns(prev, user, assistant), updated_at: new Date().toISOString() },
    { onConflict: 'team_id,channel,thread_ts,member_id' },
  )
  if (error && !missing(error)) console.error('[slack] thread save', error.message)
}
