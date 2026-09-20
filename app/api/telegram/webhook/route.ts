/**
 * VirtualCloser Telegram webhook — RETIRED.
 *
 * The VC bot (@VirtualCloserBot / TELEGRAM_BOT_TOKEN) was handed off to a
 * separate CRM product that lives outside this repo. That product owns the
 * bot now: its token env var is still populated here because other code paths
 * historically read it, but this codebase must neither send as that bot nor
 * act on its updates.
 *
 * Two independent guards enforce that, so neither alone is load-bearing:
 *   1. `virtualcloser.telegram.enabled = false` in lib/brand.ts — makes
 *      `brandTelegramToken('virtualcloser')` resolve undefined, so every
 *      sender in lib/telegram.ts no-ops.
 *   2. This route, which parses nothing and dispatches nothing.
 *
 * IMPORTANT: do not "clean this up" by calling deleteWebhook on the VC bot.
 * A bot has exactly one webhook URL, and that registration is now the other
 * CRM's to manage. Deleting it would break *their* product, not ours.
 *
 * The live bot is CXO Suite: app/api/telegram/cxo/webhook/route.ts.
 * The shared handler both brands used to run is lib/telegram-webhook.ts.
 *
 * We answer 200 rather than 404/403 on purpose: if Telegram is still pointed
 * here for any reason, a 200 makes it drop the update instead of retrying it
 * on a backoff for hours.
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({ ok: true, retired: true })
}

export async function GET() {
  return NextResponse.json({
    ok: false,
    retired: true,
    detail: 'The VirtualCloser bot is no longer operated by this application.',
    live_bot: '/api/telegram/cxo/webhook',
  })
}
