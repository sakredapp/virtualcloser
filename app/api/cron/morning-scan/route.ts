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

  // Pull brain items so the daily Telegram push is a Jarvis-style brief, not
  // a wall of every open task. Philosophy: tell them the shape of the day,
  // surface 1–2 priorities, then ASK what they're committing to. We don't
  // dump every list on them — they can ask their assistant for details.
  const buckets = await getBrainBuckets(tenant.id)

  const lines: string[] = [`*Morning brief — ${tenant.display_name}*`]
  if (briefing) {
    lines.push('')
    lines.push(briefing)
  }

  // One-line shape-of-the-day summary so they see the load without the list.
  const summaryBits: string[] = []
  if (buckets.overdue.length > 0) summaryBits.push(`${buckets.overdue.length} overdue`)
  if (buckets.today.length > 0) summaryBits.push(`${buckets.today.length} due today`)
  if (buckets.thisWeek.length > 0) summaryBits.push(`${buckets.thisWeek.length} this week`)
  if (buckets.goals.length > 0) summaryBits.push(`${buckets.goals.length} active goal${buckets.goals.length === 1 ? '' : 's'}`)
  if (hotLeads.length > 0) summaryBits.push(`${hotLeads.length} hot lead${hotLeads.length === 1 ? '' : 's'}`)

  if (summaryBits.length > 0) {
    lines.push('')
    lines.push(`📋 On your plate: ${summaryBits.join(' · ')}`)
  }

  // Surface ONLY the 1–2 sharpest priorities. Overdue beats today, high-pri
  // beats normal, hot lead is highlighted separately. Everything else is on
  // demand — ask "what's overdue?" and the bot pulls the full list.
  type Priority = { label: string; tag: string }
  const priorities: Priority[] = []
  const topOverdue = [...buckets.overdue].sort((a, b) => {
    if (a.priority === b.priority) return 0
    if (a.priority === 'high') return -1
    if (b.priority === 'high') return 1
    return 0
  })[0]
  if (topOverdue) {
    priorities.push({
      tag: '⚠️',
      label: `${topOverdue.content}${topOverdue.due_date ? ` _(was due ${topOverdue.due_date})_` : ''}`,
    })
  }
  const topToday = [...buckets.today].sort((a, b) => {
    if (a.priority === b.priority) return 0
    if (a.priority === 'high') return -1
    if (b.priority === 'high') return 1
    return 0
  })[0]
  if (topToday && priorities.length < 2) {
    priorities.push({ tag: '📅', label: topToday.content })
  }
  if (priorities.length === 0 && hotLeads[0]) {
    const h = hotLeads[0]
    priorities.push({
      tag: '🔥',
      label: `${h.name}${h.company ? ` — ${h.company}` : ''} (hot)`,
    })
  }

  if (priorities.length > 0) {
    lines.push('')
    lines.push('*Top priorit' + (priorities.length === 1 ? 'y' : 'ies') + '*')
    for (const p of priorities) lines.push(`${p.tag} ${p.label}`)
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
  } else {
    // Coaching prompt: don't dump the list, ask what they can realistically
    // commit to. They can always ask "what's overdue?" / "what's due today?"
    // and the assistant will pull the full list on demand.
    lines.push('')
    lines.push("What feels realistic to tackle today? Tell me 1–3 you're committing to and I'll keep tabs.")
    lines.push("Want the full list of what's overdue or due this week? Just ask.")
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
