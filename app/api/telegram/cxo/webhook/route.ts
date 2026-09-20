/**
 * CXO Suite Telegram webhook — the only Telegram bot this codebase operates.
 *
 * Telegram posts updates from @SuiteCxObot here. We set the brand context in
 * AsyncLocalStorage before delegating, so every outbound `sendTelegramMessage(...)`
 * deep in the dispatcher resolves the CXO bot token.
 *
 * Register with:
 *
 *   curl -X POST "https://api.telegram.org/bot${CXO_TELEGRAM_BOT_TOKEN}/setWebhook" \
 *     -d url=https://suitecxo.com/api/telegram/cxo/webhook \
 *     -d secret_token=${CXO_TELEGRAM_WEBHOOK_SECRET}
 *
 * The VirtualCloser bot is no longer ours — see app/api/telegram/webhook/route.ts.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { runWithBrand } from '@/lib/telegram-context'
import { handleTelegramWebhook, telegramWebhookInfo } from '@/lib/telegram-webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Telegram retries aggressively on slow responses; the underlying handler
// already returns fast, but give the agent tool-loop room.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  return runWithBrand('cxo', () => handleTelegramWebhook(req))
}

export async function GET() {
  const info = await runWithBrand('cxo', async () => telegramWebhookInfo())
  return NextResponse.json(info)
}
