import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import {
  getActiveTargets,
  getCallStats,
  logAgentRun,
  refreshTargetProgress,
} from '@/lib/supabase'
import { sendTelegramMessage } from '@/lib/telegram'
import { generateCoachPrompt } from '@/lib/claude'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Daily coach cron. One invocation per day; we decide per-tenant whether to fire
 * a weekly Monday kickoff, an end-of-month review, or a daily 5pm pulse based on
 * the tenant's local timezone.
 *
 * Schedule it hourly so each tenant gets nudged at ~9am / ~5pm in *their* tz.
 * Schedule path: /api/cron/coach (hourly, weekdays).
 */

type Phase = 'weekly_kickoff' | 'monthly_review' | 'daily_pulse' | null

function localParts(tz: string): { hour: number; weekday: number; day: number; daysInMonth: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
  const parts = fmt.formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hour = Number(get('hour')) // 0-23
  const day = Number(get('day'))
  const month = Number(get('month'))
  const year = Number(get('year'))
  const weekdayStr = get('weekday') // Mon, Tue...
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = wkMap[weekdayStr] ?? 1
  const daysInMonth = new Date(year, month, 0).getDate()
  return { hour, weekday, day, daysInMonth }
}

function pickPhase(tz: string): Phase {
  const { hour, weekday, day, daysInMonth } = localParts(tz)
  // Monday 9am local: weekly kickoff.
  if (weekday === 1 && hour === 9) return 'weekly_kickoff'
  // Last business day of month at 5pm local: monthly review.
  // If last day lands on Sat/Sun, this still fires on the Friday before via the day check below.
  const isLastBizDay =
    (day === daysInMonth) ||
    (day === daysInMonth - 1 && weekday === 5) ||
    (day === daysInMonth - 2 && weekday === 5)
  if (isLastBizDay && hour === 17) return 'monthly_review'
  // Weekday 5pm: daily pulse.
  if (weekday >= 1 && weekday <= 5 && hour === 17) return 'daily_pulse'
  return null
}

async function runForTenant(tenant: Tenant): Promise<{ sent: boolean; phase: Phase }> {
  if (!tenant.telegram_chat_id) return { sent: false, phase: null }
  const tz = tenant.timezone || 'UTC'
  const phase = pickPhase(tz)
  if (!phase) return { sent: false, phase: null }

  let payload: Record<string, unknown> = {}
  if (phase === 'weekly_kickoff') {
    const targets = await getActiveTargets(tenant.id)
    const lastWeekStart = new Date(Date.now() - 7 * 86400_000).toISOString()
    const stats = await getCallStats(tenant.id, lastWeekStart)
    payload = {
      timezone: tz,
      lastWeekStats: stats,
      activeTargets: targets.map((t) => ({
        metric: t.metric,
        period: t.period_type,
        target: t.target_value,
        current: t.current_value,
      })),
    }
  } else if (phase === 'monthly_review') {
    const targets = await refreshTargetProgress(tenant.id)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const stats = await getCallStats(tenant.id, monthStart.toISOString())
    payload = {
      timezone: tz,
      thisMonthStats: stats,
      monthlyTargets: targets
        .filter((t) => t.period_type === 'month')
        .map((t) => ({
          metric: t.metric,
          target: t.target_value,
          current: t.current_value,
          progress_pct:
            t.target_value > 0 ? Math.round((100 * t.current_value) / t.target_value) : 0,
        })),
    }
  } else {
    // daily_pulse
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const stats = await getCallStats(tenant.id, dayStart.toISOString())
    payload = { timezone: tz, todayStats: stats }
  }

  const message = await generateCoachPrompt(phase, payload, tenant.display_name)
  await sendTelegramMessage(Number(tenant.telegram_chat_id), message)
  return { sent: true, phase }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const tenants = await getAllActiveTenants()
  const results: Array<{ id: string; sent: boolean; phase: Phase; error?: string }> = []
  let sentCount = 0

  for (const t of tenants) {
    try {
      const r = await runForTenant(t)
      if (r.sent) sentCount += 1
      results.push({ id: t.id, ...r })
    } catch (err) {
      console.error('[cron coach] tenant failed', t.id, err)
      results.push({ id: t.id, sent: false, phase: null, error: String(err) })
    }
  }

  // Single agent_run row to keep the dashboard timeline tidy.
  try {
    await logAgentRun({
      repId: tenants[0]?.id ?? 'system',
      runType: 'coach',
      leadsProcessed: 0,
      actionsCreated: sentCount,
      status: 'success',
    })
  } catch (err) {
    console.error('[cron coach] logAgentRun failed', err)
  }

  return NextResponse.json({ ok: true, sent: sentCount, results })
}

export const POST = GET
