import { NextRequest, NextResponse } from 'next/server'
import {
  getAllLeads,
  getBrainItemsDueOnOrBefore,
  logAgentRun,
} from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { sendTelegramMessage } from '@/lib/telegram'

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

  const lines: string[] = [`*Midday pulse — ${tenant.display_name}*`]

  if (hot.length > 0) {
    lines.push('')
    lines.push(`🔥 Hot prospects (${hot.length}):`)
    for (const l of hot.slice(0, 5)) {
      lines.push(`• ${l.name}${l.company ? ` — ${l.company}` : ''}`)
    }
  }

  if (overdue.length > 0) {
    lines.push('')
    lines.push(`⚠️ Overdue (${overdue.length}):`)
    for (const i of overdue.slice(0, 5)) {
      lines.push(`• ${i.content} (was due ${i.due_date})`)
    }
  }

  if (dueToday.length > 0) {
    lines.push('')
    lines.push(`📅 Due today (${dueToday.length}):`)
    for (const i of dueToday.slice(0, 5)) {
      lines.push(`• ${i.content}`)
    }
  }

  if (hot.length === 0 && overdue.length === 0 && dueToday.length === 0) {
    lines.push('')
    lines.push("Nothing urgent on deck. Good time to prospect — tell me who you're chasing.")
  }

  await sendTelegramMessage(chatId, lines.join('\n'))

  await logAgentRun({
    repId: tenant.id,
    runType: 'hot_pulse',
    leadsProcessed: leads.length,
    actionsCreated: 0,
    status: 'success',
  })

  return { tenant: tenant.slug, hot: hot.length, overdue: overdue.length, dueToday: dueToday.length }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
