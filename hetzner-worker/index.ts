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
import { runGmailSyncTick } from '../lib/email/syncTick'
import { runGmailTriageTick } from '../lib/email/triageTick'
import { runPlaudAgentTick } from '../lib/plaud/agentTick'
import { runDailyPlanTick } from '../lib/plaud/dailyPlan'
import { runPinnacleSyncTick } from '../lib/pinnacle/syncTick'

const TICK_MS = parseInt(process.env.CAMPAIGN_TICK_MS ?? '30000', 10)  // default 30s
const MAX_CONSECUTIVE_ERRORS = 5
// Gmail sync runs every Nth tick. Default 1 = every tick = ~30s.
// Set higher (e.g. 4) to throttle if quota becomes a concern. Gmail's quota
// (1B units/day) is far above what we'd burn at 30s polling.
const GMAIL_SYNC_EVERY_N_TICKS = parseInt(process.env.GMAIL_SYNC_EVERY_N_TICKS ?? '1', 10)
// Plaud agent runs every Nth tick (default 4 → ~2 min at 30s ticks). The
// loop is gated by PLAUD_AGENT_REP_IDS so unset = never runs.
const PLAUD_AGENT_EVERY_N_TICKS = parseInt(process.env.PLAUD_AGENT_EVERY_N_TICKS ?? '4', 10)
// Daily plan ("morning briefing") rolls up recordings + tasks into one plan.
// We CHECK every ~240th tick (~2h at 30s); the tick itself enforces one plan
// per rep per day and only fires past the rep-local morning hour, so the heavy
// LLM work happens once a day. Gated by PLAUD_AGENT_REP_IDS (same as the agent).
const DAILY_PLAN_CHECK_EVERY_N_TICKS = parseInt(
  process.env.DAILY_PLAN_CHECK_EVERY_N_TICKS ?? '240',
  10,
)
// Pinnacle Airtable sync runs daily. We CHECK on every 240th tick (~2h at
// 30s ticks) but the sync function itself enforces a 23h cooldown via
// the sync_runs table, so the heavy work only fires once a day.
const PINNACLE_CHECK_EVERY_N_TICKS = parseInt(
  process.env.PINNACLE_CHECK_EVERY_N_TICKS ?? '240',
  10,
)

let consecutiveErrors = 0
let tickCount = 0

async function tick() {
  const started = Date.now()
  try {
    const shouldSyncGmail =
      Boolean(process.env.EMAIL_TRIAGE_REP_IDS) && tickCount % GMAIL_SYNC_EVERY_N_TICKS === 0
    // Run campaign tick (state transitions + queue inserts) and dispatch
    // tick (queue → RevRing) in parallel. Dispatch runs reconcileStaleVoiceCalls
    // first internally, so trunk-failure cleanup also happens every 30s.
    // Gmail sync rides along every Nth tick when enabled.
    const [campaign, dispatch, gmail] = await Promise.all([
      runCampaignTick(),
      runDispatchTick(),
      shouldSyncGmail ? runGmailSyncTick() : Promise.resolve(null),
    ])
    // Triage runs sequentially after sync — triage only matters once new
    // threads have been persisted, and we don't want concurrent LLM calls
    // dogpiling the API key.
    const triage = shouldSyncGmail ? await runGmailTriageTick() : null

    // Plaud agent rides on its own cadence. Sequential after email triage to
    // avoid stacking LLM calls; gated by PLAUD_AGENT_REP_IDS in the tick itself.
    const shouldRunPlaud =
      Boolean(process.env.PLAUD_AGENT_REP_IDS) && tickCount % PLAUD_AGENT_EVERY_N_TICKS === 0
    const plaud = shouldRunPlaud ? await runPlaudAgentTick() : null

    // Daily plan rolls up the same notes the agent triaged. Checks on its own
    // (slow) cadence; the tick no-ops until it's morning rep-local and skips
    // reps that already have today's plan.
    const shouldCheckDailyPlan =
      Boolean(process.env.PLAUD_AGENT_REP_IDS) && tickCount % DAILY_PLAN_CHECK_EVERY_N_TICKS === 0
    const dailyPlan = shouldCheckDailyPlan ? await runDailyPlanTick() : null

    // Pinnacle Airtable sync. Checks every ~2h whether the 23h cooldown
    // has expired; the actual fetch only fires once a day. The sync itself
    // takes ~9 min (167K rows across Brad's 3 bases) which is why it can't
    // live on Vercel.
    const shouldCheckPinnacle =
      Boolean(process.env.PINNACLE_AIRTABLE_TOKEN) &&
      tickCount % PINNACLE_CHECK_EVERY_N_TICKS === 0
    const pinnacle = shouldCheckPinnacle ? await runPinnacleSyncTick() : null

    consecutiveErrors = 0
    tickCount++

    const interesting =
      campaign.processed > 0 || campaign.errors > 0 ||
      dispatch.dispatched > 0 || dispatch.failed > 0 || dispatch.skipped > 0 ||
      dispatch.voice_calls_reconciled.reconciled > 0 ||
      (gmail !== null && (gmail.totalNew > 0 || gmail.totalPersisted > 0)) ||
      (triage !== null && (triage.processed > 0 || triage.drafted > 0)) ||
      (plaud !== null && (plaud.processed > 0 || plaud.actions_proposed > 0 || plaud.errors > 0)) ||
      (dailyPlan !== null && (dailyPlan.plans_generated > 0 || dailyPlan.errors > 0)) ||
      (pinnacle !== null && pinnacle.ran)
    if (interesting) {
      const gmailSummary = gmail
        ? ` gmail(new=${gmail.totalNew}, persisted=${gmail.totalPersisted})`
        : ''
      const triageSummary = triage
        ? ` triage(processed=${triage.processed}, drafted=${triage.drafted}, errors=${triage.errors})`
        : ''
      const plaudSummary = plaud
        ? ` plaud(processed=${plaud.processed}, proposed=${plaud.actions_proposed}, executed=${plaud.actions_executed}, failed=${plaud.actions_failed}, errors=${plaud.errors})`
        : ''
      const dailyPlanSummary = dailyPlan && (dailyPlan.plans_generated > 0 || dailyPlan.errors > 0)
        ? ` dailyplan(generated=${dailyPlan.plans_generated}, checked=${dailyPlan.reps_checked}, errors=${dailyPlan.errors})`
        : ''
      const pinnacleSummary = pinnacle && pinnacle.ran
        ? ` pinnacle(ok=${pinnacle.result.ok}, bases=${pinnacle.result.bases.length}, ${Math.round(pinnacle.durationMs / 1000)}s)`
        : ''
      console.log(
        `[worker] tick #${tickCount} — campaigns(processed=${campaign.processed}, skipped=${campaign.skipped}, errors=${campaign.errors}) ` +
        `dispatch(scanned=${dispatch.scanned}, dispatched=${dispatch.dispatched}, skipped=${dispatch.skipped}, failed=${dispatch.failed}) ` +
        `reconciled(stale_voice_calls=${dispatch.voice_calls_reconciled.reconciled}, expired_queue=${dispatch.reconciled_expired})` +
        gmailSummary +
        triageSummary +
        plaudSummary +
        dailyPlanSummary +
        pinnacleSummary +
        ` (${Date.now() - started}ms)`,
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
  console.log(`[worker] EMAIL_TRIAGE_REP_IDS: ${process.env.EMAIL_TRIAGE_REP_IDS ?? 'unset (gmail sync off)'}`)
  console.log(`[worker] PLAUD_AGENT_REP_IDS: ${process.env.PLAUD_AGENT_REP_IDS ?? 'unset (plaud agent + daily plan off)'}`)
  console.log(`[worker] PINNACLE_AIRTABLE_TOKEN: ${process.env.PINNACLE_AIRTABLE_TOKEN ? 'set' : 'unset (pinnacle sync off)'}`)

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
