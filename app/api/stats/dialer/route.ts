// GET /api/stats/dialer
// Read-only dialer performance endpoint for external dashboards (e.g. SakredCRM admin).
//
// Auth: x-stats-secret header must match SAKREDCRM_WEBHOOK_SECRET env var.
// Required query param: rep_id
// Optional: days (default 30, max 90), mode (concierge|appointment_setter|live_transfer|pipeline)
//
// Returns JSON with all core perf metrics + daily trend.

import { NextRequest, NextResponse } from 'next/server'
import {
  getDialerCorePerf,
  getDialerDailyTrend,
  getDialerPerMode,
  type DialerMode,
  DIALER_MODES,
} from '@/lib/dialerAnalytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATS_SECRET = process.env.SAKREDCRM_WEBHOOK_SECRET

export async function GET(req: NextRequest) {
  if (STATS_SECRET) {
    const incoming = req.headers.get('x-stats-secret')
    if (incoming !== STATS_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const { searchParams } = req.nextUrl
  const repId = searchParams.get('rep_id')
  if (!repId) {
    return NextResponse.json({ error: 'rep_id required' }, { status: 400 })
  }

  const rawDays = parseInt(searchParams.get('days') ?? '30', 10)
  const days = Math.min(Math.max(isNaN(rawDays) ? 30 : rawDays, 1), 90)
  const modeParam = searchParams.get('mode') ?? undefined
  const mode = modeParam && DIALER_MODES.includes(modeParam as DialerMode)
    ? (modeParam as DialerMode)
    : undefined

  // Account-wide scope — this endpoint is for admin/owner dashboards.
  const scope = { scope: 'account' as const, memberId: '', memberIds: null }

  console.log(`[stats/dialer] rep=${repId} days=${days} mode=${mode ?? 'all'}`)

  const [core, trend, perMode] = await Promise.all([
    getDialerCorePerf(repId, scope, { days, mode }),
    getDialerDailyTrend(repId, scope, { days, mode }),
    getDialerPerMode(repId, scope, { days }),
  ])

  const toDate = new Date()
  const fromDate = new Date(Date.now() - days * 86400_000)

  return NextResponse.json({
    period_days: days,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    dials: core.dials,
    connects: core.connects,
    connect_rate_pct: core.connectRatePct,
    appointments: core.appointments,
    conversion_rate_pct: core.conversionRatePct,
    appointments_per_hour: core.appointmentsPerHour,
    dials_per_hour: core.dialsPerHour,
    avg_call_duration_sec: core.avgDurationSec,
    talk_seconds: core.talkSeconds,
    talk_utilization_pct: core.talkUtilizationPct,
    cost_cents: core.costCents,
    cost_per_appointment_cents: core.costPerAppointmentCents,
    cost_per_connect_cents: core.connects > 0 ? Math.round(core.costCents / core.connects) : null,
    cost_per_dial_cents: core.dials > 0 ? Math.round(core.costCents / core.dials) : null,
    opt_out_rate_pct: core.optOutRatePct,
    daily_trend: trend.map((d) => ({
      date: d.day,
      dials: d.dials,
      connects: d.connects,
      appointments: d.appointments,
      cost_cents: d.costCents,
    })),
    per_mode: perMode.map((m) => ({
      mode: m.mode,
      label: m.label,
      dials: m.dials,
      connects: m.connects,
      connect_rate_pct: m.connectRatePct,
      appointments: m.appointments,
      appointments_per_hour: m.appointmentsPerHour,
      cost_per_appointment_cents: m.costPerAppointmentCents,
    })),
  })
}
