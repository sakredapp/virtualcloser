import { NextRequest, NextResponse } from 'next/server'
import {
  getAllLeads,
  getBrainBuckets,
  logAgentAction,
  logAgentRun,
  updateLeadStatus,
} from '@/lib/supabase'
import {
  classifyLead,
  draftFollowUp,
  generateMorningBriefing,
} from '@/lib/claude'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { sendTelegramMessage } from '@/lib/telegram'
import type { LeadStatus } from '@/types'

async function runForTenant(tenant: Tenant) {
  const leads = await getAllLeads(tenant.id)
  let actionsCreated = 0
  const hotLeads: Array<{ name: string; company: string; status: string; reason: string }> = []

  for (const lead of leads) {
    try {
      const { status, reason } = await classifyLead({
        name: lead.name,
        company: lead.company || '',
        lastContact: lead.last_contact,
        notes: lead.notes || '',
      })

      if (status !== lead.status) {
        await updateLeadStatus(lead.id, status as LeadStatus, tenant.id)
      }

      if (status === 'hot' || status === 'warm') {
        const draft = await draftFollowUp({
          name: lead.name,
          company: lead.company || '',
          status,
          notes: lead.notes || '',
          lastContact: lead.last_contact,
        })

        await logAgentAction({
          repId: tenant.id,
          leadId: lead.id,
          actionType: 'email_draft',
          content: JSON.stringify(draft),
        })

        actionsCreated++

        if (status === 'hot') {
          hotLeads.push({ name: lead.name, company: lead.company || '', status, reason })
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 300))
    } catch (err) {
      console.error(`[${tenant.slug}] Error processing lead ${lead.id}:`, err)
    }
  }

  const dormantCount = leads.filter((l) => l.status === 'dormant').length
  const briefing = await generateMorningBriefing({
    hotCount: hotLeads.length,
    warmCount: leads.filter((l) => l.status === 'warm').length,
    dormantCount,
    topLeads: hotLeads.slice(0, 3),
  })

  // Pull brain items so the daily Telegram push is a full Jarvis brief,
  // not just leads. Include goals, overdue, due-today, and this-week tasks.
  const buckets = await getBrainBuckets(tenant.id)

  const lines: string[] = [`*Morning brief — ${tenant.display_name}*`]
  if (briefing) {
    lines.push('')
    lines.push(briefing)
  }

  if (buckets.goals.length > 0) {
    lines.push('')
    lines.push(`🎯 *Active goals (${buckets.goals.length})*`)
    for (const g of buckets.goals.slice(0, 4)) lines.push(`• ${g.content}`)
  }

  if (buckets.overdue.length > 0) {
    lines.push('')
    lines.push(`⚠️ *Overdue (${buckets.overdue.length})*`)
    for (const i of buckets.overdue.slice(0, 6)) {
      lines.push(`• ${i.content}${i.due_date ? ` _(was due ${i.due_date})_` : ''}`)
    }
  }

  if (buckets.today.length > 0) {
    lines.push('')
    lines.push(`📅 *Today (${buckets.today.length})*`)
    for (const i of buckets.today.slice(0, 8)) {
      const tag = i.priority === 'high' ? '🔥 ' : ''
      lines.push(`• ${tag}${i.content}`)
    }
  }

  if (buckets.thisWeek.length > 0) {
    lines.push('')
    lines.push(`🗓 *This week (${buckets.thisWeek.length})*`)
    for (const i of buckets.thisWeek.slice(0, 5)) lines.push(`• ${i.content}`)
  }

  if (
    buckets.overdue.length === 0 &&
    buckets.today.length === 0 &&
    buckets.goals.length === 0 &&
    hotLeads.length === 0
  ) {
    lines.push('')
    lines.push("Clean slate — tell me who you're chasing today or drop a new goal.")
  }

  const chatId = tenant.telegram_chat_id ?? process.env.TELEGRAM_DEFAULT_CHAT_ID
  if (chatId) {
    await sendTelegramMessage(chatId, lines.join('\n'))
  }

  await logAgentRun({
    repId: tenant.id,
    runType: 'morning_scan',
    leadsProcessed: leads.length,
    actionsCreated,
    status: 'success',
  })

  return { tenant: tenant.slug, leadsProcessed: leads.length, actionsCreated }
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
      console.error(`Morning scan failed for ${tenant.slug}:`, err)
      await logAgentRun({
        repId: tenant.id,
        runType: 'morning_scan',
        leadsProcessed: 0,
        actionsCreated: 0,
        status: 'error',
        error: String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, tenants: results })
}
