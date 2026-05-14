#!/usr/bin/env tsx
/**
 * AI Campaign Worker — runs on Hetzner (or any always-on Linux VM).
 *
 * Polls the lead_campaigns table every TICK_MS milliseconds and processes
 * any campaigns with next_action_at <= now(). Designed to run 24/7 under
 * pm2 with automatic restarts.
 *
 * Setup on Hetzner:
 *   npm install -g pm2 tsx
 *   cp .env.production .env   # must have SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                             #   REVRING_API_KEY, SMS_AI_ENABLED=true, etc.
 *   pm2 start hetzner-worker/index.ts --interpreter tsx --name campaign-worker
 *   pm2 save && pm2 startup
 *
 * Environment variables required (same as the Next.js app):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   REVRING_API_KEY
 *   SMS_AI_ENABLED=true
 *   ANTHROPIC_API_KEY        (for AI decision fallback)
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (or per-rep in DB)
 */

import { runCampaignTick } from '../lib/campaign/campaignEngine'
import { runDispatchTick } from '../lib/voice/dispatchTick'

const TICK_MS = parseInt(process.env.CAMPAIGN_TICK_MS ?? '30000', 10)  // default 30s
const MAX_CONSECUTIVE_ERRORS = 5

let consecutiveErrors = 0
let tickCount = 0

async function tick() {
  const started = Date.now()
  try {
    // Run campaign tick (state transitions + queue inserts) and dispatch
    // tick (queue → RevRing) in parallel. Dispatch runs reconcileStaleVoiceCalls
    // first internally, so trunk-failure cleanup also happens every 30s.
    const [campaign, dispatch] = await Promise.all([
      runCampaignTick(),
      runDispatchTick(),
    ])
    consecutiveErrors = 0
    tickCount++

    const interesting =
      campaign.processed > 0 || campaign.errors > 0 ||
      dispatch.dispatched > 0 || dispatch.failed > 0 || dispatch.skipped > 0 ||
      dispatch.voice_calls_reconciled.reconciled > 0
    if (interesting) {
      console.log(
        `[worker] tick #${tickCount} — campaigns(processed=${campaign.processed}, skipped=${campaign.skipped}, errors=${campaign.errors}) ` +
        `dispatch(scanned=${dispatch.scanned}, dispatched=${dispatch.dispatched}, skipped=${dispatch.skipped}, failed=${dispatch.failed}) ` +
        `reconciled(stale_voice_calls=${dispatch.voice_calls_reconciled.reconciled}, expired_queue=${dispatch.reconciled_expired}) ` +
        `(${Date.now() - started}ms)`,
      )
    }
  } catch (err) {
    consecutiveErrors++
    console.error(`[worker] tick error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err)

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error('[worker] too many consecutive errors — exiting (pm2 will restart)')
      process.exit(1)
    }
  }
}

async function main() {
  console.log(`[worker] AI Campaign Worker starting — tick every ${TICK_MS}ms`)
  console.log(`[worker] SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING'}`)
  console.log(`[worker] REVRING_API_KEY: ${process.env.REVRING_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`[worker] SMS_AI_ENABLED: ${process.env.SMS_AI_ENABLED}`)

  // Graceful shutdown
  process.on('SIGTERM', () => { console.log('[worker] SIGTERM — shutting down'); process.exit(0) })
  process.on('SIGINT',  () => { console.log('[worker] SIGINT — shutting down');  process.exit(0) })

  // Run immediately on start, then every TICK_MS
  await tick()

  setInterval(async () => {
    await tick()
  }, TICK_MS)
}

main().catch((err) => {
  console.error('[worker] fatal startup error:', err)
  process.exit(1)
})
