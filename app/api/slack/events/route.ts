import { after, NextResponse } from 'next/server'
import { askFromEnvelope, slackConfig, verifySlackSignature, type SlackEnvelope } from '@/lib/slack/shared'
import { handleSlackEvent } from '@/lib/slack/handle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Slack Events API (https://www.suitecxo.com/api/slack/events). A DM to the
 * bot or an @mention in a channel. Slack wants a 200 inside 3 seconds, so we
 * verify the signature, answer now, and do the work in after(). Retries
 * (X-Slack-Retry-Num) and bot messages are dropped so nobody gets two replies.
 * Not set up (no SLACK_* env): 503, nothing else.
 */
export async function POST(req: Request) {
  const cfg = slackConfig()
  if (!cfg) return new NextResponse(null, { status: 503 })
  const rawBody = await req.text()
  const ok = verifySlackSignature({
    signingSecret: cfg.signingSecret,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    rawBody,
  })
  if (!ok) return new NextResponse(null, { status: 401 })

  let env: SlackEnvelope
  try {
    env = JSON.parse(rawBody) as SlackEnvelope
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (env.type === 'url_verification') return NextResponse.json({ challenge: env.challenge ?? '' })

  const retryNum = req.headers.get('x-slack-retry-num')
  if (retryNum) return new NextResponse(null, { status: 200, headers: { 'x-slack-no-retry': '1' } })
  // Cheap pre-check (no bot id yet): skip bot posts, edits and other events without touching the DB.
  if (!askFromEnvelope(env)) return new NextResponse(null, { status: 200 })

  after(async () => {
    try {
      await handleSlackEvent(env, { retryNum })
    } catch (err) {
      console.error('[slack events] handle failed', err)
    }
  })
  return new NextResponse(null, { status: 200 })
}
