import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { sendTelegramMessage } from '@/lib/telegram'
import { buildExecDigest, renderExecBrief, digestHasSignal } from '@/lib/exec/digest'
import type { BrandKey } from '@/lib/brand'
import type { Member } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Midday executive nudge — CXO Suite tenants only.
 *
 * The lighter, proactive sibling of exec-brief. Fires hourly Mon-Fri but only
 * sends at 1pm local, AND only when the digest actually has signal (drafts to
 * approve, emails to answer, quiet deals). Silence when there's nothing — a
 * good chief of staff doesn't ping you to say "nothing's happening".
 *
 * No Claude calls (pure data) so it never touches an AI budget.
 */

const SEND_LOCAL_HOUR = 13

function localHour(tz: string | null | undefined, ref: Date = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hour: 'numeric', hour12: false }).format(ref),
    )
  } catch {
    return ref.getUTCHours()
  }
}

async function nudgeTenant(tenant: Tenant, force: boolean): Promise<number> {
  const tz = tenant.timezone || 'America/New_York'
  if (!force && localHour(tz) !== SEND_LOCAL_HOUR) return 0

  const members = await listMembers(tenant.id)
  const recipients = members.filter(
    (m: Member) =>
      m.is_active &&
      m.telegram_chat_id &&
      (m.role === 'owner' || m.role === 'admin') &&
      Boolean((m.settings as Record<string, unknown> | undefined)?.cxo_bot_connected),
  )
  if (recipients.length === 0) return 0

  let sent = 0
  for (const m of recipients) {
    try {
      const digest = await buildExecDigest(tenant, { memberId: m.id, timezone: m.timezone || tz })
      // Silence when there's nothing actionable.
      if (!digestHasSignal(digest)) continue
      const text = renderExecBrief(digest, {
        name: m.display_name || 'there',
        timezone: m.timezone || tz,
        mode: 'nudge',
      })
      const res = await sendTelegramMessage(m.telegram_chat_id as string, text, { brand: 'cxo' })
      if (res.ok) sent++
    } catch (err) {
      console.error('[exec-nudge] failed for member', m.id, err)
    }
  }
  return sent
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'

  const tenants = await getAllActiveTenants()
  const cxoTenants = tenants.filter(
    (t) => ((t as { brand?: BrandKey }).brand ?? 'virtualcloser') === 'cxo',
  )

  let totalSent = 0
  for (const tenant of cxoTenants) {
    try {
      totalSent += await nudgeTenant(tenant, force)
    } catch (err) {
      console.error('[exec-nudge] tenant failed', tenant.slug, err)
    }
  }
  return NextResponse.json({ ok: true, cxoTenants: cxoTenants.length, totalSent })
}
