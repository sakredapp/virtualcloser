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
import {
  archiveTelegramVoiceToStorage,
  broadcastPitchToManagers,
  createMemo,
  findMemoByRelay,
  relayFeedbackToSender,
  setMemoStatus,
} from '@/lib/voice-memos'
import {
  createCalendarEvent,
  findConflict,
  getMissingSheetFields,
  getSheetCrmConfig,
  listUpcomingEvents,
  mirrorLeadToSheet,
} from '@/lib/google'
import type { Tenant } from '@/lib/tenant'
import { findMemberByLinkCode, getManagedTeamIds, updateMember } from '@/lib/members'
import { isAtLeast } from '@/lib/permissions'
import { broadcastNewTeamGoal } from '@/lib/team-goals'
import type { Lead, LeadStatus, Member } from '@/types'

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
  reply_to_message?: { message_id: number }
}
type TgUpdate = {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
}

async function findTenantByChatId(chatId: number): Promise<{ tenant: Tenant; member: Member } | null> {
  // Each member binds their *own* Telegram chat to their *own* dashboard.
  // Look up the member first, then load their tenant.
  const { data: m } = await supabase
    .from('members')
    .select('*')
    .eq('telegram_chat_id', String(chatId))
    .eq('is_active', true)
    .maybeSingle()
  if (!m) return null
  const member = m as Member
  const { data: t } = await supabase
    .from('reps')
    .select('*')
    .eq('id', member.rep_id)
    .eq('is_active', true)
    .maybeSingle()
  if (!t) return null
  return { tenant: t as Tenant, member }
}

async function bindChatToMember(memberId: string, chatId: number): Promise<void> {
  // Make sure this Telegram chat is only attached to one member at a time:
  // if anyone else already had this chat_id, clear theirs first.
  await supabase
    .from('members')
    .update({ telegram_chat_id: null })
    .eq('telegram_chat_id', String(chatId))
    .neq('id', memberId)
  await updateMember(memberId, { telegram_chat_id: String(chatId) })
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

  // Early member context lookup — needed for the voice-memo feedback loop
  // (pitch mode + manager replies). Cheap; the existing flow below also
  // re-uses it via `ctx`.
  const ctxEarly = await findTenantByChatId(chatId)
  const replyToMessageId = msg.reply_to_message?.message_id ?? null
  const incomingVoiceFileId = msg.voice?.file_id ?? msg.audio?.file_id ?? null

  // ── Manager voice/text REPLY to a pitch ping ──────────────────────────
  // Telegram includes `reply_to_message.message_id`; we match it against the
  // bot's outgoing message we stored on the original pitch memo.
  if (ctxEarly && replyToMessageId) {
    const matched = await findMemoByRelay(String(chatId), replyToMessageId)
    if (matched && matched.kind === 'pitch') {
      const tenantE = ctxEarly.tenant
      const memberE = ctxEarly.member
      // Voice reply → archive + create feedback memo + relay to rep.
      if (incomingVoiceFileId) {
        const transcript = (await transcribeTelegramVoice(incomingVoiceFileId)) ?? null
        const fb = await createMemo({
          repId: tenantE.id,
          senderMemberId: memberE.id,
          recipientMemberId: matched.sender_member_id,
          teamId: matched.team_id,
          leadId: matched.lead_id,
          parentMemoId: matched.id,
          kind: 'feedback',
          telegramFileId: incomingVoiceFileId,
          durationSeconds: msg.voice?.duration ?? msg.audio?.duration ?? null,
          transcript,
        })
        await archiveTelegramVoiceToStorage(incomingVoiceFileId, tenantE.id, fb.id)
        await setMemoStatus(matched.id, 'in_review', memberE.id)
        await relayFeedbackToSender(matched, fb, memberE.display_name)
        await sendTelegramMessage(chatId, '✅ Feedback relayed.')
        return NextResponse.json({ ok: true })
      }
      // Quick text reply: ready / needs work / archived → status update + ping rep.
      const t = (msg.text ?? '').trim()
      const tl = t.toLowerCase()
      if (/^(ready|good to go|approved|✅)/.test(tl)) {
        await setMemoStatus(matched.id, 'ready', memberE.id)
        const fb = await createMemo({
          repId: tenantE.id,
          senderMemberId: memberE.id,
          recipientMemberId: matched.sender_member_id,
          teamId: matched.team_id,
          leadId: matched.lead_id,
          parentMemoId: matched.id,
          kind: 'feedback',
          transcript: t || 'Ready to send.',
        })
        await relayFeedbackToSender(matched, fb, memberE.display_name)
        await sendTelegramMessage(chatId, '✅ Marked *ready* and notified the rep.')
        return NextResponse.json({ ok: true })
      }
      if (/^(needs?\s*work|not ready|rework|❌)/.test(tl)) {
        await setMemoStatus(matched.id, 'needs_work', memberE.id)
        const fb = await createMemo({
          repId: tenantE.id,
          senderMemberId: memberE.id,
          recipientMemberId: matched.sender_member_id,
          teamId: matched.team_id,
          leadId: matched.lead_id,
          parentMemoId: matched.id,
          kind: 'feedback',
          transcript: t || 'Needs more work.',
        })
        await relayFeedbackToSender(matched, fb, memberE.display_name)
        await sendTelegramMessage(chatId, '🛠 Marked *needs work* and notified the rep.')
        return NextResponse.json({ ok: true })
      }
      // Free-form text feedback → relay verbatim.
      if (t) {
        const fb = await createMemo({
          repId: tenantE.id,
          senderMemberId: memberE.id,
          recipientMemberId: matched.sender_member_id,
          teamId: matched.team_id,
          leadId: matched.lead_id,
          parentMemoId: matched.id,
          kind: 'feedback',
          transcript: t,
        })
        await setMemoStatus(matched.id, 'in_review', memberE.id)
        await relayFeedbackToSender(matched, fb, memberE.display_name)
        await sendTelegramMessage(chatId, '✅ Feedback relayed.')
        return NextResponse.json({ ok: true })
      }
    }
  }

  // ── Pitch mode: rep armed `/pitch`; the next voice becomes a pitch memo ─
  if (ctxEarly && incomingVoiceFileId) {
    const settings = (ctxEarly.member.settings ?? {}) as Record<string, unknown>
    if (settings.pending_action === 'pitch') {
      const tenantE = ctxEarly.tenant
      const memberE = ctxEarly.member
      const transcript = (await transcribeTelegramVoice(incomingVoiceFileId)) ?? null
      const leadId = (settings.pending_pitch_lead_id as string | null) ?? null
      const leadHint = (settings.pending_pitch_lead_hint as string | null) ?? null
      const memo = await createMemo({
        repId: tenantE.id,
        senderMemberId: memberE.id,
        leadId,
        kind: 'pitch',
        telegramFileId: incomingVoiceFileId,
        durationSeconds: msg.voice?.duration ?? msg.audio?.duration ?? null,
        transcript,
      })
      await archiveTelegramVoiceToStorage(incomingVoiceFileId, tenantE.id, memo.id)
      let leadName: string | null = leadHint
      if (leadId) {
        const { data: lr } = await supabase
          .from('leads')
          .select('name, company')
          .eq('id', leadId)
          .maybeSingle()
        const l = lr as { name: string; company: string | null } | null
        if (l) leadName = l.company ? `${l.name} · ${l.company}` : l.name
      }
      const { pinged } = await broadcastPitchToManagers(memo, memberE.display_name, leadName)
      // Clear the one-shot flag.
      await updateMember(memberE.id, {
        settings: { ...settings, pending_action: null, pending_pitch_lead_id: null, pending_pitch_lead_hint: null },
      })
      await sendTelegramMessage(
        chatId,
        pinged > 0
          ? `🎙 Pitch sent to *${pinged}* manager${pinged === 1 ? '' : 's'}.${leadName ? `\nLead: *${leadName}*` : ''}\nThey'll reply with feedback.`
          : `🎙 Pitch saved, but no managers are linked to Telegram yet.${leadName ? `\nLead: *${leadName}*` : ''}\nThey can review it from the *Feedback* tab on the dashboard.`,
      )
      return NextResponse.json({ ok: true })
    }
  }

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

  // ── /link CODE ────────────────────────────────────────────────
  // Each member has their own 8-char code (members.telegram_link_code).
  // /link binds *that member's* Telegram chat — not the whole tenant’s.
  const linkMatch = text.match(/^\/link\s+([A-Za-z0-9]{4,16})\b/i)
  if (linkMatch) {
    const code = linkMatch[1].toUpperCase()
    const linkedMember = await findMemberByLinkCode(code)
    if (!linkedMember) {
      await sendTelegramMessage(
        chatId,
        "That code didn't match any account. Double-check the *Connect Telegram* card on your dashboard and try again.",
      )
      return NextResponse.json({ ok: true })
    }
    const { data: linkedTenantRow } = await supabase
      .from('reps')
      .select('*')
      .eq('id', linkedMember.rep_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!linkedTenantRow) {
      await sendTelegramMessage(chatId, "That account isn't active. Reach out to your admin.")
      return NextResponse.json({ ok: true })
    }
    const linkedTenant = linkedTenantRow as Tenant
    await bindChatToMember(linkedMember.id, chatId)
    await sendTelegramMessage(
      chatId,
      [
        `✅ You're linked, ${firstName}. I'll send everything you text me straight into *your* dashboard at *${linkedTenant.display_name}*.`,
        '',
        `Your timezone is set to *${linkedMember.timezone || linkedTenant.timezone || 'UTC'}*. If that's wrong, send: \`/timezone America/New_York\` (or your IANA tz). I use it to fire *your* Monday kickoffs and end-of-day pulses.`,
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
    const ctx = await findTenantByChatId(chatId)
    if (!ctx) {
      await sendTelegramMessage(chatId, "Link your account first with `/link YOURCODE`, then set your timezone.")
      return NextResponse.json({ ok: true })
    }
    const tenant = ctx.tenant
    const tzMember = ctx.member
    const arg = tzMatch[1]?.trim()
    if (!arg) {
      await sendTelegramMessage(
        chatId,
        [
          `Your timezone is currently *${tzMember.timezone || tenant.timezone || 'UTC'}*.`,
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
    // Set the member's timezone (each member runs on their own clock).
    await updateMember(tzMember.id, { timezone: arg })
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
        '/pitch [lead] — record a voice pitch and send it to your manager',
        '/help — this menu',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── /pitch [optional lead name] ─────────────────────────────────────────
  // Arms a one-shot "next voice = pitch" flag on the member. The next voice
  // message they send gets uploaded as a pitch memo and broadcast to every
  // manager in scope.
  const pitchMatch = text.match(/^\/pitch(?:\s+(.+))?$/i)
  if (pitchMatch) {
    if (!ctxEarly) {
      await sendTelegramMessage(
        chatId,
        "Link your account first with `/link YOURCODE`, then send `/pitch` to record a voice pitch.",
      )
      return NextResponse.json({ ok: true })
    }
    const arg = pitchMatch[1]?.trim() || ''
    const settings = (ctxEarly.member.settings ?? {}) as Record<string, unknown>
    let leadId: string | null = null
    let leadHint: string | null = arg || null
    if (arg) {
      const knownLeads = await getRecentLeadNames(ctxEarly.tenant.id, 80)
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
      const target = norm(arg)
      const hit = knownLeads.find((l) => norm(l.name).includes(target) || (l.company && norm(l.company).includes(target)))
      if (hit) {
        leadId = hit.id
        leadHint = hit.company ? `${hit.name} · ${hit.company}` : hit.name
      }
    }
    await updateMember(ctxEarly.member.id, {
      settings: {
        ...settings,
        pending_action: 'pitch',
        pending_pitch_lead_id: leadId,
        pending_pitch_lead_hint: leadHint,
      },
    })
    await sendTelegramMessage(
      chatId,
      [
        `🎤 *Pitch mode armed*${leadHint ? ` for *${leadHint}*` : ''}.`,
        '',
        'Send your pitch now as a *voice message* (hold the mic icon). I\'ll transcribe it, archive it, and push it to your manager for feedback.',
        '',
        'Send any text to cancel.',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── Plain text → interpret into intents, then execute each one ─────────
  const ctx = await findTenantByChatId(chatId)
  if (!ctx) {
    await sendTelegramMessage(
      chatId,
      `You're not linked yet. Grab your 8-character code from the *Connect Telegram* card on your dashboard, then send: \`/link YOURCODE\`\n\n(Or /start to see the full walkthrough.)`,
    )
    return NextResponse.json({ ok: true })
  }
  const tenant = ctx.tenant
  const member: Member = ctx.member

  try {
    const knownLeads = await getRecentLeadNames(tenant.id, 40)
    const ownerMemberId = member.id

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
        const r = await executeIntent(intent, tenant, knownLeads, brainItemsQueued, ownerMemberId, member)
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
        ownerMemberId,
      })
      await createBrainItems(tenant.id, dump.id, brainItemsQueued, ownerMemberId)
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
  ownerMemberId: string | null,
  callerMember: Member,
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
        ownerMemberId,
      })
      const sheetResult = await mirrorLeadToSheet(tenant.id, {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        status: lead.status,
        notes: lead.notes,
        source: 'telegram',
        last_contact: lead.last_contact,
      }).catch(() => null)
      const sheetSuffix = sheetResult ? ' · 📄 synced to Google Sheet' : ''

      // If the linked sheet tracks fields we don't have yet, ask once.
      let missingPrompt = ''
      const sheetCfg = await getSheetCrmConfig(tenant.id).catch(() => null)
      if (sheetCfg) {
        const missing = await getMissingSheetFields(tenant.id, sheetCfg, {
          name: lead.name,
          email: lead.email ?? '',
          company: lead.company ?? '',
        }).catch(() => [] as string[])
        const labelMap: Record<string, string> = {
          email: 'email',
          company: 'company',
          phone: 'phone',
          name: 'full name',
        }
        const labels = missing.map((m) => labelMap[m] ?? m).filter(Boolean)
        if (labels.length > 0) {
          missingPrompt = `\n\n📋 To complete the row in your Google Sheet, send me their ${labels.join(', ')}. Just reply: \`${lead.name}'s ${labels[0]} is …\`.`
        }
      }

      return `➕ Added *${lead.name}*${lead.company ? ` (${lead.company})` : ''} as ${lead.status}.${sheetSuffix}${missingPrompt}`
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
          ownerMemberId,
        })
        return `➕ Didn't find *${intent.lead_name}* — added them as ${created.status}.`
      }
      const updated = await upsertLead({
        repId: tenant.id,
        name: target.name,
        company: intent.company ?? undefined,
        email: intent.email ?? undefined,
        status: (intent.status as LeadStatus) ?? undefined,
        notes: intent.note ?? null,
        touchContact: intent.mark_contacted ?? false,
        ownerMemberId,
      })
      await mirrorLeadToSheet(tenant.id, {
        name: updated.name,
        email: updated.email,
        company: updated.company,
        phone: intent.phone ?? null,
        status: updated.status,
        notes: updated.notes,
        source: 'telegram',
        last_contact: updated.last_contact,
      }).catch(() => null)
      const bits: string[] = []
      if (intent.status) bits.push(`marked ${updated.status}`)
      if (intent.mark_contacted) bits.push('logged contact')
      if (intent.email) bits.push(`email saved`)
      if (intent.company) bits.push(`company saved`)
      if (intent.phone) bits.push(`phone saved`)
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
          ownerMemberId,
        }))

      await logCall({
        repId: tenant.id,
        leadId: lead.id,
        contactName: lead.name,
        summary: intent.summary,
        outcome: intent.outcome ?? null,
        nextStep: intent.next_step ?? null,
        durationMinutes: intent.duration_minutes ?? null,
        ownerMemberId,
      })

      // Also update the lead — mark contacted, append a short note, optionally bump status.
      const noteLine = intent.summary.slice(0, 200)
      const updatedLead = await upsertLead({
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
        ownerMemberId,
      })
      await mirrorLeadToSheet(tenant.id, {
        name: updatedLead.name,
        email: updatedLead.email,
        company: updatedLead.company,
        status: updatedLead.status,
        notes: updatedLead.notes,
        source: 'telegram',
        last_contact: updatedLead.last_contact,
      }).catch(() => null)

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
      const requestedScope = intent.scope ?? 'personal'
      const isManager = isAtLeast(callerMember.role, 'manager')
      const isAdmin = isAtLeast(callerMember.role, 'admin')

      // Resolve scope + team_id with permission gates. Reps and observers
      // always fall through to personal regardless of what they asked for.
      let scope: 'personal' | 'team' | 'account' = 'personal'
      let teamId: string | null = null
      let teamName: string | null = null

      if (requestedScope === 'account' && isAdmin) {
        scope = 'account'
      } else if (requestedScope === 'team' && isManager) {
        // Find the team by name if given, else default to the caller's first
        // managed team (admins fall back to any team in the account).
        let resolvedTeamId: string | null = null
        if (intent.team_name) {
          const { data: row } = await supabase
            .from('teams')
            .select('id, name')
            .eq('rep_id', tenant.id)
            .ilike('name', intent.team_name)
            .maybeSingle()
          if (row) {
            resolvedTeamId = (row as { id: string }).id
            teamName = (row as { name: string }).name
          }
        }
        if (!resolvedTeamId) {
          const managed = await getManagedTeamIds(callerMember.id)
          if (managed.length > 0) resolvedTeamId = managed[0]
          else if (isAdmin) {
            const { data: anyTeam } = await supabase
              .from('teams')
              .select('id, name')
              .eq('rep_id', tenant.id)
              .limit(1)
              .maybeSingle()
            if (anyTeam) {
              resolvedTeamId = (anyTeam as { id: string }).id
              teamName = (anyTeam as { name: string }).name
            }
          }
        }
        if (resolvedTeamId) {
          // Permission check for non-admin managers.
          if (!isAdmin) {
            const managed = await getManagedTeamIds(callerMember.id)
            if (!managed.includes(resolvedTeamId)) {
              return `🎯 You don't manage that team — saving as a personal goal instead.`
            }
          }
          scope = 'team'
          teamId = resolvedTeamId
          if (!teamName && resolvedTeamId) {
            const { data: trow } = await supabase
              .from('teams')
              .select('name')
              .eq('id', resolvedTeamId)
              .maybeSingle()
            teamName = (trow as { name: string } | null)?.name ?? null
          }
        }
      }

      const t = await setTarget({
        repId: tenant.id,
        periodType: intent.period_type,
        metric: intent.metric,
        targetValue: intent.target_value,
        notes: intent.notes ?? null,
        ownerMemberId,
        teamId,
        scope,
      })

      if (scope !== 'personal') {
        try {
          const { delivered } = await broadcastNewTeamGoal(
            t,
            callerMember.display_name || callerMember.email,
            teamName,
          )
          const scopeLabel = scope === 'account' ? 'the account' : teamName ? `the ${teamName} team` : 'the team'
          return `🎯 ${scope === 'account' ? 'Account' : 'Team'} goal locked in: *${t.target_value} ${t.metric.replace('_', ' ')}* this ${t.period_type} for ${scopeLabel}. Pinged ${delivered} ${delivered === 1 ? 'member' : 'members'}.`
        } catch (err) {
          console.error('[telegram webhook] team broadcast failed', err)
          return `🎯 Goal saved, but I couldn't ping the team — check Telegram links on the dashboard.`
        }
      }
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
