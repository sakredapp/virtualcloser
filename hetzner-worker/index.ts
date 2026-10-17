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
 *   OPENROUTER_API_KEY       (all AI; no fallback)
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (or per-rep in DB)
 */

import { runCampaignTick } from '../lib/campaign/campaignEngine'
import { runDispatchTick } from '../lib/voice/dispatchTick'
import { runGmailSyncTick } from '../lib/email/syncTick'
import { runGmailTriageTick } from '../lib/email/triageTick'
import { runPlaudAgentTick, plaudAgentOn } from '../lib/plaud/agentTick'
import { runDailyPlanTick } from '../lib/plaud/dailyPlan'
import { runPinnacleSyncTick } from '../lib/pinnacle/syncTick'
import { runFollowupSweep } from '../lib/followups/engine'
import { runDueReportJobs } from '../lib/ops/reports'
import { runWeeklyLearningsTick } from '../lib/agent/weeklyLearnings'
import { hasAIKey } from '../lib/ai'
import { runPreMeetingBriefTick } from '../lib/mira/preMeetingBrief'
import { runSlippingAlertTick } from '../lib/pinnacle/slippingTick'
import { runDayWrapTick } from '../lib/mira/dayWrap'
import { runDecisionLogTick } from '../lib/decisions/log'
import { runExecEmail } from '../lib/exec/execEmailRun'
import { runFixDigest } from '../lib/feedback/fixDigestRun'
import { runCalendarConflictTick } from '../lib/mira/calendarConflicts'
import { runWeeklyStatusTick } from '../lib/status/weekly'
import { runFallsBehindTick } from '../lib/people/fallsBehind'
import { runOnboardingTick } from '../lib/onboarding/dayOne'
import { runLeadershipAgendaTick } from '../lib/meetings/agenda'
import { recordHeartbeat } from '../lib/health'
import { logError } from '../lib/errors'

const WORKER_NAME = 'campaign-worker'

const TICK_MS = parseInt(process.env.CAMPAIGN_TICK_MS ?? '30000', 10)  // default 30s
const MAX_CONSECUTIVE_ERRORS = 5
// Gmail sync runs every Nth tick. Default 1 = every tick = ~30s.
// Set higher (e.g. 4) to throttle if quota becomes a concern. Gmail's quota
// (1B units/day) is far above what we'd burn at 30s polling.
const GMAIL_SYNC_EVERY_N_TICKS = parseInt(process.env.GMAIL_SYNC_EVERY_N_TICKS ?? '1', 10)
// Plaud agent runs every Nth tick (default 4 → ~2 min at 30s ticks). The
// loop is gated by PLAUD_AGENT_REP_IDS: unset = every Suite CXO tenant, off = never runs.
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

// Suite CXO employee ops (follow-up nudges, scheduled reports). Checks every
// ~30th tick (~15 min at 30s); the engine itself only touches tenants with
// reps.settings.cxo_employee_ops = true, so with the switch off it is a no-op.
const CXO_OPS_EVERY_N_TICKS = parseInt(process.env.CXO_OPS_EVERY_N_TICKS ?? '30', 10)

// Weekly Ciao learnings (Suite CXO): mines owner/admin chat history for
// durable rules + capability gaps, then self-teaches from action outcomes.
// CHECKS every ~240th tick (~2h); the tick itself runs each member once per
// ISO week from Monday 7am tenant-local (job_runs markers) and caps members
// per check (CIAO_LEARNINGS_MAX_MEMBERS_PER_TICK, default 10). Needs
// OPENROUTER_API_KEY; CIAO_LEARNINGS_ENABLED=false turns it off.
const CIAO_LEARNINGS_EVERY_N_TICKS = parseInt(process.env.CIAO_LEARNINGS_EVERY_N_TICKS ?? '240', 10)
// Suite CXO "Brief Before Every Meeting": every ~20th tick (~10 min at 30s)
// each member with a connected calendar gets one model-free brief for each
// meeting starting in ~30-90 min (in-app only, one per meeting). Off with
// CXO_PREMEETING_BRIEFS=off.
const CXO_PREMEETING_EVERY_N_TICKS = parseInt(process.env.CXO_PREMEETING_EVERY_N_TICKS ?? '20', 10)
// Ciao's "a number slipped" alert for the book-of-business execs. Checks every
// ~30th tick (~15 min); the tick itself waits for the day's Pinnacle sync and
// runs once per tenant per day (in-app notice only, nothing when nothing slips).
const SLIP_CHECK_EVERY_N_TICKS = parseInt(process.env.SLIP_CHECK_EVERY_N_TICKS ?? '30', 10)
// Ciao's end-of-day wrap for every Suite CXO person: every ~20th tick
// (~10 min) checks who has reached the end of their day (an hour before their
// working hours end, else 5pm local) and writes one in-app notice per person
// per day, only when there is something to say. Off with CXO_DAY_WRAP=off.
const CXO_DAY_WRAP_EVERY_N_TICKS = parseInt(process.env.CXO_DAY_WRAP_EVERY_N_TICKS ?? '20', 10)
// Suite CXO company decision log catch-up: every ~20th tick (~10 min) any
// meeting digest with decisions not yet in cxo_decisions is logged (the
// backfill, and a safety net behind the digest writer's own hook). Model-free.
// Off with CXO_DECISION_LOG=off.
const DECISION_LOG_EVERY_N_TICKS = parseInt(process.env.DECISION_LOG_EVERY_N_TICKS ?? '20', 10)
// Ciao's calendar check (lib/mira/calendarConflicts): ~every 10 min; each person once a day.
const CXO_CALCONF_EVERY_N_TICKS = parseInt(process.env.CXO_CALCONF_EVERY_N_TICKS ?? '20', 10)
// Ciao's weekly status (lib/status/weekly): Friday 2pm drafts each person's week
// and asks; Monday 8am the owner and admins get one rollup. ~every 10 min,
// once per person per ISO week. Model-free. Off with CXO_WEEKLY_STATUS=off.
const CXO_WEEKLY_STATUS_EVERY_N_TICKS = parseInt(process.env.CXO_WEEKLY_STATUS_EVERY_N_TICKS ?? '20', 10)
// Ciao's "someone fell behind" (lib/people/fallsBehind): weekdays from 9am
// company time, once a day per company, a manager hears in-app when someone
// on their team falls behind quota or bonus pace (once per episode, at most
// weekly). ~every 10 min. Model-free. Off with CXO_FALLS_BEHIND=off.
const CXO_FALLS_BEHIND_EVERY_N_TICKS = parseInt(process.env.CXO_FALLS_BEHIND_EVERY_N_TICKS ?? '20', 10)
// Day one with Ciao (lib/onboarding/dayOne): finds logins made in the last 14
// days, sends one welcome notice with their first-day steps, and tells their
// manager once when they are set up (or how the first day went). ~every 10 min.
// Model-free, in-app only. Off with CXO_ONBOARDING=off.
const CXO_ONBOARDING_EVERY_N_TICKS = parseInt(process.env.CXO_ONBOARDING_EVERY_N_TICKS ?? '20', 10)
// Ciao's leadership meeting agenda (lib/meetings/agenda): about 24h before the
// recurring leadership meeting, drafts its agenda and tells the execs on the
// invite. ~every 10 min, each tenant scanned once an hour, each instance once.
// Model-free. Off with CXO_LEADERSHIP_AGENDA=off.
const CXO_AGENDA_EVERY_N_TICKS = parseInt(process.env.CXO_AGENDA_EVERY_N_TICKS ?? '20', 10)

// Email digests that used to be Vercel crons: the exec morning email (7am
// tenant-local, weekdays, once per person per day) and the daily fix digest to
// the developer (once per ET day after 9am). Both record in job_runs and send
// nothing when there is nothing to say. Checked every ~20th tick (~10 min).
// Off with CXO_EXEC_DIGESTS=off.
const EXEC_DIGESTS_EVERY_N_TICKS = parseInt(process.env.EXEC_DIGESTS_EVERY_N_TICKS ?? '20', 10)

let consecutiveErrors = 0
let tickCount = 0

async function tick() {
  const started = Date.now()
  // Heartbeat at the START of each loop iteration so liveness is stamped even
  // when a single tick runs long (e.g. the ~9-min Pinnacle sync). The
  // health-check cron pages the operator if this row goes stale.
  await recordHeartbeat(WORKER_NAME, { tickCount, consecutiveErrors })
  try {
    const shouldSyncGmail =
      Boolean(process.env.EMAIL_TRIAGE_REP_IDS) && tickCount % GMAIL_SYNC_EVERY_N_TICKS === 0
    // Run campaign tick (state transitions + queue inserts) and dispatch
    // tick (queue → RevRing) in parallel. Dispatch runs reconcileStaleVoiceCalls
    // first internally, so trunk-failure cleanup also happens every 30s.
    // Gmail sync rides along every Nth tick when enabled. Suite CXO email is
    // the Pinnacle edition only (owner 2026-10-17): sync and triage skip every
    // other Suite CXO tenant (lib/cxoFeatures inboxAllowed).
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
      plaudAgentOn() && tickCount % PLAUD_AGENT_EVERY_N_TICKS === 0
    const plaud = shouldRunPlaud ? await runPlaudAgentTick() : null

    // Daily plan rolls up the same notes the agent triaged. Checks on its own
    // (slow) cadence; the tick no-ops until it's morning rep-local and skips
    // reps that already have today's plan.
    const shouldCheckDailyPlan =
      plaudAgentOn() && tickCount % DAILY_PLAN_CHECK_EVERY_N_TICKS === 0
    const dailyPlan = shouldCheckDailyPlan ? await runDailyPlanTick() : null

    // Pinnacle Airtable sync. Checks every ~2h whether the 23h cooldown
    // has expired; the actual fetch only fires once a day. The sync itself
    // takes ~9 min (167K rows across Brad's 3 bases) which is why it can't
    // live on Vercel.
    const shouldCheckPinnacle =
      Boolean(process.env.PINNACLE_AIRTABLE_TOKEN) &&
      tickCount % PINNACLE_CHECK_EVERY_N_TICKS === 0
    const pinnacle = shouldCheckPinnacle ? await runPinnacleSyncTick() : null

    // Suite CXO employee ops: follow-up sweep + due scheduled reports.
    const shouldRunCxoOps = tickCount % CXO_OPS_EVERY_N_TICKS === 0
    const cxoOps = shouldRunCxoOps
      ? await (async () => {
          const sweep = await runFollowupSweep().catch((err) => {
            console.error('[worker] cxo followup sweep', err instanceof Error ? err.message : err)
            return { tenants: 0, planned: 0, delivered: 0, emailed: 0, errors: 1 }
          })
          const reports = await runDueReportJobs().catch((err) => {
            console.error('[worker] cxo report jobs', err instanceof Error ? err.message : err)
            return { ran: 0, delivered: 0, errors: 1 }
          })
          return { sweep, reports }
        })()
      : null

    const shouldRunLearnings =
      process.env.CIAO_LEARNINGS_ENABLED !== 'false' &&
      hasAIKey() &&
      tickCount % CIAO_LEARNINGS_EVERY_N_TICKS === 0
    const learnings = shouldRunLearnings
      ? await runWeeklyLearningsTick().catch((err) => {
          console.error('[worker] ciao weekly learnings', err instanceof Error ? err.message : err)
          return null
        })
      : null

    // Suite CXO pre-meeting briefs (no model, nothing sent).
    const shouldRunPreMeeting =
      process.env.CXO_PREMEETING_BRIEFS !== 'off' && tickCount % CXO_PREMEETING_EVERY_N_TICKS === 0
    const preMeeting = shouldRunPreMeeting
      ? await runPreMeetingBriefTick().catch((err) => {
          console.error('[worker] cxo pre-meeting briefs', err instanceof Error ? err.message : err)
          return { tenants: 0, members: 0, written: 0, errors: 1 }
        })
      : null

    // After the sync above: Ciao's daily slipping alert (lib/pinnacle/slippingTick).
    const slipping = tickCount % SLIP_CHECK_EVERY_N_TICKS === 0
      ? await runSlippingAlertTick().catch((err) => {
          console.error('[worker] slipping alert', err instanceof Error ? err.message : err)
          return { tenants: 0, checked: 0, written: 0, errors: 1 }
        })
      : null

    // Ciao's end-of-day wrap (lib/mira/dayWrap; no model, in-app only).
    const dayWrap = process.env.CXO_DAY_WRAP !== 'off' && tickCount % CXO_DAY_WRAP_EVERY_N_TICKS === 0
      ? await runDayWrapTick().catch((err) => {
          console.error('[worker] day wrap', err instanceof Error ? err.message : err)
          return { tenants: 0, members: 0, written: 0, errors: 1 }
        })
      : null

    // Company decision log catch-up (lib/decisions/log).
    const decisions = tickCount % DECISION_LOG_EVERY_N_TICKS === 0
      ? await runDecisionLogTick().catch((err) => {
          console.error('[worker] decision log', err instanceof Error ? err.message : err)
          return { tenants: 0, notes: 0, inserted: 0, reversals: 0, notices: 0, errors: 1 }
        })
      : null

    const shouldRunDigests =
      process.env.CXO_EXEC_DIGESTS !== 'off' && tickCount % EXEC_DIGESTS_EVERY_N_TICKS === 0
    const execEmail = shouldRunDigests
      ? await runExecEmail().catch((err) => {
          console.error('[worker] exec email', err instanceof Error ? err.message : err)
          return null
        })
      : null
    const fixDigest = shouldRunDigests
      ? await runFixDigest().catch((err) => {
          console.error('[worker] fix digest', err instanceof Error ? err.message : err)
          return null
        })
      : null

    // Ciao's calendar conflicts check (lib/mira/calendarConflicts; no model, in-app only).
    const calConf = process.env.CXO_CALENDAR_CONFLICTS !== 'off' && tickCount % CXO_CALCONF_EVERY_N_TICKS === 0
      ? await runCalendarConflictTick().catch((err) => {
          console.error('[worker] calendar conflicts', err instanceof Error ? err.message : err)
          return { tenants: 0, members: 0, checked: 0, written: 0, cleared: 0, errors: 1 }
        })
      : null

    // Ciao's weekly status ask and Monday rollup (lib/status/weekly; no model, in-app only).
    const weeklyStatus = tickCount % CXO_WEEKLY_STATUS_EVERY_N_TICKS === 0
      ? await runWeeklyStatusTick().catch((err) => {
          console.error('[worker] weekly status', err instanceof Error ? err.message : err)
          return { tenants: 0, asked: 0, rollups: 0, errors: 1 }
        })
      : null

    // Ciao's "someone fell behind" alert to their manager (lib/people/fallsBehind; no model, in-app only).
    const fallsBehind = process.env.CXO_FALLS_BEHIND !== 'off' && tickCount % CXO_FALLS_BEHIND_EVERY_N_TICKS === 0
      ? await runFallsBehindTick().catch((err) => {
          console.error('[worker] falls behind', err instanceof Error ? err.message : err)
          return { tenants: 0, checked: 0, behind: 0, written: 0, errors: 1 }
        })
      : null

    // Day one with Ciao: welcome new logins and tell their manager once (lib/onboarding/dayOne; no model, in-app only).
    const onboarding = tickCount % CXO_ONBOARDING_EVERY_N_TICKS === 0
      ? await runOnboardingTick().catch((err) => {
          console.error('[worker] onboarding', err instanceof Error ? err.message : err)
          return { tenants: 0, started: 0, welcomed: 0, told: 0, errors: 1 }
        })
      : null

    // Ciao's leadership meeting agenda (lib/meetings/agenda; no model, in-app only).
    const agenda = tickCount % CXO_AGENDA_EVERY_N_TICKS === 0
      ? await runLeadershipAgendaTick().catch((err) => {
          console.error('[worker] leadership agenda', err instanceof Error ? err.message : err)
          return { tenants: 0, checked: 0, drafted: 0, notices: 0, linked: 0, errors: 1 }
        })
      : null

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
      (pinnacle !== null && pinnacle.ran) ||
      (cxoOps !== null && (cxoOps.sweep.delivered > 0 || cxoOps.sweep.errors > 0 || cxoOps.reports.ran > 0 || cxoOps.reports.errors > 0)) ||
      (learnings !== null && (learnings.analyzed > 0 || learnings.outcomePasses > 0 || learnings.errors > 0)) ||
      (preMeeting !== null && (preMeeting.written > 0 || preMeeting.errors > 0)) ||
      (slipping !== null && (slipping.checked > 0 || slipping.errors > 0)) ||
      (dayWrap !== null && (dayWrap.written > 0 || dayWrap.errors > 0)) ||
      (decisions !== null && (decisions.inserted > 0 || decisions.errors > 0)) ||
      (execEmail !== null && execEmail.totalSent > 0) ||
      (fixDigest !== null && (fixDigest.sent || Boolean(fixDigest.error))) ||
      (calConf !== null && (calConf.written > 0 || calConf.cleared > 0 || calConf.errors > 0)) ||
      (weeklyStatus !== null && (weeklyStatus.asked > 0 || weeklyStatus.rollups > 0 || weeklyStatus.errors > 0)) ||
      (fallsBehind !== null && (fallsBehind.written > 0 || fallsBehind.errors > 0)) ||
      (onboarding !== null && (onboarding.started > 0 || onboarding.welcomed > 0 || onboarding.told > 0 || onboarding.errors > 0)) ||
      (agenda !== null && (agenda.drafted > 0 || agenda.linked > 0 || agenda.errors > 0))
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
      const cxoOpsSummary = cxoOps && (cxoOps.sweep.delivered > 0 || cxoOps.sweep.errors > 0 || cxoOps.reports.ran > 0 || cxoOps.reports.errors > 0)
        ? ` cxo(tenants=${cxoOps.sweep.tenants}, notices=${cxoOps.sweep.delivered}, emailed=${cxoOps.sweep.emailed}, reports=${cxoOps.reports.ran}, errors=${cxoOps.sweep.errors + cxoOps.reports.errors})`
        : ''
      const learningsSummary = learnings && (learnings.analyzed > 0 || learnings.outcomePasses > 0 || learnings.errors > 0)
        ? ` learnings(analyzed=${learnings.analyzed}, outcome_passes=${learnings.outcomePasses}, deferred=${learnings.deferred}, errors=${learnings.errors})`
        : ''
      const preMeetingSummary = preMeeting && (preMeeting.written > 0 || preMeeting.errors > 0)
        ? ` premeeting(briefs=${preMeeting.written}, members=${preMeeting.members}, errors=${preMeeting.errors})`
        : ''
      const slippingSummary = slipping && (slipping.checked > 0 || slipping.errors > 0)
        ? ` slipping(checked=${slipping.checked}, notices=${slipping.written}, errors=${slipping.errors})`
        : ''
      const dayWrapSummary = dayWrap && (dayWrap.written > 0 || dayWrap.errors > 0)
        ? ` daywrap(notices=${dayWrap.written}, members=${dayWrap.members}, errors=${dayWrap.errors})`
        : ''
      const decisionsSummary = decisions && (decisions.inserted > 0 || decisions.errors > 0)
        ? ` decisions(notes=${decisions.notes}, logged=${decisions.inserted}, reversals=${decisions.reversals}, notices=${decisions.notices}, errors=${decisions.errors})`
        : ''
      const digestsSummary =
        (execEmail && execEmail.totalSent > 0 ? ` exec_email(sent=${execEmail.totalSent})` : '') +
        (fixDigest && (fixDigest.sent || fixDigest.error) ? ` fix_digest(sent=${fixDigest.sent}${fixDigest.error ? `, error=${fixDigest.error}` : ''})` : '')
      const calConfSummary = calConf && (calConf.written > 0 || calConf.cleared > 0 || calConf.errors > 0)
        ? ` calconf(notices=${calConf.written}, cleared=${calConf.cleared}, checked=${calConf.checked}, errors=${calConf.errors})`
        : ''
      const weeklyStatusSummary = weeklyStatus && (weeklyStatus.asked > 0 || weeklyStatus.rollups > 0 || weeklyStatus.errors > 0)
        ? ` weekly-status(asked=${weeklyStatus.asked}, rollups=${weeklyStatus.rollups}, errors=${weeklyStatus.errors})`
        : ''
      const fallsBehindSummary = fallsBehind && (fallsBehind.written > 0 || fallsBehind.errors > 0)
        ? ` falls-behind(notices=${fallsBehind.written}, behind=${fallsBehind.behind}, checked=${fallsBehind.checked}, errors=${fallsBehind.errors})`
        : ''
      const onboardingSummary = onboarding && (onboarding.started > 0 || onboarding.welcomed > 0 || onboarding.told > 0 || onboarding.errors > 0)
        ? ` onboarding(started=${onboarding.started}, welcomed=${onboarding.welcomed}, managers=${onboarding.told}, errors=${onboarding.errors})`
        : ''
      const agendaSummary = agenda && (agenda.drafted > 0 || agenda.linked > 0 || agenda.errors > 0)
        ? ` agenda(drafted=${agenda.drafted}, notices=${agenda.notices}, linked=${agenda.linked}, checked=${agenda.checked}, errors=${agenda.errors})`
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
        cxoOpsSummary +
        learningsSummary +
        preMeetingSummary +
        slippingSummary +
        dayWrapSummary +
        decisionsSummary +
        digestsSummary +
        calConfSummary +
        weeklyStatusSummary +
        fallsBehindSummary +
        onboardingSummary +
        agendaSummary +
        ` (${Date.now() - started}ms)`,
      )
    }
  } catch (err) {
    consecutiveErrors++
    console.error(`[worker] tick error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err)

    const fatal = consecutiveErrors >= MAX_CONSECUTIVE_ERRORS
    // Persist the tick failure centrally (and page on the fatal threshold —
    // logError alerts the operator immediately on 'fatal').
    await logError({
      source: 'worker/tick',
      errorType: 'worker_tick_failed',
      severity: fatal ? 'fatal' : 'error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { consecutiveErrors, max: MAX_CONSECUTIVE_ERRORS },
    })

    if (fatal) {
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
  console.log(`[worker] PLAUD_AGENT_REP_IDS: ${process.env.PLAUD_AGENT_REP_IDS ?? 'unset (plaud agent + daily plan on for every Suite CXO tenant)'}`)
  console.log(`[worker] CIAO weekly learnings: ${process.env.CIAO_LEARNINGS_ENABLED === 'false' ? 'off (CIAO_LEARNINGS_ENABLED=false)' : hasAIKey() ? 'on' : 'off (OPENROUTER_API_KEY unset)'}`)
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
