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
import { isAuthorizedCron } from '@/lib/cron-auth'
import { listMembers } from '@/lib/members'
import { buildMemberGoalsBrief } from '@/lib/team-goals'
import { refreshTargetProgress } from '@/lib/supabase'
import { listUpcomingEvents } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
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

  // Today's calendar (Google) — surfaces meetings without forcing the rep to
  // open another app. Skipped silently if Google isn't connected.
  // Resolve members up front so we can use the owner's timezone (each member
  // has their own /timezone setting; the tenant chat is the owner's chat).
  let members: Awaited<ReturnType<typeof listMembers>> = []
  try {
    members = await listMembers(tenant.id)
  } catch (err) {
    console.error(`[${tenant.slug}] listMembers failed`, err)
  }
  const owner = members.find((m) => m.role === 'owner') ?? null
  const tz = owner?.timezone ?? tenant.timezone ?? 'UTC'

  try {
    // Pull a 3-day window in UTC and filter down to the rep's local "today",
    // so a 12am-ET event (which lives in *yesterday* UTC) and a late-night
    // event don't fall outside the window.
    const wideFrom = new Date()
    wideFrom.setUTCHours(0, 0, 0, 0)
    wideFrom.setUTCDate(wideFrom.getUTCDate() - 1)
    const wideTo = new Date()
    wideTo.setUTCHours(23, 59, 59, 999)
    wideTo.setUTCDate(wideTo.getUTCDate() + 1)

    const events = await listUpcomingEvents(tenant.id, {
      fromIso: wideFrom.toISOString(),
      toIso: wideTo.toISOString(),
      maxResults: 25,
      timeZone: tz,
    })

    const ymdFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const todayYmd = ymdFmt.format(new Date())
    const todays = (events ?? []).filter(
      (e) => e.start && ymdFmt.format(new Date(e.start)) === todayYmd,
    )

    if (todays.length > 0) {
      lines.push('')
      lines.push(`📞 *Today's calendar (${todays.length})*`)
      for (const e of todays) {
        const t = e.start
          ? new Date(e.start).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: tz,
            })
          : ''
        lines.push(`• ${t} — ${e.summary}`)
      }
    }
  } catch (err) {
    console.error(`[${tenant.slug}] today's calendar block failed`, err)
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

  // Refresh target progress before any goal blocks render.
  try {
    await refreshTargetProgress(tenant.id)
  } catch (err) {
    console.error(`[${tenant.slug}] refreshTargetProgress failed`, err)
  }

  // Append owner's own goal block to the tenant brief (the tenant chat is
  // typically the owner's chat).
  if (owner) {
    try {
      const ownerGoals = await buildMemberGoalsBrief(tenant.id, owner.id)
      if (ownerGoals) lines.push(ownerGoals)
    } catch (err) {
      console.error(`[${tenant.slug}] owner goal brief failed`, err)
    }
  }

  if (chatId) {
    await sendTelegramMessage(chatId, lines.join('\n'))
  }

  // Per-member goal brief: ping every non-owner member that has their own
  // Telegram chat with their personal/team/account goals + a "what did you
  // do today" prompt.
  let memberPings = 0
  for (const m of members) {
    if (!m.is_active || !m.telegram_chat_id) continue
    if (owner && m.id === owner.id) continue
    if (m.telegram_chat_id === tenant.telegram_chat_id) continue
    try {
      const goalsBlock = await buildMemberGoalsBrief(tenant.id, m.id)
      if (!goalsBlock) continue
      const firstName = (m.display_name ?? m.email).split(/[\s@]/)[0]
      const msg = [`☀️ *Morning, ${firstName}*`, goalsBlock].join('\n')
      await sendTelegramMessage(m.telegram_chat_id, msg)
      memberPings++
    } catch (err) {
      console.error(`[${tenant.slug}] member goal brief failed`, { memberId: m.id, err })
    }
  }

  await logAgentRun({
    repId: tenant.id,
    runType: 'morning_scan',
    leadsProcessed: leads.length,
    actionsCreated,
    status: 'success',
  })

  return { tenant: tenant.slug, leadsProcessed: leads.length, actionsCreated, memberPings }
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
