/**
 * CXO Suite Telegram webhook.
 *
 * Telegram posts updates from @SuiteCxObot here. We delegate to the same
 * giant handler that powers the VirtualCloser bot at /api/telegram/webhook,
 * but first set the brand context in AsyncLocalStorage so every outbound
 * `sendTelegramMessage(...)` call deep in the dispatcher uses the CXO bot
 * token instead of the VC one.
 *
 * To activate this endpoint on Telegram's side, register the webhook with
 * BotFather/setWebhook against the CXO bot's token:
 *
 *   curl -X POST "https://api.telegram.org/bot${CXO_TELEGRAM_BOT_TOKEN}/setWebhook" \
 *     -d url=https://virtualcloser.com/api/telegram/cxo/webhook \
 *     -d secret_token=${TELEGRAM_WEBHOOK_SECRET}
 *
 * The handler validates `TELEGRAM_WEBHOOK_SECRET` the same way it does for
 * the VC bot — sharing one webhook secret across both bots is fine since
 * Telegram only ever posts to the URL it was registered against.
 */
import type { NextRequest } from 'next/server'
import { runWithBrand } from '@/lib/telegram-context'
// Re-use the legacy VC handler verbatim — the brand context picks the right
// bot token for outbound calls. No code duplication.
import { POST as baseTelegramPost } from '../../webhook/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Telegram retries aggressively on slow responses; the underlying handler
// already returns fast, but match the VC route's budget.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  return runWithBrand('cxo', () => baseTelegramPost(req))
}
