import { NextRequest, NextResponse } from 'next/server'
import {
  getAllLeads,
  getBrainItemsDueOnOrBefore,
  logAgentRun,
} from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { sendTelegramMessage } from '@/lib/telegram'
import { isAuthorizedCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function runForTenant(tenant: Tenant) {
  const chatId = tenant.telegram_chat_id
  if (!chatId) {
    return { tenant: tenant.slug, skipped: 'no_chat_id' }
  }

  // Gate by tenant-local hour: only fire at 1 PM local time.
  let members: Awaited<ReturnType<typeof listMembers>> = []
  try { members = await listMembers(tenant.id) } catch { /* non-fatal */ }
  const owner = members.find((m) => m.role === 'owner') ?? null
  const tz = owner?.timezone ?? tenant.timezone ?? 'UTC'
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  )
  if (localHour !== 13) {
    return { tenant: tenant.slug, skipped: `not 1pm local (hour=${localHour} in ${tz})` }
  }

  const today = new Date().toISOString().slice(0, 10)
  const [leads, dueItems] = await Promise.all([
    getAllLeads(tenant.id),
    getBrainItemsDueOnOrBefore(tenant.id, today),
  ])

  const hot = leads.filter((l) => l.status === 'hot')
  const overdue = dueItems.filter((i) => (i.due_date ?? '') < today)
  const dueToday = dueItems.filter((i) => i.due_date === today)

  // Reframe: this is an assistant checking in, not a second list dump. The
  // morning brief showed the shape of the day; midday's job is to ask how
  // it's going and offer to reshuffle. No counts wall-of-text.
  const lines: string[] = [`*Checking in — ${tenant.display_name}.*`]
  lines.push('')
  lines.push("How's it going? Cross anything off from this morning?")

  const stillOn: string[] = []
  if (overdue.length > 0) stillOn.push(`${overdue.length} overdue`)
  if (dueToday.length > 0) stillOn.push(`${dueToday.length} due today`)
  if (hot.length > 0) stillOn.push(`${hot.length} hot lead${hot.length === 1 ? '' : 's'}`)

  if (stillOn.length > 0) {
    lines.push('')
    lines.push(`Still on the board: ${stillOn.join(', ')}.`)
    lines.push('')
    lines.push("Want me to read off what's left, push anything to tomorrow, or drop something that's no longer worth it? Just tell me what to do with it.")
  } else {
    lines.push('')
    lines.push("Nothing left from this morning. Solid pace — want to line up tomorrow or queue a new prospect?")
  }

  await sendTelegramMessage(chatId, lines.join('\n'))

  await logAgentRun({
    repId: tenant.id,
    runType: 'midday_pulse',
    leadsProcessed: leads.length,
    actionsCreated: 0,
    status: 'success',
  })

  return { tenant: tenant.slug, hot: hot.length, overdue: overdue.length, dueToday: dueToday.length }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!isAuthorizedCron(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenants = await getAllActiveTenants()
  const results = []
  for (const tenant of tenants) {
    try {
      results.push(await runForTenant(tenant))
    } catch (err) {
      console.error(`Midday pulse failed for ${tenant.slug}:`, err)
    }
  }
  return NextResponse.json({ ok: true, tenants: results })
}
