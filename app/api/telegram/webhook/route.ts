import { NextRequest, NextResponse } from 'next/server'
import {
  createBrainDump,
  createBrainItems,
  getActiveTargets,
  getAllLeads,
  getCallStats,
  getCallsForLead,
  getRecentCalls,
  getRecentLeadNames,
  logCall,
  refreshTargetProgress,
  setTarget,
  supabase,
  upsertLead,
} from '@/lib/supabase'
import {
  generateReport,
  interpretTelegramMessage,
  type TelegramIntent,
} from '@/lib/claude'
import { sendTelegramMessage, telegramBotUsername } from '@/lib/telegram'
import { transcribeTelegramVoice } from '@/lib/transcribe'
import { createCalendarEvent, findConflict, listUpcomingEvents } from '@/lib/google'
import type { Tenant } from '@/lib/tenant'
import type { Lead, LeadStatus } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * Telegram webhook — the rep's operations brain.
 * Any plain message gets routed by Claude into CRM updates, new prospects,
 * scheduled follow-ups, and generic brain-items.
 */

type TgUser = { id: number; first_name?: string; username?: string }
type TgChat = { id: number; type: string }
type TgVoice = { file_id: string; duration?: number; mime_type?: string }
type TgAudio = { file_id: string; duration?: number; mime_type?: string }
type TgMessage = {
  message_id: number
  from?: TgUser
  chat: TgChat
  text?: string
  voice?: TgVoice
  audio?: TgAudio
}
type TgUpdate = {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
}

async function findTenantByChatId(chatId: number): Promise<Tenant | null> {
  const { data } = await supabase
    .from('reps')
    .select('*')
    .eq('telegram_chat_id', String(chatId))
    .eq('is_active', true)
    .maybeSingle()
  return (data as Tenant | null) ?? null
}

async function findTenantByLinkCode(code: string): Promise<Tenant | null> {
  const { data } = await supabase
    .from('reps')
    .select('*')
    .eq('telegram_link_code', code)
    .eq('is_active', true)
    .maybeSingle()
  return (data as Tenant | null) ?? null
}

async function bindChat(tenantId: string, chatId: number): Promise<void> {
  await supabase
    .from('reps')
    .update({ telegram_chat_id: String(chatId) })
    .eq('id', tenantId)
}

export async function POST(req: NextRequest) {
  // Telegram verifies us using the header we registered in setWebhook.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  const got = req.headers.get('x-telegram-bot-api-secret-token')
  if (expected && got !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let update: TgUpdate
  try {
    update = (await req.json()) as TgUpdate
  } catch {
    return NextResponse.json({ ok: true })
  }

  const msg = update.message ?? update.edited_message
  if (!msg) return NextResponse.json({ ok: true })

  const chatId = msg.chat.id

  // ── Voice / audio: transcribe via Whisper, then fall through as if text ──
  let text = msg.text?.trim() ?? ''
  if (!text && (msg.voice || msg.audio)) {
    const fileId = msg.voice?.file_id ?? msg.audio?.file_id
    if (!fileId) return NextResponse.json({ ok: true })

    if (!process.env.OPENAI_API_KEY) {
      await sendTelegramMessage(
        chatId,
        "Got your voice note — transcription isn't configured yet. Drop me a quick text and I'll file it.",
      )
      return NextResponse.json({ ok: true })
    }

    const transcript = await transcribeTelegramVoice(fileId)
    if (!transcript) {
      await sendTelegramMessage(
        chatId,
        "I heard you but couldn't make out the words. Try again or send a quick text.",
      )
      return NextResponse.json({ ok: true })
    }
    // Echo the transcript back so the rep knows what we heard, then process it.
    await sendTelegramMessage(chatId, `_heard:_ "${transcript.length > 200 ? transcript.slice(0, 200) + '…' : transcript}"`)
    text = transcript
  }

  if (!text) return NextResponse.json({ ok: true })

  const firstName = msg.from?.first_name ?? 'there'

  // ── /start ──────────────────────────────────────────────────────────────
  if (/^\/start\b/i.test(text)) {
    await sendTelegramMessage(
      chatId,
      [
        `Hey ${firstName} 👋 I'm your Virtual Closer assistant.`,
        '',
        'To connect me to your dashboard:',
        '1. Log in at your Virtual Closer URL.',
        '2. Open the *Connect Telegram* card on your dashboard.',
        '3. Copy your 8-character code.',
        '4. Reply here with: `/link YOURCODE`',
        '',
        'Once linked, anything you text me (tasks, reminders, goals, notes) goes straight into your CRM.',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── /link CODE ──────────────────────────────────────────────────────────
  const linkMatch = text.match(/^\/link\s+([A-Za-z0-9]{4,16})\b/i)
  if (linkMatch) {
    const code = linkMatch[1].toUpperCase()
    const tenant = await findTenantByLinkCode(code)
    if (!tenant) {
      await sendTelegramMessage(
        chatId,
        "That code didn't match any account. Double-check the *Connect Telegram* card on your dashboard and try again.",
      )
      return NextResponse.json({ ok: true })
    }
    await bindChat(tenant.id, chatId)
    await sendTelegramMessage(
      chatId,
      [
        `✅ You're linked, ${firstName}. I'll now send everything you text me straight into *${tenant.display_name}*'s dashboard.`,
        '',
        `One more thing — your timezone is set to *${tenant.timezone || 'UTC'}*. If that's wrong, send: \`/timezone America/New_York\` (or your IANA tz). I use it to fire your Monday kickoffs and end-of-day pulses on *your* clock.`,
        '',
        'Try it:',
        '• "Call Dana Thursday about pricing"',
        '• "Goal: close 10 deals this month"',
        '• "Nina was a no-show, reschedule her for next week"',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── /timezone TZ ────────────────────────────────────────────────────────
  // Lets the rep set their IANA timezone so the coach cron fires at their
  // local 9am / 5pm rather than UTC.
  const tzMatch = text.match(/^\/timezone(?:\s+(.+))?$/i)
  if (tzMatch) {
    const tenant = await findTenantByChatId(chatId)
    if (!tenant) {
      await sendTelegramMessage(chatId, "Link your account first with `/link YOURCODE`, then set your timezone.")
      return NextResponse.json({ ok: true })
    }
    const arg = tzMatch[1]?.trim()
    if (!arg) {
      await sendTelegramMessage(
        chatId,
        [
          `Your timezone is currently *${tenant.timezone || 'UTC'}*.`,
          '',
          'Set it with: `/timezone America/New_York`',
          'Common: `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, `Europe/London`, `Europe/Berlin`, `Asia/Dubai`, `Asia/Singapore`, `Australia/Sydney`',
        ].join('\n'),
      )
      return NextResponse.json({ ok: true })
    }
    // Validate by trying to format with that tz.
    let valid = true
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: arg }).format(new Date())
    } catch {
      valid = false
    }
    if (!valid) {
      await sendTelegramMessage(chatId, `\`${arg}\` doesn't look like a valid IANA timezone. Try one like \`America/New_York\` or \`Europe/London\`.`)
      return NextResponse.json({ ok: true })
    }
    await supabase.from('reps').update({ timezone: arg }).eq('id', tenant.id)
    const localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: arg,
      hour: 'numeric',
      minute: '2-digit',
      weekday: 'short',
    }).format(new Date())
    await sendTelegramMessage(
      chatId,
      `🕒 Timezone set to *${arg}*. It's ${localTime} for you right now. I'll fire your Monday kickoffs and end-of-day pulses on your local clock.`,
    )
    return NextResponse.json({ ok: true })
  }

  // ── /help ───────────────────────────────────────────────────────────────
  if (/^\/help\b/i.test(text)) {
    await sendTelegramMessage(
      chatId,
      [
        '*How I work*',
        'Talk to me like an assistant. Examples:',
        '• "New prospect Dana Kim at Acme, seems hot — follow up Thursday on pricing"',
        '• "Just got off with Ben — he wants the deck again, said budget is tight, next step is a call next Tuesday" (logs the conversation)',
        '• "Book a call with Dana Thursday at 3pm for 30 min" (Google Calendar)',
        '• "Goal: 50 calls this week" / "target: 10 meetings booked this month"',
        '• "What\'s my pipeline?" / "What\'s on my calendar?" / "How am I tracking on goals?"',
        '• "Show me history with Dana"',
        '• "Remind me tomorrow to call the HVAC leads"',
        '',
        '*Commands*',
        '/link CODE — connect this Telegram to your dashboard',
        '/timezone America/New_York — set your local timezone (so my Monday kickoffs and daily pulses hit at *your* 9am / 5pm)',
        '/help — this menu',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── Plain text → interpret into intents, then execute each one ─────────
  const tenant = await findTenantByChatId(chatId)
  if (!tenant) {
    await sendTelegramMessage(
      chatId,
      `You're not linked yet. Grab your 8-character code from the *Connect Telegram* card on your dashboard, then send: \`/link YOURCODE\`\n\n(Or /start to see the full walkthrough.)`,
    )
    return NextResponse.json({ ok: true })
  }

  try {
    const knownLeads = await getRecentLeadNames(tenant.id, 40)
    const interp = await interpretTelegramMessage(
      text,
      tenant.display_name,
      knownLeads.map((l) => ({ name: l.name, company: l.company, status: l.status })),
    )

    const receipts: string[] = []
    const brainItemsQueued: Array<{
      item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
      content: string
      priority?: 'low' | 'normal' | 'high'
      horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
      due_date?: string | null
    }> = []

    for (const intent of interp.intents) {
      try {
        const r = await executeIntent(intent, tenant, knownLeads, brainItemsQueued)
        if (r) receipts.push(r)
      } catch (err) {
        console.error('[telegram webhook] intent failed', intent, err)
        receipts.push(`⚠️ Couldn't process one item — check your dashboard.`)
      }
    }

    // Any queued brain-items get written as a single brain_dump + items batch.
    if (brainItemsQueued.length > 0) {
      const dump = await createBrainDump({
        repId: tenant.id,
        rawText: text,
        summary: interp.reply_hint ?? '',
        source: 'mic',
      })
      await createBrainItems(tenant.id, dump.id, brainItemsQueued)
    }

    const reply =
      receipts.length === 0
        ? interp.reply_hint || "Got it — nothing to file from that one."
        : receipts.join('\n')

    await sendTelegramMessage(chatId, reply)
  } catch (err) {
    console.error('[telegram webhook] interpret failed', err)
    await sendTelegramMessage(
      chatId,
      "Something hiccuped on my end. I logged your message — check your dashboard and resend if needed.",
    )
  }

  return NextResponse.json({ ok: true })
}

/**
 * Execute a single intent. Brain-items are queued (not written) so we can
 * batch them into one brain_dump after the loop.
 * Returns a short Telegram-facing receipt string, or null for no-op.
 */
async function executeIntent(
  intent: TelegramIntent,
  tenant: Tenant,
  knownLeads: Lead[],
  brainItemQueue: Array<{
    item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
    content: string
    priority?: 'low' | 'normal' | 'high'
    horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
    due_date?: string | null
  }>,
): Promise<string | null> {
  switch (intent.kind) {
    case 'add_lead': {
      const lead = await upsertLead({
        repId: tenant.id,
        name: intent.name,
        company: intent.company ?? null,
        email: intent.email ?? null,
        status: (intent.status as LeadStatus) ?? 'warm',
        notes: intent.note ?? null,
        source: 'telegram',
        touchContact: true,
      })
      return `➕ Added *${lead.name}*${lead.company ? ` (${lead.company})` : ''} as ${lead.status}.`
    }

    case 'update_lead': {
      const target =
        knownLeads.find(
          (l) => l.name.toLowerCase() === intent.lead_name.toLowerCase(),
        ) ??
        knownLeads.find((l) =>
          l.name.toLowerCase().includes(intent.lead_name.toLowerCase()),
        )
      if (!target) {
        // No match — treat as a new lead with the note.
        const created = await upsertLead({
          repId: tenant.id,
          name: intent.lead_name,
          status: (intent.status as LeadStatus) ?? 'warm',
          notes: intent.note ?? null,
          touchContact: intent.mark_contacted ?? false,
          source: 'telegram',
        })
        return `➕ Didn't find *${intent.lead_name}* — added them as ${created.status}.`
      }
      const updated = await upsertLead({
        repId: tenant.id,
        name: target.name,
        status: (intent.status as LeadStatus) ?? undefined,
        notes: intent.note ?? null,
        touchContact: intent.mark_contacted ?? false,
      })
      const bits: string[] = []
      if (intent.status) bits.push(`marked ${updated.status}`)
      if (intent.mark_contacted) bits.push('logged contact')
      if (intent.note) bits.push('added note')
      return `✏️ *${updated.name}* — ${bits.join(', ') || 'updated'}.`
    }

    case 'schedule_followup': {
      const target =
        knownLeads.find(
          (l) => l.name.toLowerCase() === intent.lead_name.toLowerCase(),
        ) ??
        knownLeads.find((l) =>
          l.name.toLowerCase().includes(intent.lead_name.toLowerCase()),
        )
      const leadLabel = target?.name ?? intent.lead_name
      brainItemQueue.push({
        item_type: 'task',
        content: `${intent.content} — ${leadLabel}`,
        priority: intent.priority ?? 'normal',
        horizon: 'day',
        due_date: intent.due_date,
      })

      // Best-effort: drop it onto their Google Calendar too.
      let calSuffix = ''
      try {
        // Default 9am local, 30 min, UTC (user's Google account handles display TZ).
        const startIso = `${intent.due_date}T14:00:00Z`
        const ev = await createCalendarEvent({
          repId: tenant.id,
          summary: `${intent.content} — ${leadLabel}`,
          description: `Scheduled via Virtual Closer Telegram bot.`,
          startIso,
          timezone: 'UTC',
          attendees: target?.email ? [{ email: target.email, displayName: target.name }] : undefined,
        })
        if (ev) calSuffix = ' · 🗓 added to Google Calendar'
      } catch (err) {
        console.error('[telegram webhook] gcal create failed', err)
      }

      return `📅 Follow-up with *${leadLabel}* on ${intent.due_date}: ${intent.content}${calSuffix}`
    }

    case 'brain_item': {
      brainItemQueue.push({
        item_type: intent.item_type,
        content: intent.content,
        priority: intent.priority ?? 'normal',
        horizon: intent.horizon ?? 'none',
        due_date: intent.due_date ?? null,
      })
      const icon =
        intent.item_type === 'task'
          ? '✅'
          : intent.item_type === 'goal'
            ? '🎯'
            : intent.item_type === 'idea'
              ? '💡'
              : intent.item_type === 'plan'
                ? '🗺️'
                : '📝'
      return `${icon} ${intent.item_type}: ${intent.content}`
    }

    case 'log_call': {
      const target =
        knownLeads.find(
          (l) => l.name.toLowerCase() === intent.lead_name.toLowerCase(),
        ) ??
        knownLeads.find((l) =>
          l.name.toLowerCase().includes(intent.lead_name.toLowerCase()),
        )
      // Create the lead if missing so the call has somewhere to attach.
      const lead =
        target ??
        (await upsertLead({
          repId: tenant.id,
          name: intent.lead_name,
          status: intent.outcome === 'positive' || intent.outcome === 'booked' ? 'hot' : 'warm',
          source: 'telegram',
          touchContact: true,
        }))

      await logCall({
        repId: tenant.id,
        leadId: lead.id,
        contactName: lead.name,
        summary: intent.summary,
        outcome: intent.outcome ?? null,
        nextStep: intent.next_step ?? null,
        durationMinutes: intent.duration_minutes ?? null,
      })

      // Also update the lead — mark contacted, append a short note, optionally bump status.
      const noteLine = intent.summary.slice(0, 200)
      await upsertLead({
        repId: tenant.id,
        name: lead.name,
        notes: noteLine,
        status:
          intent.outcome === 'closed_won'
            ? undefined
            : intent.outcome === 'positive' || intent.outcome === 'booked'
              ? 'hot'
              : intent.outcome === 'negative' || intent.outcome === 'closed_lost'
                ? 'dormant'
                : undefined,
        touchContact: true,
      })

      const tail = intent.next_step ? ` · next: ${intent.next_step}` : ''
      return `📞 Logged call with *${lead.name}*${intent.outcome ? ` (${intent.outcome.replace('_', ' ')})` : ''}${tail}`
    }

    case 'book_meeting': {
      const target = intent.lead_name
        ? knownLeads.find(
            (l) => l.name.toLowerCase() === intent.lead_name!.toLowerCase(),
          ) ??
          knownLeads.find((l) =>
            l.name.toLowerCase().includes(intent.lead_name!.toLowerCase()),
          )
        : null
      const contactName = target?.name ?? intent.contact_name ?? intent.lead_name ?? 'Meeting'
      const attendeeEmail = intent.email ?? target?.email ?? null
      const duration = intent.duration_minutes ?? 30
      const startIso = intent.start_iso
      const endIso = new Date(new Date(startIso).getTime() + duration * 60_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')

      // Conflict check via Google free/busy. If the rep already has something
      // on the books, warn them in the reply but still create the event — they
      // can choose to delete the old one or move this one. (Returns null if
      // Google isn't connected; we just skip the warning in that case.)
      const conflict = await findConflict(tenant.id, startIso, endIso)

      const ev = await createCalendarEvent({
        repId: tenant.id,
        summary: intent.summary || `Meeting with ${contactName}`,
        description: intent.notes ?? `Booked via Virtual Closer Telegram bot.`,
        startIso,
        endIso,
        timezone: tenant.timezone ?? 'UTC',
        attendees: attendeeEmail
          ? [{ email: attendeeEmail, displayName: contactName }]
          : undefined,
      })

      // Mirror as a follow-up task so it appears in the dashboard.
      brainItemQueue.push({
        item_type: 'task',
        content: `${intent.summary || `Meeting with ${contactName}`} — ${new Date(startIso).toLocaleString()}`,
        priority: 'high',
        horizon: 'day',
        due_date: startIso.slice(0, 10),
      })

      if (!ev) {
        return `📅 Couldn't reach Google Calendar — saved as a task for ${new Date(startIso).toLocaleString()}. Connect Google on your dashboard to auto-book next time.`
      }
      const conflictWarning = conflict
        ? `\n⚠️ Heads up — you already have something on your calendar from ${new Date(conflict.startIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to ${new Date(conflict.endIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Both events are now on the books — reply *cancel last* or move one if needed.`
        : ''
      return `📅 Booked *${intent.summary || contactName}* for ${new Date(startIso).toLocaleString()}${attendeeEmail ? ` with ${attendeeEmail}` : ''} — added to your Google Calendar.${conflictWarning}`
    }

    case 'set_target': {
      const t = await setTarget({
        repId: tenant.id,
        periodType: intent.period_type,
        metric: intent.metric,
        targetValue: intent.target_value,
        notes: intent.notes ?? null,
      })
      return `🎯 Target locked in: *${t.target_value} ${t.metric.replace('_', ' ')}* this ${t.period_type}.`
    }

    case 'report': {
      const reply = await runReport(intent.report_type, intent.lead_name ?? null, tenant)
      return reply
    }

    case 'question': {
      return intent.reply
    }
  }
}

/**
 * Fetch the data for a report and ask Claude to summarize it.
 */
async function runReport(
  reportType: string,
  leadName: string | null,
  tenant: Tenant,
): Promise<string> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  if (reportType === 'pipeline') {
    const leads = await getAllLeads(tenant.id)
    const counts = {
      hot: leads.filter((l) => l.status === 'hot').length,
      warm: leads.filter((l) => l.status === 'warm').length,
      cold: leads.filter((l) => l.status === 'cold').length,
      dormant: leads.filter((l) => l.status === 'dormant').length,
      total: leads.length,
    }
    const hottest = leads
      .filter((l) => l.status === 'hot' || l.status === 'warm')
      .slice(0, 8)
      .map((l) => ({
        name: l.name,
        company: l.company,
        status: l.status,
        last_contact: l.last_contact,
      }))
    return generateReport('pipeline', { counts, hottest, today: todayIso }, tenant.display_name)
  }

  if (reportType === 'today' || reportType === 'week') {
    const leads = await getAllLeads(tenant.id)
    const startIso =
      reportType === 'today'
        ? new Date(todayIso + 'T00:00:00Z').toISOString()
        : new Date(Date.now() - 7 * 86400_000).toISOString()
    const stats = await getCallStats(tenant.id, startIso)
    const events = (await listUpcomingEvents(tenant.id, {
      fromIso: new Date().toISOString(),
      toIso: new Date(Date.now() + (reportType === 'today' ? 1 : 7) * 86400_000).toISOString(),
      maxResults: 10,
    })) ?? []
    const targets = await refreshTargetProgress(tenant.id)
    return generateReport(
      reportType,
      {
        leadCounts: {
          hot: leads.filter((l) => l.status === 'hot').length,
          warm: leads.filter((l) => l.status === 'warm').length,
        },
        callStats: stats,
        upcomingEvents: events.slice(0, 8).map((e) => ({
          summary: e.summary,
          start: e.start,
          attendees: (e.attendees ?? []).map((a) => a.email),
        })),
        activeTargets: targets.map((t) => ({
          metric: t.metric,
          target: t.target_value,
          current: t.current_value,
          period: t.period_type,
        })),
      },
      tenant.display_name,
    )
  }

  if (reportType === 'calendar') {
    const events = await listUpcomingEvents(tenant.id, { maxResults: 15 })
    if (events === null) {
      return "Google Calendar isn't connected yet — open your dashboard and click *Connect Google* so I can read your schedule."
    }
    return generateReport(
      'calendar',
      {
        events: events.map((e) => ({
          summary: e.summary,
          start: e.start,
          end: e.end,
          attendees: (e.attendees ?? []).map((a) => a.email),
        })),
      },
      tenant.display_name,
    )
  }

  if (reportType === 'goals' || reportType === 'metrics') {
    const targets = await refreshTargetProgress(tenant.id)
    const weekStart = new Date(Date.now() - 7 * 86400_000).toISOString()
    const stats = await getCallStats(tenant.id, weekStart)
    return generateReport(
      reportType,
      {
        activeTargets: targets.map((t) => ({
          metric: t.metric,
          period: t.period_type,
          target: t.target_value,
          current: t.current_value,
          progress_pct: t.target_value > 0 ? Math.round((100 * t.current_value) / t.target_value) : 0,
          notes: t.notes,
        })),
        last7Days: stats,
      },
      tenant.display_name,
    )
  }

  if (reportType === 'lead_history' && leadName) {
    const leads = await getRecentLeadNames(tenant.id, 200)
    const lead =
      leads.find((l) => l.name.toLowerCase() === leadName.toLowerCase()) ??
      leads.find((l) => l.name.toLowerCase().includes(leadName.toLowerCase()))
    if (!lead) {
      return `Couldn't find *${leadName}* in your prospects yet.`
    }
    const calls = await getCallsForLead(tenant.id, lead.id)
    return generateReport(
      'lead_history',
      {
        lead: {
          name: lead.name,
          company: lead.company,
          status: lead.status,
          last_contact: lead.last_contact,
          notes: lead.notes,
        },
        calls: calls.slice(0, 10).map((c) => ({
          when: c.occurred_at,
          outcome: c.outcome,
          summary: c.summary,
          next_step: c.next_step,
        })),
      },
      tenant.display_name,
    )
  }

  // Fallback summary
  const recentCalls = await getRecentCalls(tenant.id, 10)
  const targets = await getActiveTargets(tenant.id)
  return generateReport('summary', { recentCalls, targets }, tenant.display_name)
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    bot: telegramBotUsername(),
    hint: 'Point Telegram setWebhook at this URL with a secret_token.',
  })
}
