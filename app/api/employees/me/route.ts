import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { loadSelfView } from '@/lib/employees/data'
import { employeeSnapshot, ptoSummary } from '@/lib/employees/shared'
import { bookToday } from '@/lib/pinnacle/kpis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The signed-in person's own page as JSON. Only their own row, never anyone else's. */
export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
  const view = await loadSelfView(ctx.tenant.id, ctx.member.id, today)
  if (!view) return NextResponse.json({ linked: false })
  const snap = employeeSnapshot(view.employee, view, today)
  const pto = ptoSummary(view.timeOff, today.slice(0, 4), view.employee.pto_allowed_days, view.employee.pto_balance_days)
  return NextResponse.json({
    linked: true,
    employee: { name: view.employee.name, title: view.employee.title, department: view.employee.department, manager: view.manager, hours_per_week: view.employee.hours_per_week },
    quotas: snap.quotas.map((q) => ({ name: q.kpi.name, type: q.kpi.quota_type, unit: q.kpi.unit, period: q.periodKey, target: q.kpi.target, actual: q.actual, attainment: q.att, pace: q.pace, bonus: q.bonus, next_tier: q.next, more_to_next: q.moreToNext })),
    bonus: { earned: snap.bonusEarned, possible: snap.bonusPossible },
    status: snap.status,
    pto,
    hours_this_month: view.hoursThisMonth,
  })
}
