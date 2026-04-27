import { NextRequest, NextResponse } from 'next/server'
import {
  getAllLeads,
  getBrainItemsDueOnOrBefore,
  logAgentRun,
} from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { sendTelegramMessage } from '@/lib/telegram'
import { isAuthorizedCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function runForTenant(tenant: Tenant) {
  const chatId = tenant.telegram_chat_id
  if (!chatId) {
    return { tenant: tenant.slug, skipped: true }
  }

  const today = new Date().toISOString().slice(0, 10)
  const [leads, dueItems] = await Promise.all([
    getAllLeads(tenant.id),
    getBrainItemsDueOnOrBefore(tenant.id, today),
  ])

  const hot = leads.filter((l) => l.status === 'hot')
  const overdue = dueItems.filter((i) => (i.due_date ?? '') < today)
  const dueToday = dueItems.filter((i) => i.due_date === today)

  // Reframe: this is a check-in, not a second list dump. The morning brief
  // already showed what's on the plate; the midday job is to ask how it's
  // going, not repeat the same items. Counts only — full list on demand.
  const lines: string[] = [`*Midday check-in — ${tenant.display_name}*`]
  lines.push('')
  lines.push("How's it going? Knock anything off this morning's list?")

  const stillOn: string[] = []
  if (overdue.length > 0) stillOn.push(`${overdue.length} overdue`)
  if (dueToday.length > 0) stillOn.push(`${dueToday.length} due today`)
  if (hot.length > 0) stillOn.push(`${hot.length} hot lead${hot.length === 1 ? '' : 's'}`)

  if (stillOn.length > 0) {
    lines.push('')
    lines.push(`Still on your plate: ${stillOn.join(' · ')}.`)
    lines.push('')
    lines.push("Want a reminder of what's left, or want to push anything to tomorrow? Just say the word.")
  } else {
    lines.push('')
    lines.push("Plate's clear from this morning's list — solid pace. Want to line up tomorrow or queue a new prospect?")
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
