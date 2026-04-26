import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { sendTelegramMessage } from '@/lib/telegram'
import { getActiveTargets, refreshTargetProgress, supabase } from '@/lib/supabase'
import { listUpcomingEvents } from '@/lib/google'
import type { Member } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 8pm tenant-local end-of-day standup digest.
 *
 * Cron runs hourly Mon-Fri (`0 * * * 1-5`); we only send to tenants whose
 * local hour is currently 20:00. Per-member: today's calls, outcomes, deals
 * closed, target progress, tomorrow's calendar.
 */

function localHour(tz: string | null | undefined, ref: Date = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz ?? 'UTC',
      hour: 'numeric',
      hour12: false,
    })
    return Number(fmt.format(ref))
  } catch {
    return ref.getUTCHours()
  }
}

function todayStartIso(tz: string | null | undefined): string {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const ymd = fmt.format(now) // YYYY-MM-DD in tenant tz
  // Anchor to local midnight, then convert to ISO via the tenant offset.
  const offsetMin = (() => {
    try {
      const local = new Date(now.toLocaleString('en-US', { timeZone: tz ?? 'UTC' }))
      const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
      return (local.getTime() - utc.getTime()) / 60000
    } catch {
      return 0
    }
  })()
  const startUtc = new Date(`${ymd}T00:00:00Z`).getTime() - offsetMin * 60000
  return new Date(startUtc).toISOString()
}

async function digestForMember(tenant: Tenant, member: Member): Promise<string | null> {
  const tz = member.timezone ?? tenant.timezone ?? 'UTC'
  const sinceIso = todayStartIso(tz)

  const { data: callRows } = await supabase
    .from('call_logs')
    .select('outcome')
    .eq('rep_id', tenant.id)
    .eq('owner_member_id', member.id)
    .gte('occurred_at', sinceIso)
  const calls = (callRows ?? []) as Array<{ outcome: string | null }>
  const stats = {
    total: calls.length,
    conversations: calls.filter((r) => r.outcome && r.outcome !== 'no_answer' && r.outcome !== 'voicemail').length,
    meetingsBooked: calls.filter((r) => r.outcome === 'booked').length,
    closedWon: calls.filter((r) => r.outcome === 'closed_won').length,
    closedLost: calls.filter((r) => r.outcome === 'closed_lost').length,
  }

  const lines: string[] = []
  const firstName = (member.display_name ?? member.email).split(/[\s@]/)[0]
  lines.push(`🌙 *Day's wrap, ${firstName}*`)

  if (stats.total === 0) {
    lines.push('_No calls logged today._')
  } else {
    const parts = [
      `${stats.total} call${stats.total === 1 ? '' : 's'}`,
      `${stats.conversations} conversation${stats.conversations === 1 ? '' : 's'}`,
    ]
    if (stats.meetingsBooked > 0) parts.push(`${stats.meetingsBooked} booked`)
    if (stats.closedWon > 0) parts.push(`*${stats.closedWon} won* 🎉`)
    if (stats.closedLost > 0) parts.push(`${stats.closedLost} lost`)
    lines.push(parts.join(' · '))
  }

  // Brain items completed today
  const { data: doneItems } = await supabase
    .from('brain_items')
    .select('id, content')
    .eq('rep_id', tenant.id)
    .eq('owner_member_id', member.id)
    .eq('status', 'done')
    .gte('updated_at', sinceIso)
    .limit(10)
  if (doneItems && doneItems.length > 0) {
    lines.push('')
    lines.push(`✅ *Shipped (${doneItems.length})*`)
    for (const i of doneItems.slice(0, 6)) lines.push(`• ${i.content}`)
  }

  // Target progress
  try {
    await refreshTargetProgress(tenant.id)
    const allTargets = await getActiveTargets(tenant.id)
    const personal = allTargets.filter((t) => t.owner_member_id === member.id)
    if (personal.length > 0) {
      lines.push('')
      lines.push('*Targets*')
      for (const t of personal.slice(0, 4)) {
        const pct = Number(t.target_value) > 0 ? Math.round((Number(t.current_value) / Number(t.target_value)) * 100) : 0
        lines.push(`• ${t.metric} (${t.period_type}): ${t.current_value}/${t.target_value} — ${pct}%`)
      }
    }
  } catch (err) {
    console.error('[standup-digest] target progress failed', err)
  }

  // Tomorrow's calendar
  try {
    const startTomorrow = new Date(sinceIso)
    startTomorrow.setUTCDate(startTomorrow.getUTCDate() + 1)
    const endTomorrow = new Date(startTomorrow)
    endTomorrow.setUTCDate(endTomorrow.getUTCDate() + 1)
    const events = await listUpcomingEvents(tenant.id, {
      fromIso: startTomorrow.toISOString(),
      toIso: endTomorrow.toISOString(),
      maxResults: 6,
    })
    if (events && events.length > 0) {
      lines.push('')
      lines.push(`*Tomorrow (${events.length})*`)
      for (const e of events) {
        const t = e.start
          ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
          : ''
        lines.push(`• ${t} — ${e.summary}`)
      }
    }
  } catch {
    // Google not connected — skip silently.
  }

  lines.push('')
  lines.push("_Reply with one line: what's the single most important thing for tomorrow?_")
  return lines.join('\n')
}

async function runForTenant(tenant: Tenant): Promise<{ tenant: string; pings: number }> {
  // Per-tenant gate: only fire at local 8pm.
  if (localHour(tenant.timezone) !== 20) return { tenant: tenant.slug, pings: 0 }

  const members = await listMembers(tenant.id)
  let pings = 0
  for (const m of members) {
    if (!m.is_active || !m.telegram_chat_id) continue
    if (m.role === 'observer') continue
    try {
      const msg = await digestForMember(tenant, m)
      if (msg) {
        await sendTelegramMessage(m.telegram_chat_id, msg)
        pings++
      }
    } catch (err) {
      console.error(`[${tenant.slug}] standup digest failed`, { memberId: m.id, err })
    }
  }
  return { tenant: tenant.slug, pings }
}

async function handle(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!isAuthorizedCron(authHeader)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const tenants = await getAllActiveTenants()
  const results: Array<{ tenant: string; pings: number }> = []
  for (const t of tenants) {
    try {
      results.push(await runForTenant(t))
    } catch (err) {
      console.error(`[standup-digest] ${t.slug} failed`, err)
    }
  }
  return NextResponse.json({ ok: true, results })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
