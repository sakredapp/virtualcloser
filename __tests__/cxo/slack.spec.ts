/**
 * Ciao in Slack (lib/slack). No model, no network, no DB: the pure half
 * directly, and handleSlackEvent with every dependency injected.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in tests') } } }))
vi.mock('@/lib/agent/chatTurn', () => ({ runChatTurn: vi.fn() }))

import {
  SLACK_BOT_SCOPES,
  UNKNOWN_PERSON_REPLY,
  NO_EMAIL_REPLY,
  appendTurns,
  askFromEnvelope,
  buildSlackAuthUrl,
  canManageSlack,
  matchMemberByEmail,
  openSlackToken,
  sealSlackToken,
  signSlackBody,
  signSlackState,
  slackConfig,
  stripMentions,
  toSlackText,
  verifySlackSignature,
  verifySlackState,
  type SlackEnvelope,
} from '@/lib/slack/shared'
import { handleSlackEvent, type SlackDeps } from '@/lib/slack/handle'
import { SLACK_HELD_INTENT_KINDS, slackHoldFor } from '@/lib/ops/approvalsShared'
import { actionsFor, SLACK_HOLD_PREFIX } from '@/lib/followups/noticeActionsShared'

const SECRET = 'shhh-signing-secret'
const NOW = 1_760_000_000_000
const TS = String(Math.floor(NOW / 1000))
const root = join(__dirname, '..', '..')

describe('Slack request signature (v0)', () => {
  const body = '{"type":"event_callback"}'
  it('accepts a good signature', () => {
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: signSlackBody(SECRET, TS, body), rawBody: body, now: NOW })).toBe(true)
  })
  it('rejects a bad signature, a tampered body and a missing header', () => {
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: signSlackBody('other', TS, body), rawBody: body, now: NOW })).toBe(false)
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: signSlackBody(SECRET, TS, body), rawBody: body + ' ', now: NOW })).toBe(false)
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: null, rawBody: body, now: NOW })).toBe(false)
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: 'v0=abc', rawBody: body, now: NOW })).toBe(false)
  })
  it('rejects a stale or non-numeric timestamp (5 minute window)', () => {
    const old = String(Number(TS) - 301)
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: old, signature: signSlackBody(SECRET, old, body), rawBody: body, now: NOW })).toBe(false)
    const ok = String(Number(TS) - 299)
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ok, signature: signSlackBody(SECRET, ok, body), rawBody: body, now: NOW })).toBe(true)
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: 'abc', signature: signSlackBody(SECRET, 'abc', body), rawBody: body, now: NOW })).toBe(false)
  })
})

const dm = (over: Partial<NonNullable<SlackEnvelope['event']>> = {}): SlackEnvelope => ({
  type: 'event_callback',
  team_id: 'T1',
  event: { type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '111.1', text: 'what is on my plate', ...over },
})

describe('which Slack events get an answer', () => {
  it('answers a DM, threaded on its own ts', () => {
    expect(askFromEnvelope(dm(), { botUserId: 'UBOT' })).toEqual({ teamId: 'T1', slackUserId: 'U1', channel: 'D1', threadTs: '111.1', text: 'what is on my plate', kind: 'dm' })
  })
  it('answers an @mention, strips the bot tag, keeps the thread', () => {
    const env: SlackEnvelope = { type: 'event_callback', team_id: 'T1', event: { type: 'app_mention', user: 'U1', channel: 'C1', ts: '222.2', thread_ts: '200.0', text: '<@UBOT> who is behind <@U9>?' } }
    const a = askFromEnvelope(env, { botUserId: 'UBOT' })!
    expect(a.kind).toBe('mention')
    expect(a.threadTs).toBe('200.0')
    expect(a.text).toBe('who is behind <@U9>?')
  })
  it('ignores retries', () => {
    expect(askFromEnvelope(dm(), { retryNum: '1' })).toBeNull()
  })
  it('ignores bot messages, our own posts, edits and joins', () => {
    expect(askFromEnvelope(dm({ bot_id: 'B1' }))).toBeNull()
    expect(askFromEnvelope(dm({ bot_profile: {} }))).toBeNull()
    expect(askFromEnvelope(dm({ subtype: 'message_changed' }))).toBeNull()
    expect(askFromEnvelope(dm({ user: 'UBOT' }), { botUserId: 'UBOT' })).toBeNull()
  })
  it('ignores channel messages that are not a mention, and empty text', () => {
    expect(askFromEnvelope(dm({ channel_type: 'channel' }))).toBeNull()
    expect(askFromEnvelope(dm({ text: '<@UBOT>' }), { botUserId: 'UBOT' })).toBeNull()
    expect(askFromEnvelope({ type: 'url_verification', challenge: 'x' })).toBeNull()
  })
  it('stripMentions only removes the bot', () => {
    expect(stripMentions('<@UBOT> hi <@U2>', 'UBOT').trim()).toBe('hi <@U2>')
  })
})

describe('email to member, one company only', () => {
  const members = [
    { id: 'm1', rep_id: 'acme', email: 'Dana@Acme.com', is_active: true, role: 'member' },
    { id: 'm2', rep_id: 'other', email: 'sam@acme.com', is_active: true, role: 'owner' },
    { id: 'm3', rep_id: 'acme', email: 'gone@acme.com', is_active: false, role: 'member' },
    { id: 'm4', rep_id: 'acme', email: 'pa@acme.com', is_active: true, role: 'assistant' },
  ]
  it('matches case-insensitively inside the company', () => {
    expect(matchMemberByEmail(members, 'acme', 'dana@acme.com')?.id).toBe('m1')
  })
  it('never matches a member of another company', () => {
    expect(matchMemberByEmail(members, 'acme', 'sam@acme.com')).toBeNull()
  })
  it('never matches an inactive member or an assistant, or no email', () => {
    expect(matchMemberByEmail(members, 'acme', 'gone@acme.com')).toBeNull()
    expect(matchMemberByEmail(members, 'acme', 'pa@acme.com')).toBeNull()
    expect(matchMemberByEmail(members, 'acme', null)).toBeNull()
  })
})

describe('handleSlackEvent (no model, all deps injected)', () => {
  const install = { rep_id: 'acme', team_id: 'T1', team_name: 'Acme', bot_user_id: 'UBOT', bot_token_enc: 'enc', installed_by: null }
  const tenant = { id: 'acme', slug: 'acme', brand: 'cxo', host_aliases: [] }
  function deps(over: Partial<SlackDeps> = {}) {
    const posts: string[] = []
    const d: SlackDeps = {
      getInstallByTeam: vi.fn(async (t: string) => (t === 'T1' ? install : null)) as unknown as SlackDeps['getInstallByTeam'],
      slackUserEmail: vi.fn(async () => 'dana@acme.com'),
      postSlackReply: vi.fn(async (_t: string, _c: string, _ts: string, text: string) => { posts.push(text); return true }),
      loadThread: vi.fn(async () => []),
      saveThread: vi.fn(async () => {}),
      loadTenant: vi.fn(async () => tenant) as unknown as SlackDeps['loadTenant'],
      loadMembers: vi.fn(async () => [{ id: 'm1', rep_id: 'acme', email: 'dana@acme.com', is_active: true, role: 'owner' }]) as unknown as SlackDeps['loadMembers'],
      runChatTurn: vi.fn(async () => ({ reply: 'You have **two** to-dos.', held: [], raw: {} })) as unknown as SlackDeps['runChatTurn'],
      openToken: () => 'xoxb-test',
      ...over,
    }
    return { d, posts }
  }

  it('an unknown person gets the one polite line and Ciao never runs', async () => {
    const { d, posts } = deps({ slackUserEmail: vi.fn(async () => 'stranger@else.com') })
    expect(await handleSlackEvent(dm(), {}, d)).toBe('unknown_person')
    expect(posts).toEqual([UNKNOWN_PERSON_REPLY])
    expect(d.runChatTurn).not.toHaveBeenCalled()
  })
  it('a hidden email gets the no-email line', async () => {
    const { d, posts } = deps({ slackUserEmail: vi.fn(async () => null) })
    expect(await handleSlackEvent(dm(), {}, d)).toBe('no_email')
    expect(posts).toEqual([NO_EMAIL_REPLY])
  })
  it('an email from another company is unknown here', async () => {
    const { d, posts } = deps({ loadMembers: vi.fn(async () => [{ id: 'x', rep_id: 'other', email: 'dana@acme.com', is_active: true, role: 'owner' }]) as unknown as SlackDeps['loadMembers'] })
    expect(await handleSlackEvent(dm(), {}, d)).toBe('unknown_person')
    expect(posts).toEqual([UNKNOWN_PERSON_REPLY])
  })
  it('a retry and an unknown workspace stay quiet', async () => {
    const a = deps()
    expect(await handleSlackEvent(dm(), { retryNum: '2' }, a.d)).toBe('ignored')
    expect(await handleSlackEvent({ ...dm(), team_id: 'T9' }, {}, a.d)).toBe('no_install')
    expect(a.posts).toEqual([])
  })
  it('a non-CXO company is never answered', async () => {
    const { d, posts } = deps({ loadTenant: vi.fn(async () => ({ ...tenant, brand: 'virtualcloser' })) as unknown as SlackDeps['loadTenant'] })
    expect(await handleSlackEvent(dm(), {}, d)).toBe('no_install')
    expect(posts).toEqual([])
  })
  it('a known member: runs Ciao on the slack channel, replies in the thread as plain text, saves history', async () => {
    const { d, posts } = deps()
    expect(await handleSlackEvent(dm(), {}, d)).toBe('answered')
    expect(d.runChatTurn).toHaveBeenCalledWith(expect.objectContaining({ channel: 'slack', text: 'what is on my plate' }))
    expect(d.postSlackReply).toHaveBeenCalledWith('xoxb-test', 'D1', '111.1', 'You have *two* to-dos.')
    expect(posts).toEqual(['You have *two* to-dos.'])
    expect(d.saveThread).toHaveBeenCalled()
  })
  it('a held send carries the approve-in-app link', async () => {
    const { d, posts } = deps({ runChatTurn: vi.fn(async () => ({ reply: 'Ready: message Dana.', held: ['ap1'], raw: {} })) as unknown as SlackDeps['runChatTurn'] })
    await handleSlackEvent(dm(), {}, d)
    expect(posts[0]).toContain('Approve it in the app')
    expect(posts[0]).toContain('https://acme.suitecxo.com/dashboard')
  })
})

describe('Slack holds: nothing sends or changes from Slack', () => {
  it('holds sends and changes', () => {
    expect(slackHoldFor('send_member_message', { to: 'x' })?.reason).toBe('slack_hold')
    expect(slackHoldFor('create_calendar_event', {})?.reason).toBe('slack_hold')
    expect(slackHoldFor('reply_to_thread', { mode: 'send' })?.reason).toBe('slack_hold')
  })
  it('lets reads and drafts through', () => {
    expect(slackHoldFor('list_my_todos', {})).toBeNull()
    expect(slackHoldFor('reply_to_thread', { mode: 'draft' })).toBeNull()
  })
  it('booking, calling and sending intents are held', () => {
    for (const k of ['book_meeting', 'place_call', 'send_email', 'send_sms']) expect(SLACK_HELD_INTENT_KINDS.has(k)).toBe(true)
  })
  it('the in-app notice offers yes and no to the asker', () => {
    const acts = actionsFor({ key: `${SLACK_HOLD_PREFIX}abc`, item_id: 'abc' } as Parameters<typeof actionsFor>[0])
    expect(acts.map((a) => a.action)).toEqual(['approve_held', 'decline_held'])
  })
})

describe('install plumbing', () => {
  it('slackConfig is null until all three env vars are set', () => {
    expect(slackConfig({})).toBeNull()
    expect(slackConfig({ SLACK_CLIENT_ID: 'a', SLACK_CLIENT_SECRET: 'b' })).toBeNull()
    expect(slackConfig({ SLACK_CLIENT_ID: 'a', SLACK_CLIENT_SECRET: 'b', SLACK_SIGNING_SECRET: 'c' })?.redirectUri).toBe('https://www.suitecxo.com/api/slack/oauth/callback')
  })
  it('the auth URL asks for exactly the manifest scopes', () => {
    const cfg = slackConfig({ SLACK_CLIENT_ID: 'a', SLACK_CLIENT_SECRET: 'b', SLACK_SIGNING_SECRET: 'c' })!
    const u = new URL(buildSlackAuthUrl(cfg, 'st'))
    expect(u.searchParams.get('scope')).toBe(SLACK_BOT_SCOPES.join(','))
    const manifest = readFileSync(join(root, 'docs', 'slack-app-manifest.yml'), 'utf8')
    for (const s of SLACK_BOT_SCOPES) expect(manifest).toContain(`- ${s}`)
    expect(manifest).toContain('- app_mention')
    expect(manifest).toContain('- message.im')
    expect(manifest).toContain('https://www.suitecxo.com/api/slack/events')
  })
  it('state round-trips, rejects tampering and expiry', () => {
    const st = signSlackState('k', { repId: 'acme', memberId: 'm1' }, NOW)
    expect(verifySlackState('k', st, NOW)).toEqual({ repId: 'acme', memberId: 'm1' })
    expect(verifySlackState('other', st, NOW)).toBeNull()
    expect(verifySlackState('k', st, NOW + 16 * 60_000)).toBeNull()
  })
  it('the bot token is sealed and opens only with the same key', () => {
    const enc = sealSlackToken('xoxb-1', { SESSION_SECRET: 's1' })!
    expect(enc).not.toContain('xoxb')
    expect(openSlackToken(enc, { SESSION_SECRET: 's1' })).toBe('xoxb-1')
    expect(openSlackToken(enc, { SESSION_SECRET: 's2' })).toBeNull()
  })
  it('only owners and admins manage Slack', () => {
    expect(canManageSlack({ role: 'owner' })).toBe(true)
    expect(canManageSlack({ role: 'admin' })).toBe(true)
    expect(canManageSlack({ role: 'member' })).toBe(false)
  })
  it('replies are plain Slack text', () => {
    expect(toSlackText('## Hi\n**bold** [link](https://x.com)')).toBe('Hi\n*bold* <https://x.com|link>')
    expect(appendTurns([], 'q', 'a').length).toBe(2)
  })
})

describe('wiring', () => {
  const read = (p: string) => readFileSync(join(root, p), 'utf8')
  it('the events route acks then works in after()', () => {
    const src = read('app/api/slack/events/route.ts')
    expect(src).toMatch(/import \{ after/)
    expect(src).toContain('after(')
    expect(src).toContain('x-slack-retry-num')
    expect(src).toContain('url_verification')
    expect(src).toContain('status: 503')
  })
  it('the tool gate holds Slack asks', () => {
    expect(read('lib/ops/agentGate.ts')).toContain('slackHoldFor(')
  })
  it('every Slack route answers 503 when Slack is not set up', () => {
    for (const p of ['app/api/slack/oauth/start/route.ts', 'app/api/slack/oauth/callback/route.ts', 'app/api/slack/disconnect/route.ts']) {
      expect(read(p)).toContain('status: 503')
    }
  })
  it('user-facing Slack copy has no em dashes and never names Pinnacle', () => {
    for (const p of ['lib/slack/shared.ts', 'lib/slack/handle.ts', 'docs/slack-app-manifest.yml']) {
      const src = read(p)
      expect(src).not.toContain('—')
      expect(src).not.toMatch(/pinnacle/i)
    }
  })
})
