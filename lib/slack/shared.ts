/**
 * Ciao in Slack, the pure half (no DB, no network). Used by the Slack routes,
 * lib/slack/data.ts, lib/slack/handle.ts and the tests.
 *
 *  - Request signing: Slack's v0 HMAC over `v0:<ts>:<raw body>` with the app's
 *    signing secret, inside a 5 minute window.
 *  - Which events we answer: a DM to the bot (message.im) and an @mention in a
 *    channel (app_mention). Never a bot's own message, an edit, or a retry
 *    (X-Slack-Retry-Num), so nobody gets two replies.
 *  - OAuth v2 install: the authorize URL and a signed state.
 *  - The bot token is AES-256-GCM encrypted at rest, same scheme as Google.
 *
 * Env: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET. Unset means
 * Slack is still being set up: the card says so, the routes answer 503.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { decryptToken, encryptToken } from '@/lib/qbo/shared'
import { ASSISTANT_NAME } from '@/lib/assistantName'

type Env = Record<string, string | undefined>

/** Scopes the bot asks for (the manifest in docs/slack-app-manifest.yml lists the same). */
export const SLACK_BOT_SCOPES = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write', 'users:read', 'users:read.email'] as const

/** The production host: suitecxo.com 307s to www, and Slack does not follow redirects. */
export const SLACK_APP_ORIGIN = 'https://www.suitecxo.com'
export const SLACK_REDIRECT_PATH = '/api/slack/oauth/callback'

export type SlackConfig = { clientId: string; clientSecret: string; signingSecret: string; redirectUri: string }

/** All three set, or null (Slack is being set up). */
export function slackConfig(env: Env = process.env): SlackConfig | null {
  const clientId = (env.SLACK_CLIENT_ID ?? '').trim()
  const clientSecret = (env.SLACK_CLIENT_SECRET ?? '').trim()
  const signingSecret = (env.SLACK_SIGNING_SECRET ?? '').trim()
  if (!clientId || !clientSecret || !signingSecret) return null
  const redirectUri = (env.SLACK_REDIRECT_URI ?? '').trim() || `${SLACK_APP_ORIGIN}${SLACK_REDIRECT_PATH}`
  return { clientId, clientSecret, signingSecret, redirectUri }
}

// ── Request signing ─────────────────────────────────────────────────────

export const SLACK_SIGNATURE_WINDOW_S = 5 * 60

/** Slack's v0 signature check. `now` is ms. False on anything missing, stale or wrong. */
export function verifySlackSignature(input: { signingSecret: string; timestamp: string | null; signature: string | null; rawBody: string; now?: number }): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input
  if (!signingSecret || !timestamp || !signature) return false
  if (!/^\d{1,12}$/.test(timestamp)) return false
  const nowS = Math.floor((input.now ?? Date.now()) / 1000)
  if (Math.abs(nowS - Number(timestamp)) > SLACK_SIGNATURE_WINDOW_S) return false
  if (!signature.startsWith('v0=')) return false
  const want = Buffer.from(`v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`)
  const got = Buffer.from(signature)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** The signature for a body (tests and local checks). */
export function signSlackBody(signingSecret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`
}

// ── Which events we answer ──────────────────────────────────────────────

export type SlackEvent = {
  type?: string
  subtype?: string
  channel_type?: string
  user?: string
  bot_id?: string
  bot_profile?: unknown
  text?: string
  channel?: string
  ts?: string
  thread_ts?: string
}

export type SlackEnvelope = {
  type?: string
  challenge?: string
  team_id?: string
  event_id?: string
  event?: SlackEvent
  authorizations?: Array<{ team_id?: string; user_id?: string; is_bot?: boolean }>
}

export type SlackAsk = { teamId: string; slackUserId: string; channel: string; threadTs: string; text: string; kind: 'dm' | 'mention' }

/**
 * The one question to answer, or null to stay quiet. `retryNum` is the
 * X-Slack-Retry-Num header: Slack resends when we were slow, and the first
 * delivery is already being answered.
 */
export function askFromEnvelope(env: SlackEnvelope, opts: { retryNum?: string | null; botUserId?: string | null } = {}): SlackAsk | null {
  if (opts.retryNum) return null
  if (env.type !== 'event_callback') return null
  const e = env.event
  const teamId = env.team_id ?? ''
  if (!e || !teamId) return null
  if (e.bot_id || e.bot_profile || e.subtype) return null // bot posts (ours included), edits, joins, deletes
  if (!e.user || !e.channel || !e.ts) return null
  if (opts.botUserId && e.user === opts.botUserId) return null
  let kind: SlackAsk['kind']
  if (e.type === 'app_mention') kind = 'mention'
  else if (e.type === 'message' && e.channel_type === 'im') kind = 'dm'
  else return null
  const text = stripMentions(e.text ?? '', opts.botUserId).trim().slice(0, 4000)
  if (!text) return null
  return { teamId, slackUserId: e.user, channel: e.channel, threadTs: e.thread_ts || e.ts, text, kind }
}

/** Drop the bot's own <@U123> tag; other people's tags stay as they are. */
export function stripMentions(text: string, botUserId?: string | null): string {
  let t = String(text ?? '')
  if (botUserId) t = t.split(`<@${botUserId}>`).join(' ')
  return t.replace(/\s+/g, ' ')
}

// ── Replies ─────────────────────────────────────────────────────────────

/** The reply to someone Slack shows us who is not on this company's team (company's name for the assistant). */
export function unknownPersonReply(assistantName: string = ASSISTANT_NAME): string {
  return `I can only help people on your company's ${assistantName} team. Ask an admin to add you with this email address.`
}
export const UNKNOWN_PERSON_REPLY = unknownPersonReply()

export const NO_EMAIL_REPLY = `I could not see your email address in Slack, so I cannot tell who you are. Ask an admin to check the app's Slack setup.`

/** Slack mrkdwn is close to plain text; turn **bold** into *bold* and [x](url) into <url|x>. */
export function toSlackText(reply: string): string {
  return String(reply ?? '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>')
    .replace(/^#{1,6}\s+/gm, '')
    .slice(0, 3900)
}

/** The line added under a reply when something waits for a yes in the app. */
export function approveInAppLine(url: string, assistantName: string = ASSISTANT_NAME): string {
  return `Nothing has been sent or changed yet. Approve it in the app: <${url}|open ${assistantName}>`
}

// ── Thread history ──────────────────────────────────────────────────────

export type ThreadTurn = { role: 'user' | 'assistant'; content: string; at?: string }
export const THREAD_HISTORY_MAX = 20

/** Append a question and its answer, keep the last THREAD_HISTORY_MAX turns. */
export function appendTurns(history: unknown, user: string, assistant: string, at = new Date()): ThreadTurn[] {
  const prev = Array.isArray(history)
    ? (history as ThreadTurn[]).filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    : []
  const t = at.toISOString()
  return [...prev, { role: 'user' as const, content: user.slice(0, 4000), at: t }, { role: 'assistant' as const, content: assistant.slice(0, 4000), at: t }].slice(-THREAD_HISTORY_MAX)
}

// ── OAuth v2 install ────────────────────────────────────────────────────

/** Owners and admins add or remove the company's Slack. */
export function canManageSlack(member: { role?: string | null } | null | undefined): boolean {
  return !!member && (member.role === 'owner' || member.role === 'admin')
}

export function buildSlackAuthUrl(cfg: SlackConfig, state: string): string {
  const u = new URL('https://slack.com/oauth/v2/authorize')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('state', state)
  return u.toString()
}

const b64u = (b: Buffer) => b.toString('base64url')

export function signSlackState(secret: string, s: { repId: string; memberId: string }, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ r: s.repId, m: s.memberId, e: now + 15 * 60_000, n: b64u(randomBytes(12)) })))
  const sig = b64u(createHmac('sha256', secret).update(`slack-state.${body}`).digest())
  return `${body}.${sig}`
}

export function verifySlackState(secret: string, state: string, now = Date.now()): { repId: string; memberId: string } | null {
  const [body, sig] = String(state || '').split('.')
  if (!body || !sig) return null
  const want = createHmac('sha256', secret).update(`slack-state.${body}`).digest()
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { r?: string; m?: string; e?: number }
    if (!j.r || !j.m || typeof j.e !== 'number' || j.e < now) return null
    return { repId: j.r, memberId: j.m }
  } catch {
    return null
  }
}

// ── Token at rest ───────────────────────────────────────────────────────

/** Same root as the Google key (GOOGLE_TOKEN_KEY, else SESSION_SECRET), its own derived key. */
export function slackSecretKey(env: Env = process.env): Buffer | null {
  const raw = (env.GOOGLE_TOKEN_KEY || env.SESSION_SECRET || '').trim()
  if (!raw) return null
  return Buffer.from(hkdfSync('sha256', raw, 'suitecxo-slack', 'slack-bot-token-v1', 32))
}

export function sealSlackToken(plain: string, env: Env = process.env): string | null {
  const key = slackSecretKey(env)
  return key ? encryptToken(plain, key) : null
}

export function openSlackToken(enc: string | null | undefined, env: Env = process.env): string | null {
  const key = slackSecretKey(env)
  return key && enc ? decryptToken(enc, key) : null
}

// ── Members by email, one company only ──────────────────────────────────

export type MemberLike = { id: string; rep_id: string; email: string | null; is_active?: boolean | null; role?: string | null }

/** The active member of THIS company with that verified email. Assistants never. */
export function matchMemberByEmail<T extends MemberLike>(members: T[], repId: string, email: string | null | undefined): T | null {
  const e = String(email ?? '').trim().toLowerCase()
  if (!e || !e.includes('@')) return null
  return members.find((m) => m.rep_id === repId && m.is_active !== false && m.role !== 'assistant' && String(m.email ?? '').trim().toLowerCase() === e) ?? null
}
