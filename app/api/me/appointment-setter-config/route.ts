import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getIntegrationConfig, upsertClientIntegration } from '@/lib/client-integrations'
import type { AppointmentSetterConfig } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Re-export so existing imports from this route still work
export type { AppointmentSetterConfig }

export const DEFAULT_APPT_SETTER_CONFIG: AppointmentSetterConfig = {
  active_days: [1, 2, 3, 4, 5],
  start_hour: 9,
  end_hour: 17,
  timezone: 'America/New_York',
  daily_appt_target: 5,
  max_daily_dials: 100,
  leads_per_hour: 18,
  leads_per_day: 120,
  max_daily_hours: 6,
  preferred_call_windows: '',
  booking_calendar_url: '',
  ghl_calendar_id: '',
  booking_rep_name: '',
  opener: '',
  qualification_questions: '',
  objections: '',
  ai_name: '',
  role_title: '',
  role_mission: '',
  disqualify_rules: '',
  enabled: false,
}

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const stored = await getIntegrationConfig(ctx.tenant.id, 'appointment_setter_config')
  const config: AppointmentSetterConfig = { ...DEFAULT_APPT_SETTER_CONFIG, ...(stored ?? {}) }
  return NextResponse.json({ ok: true, config })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const role = ctx.member.role as string
  if (!['owner', 'admin', 'manager'].includes(role) && ctx.tenant.tier !== 'individual') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let body: Partial<AppointmentSetterConfig>
  try {
    body = (await req.json()) as Partial<AppointmentSetterConfig>
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const existing = (await getIntegrationConfig(ctx.tenant.id, 'appointment_setter_config')) ?? {}
  const merged = { ...DEFAULT_APPT_SETTER_CONFIG, ...existing, ...body }

  await upsertClientIntegration(ctx.tenant.id, 'appointment_setter_config', {
    label: 'Appointment Setter Config',
    kind: 'api',
    config: merged,
    is_active: true,
  })

  return NextResponse.json({ ok: true, config: merged })
}
