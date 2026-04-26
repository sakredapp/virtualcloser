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
import { sendTelegramMessage, sendTelegramVoice, telegramBotUsername, answerCallbackQuery, editTelegramReplyMarkup } from '@/lib/telegram'
import { transcribeTelegramVoice } from '@/lib/transcribe'
import {
  archiveTelegramVoiceToStorage,
  createMemo,
  findMemoByRelay,
  getMemo,
  listPitchableManagers,
  relayFeedbackToSender,
  resolvePitchRecipient,
  sendPitchToManager,
  setMemoRelay,
  setMemoStatus,
} from '@/lib/voice-memos'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarEventsByQuery,
  findConflict,
  findFreeSlots,
  getMissingSheetFields,
  getSheetCrmConfig,
  listUpcomingEvents,
  mirrorLeadToSheet,
  patchCalendarEvent,
} from '@/lib/google'
import type { Tenant } from '@/lib/tenant'
import { findMemberByLinkCode, getManagedTeamIds, listMembers, updateMember } from '@/lib/members'
import { isAtLeast } from '@/lib/permissions'
import {
  createRoomMessage,
  findDeliveryByRelay,
  getRoomMessage,
  listAudience,
  relayRoomMessage,
  describeAudience,
} from '@/lib/rooms'
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
  callback_query?: {
    id: string
    from: TgUser
    message?: TgMessage
    data?: string
  }
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

  // ── Inline-keyboard callbacks (Now / Later on a pitch) ────────────────
  if (update.callback_query) {
    const cq = update.callback_query
    const data = cq.data ?? ''
    const cbChatId = cq.message?.chat.id
    const cbMessageId = cq.message?.message_id
    if (!cbChatId || !cbMessageId) {
      await answerCallbackQuery(cq.id)
      return NextResponse.json({ ok: true })
    }
    const ctxCb = await findTenantByChatId(cbChatId)
    if (!ctxCb) {
      await answerCallbackQuery(cq.id, "You're not linked.")
      return NextResponse.json({ ok: true })
    }

    const memoIdMatch = data.match(/^memo:(now|later):([0-9a-f-]{36})$/i)
    if (memoIdMatch) {
      const action = memoIdMatch[1].toLowerCase()
      const memoId = memoIdMatch[2]
      const memo = await getMemo(memoId)
      if (!memo || memo.rep_id !== ctxCb.tenant.id) {
        await answerCallbackQuery(cq.id, 'Memo not found.')
        return NextResponse.json({ ok: true })
      }
      // Only the assigned recipient (or an admin/owner) can react.
      const isRecipient = memo.recipient_member_id === ctxCb.member.id
      const isAdmin = ctxCb.member.role === 'owner' || ctxCb.member.role === 'admin'
      if (!isRecipient && !isAdmin) {
        await answerCallbackQuery(cq.id, 'Not addressed to you.')
        return NextResponse.json({ ok: true })
      }

      // Resolve sender for outbound messages.
      const { data: senderRow } = await supabase
        .from('members')
        .select('id, telegram_chat_id, display_name')
        .eq('id', memo.sender_member_id)
        .maybeSingle()
      const sender = senderRow as { id: string; telegram_chat_id: string | null; display_name: string } | null

      if (action === 'now') {
        await setMemoStatus(memoId, 'in_review', ctxCb.member.id)
        await editTelegramReplyMarkup(cbChatId, cbMessageId, []) // strip buttons
        await answerCallbackQuery(cq.id, 'Locked in.')
        await sendTelegramMessage(
          cbChatId,
          'Reply to the pitch above with a *voice message* (or text `ready` / `needs work` / free-form notes). I\'ll relay it to the rep.',
          { replyToMessageId: cbMessageId },
        )
        if (sender?.telegram_chat_id) {
          await sendTelegramMessage(
            sender.telegram_chat_id,
            `🎯 *${ctxCb.member.display_name}* is reviewing your pitch now.`,
          )
        }
        return NextResponse.json({ ok: true })
      }

      if (action === 'later') {
        // Add a task to the manager's brain so the pitch lives on their day plan.
        const taskBody = sender
          ? `Review pitch from ${sender.display_name}${memo.lead_id ? '' : ''} — voice memo waiting on /dashboard/feedback`
          : 'Review pending pitch on /dashboard/feedback'
        const dump = await createBrainDump({
          repId: ctxCb.tenant.id,
          rawText: `[pitch:${memoId}] ${taskBody}`,
          summary: 'Pitch queued for later review',
          source: 'mic',
          ownerMemberId: ctxCb.member.id,
        })
        await createBrainItems(
          ctxCb.tenant.id,
          dump.id,
          [
            {
              item_type: 'task',
              content: taskBody,
              priority: 'high',
              horizon: 'day',
            },
          ],
          ctxCb.member.id,
        )
        await setMemoStatus(memoId, 'in_review', ctxCb.member.id, 'Queued for later by recipient')
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        await answerCallbackQuery(cq.id, 'Added to your task list.')
        await sendTelegramMessage(
          cbChatId,
          '🕒 Got it — added to your tasks. The rep is told you\'ll get to it shortly.',
          { replyToMessageId: cbMessageId },
        )
        if (sender?.telegram_chat_id) {
          await sendTelegramMessage(
            sender.telegram_chat_id,
            `🕒 *${ctxCb.member.display_name}* will get to your pitch a little later — it\u2019s on their task list.`,
          )
        }
        return NextResponse.json({ ok: true })
      }
    }

    await answerCallbackQuery(cq.id)
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
    // Room reply: someone hit Reply on a relayed room post. Persist the
    // reply as a child room_message and fan it out to the rest of the
    // audience (still 1:1 to each member).
    const roomDelivery = await findDeliveryByRelay(String(chatId), replyToMessageId)
    if (roomDelivery) {
      const parent = await getRoomMessage(roomDelivery.message_id)
      if (parent) {
        const memberE = ctxEarly.member
        const tenantE = ctxEarly.tenant
        let body: string | null = null
        let kindR: 'text' | 'voice' = 'text'
        let fileId: string | null = null
        let transcript: string | null = null
        if (incomingVoiceFileId) {
          kindR = 'voice'
          fileId = incomingVoiceFileId
          transcript = (await transcribeTelegramVoice(incomingVoiceFileId)) ?? null
        } else {
          const t = (msg.text ?? '').trim()
          if (!t) return NextResponse.json({ ok: true })
          body = t
        }
        const reply = await createRoomMessage({
          repId: tenantE.id,
          audience: parent.audience,
          senderMemberId: memberE.id,
          parentMessageId: parent.id,
          body,
          kind: kindR,
          telegramFileId: fileId,
          transcript,
        })
        const { delivered } = await relayRoomMessage(reply, memberE.display_name || memberE.email)
        await sendTelegramMessage(
          chatId,
          `\u2705 Threaded back to ${describeAudience(parent.audience)} (${delivered} ${delivered === 1 ? 'person' : 'people'}).`,
        )
        return NextResponse.json({ ok: true })
      }
    }
    const matched = await findMemoByRelay(String(chatId), replyToMessageId)
    if (matched && (matched.kind === 'pitch' || matched.kind === 'coaching' || matched.kind === 'note')) {
      const tenantE = ctxEarly.tenant
      const memberE = ctxEarly.member
      // Walkie-talkie (kind='note') replies: a teammate replied to a relayed
      // walkie. Bounce it straight back to the original sender — no feedback
      // semantics, no status changes. Voice stays voice; text stays text.
      if (matched.kind === 'note') {
        const { data: senderRow } = await supabase
          .from('members')
          .select('telegram_chat_id, display_name')
          .eq('id', matched.sender_member_id)
          .maybeSingle()
        const sender = senderRow as { telegram_chat_id: string | null; display_name: string } | null
        const replierName = memberE.display_name || memberE.email
        if (!sender?.telegram_chat_id) {
          await sendTelegramMessage(chatId, "Couldn't reach the original sender on Telegram.")
          return NextResponse.json({ ok: true })
        }
        if (incomingVoiceFileId) {
          const transcript = (await transcribeTelegramVoice(incomingVoiceFileId)) ?? null
          // Persist as a child note memo + set its relay so the back-and-forth keeps threading.
          const reply = await createMemo({
            repId: tenantE.id,
            senderMemberId: memberE.id,
            recipientMemberId: matched.sender_member_id,
            parentMemoId: matched.id,
            kind: 'note',
            telegramFileId: incomingVoiceFileId,
            durationSeconds: msg.voice?.duration ?? msg.audio?.duration ?? null,
            transcript,
          })
          const caption = `💬 *${replierName}* replied${transcript ? `\n_${transcript.length > 240 ? transcript.slice(0, 240) + '…' : transcript}_` : ''}`
          const sent = await sendTelegramVoice(sender.telegram_chat_id, incomingVoiceFileId, caption)
          if (sent.ok && sent.message_id) {
            await setMemoRelay(reply.id, sender.telegram_chat_id, sent.message_id)
          }
          await sendTelegramMessage(chatId, '✅ Walkie reply sent.')
          return NextResponse.json({ ok: true })
        }
        const tw = (msg.text ?? '').trim()
        if (tw) {
          const reply = await createMemo({
            repId: tenantE.id,
            senderMemberId: memberE.id,
            recipientMemberId: matched.sender_member_id,
            parentMemoId: matched.id,
            kind: 'note',
            transcript: tw,
          })
          const sent = await sendTelegramMessage(
            sender.telegram_chat_id,
            `💬 *${replierName}* replied:\n\n${tw}`,
          )
          if (sent.ok && sent.message_id) {
            await setMemoRelay(reply.id, sender.telegram_chat_id, sent.message_id)
          }
          await sendTelegramMessage(chatId, '✅ Walkie reply sent.')
          return NextResponse.json({ ok: true })
        }
      }
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

  // ── Pitch mode: rep armed `/pitch <recipient>`; the next voice goes to that recipient ─
  if (ctxEarly && incomingVoiceFileId) {
    const settings = (ctxEarly.member.settings ?? {}) as Record<string, unknown>
    if (settings.pending_action === 'pitch') {
      const tenantE = ctxEarly.tenant
      const memberE = ctxEarly.member
      const recipientId = (settings.pending_pitch_recipient_member_id as string | null) ?? null
      // Hard rule: pitches only relay if the rep named a recipient. If the
      // settings flag is here without one, we treat it as a self-archive.
      if (!recipientId) {
        await updateMember(memberE.id, {
          settings: { ...settings, pending_action: null, pending_pitch_lead_id: null, pending_pitch_lead_hint: null, pending_pitch_recipient_member_id: null },
        })
        await sendTelegramMessage(
          chatId,
          'No recipient on that pitch — re-run `/pitch <manager-name>` and try again. Nothing was sent.',
        )
        return NextResponse.json({ ok: true })
      }

      const transcript = (await transcribeTelegramVoice(incomingVoiceFileId)) ?? null
      const leadId = (settings.pending_pitch_lead_id as string | null) ?? null
      const leadHint = (settings.pending_pitch_lead_hint as string | null) ?? null

      // Resolve recipient.
      const { data: recRow } = await supabase
        .from('members')
        .select('id, telegram_chat_id, display_name, is_active')
        .eq('id', recipientId)
        .maybeSingle()
      const recipient = recRow as
        | { id: string; telegram_chat_id: string | null; display_name: string; is_active: boolean }
        | null

      const memo = await createMemo({
        repId: tenantE.id,
        senderMemberId: memberE.id,
        recipientMemberId: recipient?.id ?? null,
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

      // Clear pitch mode regardless of delivery outcome.
      await updateMember(memberE.id, {
        settings: {
          ...settings,
          pending_action: null,
          pending_pitch_lead_id: null,
          pending_pitch_lead_hint: null,
          pending_pitch_recipient_member_id: null,
        },
      })

      if (!recipient || !recipient.is_active || !recipient.telegram_chat_id) {
        await sendTelegramMessage(
          chatId,
          `🎙 Pitch saved, but ${recipient?.display_name ?? 'the recipient'} isn\u2019t reachable on Telegram yet. They can review it on /dashboard/feedback.`,
        )
        return NextResponse.json({ ok: true })
      }

      const res = await sendPitchToManager(memo, recipient, memberE.display_name, leadName)
      if (res.ok) {
        await sendTelegramMessage(
          chatId,
          `🎙 Pitch sent to *${recipient.display_name}*.${leadName ? `\nLead: *${leadName}*` : ''}\nThey\u2019ll choose *Now* or *Later* and you\u2019ll hear back.`,
        )
      } else {
        await sendTelegramMessage(
          chatId,
          `🎙 Couldn\u2019t deliver to ${recipient.display_name} on Telegram. Pitch is saved on /dashboard/feedback.`,
        )
      }
      return NextResponse.json({ ok: true })
    }
  }

  // ── Walkie mode: rep armed `/walkie <teammate>`; next voice goes to them ─
  // Same shape as pitch but with kind='note' so replies route via the
  // walkie reply handler above (no feedback semantics, no status flow).
  if (ctxEarly && incomingVoiceFileId) {
    const settings = (ctxEarly.member.settings ?? {}) as Record<string, unknown>
    if (settings.pending_action === 'walkie') {
      const tenantE = ctxEarly.tenant
      const memberE = ctxEarly.member
      const recipientId = (settings.pending_walkie_recipient_member_id as string | null) ?? null
      if (!recipientId) {
        await updateMember(memberE.id, {
          settings: { ...settings, pending_action: null, pending_walkie_recipient_member_id: null },
        })
        await sendTelegramMessage(chatId, 'No recipient on that walkie — re-run `/walkie <name>`.')
        return NextResponse.json({ ok: true })
      }

      const transcript = (await transcribeTelegramVoice(incomingVoiceFileId)) ?? null
      const { data: recRow } = await supabase
        .from('members')
        .select('id, telegram_chat_id, display_name, is_active')
        .eq('id', recipientId)
        .maybeSingle()
      const recipient = recRow as
        | { id: string; telegram_chat_id: string | null; display_name: string; is_active: boolean }
        | null

      const memo = await createMemo({
        repId: tenantE.id,
        senderMemberId: memberE.id,
        recipientMemberId: recipient?.id ?? null,
        kind: 'note',
        telegramFileId: incomingVoiceFileId,
        durationSeconds: msg.voice?.duration ?? msg.audio?.duration ?? null,
        transcript,
      })
      await archiveTelegramVoiceToStorage(incomingVoiceFileId, tenantE.id, memo.id)

      await updateMember(memberE.id, {
        settings: { ...settings, pending_action: null, pending_walkie_recipient_member_id: null },
      })

      if (!recipient || !recipient.is_active || !recipient.telegram_chat_id) {
        await sendTelegramMessage(
          chatId,
          `📡 Walkie saved, but ${recipient?.display_name ?? 'the teammate'} isn't reachable on Telegram yet.`,
        )
        return NextResponse.json({ ok: true })
      }

      const senderName = memberE.display_name || memberE.email
      const caption = `📡 *Walkie from ${senderName}*${transcript ? `\n_${transcript.length > 240 ? transcript.slice(0, 240) + '…' : transcript}_` : ''}\n\n_Reply to this message (voice or text) and I'll bounce it back._`
      const sent = await sendTelegramVoice(recipient.telegram_chat_id, incomingVoiceFileId, caption)
      if (sent.ok && sent.message_id) {
        await setMemoRelay(memo.id, recipient.telegram_chat_id, sent.message_id)
        await sendTelegramMessage(chatId, `📡 Walkie sent to *${recipient.display_name.split(/\s+/)[0]}*.`)
      } else {
        await sendTelegramMessage(
          chatId,
          `📡 Couldn't deliver walkie to ${recipient.display_name} on Telegram.`,
        )
      }
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
        '*Talk to teammates*',
        '• "Tell Sarah I\'m running 5 late" — I\'ll confirm the right person and relay it.',
        '• "Let the managers know we shifted the demo to Friday" — posts to the Manager Room.',
        '• "Owners only: revenue is tracking +12% MoM" — posts to the Owners Room.',
        '• Replies to my walkie/room messages thread back automatically.',
        '',
        '*Commands* (optional — speaking is fine)',
        '/link CODE — connect this Telegram to your dashboard',
        '/timezone America/New_York — set your local timezone',
        '/help — this menu',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── /pitch <recipient name> [about <lead>] ─────────────────────────────
  // Pitches ONLY relay when the rep names a recipient. No fan-out, no
  // auto-broadcast. The recipient must be a manager/admin/owner the rep is
  // attached to (resolved via team membership + account admins).
  // Forms accepted:
  //   /pitch                          → list available recipients
  //   /pitch sara                     → arms pitch to Sara
  //   /pitch sara about Dana Northwind→ + binds the pitch to lead "Dana Northwind"
  //   /pitch sara : Dana              → same, colon separator
  //   /pitch cancel                   → clears pitch mode
  const pitchMatch = text.match(/^\/pitch(?:\s+(.+))?$/i)
  if (pitchMatch) {
    if (!ctxEarly) {
      await sendTelegramMessage(
        chatId,
        "Link your account first with `/link YOURCODE`, then send `/pitch <manager-name>` to start a voice pitch.",
      )
      return NextResponse.json({ ok: true })
    }
    const settings = (ctxEarly.member.settings ?? {}) as Record<string, unknown>

    // /pitch cancel → clear any armed pitch mode.
    const argRaw = pitchMatch[1]?.trim() || ''
    if (/^cancel\b/i.test(argRaw)) {
      await updateMember(ctxEarly.member.id, {
        settings: {
          ...settings,
          pending_action: null,
          pending_pitch_lead_id: null,
          pending_pitch_lead_hint: null,
          pending_pitch_recipient_member_id: null,
        },
      })
      await sendTelegramMessage(chatId, '✅ Pitch cancelled. Nothing was sent.')
      return NextResponse.json({ ok: true })
    }

    // No args → show who they can pitch to and explain the command.
    if (!argRaw) {
      const candidates = await listPitchableManagers(ctxEarly.tenant.id, ctxEarly.member.id)
      const lines = [
        '*🎤 How to send a pitch*',
        '',
        '`/pitch <manager-name>` — names the only person who gets it.',
        '`/pitch <name> about <lead>` — also tags the lead.',
        '',
        candidates.length
          ? `*Who you can pitch:* ${candidates.map((c) => `*${c.display_name}*${c.telegram_chat_id ? '' : ' (not on Telegram yet)'}`).join(', ')}`
          : 'No managers or admins linked yet — ask your team to onboard first.',
        '',
        '_Pitches are *never* auto-broadcast. Only the person you name receives it._',
      ]
      await sendTelegramMessage(chatId, lines.join('\n'))
      return NextResponse.json({ ok: true })
    }

    // Split "name [about|: lead]"
    let recipientName = argRaw
    let leadArg = ''
    const aboutMatch = argRaw.match(/^(.+?)\s+(?:about|re|for|:)\s+(.+)$/i)
    if (aboutMatch) {
      recipientName = aboutMatch[1].trim()
      leadArg = aboutMatch[2].trim()
    }

    const recipient = await resolvePitchRecipient(
      ctxEarly.tenant.id,
      ctxEarly.member.id,
      recipientName,
    )
    if (!recipient) {
      const candidates = await listPitchableManagers(ctxEarly.tenant.id, ctxEarly.member.id)
      await sendTelegramMessage(
        chatId,
        [
          `Couldn\u2019t match *${recipientName}* to anyone you can pitch.`,
          candidates.length
            ? `Try one of: ${candidates.map((c) => `*${c.display_name.split(' ')[0]}*`).join(', ')}.`
            : 'No managers or admins linked to your account yet.',
        ].join('\n'),
      )
      return NextResponse.json({ ok: true })
    }

    // Resolve optional lead.
    let leadId: string | null = null
    let leadHint: string | null = leadArg || null
    if (leadArg) {
      const knownLeads = await getRecentLeadNames(ctxEarly.tenant.id, 80)
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
      const target = norm(leadArg)
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
        pending_pitch_recipient_member_id: recipient.id,
        pending_pitch_lead_id: leadId,
        pending_pitch_lead_hint: leadHint,
      },
    })
    await sendTelegramMessage(
      chatId,
      [
        `🎤 *Pitch armed* — your next voice goes to *${recipient.display_name}*${leadHint ? ` about *${leadHint}*` : ''}.`,
        '',
        'Send a *voice message* now (hold the mic). Only that one person will hear it.',
        '',
        'Send `/pitch cancel` to abort.',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── /walkie <teammate> ─────────────────────────────────────────────────
  // Walkie-talkie voice channel to a single teammate (any role). The next
  // voice message gets relayed to them; their reply bounces back. For text
  // walkies, just say "tell <name> ..." and the dm_member intent handles it.
  const walkieMatch = text.match(/^\/(?:walkie|dm)(?:\s+(.+))?$/i)
  if (walkieMatch) {
    if (!ctxEarly) {
      await sendTelegramMessage(chatId, "Link your account first with `/link YOURCODE`, then `/walkie <name>`.")
      return NextResponse.json({ ok: true })
    }
    const settings = (ctxEarly.member.settings ?? {}) as Record<string, unknown>
    const argRaw = walkieMatch[1]?.trim() || ''
    if (/^cancel\b/i.test(argRaw)) {
      await updateMember(ctxEarly.member.id, {
        settings: { ...settings, pending_action: null, pending_walkie_recipient_member_id: null },
      })
      await sendTelegramMessage(chatId, '✅ Walkie cancelled.')
      return NextResponse.json({ ok: true })
    }
    if (!argRaw) {
      await sendTelegramMessage(
        chatId,
        '*📡 Walkie-talkie*\n\n`/walkie <teammate>` — armed; your next voice goes only to them.\n`/walkie cancel` to abort.\n\nFor text walkies: just say _"tell Sarah I\'m running 5 late"_.',
      )
      return NextResponse.json({ ok: true })
    }
    const allMembers = await listMembers(ctxEarly.tenant.id)
    const target = matchMemberByName(allMembers, argRaw, ctxEarly.member.id)
    if (!target) {
      await sendTelegramMessage(chatId, `Couldn't match *${argRaw}* on your team.`)
      return NextResponse.json({ ok: true })
    }
    if (!target.telegram_chat_id) {
      await sendTelegramMessage(chatId, `${target.display_name} hasn't linked Telegram yet.`)
      return NextResponse.json({ ok: true })
    }
    await updateMember(ctxEarly.member.id, {
      settings: {
        ...settings,
        pending_action: 'walkie',
        pending_walkie_recipient_member_id: target.id,
      },
    })
    await sendTelegramMessage(
      chatId,
      `📡 *Walkie armed* — your next voice goes to *${target.display_name}*.\n\nSend `+ '`/walkie cancel`' + ' to abort.',
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

  // ── Pending confirmation: rescheduling or cancelling a meeting ─────────
  // We staged the change in the previous turn; this turn the rep replies
  // yes/no (or a number to pick a different candidate).
  {
    const settings = (member.settings ?? {}) as Record<string, unknown>
    const pending = settings.pending_action as string | undefined
    if (pending === 'reschedule_confirm' || pending === 'cancel_confirm') {
      const reply = await handlePendingCalendarConfirm(text, tenant, member, settings, pending)
      if (reply) {
        await sendTelegramMessage(chatId, reply)
        return NextResponse.json({ ok: true })
      }
    }
    if (pending === 'one_on_one_pick') {
      const reply = await handlePendingOneOnOnePick(text, tenant, member, settings)
      if (reply) {
        await sendTelegramMessage(chatId, reply)
        return NextResponse.json({ ok: true })
      }
    }
    if (pending === 'await_commission') {
      const callLogId = settings.pending_call_log_id as string | undefined
      const trimmed = (text ?? '').trim().toLowerCase()
      // Allow rep to skip ("skip" / "later" / "n/a")
      if (/^(skip|later|n\/?a|no|none)\b/.test(trimmed)) {
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_call_log_id: null },
        })
        await sendTelegramMessage(chatId, 'Got it — skipped. You can add it later by saying "commission on the Acme deal was $1,500".')
        return NextResponse.json({ ok: true })
      }
      const m = (text ?? '').match(/\$?\s?([\d]{1,3}(?:[,\d]{0,7})(?:\.\d{1,2})?)\s?(k|m|mm)?\b/i)
      if (m && callLogId) {
        const raw = parseFloat(m[1].replace(/,/g, ''))
        const mult = m[2]?.toLowerCase() === 'k' ? 1000 : (m[2]?.toLowerCase() === 'm' || m[2]?.toLowerCase() === 'mm') ? 1_000_000 : 1
        const value = Math.round(raw * mult * 100) / 100
        if (value > 0 && value <= 10_000_000) {
          await supabase
            .from('call_logs')
            .update({ commission_amount: value, commission_currency: 'USD' })
            .eq('id', callLogId)
            .eq('rep_id', tenant.id)
          await updateMember(member.id, {
            settings: { ...settings, pending_action: null, pending_call_log_id: null },
          })
          await sendTelegramMessage(chatId, `💰 Logged $${value.toLocaleString()} commission. Ask "commission this month" anytime for the running total.`)
          return NextResponse.json({ ok: true })
        }
      }
      await sendTelegramMessage(chatId, 'Send a number (e.g. `1500`, `$2,000`, `1.5k`) or `skip`.')
      return NextResponse.json({ ok: true })
    }
    if (pending === 'confirm_dm') {
      const recipientId = settings.pending_dm_recipient_id as string | undefined
      const message = settings.pending_dm_message as string | undefined
      const trimmed = (text ?? '').trim().toLowerCase()
      const isYes = /^(yes|y|yep|yeah|send|confirm|do it|go|ship it|sure|ok|okay)\b/.test(trimmed)
      if (!isYes) {
        await updateMember(member.id, {
          settings: {
            ...settings,
            pending_action: null,
            pending_dm_recipient_id: null,
            pending_dm_message: null,
          },
        })
        await sendTelegramMessage(chatId, 'Cancelled — nothing was sent.')
        return NextResponse.json({ ok: true })
      }
      if (!recipientId || !message) {
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_dm_recipient_id: null, pending_dm_message: null },
        })
        await sendTelegramMessage(chatId, 'Lost the draft — say it again and I\u2019ll re-confirm.')
        return NextResponse.json({ ok: true })
      }
      const { data: tRow } = await supabase
        .from('members')
        .select('id, telegram_chat_id, display_name')
        .eq('id', recipientId)
        .maybeSingle()
      const target = tRow as { id: string; telegram_chat_id: string | null; display_name: string } | null
      await updateMember(member.id, {
        settings: { ...settings, pending_action: null, pending_dm_recipient_id: null, pending_dm_message: null },
      })
      if (!target?.telegram_chat_id) {
        await sendTelegramMessage(chatId, 'They\u2019re no longer reachable on Telegram.')
        return NextResponse.json({ ok: true })
      }
      const senderName = member.display_name || member.email
      const body = `\ud83d\udcac *${senderName}* sent you a walkie\n\n${message}\n\n_Reply to this message and I'll bounce it back._`
      const memo = await createMemo({
        repId: tenant.id,
        senderMemberId: member.id,
        recipientMemberId: target.id,
        kind: 'note',
        transcript: message,
      })
      const sent = await sendTelegramMessage(target.telegram_chat_id, body)
      if (sent.ok && sent.message_id) {
        await setMemoRelay(memo.id, target.telegram_chat_id, sent.message_id)
      }
      const first = target.display_name.split(/\s+/)[0]
      await sendTelegramMessage(chatId, `\ud83d\udce1 Sent to *${first}*. I'll ping you when they reply.`)
      return NextResponse.json({ ok: true })
    }
    if (pending === 'confirm_room') {
      const audience = settings.pending_room_audience as string | undefined
      const message = settings.pending_room_message as string | undefined
      const trimmed = (text ?? '').trim().toLowerCase()
      const isYes = /^(yes|y|yep|yeah|send|confirm|do it|go|ship it|sure|ok|okay)\b/.test(trimmed)
      if (!isYes) {
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_room_audience: null, pending_room_message: null },
        })
        await sendTelegramMessage(chatId, 'Cancelled \u2014 nothing was sent.')
        return NextResponse.json({ ok: true })
      }
      if (!audience || !message) {
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_room_audience: null, pending_room_message: null },
        })
        await sendTelegramMessage(chatId, 'Lost the draft \u2014 say it again and I\u2019ll re-confirm.')
        return NextResponse.json({ ok: true })
      }
      try {
        const post = await createRoomMessage({
          repId: tenant.id,
          audience,
          senderMemberId: member.id,
          body: message,
          kind: 'text',
        })
        const { delivered } = await relayRoomMessage(post, member.display_name || member.email)
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_room_audience: null, pending_room_message: null },
        })
        const label = describeAudience(audience)
        await sendTelegramMessage(
          chatId,
          `\ud83d\udce1 Sent to ${label}. Delivered to ${delivered} ${delivered === 1 ? 'person' : 'people'}.`,
        )
      } catch (err) {
        console.error('[telegram] room_post relay failed', err)
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_room_audience: null, pending_room_message: null },
        })
        await sendTelegramMessage(chatId, 'Couldn\u2019t deliver \u2014 try again in a sec.')
      }
      return NextResponse.json({ ok: true })
    }
  }

  try {
    const knownLeads = await getRecentLeadNames(tenant.id, 40)
    const ownerMemberId = member.id

    const interp = await interpretTelegramMessage(
      text,
      tenant.display_name,
      knownLeads.map((l) => ({ name: l.name, company: l.company, status: l.status })),
      member.timezone || tenant.timezone || 'UTC',
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

      const newCall = await logCall({
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

      // Auto-extract deal value from the summary, e.g. "$12k", "50,000", "8k MRR".
      // Only if the lead doesn't already have a deal_value set (don't clobber).
      let dealValueAdded: number | null = null
      if (!updatedLead.deal_value) {
        const m = intent.summary.match(/\$?\s?([\d]{1,3}(?:[,\d]{0,7})(?:\.\d{1,2})?)\s?(k|m|mm)?\b/i)
        if (m) {
          const raw = parseFloat(m[1].replace(/,/g, ''))
          const mult = m[2]?.toLowerCase() === 'k' ? 1000 : m[2]?.toLowerCase() === 'm' || m[2]?.toLowerCase() === 'mm' ? 1_000_000 : 1
          const value = Math.round(raw * mult)
          // Only accept if it looks like a deal-value number (>= $500, <= $100M).
          if (value >= 500 && value <= 100_000_000) {
            const { error: dvErr } = await supabase
              .from('leads')
              .update({ deal_value: value, deal_currency: 'USD' })
              .eq('id', lead.id)
              .eq('rep_id', tenant.id)
            if (!dvErr) dealValueAdded = value
          }
        }
      }

      // Coaching-moment flag: when a deal is logged as closed_lost or as
      // having a "negative" outcome, ping the rep's manager(s) so they can
      // jump in with feedback while it's fresh.
      if (intent.outcome === 'closed_lost' || intent.outcome === 'negative') {
        try {
          const managers = await listPitchableManagers(tenant.id, callerMember.id)
          const repName = callerMember.display_name || callerMember.email
          const dealLabel = lead.deal_value ?? dealValueAdded
          const valueLine = dealLabel ? ` ($${dealLabel.toLocaleString()})` : ''
          const body = [
            `🚩 *Coaching moment* — ${repName} just logged a ${intent.outcome === 'closed_lost' ? 'lost deal' : 'tough call'}.`,
            ``,
            `*Lead:* ${lead.name}${lead.company ? ` (${lead.company})` : ''}${valueLine}`,
            `*Summary:* ${intent.summary.slice(0, 400)}`,
            intent.next_step ? `*Next step:* ${intent.next_step}` : '',
            ``,
            `Reply here with a voice memo or note and I'll relay it to ${repName.split(/\s+/)[0]}.`,
          ]
            .filter(Boolean)
            .join('\n')
          for (const mgr of managers) {
            if (!mgr.telegram_chat_id) continue
            await sendTelegramMessage(mgr.telegram_chat_id, body)
          }
        } catch (err) {
          console.error('[telegram] coaching-moment ping failed', err)
        }
      }

      const tail = intent.next_step ? ` · next: ${intent.next_step}` : ''
      const dvTail = dealValueAdded ? ` · 💰 $${dealValueAdded.toLocaleString()}` : ''

      // Closed-won → arm a follow-up to capture expected commission so the
      // "commission this month" intent has data to sum.
      if (intent.outcome === 'closed_won') {
        try {
          const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
          await updateMember(callerMember.id, {
            settings: { ...settingsNow, pending_action: 'await_commission', pending_call_log_id: newCall.id },
          })
          const dealLine = (lead.deal_value ?? dealValueAdded)
            ? ` (deal: $${(lead.deal_value ?? dealValueAdded)!.toLocaleString()})`
            : ''
          await sendTelegramMessage(
            callerMember.telegram_chat_id ?? '',
            [
              `🎉 *Closed won — ${lead.name}*${dealLine}!`,
              '',
              `What's your expected commission on this deal? Reply with a number (e.g. \`1500\`, \`$2,000\`, \`1.5k\`) or \`skip\`.`,
            ].join('\n'),
          )
          // Skip the standard reply this turn — we already sent a custom one.
          return null
        } catch (err) {
          console.error('[telegram] commission prompt failed', err)
        }
      }

      return `📞 Logged call with *${lead.name}*${intent.outcome ? ` (${intent.outcome.replace('_', ' ')})` : ''}${tail}${dvTail}`
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

    case 'reschedule_meeting':
    case 'cancel_meeting': {
      const tz = callerMember.timezone || tenant.timezone || 'UTC'
      const target = intent.lead_name
        ? knownLeads.find(
            (l) => l.name.toLowerCase() === intent.lead_name!.toLowerCase(),
          ) ??
          knownLeads.find((l) =>
            l.name.toLowerCase().includes(intent.lead_name!.toLowerCase()),
          )
        : null
      const who =
        target?.name ||
        intent.lead_name ||
        intent.contact_name ||
        ''
      if (!who) {
        return intent.kind === 'reschedule_meeting'
          ? "Who is the meeting with? Try: \"reschedule my call with Dana to Thursday 10am\"."
          : "Who is the meeting with? Try: \"cancel my call with Dana\"."
      }

      // Search the calendar. If we have a date hint, narrow the window.
      let fromIso: string | undefined
      let toIso: string | undefined
      if (intent.original_when) {
        const day = intent.original_when.slice(0, 10)
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          fromIso = `${day}T00:00:00Z`
          // 2-day window to absorb timezone offsets.
          toIso = new Date(new Date(fromIso).getTime() + 2 * 86400_000).toISOString()
        }
      }
      const events = await findCalendarEventsByQuery(
        tenant.id,
        target?.email || who,
        { fromIso, toIso, maxResults: 5 },
      )
      if (events === null) {
        return "Google Calendar isn't connected yet — link it on your dashboard so I can move events for you."
      }
      if (events.length === 0) {
        return `Couldn't find a calendar event matching *${who}*${intent.original_when ? ` around ${intent.original_when}` : ''}. Want me to book a new one instead?`
      }

      // Pick the soonest as the primary candidate; keep the rest as alts.
      const sorted = [...events].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      )
      const primary = sorted[0]
      const alts = sorted.slice(1)

      const settings = (callerMember.settings ?? {}) as Record<string, unknown>

      if (intent.kind === 'reschedule_meeting') {
        const newStart = intent.new_start_iso
        const duration =
          intent.new_duration_minutes ??
          Math.max(
            15,
            Math.round(
              (new Date(primary.end).getTime() - new Date(primary.start).getTime()) / 60_000,
            ) || 30,
          )
        await updateMember(callerMember.id, {
          settings: {
            ...settings,
            pending_action: 'reschedule_confirm',
            pending_calendar_event_id: primary.id,
            pending_calendar_new_start_iso: newStart,
            pending_calendar_new_duration_minutes: duration,
            pending_calendar_summary: primary.summary,
            pending_calendar_alts: alts.map((e) => ({
              id: e.id,
              start: e.start,
              end: e.end,
              summary: e.summary,
            })),
          },
        })
        const altsText =
          alts.length > 0
            ? `\n\nOr did you mean one of these? Reply with the number:\n${alts
                .map(
                  (e, i) =>
                    `${i + 2}. *${e.summary}* — ${formatLocalDateTime(e.start, tz)}`,
                )
                .join('\n')}`
            : ''
        return `🔁 The one with *${primary.summary}* on *${formatLocalDateTime(primary.start, tz)}* — move it to *${formatLocalDateTime(newStart, tz)}*, right?\n\nReply *yes* to confirm, *no* to cancel.${altsText}`
      } else {
        // cancel_meeting
        await updateMember(callerMember.id, {
          settings: {
            ...settings,
            pending_action: 'cancel_confirm',
            pending_calendar_event_id: primary.id,
            pending_calendar_summary: primary.summary,
            pending_calendar_alts: alts.map((e) => ({
              id: e.id,
              start: e.start,
              end: e.end,
              summary: e.summary,
            })),
          },
        })
        const altsText =
          alts.length > 0
            ? `\n\nOr did you mean one of these? Reply with the number:\n${alts
                .map(
                  (e, i) =>
                    `${i + 2}. *${e.summary}* — ${formatLocalDateTime(e.start, tz)}`,
                )
                .join('\n')}`
            : ''
        return `🗑 The one with *${primary.summary}* on *${formatLocalDateTime(primary.start, tz)}* — cancel it, right?\n\nReply *yes* to confirm, *no* to keep it.${altsText}`
      }
    }

    case 'request_one_on_one': {
      // Manager/admin asks to set up a 1-on-1 with someone on their team.
      // We pull free slots from the shared calendar (one Google connection
      // per account today), Telegram the teammate three options, and book
      // when they pick. The pending state lives on the *target* member.
      if (!isAtLeast(callerMember.role, 'manager')) {
        return "1-on-1 booking is for managers and admins. Want me to schedule a regular meeting instead?"
      }
      const tz = callerMember.timezone || tenant.timezone || 'UTC'
      const duration = intent.duration_minutes ?? 30

      // Find the teammate. Try exact display_name, then case-insensitive,
      // then first-name match. Exclude the caller.
      const allMembers = await listMembers(tenant.id)
      const candidates = allMembers.filter(
        (m) => m.id !== callerMember.id && m.is_active !== false,
      )
      const needle = intent.member_name.trim().toLowerCase()
      const target =
        candidates.find((m) => (m.display_name || '').toLowerCase() === needle) ||
        candidates.find((m) => (m.display_name || '').toLowerCase().includes(needle)) ||
        candidates.find((m) => (m.email || '').toLowerCase().split('@')[0] === needle) ||
        candidates.find((m) => {
          const first = (m.display_name || '').split(/\s+/)[0]?.toLowerCase()
          return first && first === needle
        })

      if (!target) {
        return `Couldn't find *${intent.member_name}* on your team. Add them as a member on the dashboard, then try again.`
      }
      if (!target.telegram_chat_id) {
        return `*${target.display_name}* hasn't linked Telegram yet — they need to /link first so I can send them slots.`
      }

      // Permission: caller must be admin+ OR target must share a managed team.
      const isAdminPlus = isAtLeast(callerMember.role, 'admin')
      if (!isAdminPlus) {
        const managed = await getManagedTeamIds(callerMember.id)
        if (managed.length > 0) {
          const { data: targetTeams } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('member_id', target.id)
          const targetTeamIds = (targetTeams ?? []).map((r) => (r as { team_id: string }).team_id)
          const overlap = targetTeamIds.some((id) => managed.includes(id))
          if (!overlap) {
            return `*${target.display_name}* isn't on a team you manage.`
          }
        }
      }

      // Resolve the search window from `within`.
      const { fromIso, toIso, label } = resolveOneOnOneWindow(intent.within ?? null, tz)

      const slots = await findFreeSlots(tenant.id, {
        fromIso,
        toIso,
        durationMinutes: duration,
        count: 3,
        tz,
      })
      if (slots === null) {
        return "Google Calendar isn't connected yet — link it on your dashboard so I can find open slots."
      }
      if (slots.length === 0) {
        return `No open slots ${label} for a ${duration}-min 1-on-1. Try "next week" or pick a specific day.`
      }

      // Stash the pending pick on the *target* member.
      const targetSettings = (target.settings ?? {}) as Record<string, unknown>
      await updateMember(target.id, {
        settings: {
          ...targetSettings,
          pending_action: 'one_on_one_pick',
          pending_one_on_one_from_member_id: callerMember.id,
          pending_one_on_one_from_name: callerMember.display_name || callerMember.email,
          pending_one_on_one_from_chat_id: callerMember.telegram_chat_id ?? null,
          pending_one_on_one_slots: slots,
          pending_one_on_one_duration: duration,
          pending_one_on_one_purpose: intent.purpose ?? null,
        },
      })

      const purposeLine = intent.purpose ? `\n_About:_ ${intent.purpose}` : ''
      const slotLines = slots
        .map((s, i) => `${i + 1}. ${formatLocalDateTime(s.startIso, target.timezone || tz)}`)
        .join('\n')
      const targetMsg = `📅 *${callerMember.display_name || callerMember.email}* wants a ${duration}-min 1-on-1.${purposeLine}\n\nReply with *1*, *2*, or *3* to lock it in — or *no* if none of these work and we'll find another time.\n\n${slotLines}`
      await sendTelegramMessage(target.telegram_chat_id, targetMsg)

      return `📨 Pinged *${target.display_name}* with 3 open slots ${label}. I'll book it as soon as they pick one.`
    }

    case 'pipeline_triage': {
      const count = Math.min(Math.max(intent.count ?? 5, 1), 15)
      const allLeads = await getAllLeads(tenant.id)
      // Member-scoped if a rep, otherwise see everything.
      const ownLeads = isAtLeast(callerMember.role, 'manager')
        ? allLeads
        : allLeads.filter((l) => !l.owner_member_id || l.owner_member_id === callerMember.id)
      const now = Date.now()
      const active = ownLeads.filter((l) => {
        if (l.status === 'dormant') return false
        if (l.snoozed_until && new Date(l.snoozed_until).getTime() > now) return false
        return true
      })
      // Score: hot=100, warm=60, cold=20; +deal_value/1000 capped at 50;
      // +days-since-last-contact (encourages overdue touches).
      const statusScore: Record<string, number> = { hot: 100, warm: 60, cold: 20 }
      const scored = active.map((l) => {
        const days = l.last_contact
          ? Math.floor((now - new Date(l.last_contact).getTime()) / 86_400_000)
          : 30
        const valueBoost = Math.min(50, (l.deal_value ?? 0) / 1000)
        const score = (statusScore[l.status] ?? 0) + Math.min(days, 30) + valueBoost
        return { lead: l, score, days }
      })
      scored.sort((a, b) => b.score - a.score)
      const top = scored.slice(0, count)
      if (top.length === 0) {
        return "Pipeline's empty (or all snoozed). Add a few prospects and I'll prioritize them for you."
      }
      return generateReport(
        'triage',
        {
          asked_for: count,
          leads: top.map((s) => ({
            name: s.lead.name,
            company: s.lead.company,
            status: s.lead.status,
            deal_value: s.lead.deal_value,
            days_since_contact: s.days,
            notes: (s.lead.notes ?? '').slice(0, 120),
          })),
        },
        tenant.display_name,
      )
    }

    case 'snooze_lead': {
      const lead = findLeadInList(knownLeads, intent.lead_name)
      if (!lead) return `Couldn't find *${intent.lead_name}* in your prospects.`
      let untilIso: string | null = null
      if (intent.until_date && /^\d{4}-\d{2}-\d{2}$/.test(intent.until_date)) {
        untilIso = `${intent.until_date}T09:00:00Z`
      } else if (intent.within) {
        const map: Record<string, number> = { '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1m': 30 }
        const days = map[intent.within] ?? 7
        untilIso = new Date(Date.now() + days * 86_400_000).toISOString()
      } else {
        untilIso = new Date(Date.now() + 7 * 86_400_000).toISOString()
      }
      const { error } = await supabase
        .from('leads')
        .update({ snoozed_until: untilIso })
        .eq('id', lead.id)
        .eq('rep_id', tenant.id)
      if (error) {
        console.error('[telegram] snooze_lead failed', error)
        return `Couldn't snooze *${lead.name}* — try again.`
      }
      const when = new Date(untilIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `🔕 Snoozed *${lead.name}* until ${when}. They'll pop back into triage then.`
    }

    case 'set_deal_value': {
      const lead = findLeadInList(knownLeads, intent.lead_name)
      if (!lead) return `Couldn't find *${intent.lead_name}* in your prospects.`
      const value = Math.round(intent.deal_value)
      if (!Number.isFinite(value) || value < 0) {
        return `That deal value didn't parse — try \"Acme is a $12k deal\".`
      }
      const { error } = await supabase
        .from('leads')
        .update({ deal_value: value, deal_currency: intent.currency || 'USD' })
        .eq('id', lead.id)
        .eq('rep_id', tenant.id)
      if (error) {
        console.error('[telegram] set_deal_value failed', error)
        return `Couldn't update *${lead.name}* — try again.`
      }
      return `💰 *${lead.name}* — deal value set to $${value.toLocaleString()}.`
    }

    case 'handoff_lead': {
      if (!isAtLeast(callerMember.role, 'manager')) {
        return "Lead reassignment is for managers and admins."
      }
      const lead = findLeadInList(knownLeads, intent.lead_name)
      if (!lead) return `Couldn't find *${intent.lead_name}* in your prospects.`
      const allMembers = await listMembers(tenant.id)
      const newOwner = matchMemberByName(allMembers, intent.to_member_name, callerMember.id)
      if (!newOwner) {
        return `Couldn't find *${intent.to_member_name}* on your team.`
      }
      const { error } = await supabase
        .from('leads')
        .update({ owner_member_id: newOwner.id })
        .eq('id', lead.id)
        .eq('rep_id', tenant.id)
      if (error) {
        console.error('[telegram] handoff_lead failed', error)
        return `Couldn't reassign *${lead.name}* — try again.`
      }
      // Notify the new owner if linked to Telegram.
      if (newOwner.telegram_chat_id) {
        const summary = `🤝 *${callerMember.display_name || callerMember.email}* handed *${lead.name}*${lead.company ? ` (${lead.company})` : ''} over to you.${lead.notes ? `\n\n_Notes:_ ${lead.notes.slice(0, 240)}` : ''}`
        await sendTelegramMessage(newOwner.telegram_chat_id, summary)
      }
      return `🤝 Reassigned *${lead.name}* to *${newOwner.display_name}*${newOwner.telegram_chat_id ? ' — pinged them with the context' : ''}.`
    }

    case 'objection_coach': {
      // Don't let the AI answer — route this to the rep's manager(s) and
      // surface it in the coaching dashboard. Real humans coach, not Claude.
      const managers = await listPitchableManagers(tenant.id, callerMember.id)
      const reachable = managers.filter((m) => m.telegram_chat_id)
      if (reachable.length === 0) {
        return "No manager is set up to coach yet — once a manager links Telegram I'll route this to them."
      }
      // One memo per manager so each one has their own relay tracking and
      // can reply directly. First reply wins; the dashboard shows them all.
      const repName = callerMember.display_name || callerMember.email
      const firstName = repName.split(/\s+/)[0]
      const body = [
        `🎯 *Coaching request from ${repName}*`,
        ``,
        `*Objection:* ${intent.objection}`,
        ``,
        `Reply to this message (voice or text) and I'll relay it back to ${firstName}.`,
      ].join('\n')
      let routed = 0
      for (const mgr of reachable) {
        try {
          const memo = await createMemo({
            repId: tenant.id,
            senderMemberId: callerMember.id,
            recipientMemberId: mgr.id,
            kind: 'coaching',
            transcript: intent.objection,
          })
          if (!mgr.telegram_chat_id) continue
          const sent = await sendTelegramMessage(mgr.telegram_chat_id, body)
          if (sent.ok && sent.message_id) {
            await setMemoRelay(memo.id, mgr.telegram_chat_id, sent.message_id)
            routed++
          }
        } catch (err) {
          console.error('[telegram] objection_coach memo failed', err)
        }
      }
      if (routed === 0) {
        return "Tried to route that to your manager but Telegram didn't accept it. Try again in a sec."
      }
      const names = reachable
        .slice(0, 3)
        .map((m) => m.display_name.split(/\s+/)[0])
        .join(', ')
      return `🎯 Sent your question to ${names}${reachable.length > 3 ? ` +${reachable.length - 3}` : ''}. I'll ping you back as soon as they reply.`
    }

    case 'rep_pulse': {
      if (!isAtLeast(callerMember.role, 'manager')) {
        return "Rep pulses are for managers and admins. Want your own pulse instead? Try \"how am I doing this week\"."
      }
      const allMembers = await listMembers(tenant.id)
      const subject = matchMemberByName(allMembers, intent.member_name, null)
      if (!subject) return `Couldn't find *${intent.member_name}* on your team.`
      // Permission: admin+ sees anyone; managers only their managed teams.
      if (!isAtLeast(callerMember.role, 'admin')) {
        const managed = await getManagedTeamIds(callerMember.id)
        if (managed.length > 0) {
          const { data: subjTeams } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('member_id', subject.id)
          const overlap = (subjTeams ?? []).some((r) =>
            managed.includes((r as { team_id: string }).team_id),
          )
          if (!overlap) return `*${subject.display_name}* isn't on a team you manage.`
        }
      }
      const period = intent.period ?? 'week'
      const since = new Date(
        Date.now() - (period === 'day' ? 1 : period === 'month' ? 30 : 7) * 86_400_000,
      ).toISOString()
      const { data: callsRaw } = await supabase
        .from('call_logs')
        .select('outcome, occurred_at, summary, contact_name')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', subject.id)
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
      const calls = (callsRaw ?? []) as Array<{
        outcome: string | null
        occurred_at: string
        summary: string
        contact_name: string
      }>
      const { data: leadsRaw } = await supabase
        .from('leads')
        .select('status, deal_value, last_contact')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', subject.id)
      const leads = (leadsRaw ?? []) as Array<{
        status: string
        deal_value: number | null
        last_contact: string | null
      }>
      return generateReport(
        'rep_pulse',
        {
          rep: subject.display_name,
          period,
          calls: {
            total: calls.length,
            booked: calls.filter((c) => c.outcome === 'booked').length,
            won: calls.filter((c) => c.outcome === 'closed_won').length,
            lost: calls.filter((c) => c.outcome === 'closed_lost').length,
          },
          recent_summaries: calls.slice(0, 5).map((c) => `${c.contact_name}: ${c.summary}`),
          pipeline: {
            hot: leads.filter((l) => l.status === 'hot').length,
            warm: leads.filter((l) => l.status === 'warm').length,
            cold: leads.filter((l) => l.status === 'cold').length,
            total_value: leads.reduce((sum, l) => sum + (l.deal_value ?? 0), 0),
          },
        },
        tenant.display_name,
      )
    }

    case 'leaderboard': {
      if (!isAtLeast(callerMember.role, 'admin')) {
        return "Leaderboards are admin/owner only."
      }
      const period = intent.period ?? 'week'
      const since = new Date(
        Date.now() -
          (period === 'day' ? 1 : period === 'month' ? 30 : period === 'quarter' ? 90 : 7) *
            86_400_000,
      ).toISOString()
      const allMembers = await listMembers(tenant.id)
      const eligible = allMembers.filter((m) => m.role !== 'observer' && m.is_active !== false)
      const { data: callsRaw } = await supabase
        .from('call_logs')
        .select('owner_member_id, outcome')
        .eq('rep_id', tenant.id)
        .gte('occurred_at', since)
      const calls = (callsRaw ?? []) as Array<{ owner_member_id: string | null; outcome: string | null }>
      const board = eligible
        .map((m) => {
          const own = calls.filter((c) => c.owner_member_id === m.id)
          return {
            name: m.display_name,
            calls: own.length,
            booked: own.filter((c) => c.outcome === 'booked').length,
            won: own.filter((c) => c.outcome === 'closed_won').length,
          }
        })
        .filter((r) => r.calls > 0)
        .sort((a, b) => {
          const metric = intent.metric ?? 'deals_closed'
          if (metric === 'calls') return b.calls - a.calls
          if (metric === 'meetings_booked') return b.booked - a.booked
          return b.won - a.won || b.booked - a.booked || b.calls - a.calls
        })
        .slice(0, 10)
      if (board.length === 0) {
        return `📊 No activity logged in the last ${period}. Once reps log calls it'll show up here.`
      }
      return generateReport('leaderboard', { period, metric: intent.metric ?? 'deals_closed', board }, tenant.display_name)
    }

    case 'forecast': {
      if (!isAtLeast(callerMember.role, 'admin')) {
        return "Forecasts are admin/owner only."
      }
      const period = intent.period ?? 'month'
      const allLeads = await getAllLeads(tenant.id)
      // Weight by status: hot=0.6, warm=0.3, cold=0.1, dormant=0.
      const weights: Record<string, number> = { hot: 0.6, warm: 0.3, cold: 0.1, dormant: 0 }
      const open = allLeads.filter((l) => (l.deal_value ?? 0) > 0)
      const weighted = open.reduce((s, l) => s + (l.deal_value ?? 0) * (weights[l.status] ?? 0), 0)
      const bestCase = open.reduce(
        (s, l) => s + (l.status === 'dormant' ? 0 : (l.deal_value ?? 0)),
        0,
      )
      const commit = open
        .filter((l) => l.status === 'hot')
        .reduce((s, l) => s + (l.deal_value ?? 0), 0)
      return generateReport(
        'forecast',
        {
          period,
          open_deals: open.length,
          commit_usd: Math.round(commit),
          weighted_usd: Math.round(weighted),
          best_case_usd: Math.round(bestCase),
          top_deals: open
            .filter((l) => l.status === 'hot' || l.status === 'warm')
            .sort((a, b) => (b.deal_value ?? 0) - (a.deal_value ?? 0))
            .slice(0, 5)
            .map((l) => ({ name: l.name, status: l.status, value: l.deal_value })),
        },
        tenant.display_name,
      )
    }

    case 'winloss': {
      const period = intent.period ?? 'month'
      const days = period === 'week' ? 7 : period === 'quarter' ? 90 : 30
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data: callsRaw } = await supabase
        .from('call_logs')
        .select('outcome, summary, contact_name')
        .eq('rep_id', tenant.id)
        .gte('occurred_at', since)
        .in('outcome', ['closed_won', 'closed_lost'])
        .order('occurred_at', { ascending: false })
        .limit(60)
      const calls = (callsRaw ?? []) as Array<{
        outcome: string | null
        summary: string
        contact_name: string
      }>
      const won = calls.filter((c) => c.outcome === 'closed_won')
      const lost = calls.filter((c) => c.outcome === 'closed_lost')
      if (calls.length === 0) {
        return `📊 No closed deals logged in the last ${days} days yet.`
      }
      return generateReport(
        'winloss',
        {
          period,
          counts: { won: won.length, lost: lost.length },
          win_rate_pct: Math.round((100 * won.length) / Math.max(1, calls.length)),
          won_summaries: won.slice(0, 8).map((c) => `${c.contact_name}: ${c.summary}`),
          lost_summaries: lost.slice(0, 8).map((c) => `${c.contact_name}: ${c.summary}`),
        },
        tenant.display_name,
      )
    }

    case 'announce': {
      if (!isAtLeast(callerMember.role, 'admin')) {
        return "Announcements are admin/owner only."
      }
      const audience = intent.audience ?? 'account'
      const allMembers = await listMembers(tenant.id)
      let recipients = allMembers.filter(
        (m) => m.id !== callerMember.id && m.is_active !== false && m.telegram_chat_id,
      )
      if (audience === 'team' && intent.team_name) {
        const { data: teamRow } = await supabase
          .from('teams')
          .select('id')
          .eq('rep_id', tenant.id)
          .ilike('name', intent.team_name)
          .maybeSingle()
        const teamId = (teamRow as { id: string } | null)?.id
        if (teamId) {
          const { data: tmRows } = await supabase
            .from('team_members')
            .select('member_id')
            .eq('team_id', teamId)
          const ids = new Set((tmRows ?? []).map((r) => (r as { member_id: string | null }).member_id))
          recipients = recipients.filter((m) => ids.has(m.id))
        }
      }
      if (recipients.length === 0) {
        return `📣 No one to ping (no linked Telegram chats${audience === 'team' ? ' in that team' : ''}).`
      }
      const body = `📣 *Announcement from ${callerMember.display_name || callerMember.email}*\n\n${intent.message}`
      let delivered = 0
      for (const r of recipients) {
        if (!r.telegram_chat_id) continue
        const ok = await sendTelegramMessage(r.telegram_chat_id, body)
        if (ok.ok) delivered++
      }
      return `📣 Announcement sent to ${delivered} ${delivered === 1 ? 'person' : 'people'}.`
    }

    case 'inbox_zero': {
      const days = Math.min(Math.max(intent.days ?? 3, 1), 30)
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
      const allLeads = await getAllLeads(tenant.id)
      const own = isAtLeast(callerMember.role, 'manager')
        ? allLeads
        : allLeads.filter((l) => !l.owner_member_id || l.owner_member_id === callerMember.id)
      const now = Date.now()
      const overdue = own.filter((l) => {
        if (l.status !== 'hot' && l.status !== 'warm') return false
        if (l.snoozed_until && new Date(l.snoozed_until).getTime() > now) return false
        if (!l.last_contact) return true
        return l.last_contact < cutoff
      })
      // Pull scheduled follow-ups so we can exclude leads that already have one queued.
      const leadIds = overdue.map((l) => l.id)
      const scheduled = new Set<string>()
      if (leadIds.length > 0) {
        const { data: tasks } = await supabase
          .from('brain_items')
          .select('content')
          .eq('rep_id', tenant.id)
          .eq('item_type', 'task')
          .eq('status', 'open')
          .gte('due_date', new Date().toISOString().slice(0, 10))
        for (const t of (tasks ?? []) as Array<{ content: string }>) {
          for (const l of overdue) {
            if (t.content.toLowerCase().includes(l.name.toLowerCase())) scheduled.add(l.id)
          }
        }
      }
      const stuck = overdue
        .filter((l) => !scheduled.has(l.id))
        .map((l) => ({
          name: l.name,
          company: l.company,
          status: l.status,
          days_since: l.last_contact
            ? Math.floor((now - new Date(l.last_contact).getTime()) / 86_400_000)
            : null,
          deal_value: l.deal_value,
        }))
        .sort((a, b) => (b.days_since ?? 999) - (a.days_since ?? 999))
        .slice(0, 12)
      if (stuck.length === 0) {
        return `📥 Inbox zero — no hot/warm leads waiting on you (within ${days} days).`
      }
      return generateReport('inbox_zero', { days, stuck }, tenant.display_name)
    }

    case 'commission_report': {
      const period = intent.period ?? 'month'
      const now = new Date()
      const start = new Date(now)
      if (period === 'day') start.setUTCHours(0, 0, 0, 0)
      else if (period === 'week') {
        const dow = (start.getUTCDay() + 6) % 7
        start.setUTCDate(start.getUTCDate() - dow)
        start.setUTCHours(0, 0, 0, 0)
      } else if (period === 'month') start.setUTCDate(1), start.setUTCHours(0, 0, 0, 0)
      else if (period === 'quarter') {
        const q = Math.floor(start.getUTCMonth() / 3) * 3
        start.setUTCMonth(q, 1), start.setUTCHours(0, 0, 0, 0)
      } else if (period === 'year') start.setUTCMonth(0, 1), start.setUTCHours(0, 0, 0, 0)
      const sinceIso = start.toISOString()

      // Reps see their own; managers/admins see the team total.
      let query = supabase
        .from('call_logs')
        .select('commission_amount, occurred_at, contact_name')
        .eq('rep_id', tenant.id)
        .not('commission_amount', 'is', null)
        .gte('occurred_at', sinceIso)
      if (!isAtLeast(callerMember.role, 'manager')) {
        query = query.eq('owner_member_id', callerMember.id)
      }
      const { data: rows } = await query
      const list = (rows ?? []) as Array<{ commission_amount: number; occurred_at: string; contact_name: string }>
      const total = list.reduce((sum, r) => sum + Number(r.commission_amount ?? 0), 0)
      const count = list.length
      if (count === 0) {
        return `💰 No commission logged yet for *${period}*. Log a closed_won call and I'll ask you the commission amount.`
      }
      const top = [...list].sort((a, b) => b.commission_amount - a.commission_amount).slice(0, 5)
      const lines = [
        `💰 *Commission · ${period}* — $${Math.round(total).toLocaleString()} across ${count} deal${count === 1 ? '' : 's'}`,
        '',
        ...top.map((r) => `• ${r.contact_name}: $${Math.round(r.commission_amount).toLocaleString()}`),
      ]
      return lines.join('\n')
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

      // Visibility (who actually sees this goal). Reps can only set 'all'.
      // Managers can set 'all' or 'managers'. Admins/owners can set anything.
      let visibility: 'all' | 'managers' | 'owners' = 'all'
      if (intent.visibility === 'owners' && isAdmin) visibility = 'owners'
      else if (intent.visibility === 'managers' && isManager) visibility = 'managers'
      else if (intent.visibility === 'all' || !intent.visibility) visibility = 'all'

      const t = await setTarget({
        repId: tenant.id,
        periodType: intent.period_type,
        metric: intent.metric,
        targetValue: intent.target_value,
        notes: intent.notes ?? null,
        ownerMemberId,
        teamId,
        scope,
        visibility,
      })

      if (scope !== 'personal') {
        try {
          const { delivered } = await broadcastNewTeamGoal(
            t,
            callerMember.display_name || callerMember.email,
            teamName,
          )
          const scopeLabel = scope === 'account' ? 'the account' : teamName ? `the ${teamName} team` : 'the team'
          const visTag = visibility === 'owners' ? ' · _owners only_' : visibility === 'managers' ? ' · _managers only_' : ''
          return `🎯 ${scope === 'account' ? 'Account' : 'Team'} goal locked in: *${t.target_value} ${t.metric.replace('_', ' ')}* this ${t.period_type} for ${scopeLabel}${visTag}. Pinged ${delivered} ${delivered === 1 ? 'member' : 'members'}.`
        } catch (err) {
          console.error('[telegram webhook] team broadcast failed', err)
          return `🎯 Goal saved, but I couldn't ping the team — check Telegram links on the dashboard.`
        }
      }
      const visTag = visibility === 'owners' ? ' · _owners only_' : visibility === 'managers' ? ' · _managers only_' : ''
      return `🎯 Target locked in: *${t.target_value} ${t.metric.replace('_', ' ')}* this ${t.period_type}${visTag}.`
    }

    case 'report': {
      const reply = await runReport(intent.report_type, intent.lead_name ?? null, tenant)
      return reply
    }

    case 'dm_member': {
      const allMembers = await listMembers(tenant.id)
      const target = matchMemberByName(allMembers, intent.member_name, callerMember.id)
      if (!target) return `Couldn't find *${intent.member_name}* on your team. Who did you mean?`
      if (!target.telegram_chat_id) {
        return `${target.display_name} hasn't linked Telegram yet — can't relay.`
      }
      // Stage a confirmation. Don't send until the rep says "yes". Avoids
      // mis-routed messages from a fuzzy name match.
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'confirm_dm',
          pending_dm_recipient_id: target.id,
          pending_dm_message: intent.message,
        },
      })
      const preview = intent.message.length > 200 ? intent.message.slice(0, 200) + '…' : intent.message
      return [
        `📡 Send to *${target.display_name}*?`,
        '',
        `_"${preview}"_`,
        '',
        'Reply *yes* to send, or anything else to cancel.',
      ].join('\n')
    }

    case 'room_post': {
      let audienceKey: string
      let audienceLabel: string
      if (intent.audience === 'managers') {
        if (!isAtLeast(callerMember.role, 'manager')) {
          return "The managers room is for managers, admins, and owners only."
        }
        audienceKey = 'managers'
        audienceLabel = 'the Manager Room'
      } else if (intent.audience === 'owners') {
        if (!isAtLeast(callerMember.role, 'admin')) {
          return "The owners room is for admins and owners only."
        }
        audienceKey = 'owners'
        audienceLabel = 'the Owners Room'
      } else {
        // team
        let teamId: string | null = null
        let teamName: string | null = null
        if (intent.team_name) {
          const { data: row } = await supabase
            .from('teams')
            .select('id, name')
            .eq('rep_id', tenant.id)
            .ilike('name', intent.team_name)
            .maybeSingle()
          if (row) {
            teamId = (row as { id: string }).id
            teamName = (row as { name: string }).name
          }
        }
        if (!teamId) {
          if (isAtLeast(callerMember.role, 'manager')) {
            const managed = await getManagedTeamIds(callerMember.id)
            if (managed.length > 0) teamId = managed[0]
          }
        }
        if (!teamId) return `Which team did you want to message? I couldn't match *${intent.team_name ?? '—'}*.`
        if (!teamName) {
          const { data: trow } = await supabase.from('teams').select('name').eq('id', teamId).maybeSingle()
          teamName = (trow as { name: string } | null)?.name ?? 'team'
        }
        audienceKey = `team:${teamId}`
        audienceLabel = `the ${teamName} team room`
      }

      // Count receivers (excluding sender) so we can show "send to N people?".
      const receivers = (await listAudience(tenant.id, audienceKey)).filter(
        (m) => m.id !== callerMember.id && m.telegram_chat_id,
      )
      if (receivers.length === 0) {
        return `Nobody else is reachable in ${audienceLabel} yet.`
      }

      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'confirm_room',
          pending_room_audience: audienceKey,
          pending_room_message: intent.message,
        },
      })
      const preview = intent.message.length > 200 ? intent.message.slice(0, 200) + '…' : intent.message
      const names = receivers.slice(0, 5).map((r) => r.display_name.split(/\s+/)[0]).join(', ')
      const more = receivers.length > 5 ? ` +${receivers.length - 5}` : ''
      return [
        `📡 Post to ${audienceLabel} (${receivers.length} ${receivers.length === 1 ? 'person' : 'people'}: ${names}${more})?`,
        '',
        `_"${preview}"_`,
        '',
        'Reply *yes* to send, or anything else to cancel.',
      ].join('\n')
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

// ── Lead/member name matching helpers ─────────────────────────────────────

function findLeadInList(leads: Lead[], query: string): Lead | null {
  if (!query) return null
  const q = query.trim().toLowerCase()
  if (!q) return null
  return (
    leads.find((l) => l.name.toLowerCase() === q) ||
    leads.find((l) => (l.company || '').toLowerCase() === q) ||
    leads.find((l) => l.name.toLowerCase().includes(q)) ||
    leads.find((l) => (l.company || '').toLowerCase().includes(q)) ||
    null
  )
}

function matchMemberByName(
  members: Member[],
  query: string,
  excludeId: string | null,
): Member | null {
  if (!query) return null
  const q = query.trim().toLowerCase()
  if (!q) return null
  const pool = members.filter(
    (m) => (excludeId ? m.id !== excludeId : true) && m.is_active !== false,
  )
  return (
    pool.find((m) => (m.display_name || '').toLowerCase() === q) ||
    pool.find((m) => (m.display_name || '').toLowerCase().includes(q)) ||
    pool.find((m) => (m.email || '').toLowerCase().split('@')[0] === q) ||
    pool.find((m) => {
      const first = (m.display_name || '').split(/\s+/)[0]?.toLowerCase()
      return first && first === q
    }) ||
    null
  )
}

// ── Calendar confirmation helpers ─────────────────────────────────────────

function formatLocalDateTime(iso: string, timeZone: string): string {
  if (!iso) return '(no time)'
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}

type PendingCalendarAlt = {
  id: string
  start: string
  end: string
  summary: string
}

async function clearPendingCalendar(member: Member, settings: Record<string, unknown>) {
  await updateMember(member.id, {
    settings: {
      ...settings,
      pending_action: null,
      pending_calendar_event_id: null,
      pending_calendar_new_start_iso: null,
      pending_calendar_new_duration_minutes: null,
      pending_calendar_summary: null,
      pending_calendar_alts: null,
    },
  })
}

/**
 * Handle the rep's reply when they're sitting on a pending reschedule/cancel
 * confirmation. Returns the reply string to send (and the caller is responsible
 * for sending it), or null if the message wasn't a recognised confirmation
 * answer (so the normal interpret flow runs).
 */
async function handlePendingCalendarConfirm(
  rawText: string,
  tenant: Tenant,
  member: Member,
  settings: Record<string, unknown>,
  pending: 'reschedule_confirm' | 'cancel_confirm',
): Promise<string | null> {
  const text = rawText.trim().toLowerCase()
  if (!text) return null

  const tz = member.timezone || tenant.timezone || 'UTC'
  const eventId = (settings.pending_calendar_event_id as string | null) ?? null
  const summary = (settings.pending_calendar_summary as string | null) ?? 'meeting'
  const alts = (settings.pending_calendar_alts as PendingCalendarAlt[] | null) ?? []

  const yes = /^(y|yes|yep|yeah|yup|confirm|do it|sure|ok|okay|please)\b/.test(text)
  const no = /^(n|no|nope|cancel|stop|don'?t|nevermind|never mind|abort)\b/.test(text)
  // "2", "3" → pick alt at that position. Primary was 1 (already shown).
  const numMatch = text.match(/^(\d+)\b/)

  // Detect time/date hints inside the reply ("yes, but at 10am", "make it
  // friday at 2pm"). If present, we re-run the interpreter to extract a new
  // start_iso so the rep can confirm + adjust in a single message.
  const timeHint =
    /\b(\d{1,2}(:\d{2})?\s*(am|pm)|\d{1,2}:\d{2}|noon|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+(min|minute|hour|day))/i.test(
      rawText,
    )

  if (no) {
    await clearPendingCalendar(member, settings)
    return pending === 'reschedule_confirm'
      ? '👍 Cancelled — left your calendar alone.'
      : '👍 Cancelled — kept the meeting on your calendar.'
  }

  if (numMatch) {
    const n = parseInt(numMatch[1], 10)
    if (n === 1) {
      // Treat "1" same as yes — they re-affirmed the primary.
    } else if (n >= 2 && alts.length >= n - 1) {
      const chosen = alts[n - 2]
      // Re-stage with the new primary, keep the same new_start / new_duration.
      const newAlts = alts.filter((_, i) => i !== n - 2)
      await updateMember(member.id, {
        settings: {
          ...settings,
          pending_calendar_event_id: chosen.id,
          pending_calendar_summary: chosen.summary,
          pending_calendar_alts: newAlts,
        },
      })
      if (pending === 'reschedule_confirm') {
        const newStart = (settings.pending_calendar_new_start_iso as string) ?? ''
        return `🔁 The one with *${chosen.summary}* on *${formatLocalDateTime(chosen.start, tz)}* — move it to *${formatLocalDateTime(newStart, tz)}*, right?\n\nReply *yes* to confirm, *no* to cancel.`
      }
      return `🗑 The one with *${chosen.summary}* on *${formatLocalDateTime(chosen.start, tz)}* — cancel it, right?\n\nReply *yes* to confirm, *no* to keep it.`
    } else {
      return `That number isn't on the list. Reply *yes* to confirm the first one, *no* to cancel, or pick a number that was shown.`
    }
  }

  if (!yes && !numMatch) {
    // No yes/no/number, but a time hint while we're awaiting a reschedule
    // confirmation → treat as an adjusted-confirm ("at 10am please").
    if (pending === 'reschedule_confirm' && timeHint) {
      // fall through to YES path; the time-hint branch below will pull the
      // new time out of the reply.
    } else {
      // Not a clear yes/no/number → let the normal interpret flow handle it
      // (so "actually move it to Friday" still works). Clear pending state so
      // we don't loop.
      await clearPendingCalendar(member, settings)
      return null
    }
  }

  // YES path → execute.
  if (!eventId) {
    await clearPendingCalendar(member, settings)
    return "Lost track of which event you meant — try the reschedule again."
  }

  if (pending === 'reschedule_confirm') {
    let newStart = (settings.pending_calendar_new_start_iso as string) ?? ''
    let duration = (settings.pending_calendar_new_duration_minutes as number) ?? 30

    // "yes, but at 10am" / "yes, friday at 2pm" / bare "at 10am please" — pull
    // the new time out of the confirmation reply and use it. We re-run the
    // interpreter and look for a fresh reschedule_meeting / book_meeting
    // intent's start time.
    if (timeHint) {
      try {
        // Phrase it as a complete reschedule instruction so Claude reliably
        // emits a reschedule_meeting / book_meeting with start_iso, even when
        // the rep just sent a fragment like "at 10am please".
        const synthetic = `Reschedule the meeting "${summary}" — ${rawText}`
        const re = await interpretTelegramMessage(synthetic, tenant.display_name, [], tz)
        const adjusted = re.intents.find(
          (i) => i.kind === 'reschedule_meeting' || i.kind === 'book_meeting',
        )
        if (adjusted) {
          if (adjusted.kind === 'reschedule_meeting') {
            newStart = adjusted.new_start_iso || newStart
            if (typeof adjusted.new_duration_minutes === 'number') {
              duration = adjusted.new_duration_minutes
            }
          } else {
            newStart = adjusted.start_iso || newStart
            if (typeof adjusted.duration_minutes === 'number') {
              duration = adjusted.duration_minutes
            }
          }
        }
      } catch (err) {
        console.error('[telegram] confirm-time reinterpret failed', err)
      }
    }

    if (!newStart) {
      await clearPendingCalendar(member, settings)
      return "Lost the new time — try the reschedule again."
    }
    const newEnd = new Date(new Date(newStart).getTime() + duration * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
    const patched = await patchCalendarEvent(tenant.id, eventId, {
      startIso: newStart,
      endIso: newEnd,
      timezone: tz,
    })
    await clearPendingCalendar(member, settings)
    if (!patched) {
      return "Couldn't update Google Calendar — the event may have been deleted, or your Google connection needs a refresh."
    }
    return `✅ Moved *${summary}* to *${formatLocalDateTime(newStart, tz)}*.`
  } else {
    const ok = await deleteCalendarEvent(tenant.id, eventId)
    await clearPendingCalendar(member, settings)
    if (!ok) {
      return "Couldn't delete the event on Google Calendar — try again or remove it manually."
    }
    return `✅ Cancelled *${summary}*.`
  }
}

// ── 1-on-1 booking helpers ────────────────────────────────────────────────

/**
 * Map a `within` hint ("tomorrow", "this_week", "next_week", YYYY-MM-DD,
 * null) to a UTC ISO window suitable for free/busy lookups, plus a short
 * human label for the manager's confirmation reply. Default = next 7 days.
 */
function resolveOneOnOneWindow(
  within: string | null,
  tz: string,
): { fromIso: string; toIso: string; label: string } {
  const now = new Date()
  // Parse `now` into the rep's local Y-M-D so we can do day math relative
  // to their timezone instead of UTC.
  let localY = now.getUTCFullYear()
  let localM = now.getUTCMonth() + 1
  let localD = now.getUTCDate()
  let localDow = 0
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
    const parts = fmt.formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    localY = parseInt(get('year'), 10) || localY
    localM = parseInt(get('month'), 10) || localM
    localD = parseInt(get('day'), 10) || localD
    const wd = get('weekday')
    localDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
    if (localDow < 0) localDow = 0
  } catch {
    // fall through with UTC values
  }

  // Helper: build an ISO timestamp from a local Y-M-D + hour:min in `tz`.
  // Uses noon UTC of the date as a stable anchor; the free/busy API just
  // needs UTC instants so a wide window is fine.
  const dayUtcStart = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString()
  const addDays = (y: number, m: number, d: number, days: number) => {
    const t = new Date(Date.UTC(y, m - 1, d)).getTime() + days * 86_400_000
    const x = new Date(t)
    return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }
  }

  // Specific date.
  if (within && /^\d{4}-\d{2}-\d{2}$/.test(within)) {
    const y = parseInt(within.slice(0, 4), 10)
    const m = parseInt(within.slice(5, 7), 10)
    const d = parseInt(within.slice(8, 10), 10)
    const next = addDays(y, m, d, 1)
    return {
      fromIso: dayUtcStart(y, m, d),
      toIso: dayUtcStart(next.y, next.m, next.d),
      label: `on ${within}`,
    }
  }

  if (within === 'tomorrow') {
    const t1 = addDays(localY, localM, localD, 1)
    const t2 = addDays(localY, localM, localD, 2)
    return {
      fromIso: dayUtcStart(t1.y, t1.m, t1.d),
      toIso: dayUtcStart(t2.y, t2.m, t2.d),
      label: 'tomorrow',
    }
  }

  if (within === 'next_week') {
    // Next Monday → following Sunday.
    const daysToNextMon = ((8 - localDow) % 7) || 7
    const start = addDays(localY, localM, localD, daysToNextMon)
    const end = addDays(start.y, start.m, start.d, 7)
    return {
      fromIso: dayUtcStart(start.y, start.m, start.d),
      toIso: dayUtcStart(end.y, end.m, end.d),
      label: 'next week',
    }
  }

  // 'this_week' or null/anything else → now → end of this work week, with
  // a 7-day fallback for late-week requests.
  const daysToFri = (5 - localDow + 7) % 7
  const span = Math.max(daysToFri + 1, 7)
  const end = addDays(localY, localM, localD, span)
  return {
    fromIso: now.toISOString(),
    toIso: dayUtcStart(end.y, end.m, end.d),
    label: within === 'this_week' ? 'this week' : 'in the next 7 days',
  }
}

/**
 * Handle the *target* member's reply when they're sitting on a pending
 * 1-on-1 slot pick. Returns the reply string for the target (caller sends
 * it). Also pings the manager with the booking outcome.
 */
async function handlePendingOneOnOnePick(
  rawText: string,
  tenant: Tenant,
  member: Member,
  settings: Record<string, unknown>,
): Promise<string | null> {
  const text = rawText.trim().toLowerCase()
  if (!text) return null

  const slots = (settings.pending_one_on_one_slots as Array<{ startIso: string; endIso: string }> | null) ?? []
  const fromName = (settings.pending_one_on_one_from_name as string | null) ?? 'your manager'
  const fromChatId = (settings.pending_one_on_one_from_chat_id as string | null) ?? null
  const fromMemberId = (settings.pending_one_on_one_from_member_id as string | null) ?? null
  const purpose = (settings.pending_one_on_one_purpose as string | null) ?? null
  const tz = member.timezone || tenant.timezone || 'UTC'

  const clear = async () => {
    await updateMember(member.id, {
      settings: {
        ...settings,
        pending_action: null,
        pending_one_on_one_from_member_id: null,
        pending_one_on_one_from_name: null,
        pending_one_on_one_from_chat_id: null,
        pending_one_on_one_slots: null,
        pending_one_on_one_duration: null,
        pending_one_on_one_purpose: null,
      },
    })
  }

  const noMatch = /^(no|none|nope|skip|cancel|stop|not now|none of those|other time|different time)\b/.test(text)
  if (noMatch) {
    await clear()
    if (fromChatId) {
      await sendTelegramMessage(
        fromChatId,
        `🛑 *${member.display_name}* couldn't make any of those slots — ping them with a different window.`,
      )
    }
    return `👍 Told *${fromName}* none of those work. They'll send another window.`
  }

  const numMatch = text.match(/^(\d)\b/)
  if (!numMatch) {
    // Not a clear pick → let normal flow run.
    return null
  }
  const idx = parseInt(numMatch[1], 10) - 1
  if (idx < 0 || idx >= slots.length) {
    return `Reply with *1*, *2*, or *3* to pick a slot — or *no* to ask for a different time.`
  }
  const chosen = slots[idx]

  // Build event with both as attendees on the tenant calendar (today there's
  // one shared Google connection per account; the event will land on that
  // calendar and invite both addresses).
  const summary = purpose
    ? `1:1 — ${fromName} & ${member.display_name} (${purpose})`
    : `1:1 — ${fromName} & ${member.display_name}`
  const attendees: Array<{ email: string; displayName?: string }> = []
  if (member.email) attendees.push({ email: member.email, displayName: member.display_name })
  // Look up the manager's email so they get the invite too.
  if (fromMemberId) {
    const { data: mgr } = await supabase
      .from('members')
      .select('email, display_name')
      .eq('id', fromMemberId)
      .maybeSingle()
    const mgrRow = mgr as { email: string | null; display_name: string | null } | null
    if (mgrRow?.email) {
      attendees.push({ email: mgrRow.email, displayName: mgrRow.display_name ?? undefined })
    }
  }

  const ev = await createCalendarEvent({
    repId: tenant.id,
    summary,
    description: `Booked via Virtual Closer — internal 1-on-1.`,
    startIso: chosen.startIso,
    endIso: chosen.endIso,
    timezone: tz,
    attendees: attendees.length > 0 ? attendees : undefined,
  })
  await clear()

  const when = formatLocalDateTime(chosen.startIso, tz)
  if (!ev) {
    if (fromChatId) {
      await sendTelegramMessage(
        fromChatId,
        `⚠️ *${member.display_name}* picked ${when}, but I couldn't reach Google Calendar. Add it manually.`,
      )
    }
    return `Got it for ${when} — but I couldn't write it to Google Calendar. Your manager will follow up.`
  }
  if (fromChatId) {
    await sendTelegramMessage(
      fromChatId,
      `✅ *${member.display_name}* locked in *${when}* for your 1-on-1 — on both calendars.`,
    )
  }
  return `✅ Booked *${when}* with ${fromName} — invite is on your calendar.`
}

