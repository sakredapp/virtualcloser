// Per-tenant dialer timing & retry settings.
// Stored in client_integrations.config['vapi'].dialer_settings.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import {
  DEFAULT_DIALER_SETTINGS,
  getDialerSettings,
  saveDialerSettings,
  type DialerSettings,
} from '@/lib/voice/dialerSettings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const settings = await getDialerSettings(ctx.tenant.id)
  return NextResponse.json({ ok: true, settings, defaults: DEFAULT_DIALER_SETTINGS })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  // Individual accounts are single-operator, so they can edit directly.
  // Enterprise accounts remain owner/admin-gated for global dialer behavior.
  if (ctx.tenant.tier !== 'individual' && !['owner', 'admin'].includes(ctx.member.role as string)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as Partial<DialerSettings>
  const allowed: (keyof DialerSettings)[] = [
    'auto_confirm_enabled',
    'auto_confirm_lead_min',
    'auto_confirm_lead_max',
    'retry_on_voicemail',
    'retry_delay_min',
    'max_attempts',
    'enable_post_call_summary',
    'enable_followup_tasks',
    'enabled_modes',
    'pipeline_opt_in',
    'live_transfer_fallback',
    'mode_providers',
    'max_concurrent_calls',
  ]
  const patch: Partial<DialerSettings> = {}
  for (const key of allowed) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key]
  }
  // Sanity: lead_min must be <= lead_max
  const current = await getDialerSettings(ctx.tenant.id)
  const next = { ...current, ...patch }
  if (next.auto_confirm_lead_min > next.auto_confirm_lead_max) {
    return NextResponse.json(
      { ok: false, error: 'auto_confirm_lead_min must be ≤ auto_confirm_lead_max' },
      { status: 400 },
    )
  }
  const saved = await saveDialerSettings(ctx.tenant.id, patch)
  return NextResponse.json({ ok: true, settings: saved })
}
