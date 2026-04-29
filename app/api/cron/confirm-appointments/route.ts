// Confirm-appointments cron. Every 15 min, scans the meetings table and
// dispatches Vapi confirmation calls based on each tenant's configured
// timing window. Per-tenant overrides live in client_integrations.config
// .dialer_settings (see lib/voice/dialerSettings.ts).
//
// Algorithm:
//   1. Pull all meetings whose scheduled_at is within the WIDEST possible
//      window any tenant could have configured (5..300 min from now).
//   2. For each meeting, load the tenant's DialerSettings; skip unless:
//        - auto_confirm_enabled is true
//        - the meeting falls in [lead_min, lead_max] minutes from now
//        - confirmation_attempts < max_attempts
//        - last attempt outcome (if any) was voicemail/no_answer AND
//          retry_on_voicemail is true AND retry_delay_min has elapsed
//   3. Dispatch in parallel (each placeCall returns ~immediately).

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { dispatchConfirmCall } from '@/lib/voice/dialer'
import { getDialerSettings } from '@/lib/voice/dialerSettings'
import type { Meeting } from '@/lib/meetings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTER_WINDOW_MIN_FROM_MIN = 5
const OUTER_WINDOW_MAX_FROM_MIN = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const fromIso = new Date(now + OUTER_WINDOW_MIN_FROM_MIN * 60_000).toISOString()
  const toIso = new Date(now + OUTER_WINDOW_MAX_FROM_MIN * 60_000).toISOString()

  const { data: rows, error } = await supabase
    .from('meetings')
    .select('*')
    .in('status', ['scheduled', 'rescheduled'])
    .not('phone', 'is', null)
    .gte('scheduled_at', fromIso)
    .lte('scheduled_at', toIso)
    .order('scheduled_at', { ascending: true })
    .limit(500)

  if (error) {
    console.error('[cron/confirm-appointments] query failed', error)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }

  const meetings = (rows ?? []) as Meeting[]
  if (!meetings.length) {
    return NextResponse.json({ ok: true, scanned: 0, dispatched: 0, skipped: 0, results: [] })
  }

  const settingsCache = new Map<string, Awaited<ReturnType<typeof getDialerSettings>>>()
  const eligibilityResults: Array<
    | { ok: true; meeting: Meeting }
    | { ok: false; meeting_id: string; reason: string }
  > = []

  for (const m of meetings) {
    let settings = settingsCache.get(m.rep_id)
    if (!settings) {
      settings = await getDialerSettings(m.rep_id)
      settingsCache.set(m.rep_id, settings)
    }

    if (!settings.auto_confirm_enabled) {
      eligibilityResults.push({ ok: false, meeting_id: m.id, reason: 'auto_confirm_disabled' })
      continue
    }

    const minutesUntil = (new Date(m.scheduled_at).getTime() - now) / 60_000
    if (
      minutesUntil < settings.auto_confirm_lead_min ||
      minutesUntil > settings.auto_confirm_lead_max
    ) {
      eligibilityResults.push({ ok: false, meeting_id: m.id, reason: 'outside_tenant_window' })
      continue
    }

    if (m.confirmation_attempts >= settings.max_attempts) {
      eligibilityResults.push({ ok: false, meeting_id: m.id, reason: 'max_attempts_reached' })
      continue
    }

    if (m.confirmation_attempts > 0) {
      if (!settings.retry_on_voicemail) {
        eligibilityResults.push({ ok: false, meeting_id: m.id, reason: 'retry_disabled' })
        continue
      }
      if (!m.last_call_id) {
        eligibilityResults.push({ ok: false, meeting_id: m.id, reason: 'no_last_call_ref' })
        continue
      }
      const { data: lastCall } = await supabase
        .from('voice_calls')
        .select('outcome, ended_at, created_at')
        .eq('id', m.last_call_id)
        .maybeSingle()
      const lastOutcome = (lastCall?.outcome as string | undefined) ?? null
      const retryEligible = lastOutcome === 'voicemail' || lastOutcome === 'no_answer'
      if (!retryEligible) {
        eligibilityResults.push({
          ok: false,
          meeting_id: m.id,
          reason: `last_outcome:${lastOutcome ?? 'unknown'}`,
        })
        continue
      }
      const lastAt = new Date(
        (lastCall?.ended_at as string) ?? (lastCall?.created_at as string) ?? Date.now(),
      ).getTime()
      const minutesSince = (now - lastAt) / 60_000
      if (minutesSince < settings.retry_delay_min) {
        eligibilityResults.push({ ok: false, meeting_id: m.id, reason: 'retry_delay_pending' })
        continue
      }
    }

    eligibilityResults.push({ ok: true, meeting: m })
  }

  const eligible = eligibilityResults.filter(
    (r): r is { ok: true; meeting: Meeting } => r.ok,
  )
  const skipped = eligibilityResults.filter(
    (r): r is { ok: false; meeting_id: string; reason: string } => !r.ok,
  )

  // Parallel dispatch. Vapi's placeCall returns immediately after queuing.
  const dispatched: Array<{ meeting_id: string; ok: boolean; reason?: string }> = []
  const CONCURRENCY = 25
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const slice = eligible.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(
      slice.map(async ({ meeting }) => {
        const r = await dispatchConfirmCall(meeting.id)
        return r.ok
          ? { meeting_id: meeting.id, ok: true }
          : { meeting_id: meeting.id, ok: false, reason: r.reason }
      }),
    )
    dispatched.push(...settled)
  }

  return NextResponse.json({
    ok: true,
    scanned: meetings.length,
    eligible: eligible.length,
    dispatched: dispatched.filter((r) => r.ok).length,
    failed: dispatched.filter((r) => !r.ok).length,
    skipped: skipped.length,
    results: dispatched,
    skipped_reasons: skipped,
  })
}
