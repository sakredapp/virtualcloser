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
  extractBulkLeads,
  type TelegramIntent,
} from '@/lib/claude'
import { runAgent } from '@/lib/agent/runAgent'
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
import { BlueBubbles } from '@/lib/bluebubbles'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { broadcastNewTeamGoal } from '@/lib/team-goals'
import { createDeferredItem, type DeferredSource } from '@/lib/deferred'
import { mirrorLeadToGHL } from '@/lib/crm-sync'
import {
  createCard as createKpiCard,
  findCard as findKpiCard,
  findAnyCardForMetric,
  listKpiCards,
  logEntry as logKpiEntry,
  normalizeMetric,
  isCurrencyMetric,
  type KpiCard,
} from '@/lib/kpi-cards'
import { sendFeatureRequest } from '@/lib/email'
import type { Lead, LeadStatus, Member } from '@/types'

export const dynamic = 'force-dynamic'

/** Fuzzy-match a pipeline stage by name for the given tenant. */
async function findStageByNameForTenant(
  repId: string,
  stageName: string,
): Promise<{ id: string; pipeline_id: string; name: string } | null> {
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id, pipeline_id, name')
    .eq('rep_id', repId)
  if (!data?.length) return null
  const lower = stageName.toLowerCase()
  const rows = data as Array<{ id: string; pipeline_id: string; name: string }>
  return (
    rows.find((s) => s.name.toLowerCase() === lower) ??
    rows.find(
      (s) =>
        s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()),
    ) ??
    null
  )
}

/**
 * Telegram webhook — the rep's operations brain.
 * Any plain message gets routed by Claude into CRM updates, new prospects,
 * scheduled follow-ups, and generic brain-items.
 */

type TgUser = { id: number; first_name?: string; username?: string }
type TgChat = { id: number; type: string }
type TgVoice = { file_id: string; duration?: number; mime_type?: string }
type TgAudio = { file_id: string; duration?: number; mime_type?: string }
type TgDocument = { file_id: string; mime_type?: string; file_name?: string }
type TgMessage = {
  message_id: number
  from?: TgUser
  chat: TgChat
  text?: string
  voice?: TgVoice
  audio?: TgAudio
  document?: TgDocument
  reply_to_message?: {
    message_id: number
    text?: string
    caption?: string
    from?: TgUser
  }
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
          'Reply to the recording above with a *voice message* (or text `ready` / `needs work` / free-form notes). I\'ll relay it to the rep.',
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

    // ── Assigned-task buttons (Got it now / later / Decline) ────────────
    const taskMatch = data.match(/^task:(now|later|accept|decline):([0-9a-f-]{36})$/i)
    if (taskMatch) {
      const action = taskMatch[1].toLowerCase() as 'now' | 'later' | 'accept' | 'decline'
      const taskId = taskMatch[2]
      const { data: tRow } = await supabase
        .from('brain_items')
        .select('id, content, owner_member_id, brain_dump_id, status, rep_id')
        .eq('id', taskId)
        .maybeSingle()
      const task = tRow as {
        id: string
        content: string
        owner_member_id: string | null
        brain_dump_id: string | null
        status: string
        rep_id: string
      } | null
      if (!task || task.rep_id !== ctxCb.tenant.id) {
        await answerCallbackQuery(cq.id, 'Task not found.')
        return NextResponse.json({ ok: true })
      }
      // Only the assignee (or admins/owners) can react.
      const isAssignee = task.owner_member_id === ctxCb.member.id
      const isAdmin = ctxCb.member.role === 'owner' || ctxCb.member.role === 'admin'
      if (!isAssignee && !isAdmin) {
        await answerCallbackQuery(cq.id, 'Not addressed to you.')
        return NextResponse.json({ ok: true })
      }
      // Look up the assigner via the brain_dump's owner_member_id (we stamped
      // the assigner there at create time using the rawText prefix).
      let assignerId: string | null = null
      if (task.brain_dump_id) {
        const { data: dRow } = await supabase
          .from('brain_dumps')
          .select('raw_text')
          .eq('id', task.brain_dump_id)
          .maybeSingle()
        const rawText = (dRow as { raw_text: string } | null)?.raw_text ?? ''
        const m = rawText.match(/^\[assigned-by:([0-9a-f-]{36})\]/i)
        if (m) assignerId = m[1]
      }
      const { data: aRow } = assignerId
        ? await supabase
            .from('members')
            .select('id, telegram_chat_id, display_name')
            .eq('id', assignerId)
            .maybeSingle()
        : { data: null }
      const assigner = aRow as { id: string; telegram_chat_id: string | null; display_name: string } | null

      if (action === 'decline') {
        await supabase
          .from('brain_items')
          .update({ status: 'dismissed', updated_at: new Date().toISOString() })
          .eq('id', task.id)
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        await answerCallbackQuery(cq.id, 'Declined.')
        await sendTelegramMessage(
          cbChatId,
          `🚫 Declined: *${task.content}*. The assigner has been told.`,
          { replyToMessageId: cbMessageId },
        )
        if (assigner?.telegram_chat_id) {
          await sendTelegramMessage(
            assigner.telegram_chat_id,
            `🚫 *${ctxCb.member.display_name}* declined the task you sent: *${task.content}*.`,
          )
        }
        return NextResponse.json({ ok: true })
      }

      // 'now' / 'later' / 'accept' — keep status open, set horizon/priority.
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (action === 'now') {
        updates.horizon = 'day'
        updates.priority = 'high'
      } else if (action === 'later') {
        updates.horizon = 'week'
      }
      await supabase.from('brain_items').update(updates).eq('id', task.id)
      await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
      const ackLabel =
        action === 'now' ? 'Locked in for today.' : action === 'later' ? 'Queued for later.' : 'Accepted.'
      await answerCallbackQuery(cq.id, ackLabel)
      await sendTelegramMessage(
        cbChatId,
        `✅ ${ackLabel} *${task.content}* is on your list.`,
        { replyToMessageId: cbMessageId },
      )
      if (assigner?.telegram_chat_id) {
        const verb =
          action === 'now'
            ? 'is on it now'
            : action === 'later'
              ? 'will get to it later'
              : 'accepted the task'
        await sendTelegramMessage(
          assigner.telegram_chat_id,
          `✅ *${ctxCb.member.display_name}* ${verb}: *${task.content}*.`,
        )
      }
      return NextResponse.json({ ok: true })
    }

    // ── iMessage confirm-send / cancel ──────────────────────────────────
    const imsgMatch = data.match(/^imessage:(send|cancel):([0-9a-f-]{36})$/i)
    if (imsgMatch) {
      const action = imsgMatch[1].toLowerCase() as 'send' | 'cancel'
      const pendingId = imsgMatch[2]

      const { data: pendingRow } = await supabase
        .from('outbound_messages')
        .select('*')
        .eq('id', pendingId)
        .eq('rep_id', ctxCb.tenant.id)
        .maybeSingle()
      const pending = pendingRow as {
        id: string
        to_address: string
        body: string
        status: string
        metadata: Record<string, unknown> | null
      } | null

      if (!pending || pending.status !== 'pending') {
        await answerCallbackQuery(cq.id, pending ? 'Already processed.' : 'Message not found.')
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        return NextResponse.json({ ok: true })
      }

      if (action === 'cancel') {
        await supabase
          .from('outbound_messages')
          .update({ status: 'failed', metadata: { ...(pending.metadata ?? {}), cancelled: true } })
          .eq('id', pendingId)
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        await answerCallbackQuery(cq.id, 'Cancelled.')
        await sendTelegramMessage(cbChatId, '❌ Message cancelled.', { replyToMessageId: cbMessageId })
        return NextResponse.json({ ok: true })
      }

      // action === 'send' — fire via BlueBubbles
      const bbCfg = await getIntegrationConfig(ctxCb.tenant.id, 'bluebubbles')
      if (!bbCfg?.url || !bbCfg?.password) {
        await answerCallbackQuery(cq.id, 'BlueBubbles not configured.')
        return NextResponse.json({ ok: true })
      }

      const bb = new BlueBubbles(bbCfg.url as string, bbCfg.password as string)
      let bbGuid: string | null = null
      try {
        const result = await bb.sendMessage(pending.to_address, pending.body)
        bbGuid = result.guid ?? null
      } catch (err) {
        console.error('[tg/webhook] BlueBubbles send failed:', err)
        await answerCallbackQuery(cq.id, 'Send failed — check BlueBubbles is running.')
        await sendTelegramMessage(
          cbChatId,
          '⚠️ Failed to send via BlueBubbles. Is the app running on the Mac?',
          { replyToMessageId: cbMessageId },
        )
        return NextResponse.json({ ok: true })
      }

      await supabase
        .from('outbound_messages')
        .update({
          status: 'sent',
          external_id: bbGuid,
          metadata: { ...(pending.metadata ?? {}), sent_at: new Date().toISOString() },
        })
        .eq('id', pendingId)

      const senderName = (pending.metadata as Record<string, unknown> | null)?.sender_name as string ?? pending.to_address
      await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
      await answerCallbackQuery(cq.id, 'Sent!')
      await sendTelegramMessage(
        cbChatId,
        `✅ iMessage sent to *${senderName}*.`,
        { replyToMessageId: cbMessageId },
      )
      return NextResponse.json({ ok: true })
    }

    // ── Agent propose_choice taps ────────────────────────────────────
    // Format: agent:choice:<value>. We treat the value as if the user
    // typed it as a fresh message and re-invoke the agent. Write intents
    // returned by the agent are dispatched directly through executeIntent
    // (no complete_task batch confirmation \u2014 choices are typically
    // navigational reads).
    const agentChoiceMatch = data.match(/^agent:choice:(.+)$/)
    if (agentChoiceMatch) {
      const chosenValue = agentChoiceMatch[1]
      await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
      await answerCallbackQuery(cq.id, chosenValue.length > 32 ? 'Got it' : chosenValue)
      try {
        const followup = await runAgent({
          tenant: ctxCb.tenant,
          caller: ctxCb.member,
          text: chosenValue,
        })
        if (followup.choice) {
          const kb = followup.choice.options.map((opt) => [
            { text: opt.label, callback_data: `agent:choice:${opt.value}`.slice(0, 64) },
          ])
          await sendTelegramMessage(cbChatId, followup.choice.prompt, { inlineKeyboard: kb })
        } else {
          if (followup.replyText) await sendTelegramMessage(cbChatId, followup.replyText)
          if (followup.intentsToExecute.length > 0) {
            const knownLeadsCb = await getRecentLeadNames(ctxCb.tenant.id, 40)
            const queuedItems: Array<{
              item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
              content: string
              priority?: 'low' | 'normal' | 'high'
              horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
              due_date?: string | null
            }> = []
            for (const intent of followup.intentsToExecute) {
              try {
                const r = await executeIntent(intent, ctxCb.tenant, knownLeadsCb, queuedItems, ctxCb.member.id, ctxCb.member, undefined)
                if (r) await sendTelegramMessage(cbChatId, r)
              } catch (err) {
                console.error('[telegram webhook] choice intent failed', intent, err)
              }
            }
            if (queuedItems.length > 0) {
              const dump = await createBrainDump({
                repId: ctxCb.tenant.id,
                rawText: chosenValue,
                summary: '',
                source: 'mic',
                ownerMemberId: ctxCb.member.id,
              })
              await createBrainItems(ctxCb.tenant.id, dump.id, queuedItems, ctxCb.member.id)
            }
          }
        }
      } catch (err) {
        console.error('[telegram webhook] choice agent failed', err)
        await sendTelegramMessage(cbChatId, "Couldn't process that one \u2014 try again.")
      }
      return NextResponse.json({ ok: true })
    }


    // ── KPI tracking-period taps ─────────────────────────────────────
    // Format: kpi:period:<day|week|month|once|cancel>.
    // Triggered after the rep sends "made 100 dials, 25 convos today" and
    // we surface the 4-button picker. day/week/month → create cards at
    // that period; once → log entry without creating cards.
    const kpiPeriodMatch = data.match(/^kpi:period:(day|week|month|once|cancel)$/)
    if (kpiPeriodMatch) {
      const choice = kpiPeriodMatch[1] as 'day' | 'week' | 'month' | 'once' | 'cancel'
      const settingsCb = (ctxCb.member.settings ?? {}) as Record<string, unknown>
      const pendingMetrics = (settingsCb.pending_kpi_metrics as Array<{
        key: string
        label: string
        value: number
        unit: string | null
      }>) ?? []
      const pendingDate =
        (settingsCb.pending_kpi_date as string | null) ??
        new Date().toISOString().slice(0, 10)
      const clearPending = async () => {
        await updateMember(ctxCb.member.id, {
          settings: {
            ...settingsCb,
            pending_action: null,
            pending_action_set_at: null,
            pending_kpi_metrics: null,
            pending_kpi_date: null,
            kpi_onboarded: true,
            kpi_onboarded_at: settingsCb.kpi_onboarded_at ?? new Date().toISOString(),
          },
        })
      }
      if (!pendingMetrics.length || choice === 'cancel') {
        await clearPending()
        await answerCallbackQuery(cq.id, choice === 'cancel' ? 'Cancelled.' : 'Lost the draft.')
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        return NextResponse.json({ ok: true })
      }
      const { createCard: createKpiCardCb, findCard: findKpiCardCb, logEntry: logKpiEntryCb } =
        await import('@/lib/kpi-cards')
      if (choice === 'once') {
        // Log a one-off note without creating cards. Use a brain_dump so it
        // shows up in the rep's history.
        const summary = pendingMetrics.map((m) => `${m.value} ${m.label}`).join(', ')
        try {
          const dump = await createBrainDump({
            repId: ctxCb.tenant.id,
            rawText: `KPI snapshot ${pendingDate}: ${summary}`,
            summary: `KPI: ${summary}`,
            source: 'telegram',
            ownerMemberId: ctxCb.member.id,
          })
          await createBrainItems(ctxCb.tenant.id, dump.id, [
            {
              item_type: 'note',
              content: `KPI ${pendingDate}: ${summary}`,
              priority: 'normal',
              horizon: 'none',
              due_date: null,
            },
          ], ctxCb.member.id)
        } catch (err) {
          console.error('[kpi:period:once] brain note failed', err)
        }
        await clearPending()
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        await answerCallbackQuery(cq.id, 'Logged once.')
        await sendTelegramMessage(
          cbChatId,
          `Cool — logged ${summary} as a one-off note. Nothing pinned to your dashboard. Anytime you want a permanent tracker, say "track dials daily".`,
        )
        return NextResponse.json({ ok: true })
      }
      // day | week | month → create + log
      const period = choice
      const created: string[] = []
      for (const m of pendingMetrics) {
        try {
          let card = await findKpiCardCb(ctxCb.tenant.id, ctxCb.member.id, m.key, period)
          if (!card) {
            card = await createKpiCardCb({
              repId: ctxCb.tenant.id,
              memberId: ctxCb.member.id,
              metricKey: m.key,
              label: m.label,
              unit: m.unit ?? null,
              period,
              pinnedToDashboard: true,
            })
            created.push(m.label)
          }
          await logKpiEntryCb({
            repId: ctxCb.tenant.id,
            memberId: ctxCb.member.id,
            cardId: card.id,
            day: pendingDate,
            value: m.value,
            mode: 'set',
          })
        } catch (err) {
          console.error('[kpi:period] create/log failed', err)
        }
      }
      await clearPending()
      await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
      await answerCallbackQuery(cq.id, `Tracking ${period === 'day' ? 'daily' : period === 'week' ? 'weekly' : 'monthly'}.`)
      const periodLabel = period === 'day' ? 'daily' : period === 'week' ? 'weekly' : 'monthly'
      const summary = pendingMetrics.map((m) => `*${m.value}* ${m.label}`).join(' · ')
      await sendTelegramMessage(
        cbChatId,
        `✅ Logged ${summary}. ${created.length ? `Pinned ${created.join(', ')} as ${periodLabel} card${created.length === 1 ? '' : 's'} on /dashboard.` : `Updated existing ${periodLabel} cards.`}\n\nFull history at /dashboard/analytics.`,
      )
      return NextResponse.json({ ok: true })
    }

    // ── KPI onboarding skip tap ──────────────────────────────────────
    if (data === 'kpi:onboard:skip') {
      const settingsCb = (ctxCb.member.settings ?? {}) as Record<string, unknown>
      await updateMember(ctxCb.member.id, {
        settings: { ...settingsCb, kpi_onboarded: true, kpi_onboarded_at: new Date().toISOString() },
      })
      await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
      await answerCallbackQuery(cq.id, 'No problem.')
      await sendTelegramMessage(
        cbChatId,
        `All good. Anytime you want to start, just text me your numbers ("100 dials, 25 convos, 5 sets today") and I'll offer to pin them.`,
      )
      return NextResponse.json({ ok: true })
    }

    // ── Bulk-import kind confirmation taps ───────────────────────────
    // Format: bulk_kind:<sales|recruiting|team|project|custom|cancel>.
    // Reads parsed leads from member.settings.pending_bulk_import,
    // creates the pipeline with the chosen kind, and runs the import.
    const bulkKindMatch = data.match(/^bulk_kind:(sales|recruiting|team|project|custom|cancel)$/)
    if (bulkKindMatch) {
      const choice = bulkKindMatch[1] as
        | 'sales'
        | 'recruiting'
        | 'team'
        | 'project'
        | 'custom'
        | 'cancel'
      const settingsCb = (ctxCb.member.settings ?? {}) as Record<string, unknown>
      const stash = settingsCb.pending_bulk_import as
        | {
            wantedName: string
            suggestedKind: string
            leads: Parameters<typeof runBulkImport>[0]['parsedLeads']
            suggested_stages: string[]
            ownerMemberId: string | null
            stashed_at: string
          }
        | undefined

      if (!stash || !stash.leads?.length) {
        await editTelegramReplyMarkup(cbChatId, cbMessageId, [])
        await answerCallbackQuery(cq.id, 'Nothing to import.')
        return NextResponse.json({ ok: true })
      }

      // Always clear the stash first so we never double-import.
      await updateMember(ctxCb.member.id, {
        settings: { ...settingsCb, pending_bulk_import: null },
      })
      await editTelegramReplyMarkup(cbChatId, cbMessageId, [])

      if (choice === 'cancel') {
        await answerCallbackQuery(cq.id, 'Cancelled.')
        await sendTelegramMessage(
          cbChatId,
          `❌ Cancelled — nothing was imported. The list is gone; paste it again if you change your mind.`,
        )
        return NextResponse.json({ ok: true })
      }

      await answerCallbackQuery(cq.id, `Creating ${choice} board…`)
      try {
        const brainItemQueue: Array<{
          item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
          content: string
          priority?: 'low' | 'normal' | 'high'
          horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
          due_date?: string | null
        }> = []
        const message = await runBulkImport({
          tenant: ctxCb.tenant,
          ownerMemberId: stash.ownerMemberId,
          parsedLeads: stash.leads,
          suggestedStages: stash.suggested_stages ?? [],
          wantedName: stash.wantedName,
          kind: choice,
          brainItemQueue,
          ambiguousAgainst: [],
        })
        await sendTelegramMessage(cbChatId, message)
        if (brainItemQueue.length > 0) {
          const dump = await createBrainDump({
            repId: ctxCb.tenant.id,
            rawText: stash.wantedName,
            summary: '',
            source: 'mic',
            ownerMemberId: ctxCb.member.id,
          })
          await createBrainItems(ctxCb.tenant.id, dump.id, brainItemQueue, ctxCb.member.id)
        }
      } catch (err) {
        console.error('[telegram webhook] bulk import resume failed', err)
        await sendTelegramMessage(
          cbChatId,
          `⚠️ Import failed — please try pasting the list again.`,
        )
      }
      return NextResponse.json({ ok: true })
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
  // A rep can submit a recording three ways: a voice note (push-to-talk),
  // a Telegram audio attachment (mp3/m4a), or a document upload whose
  // mime_type starts with audio/. The third lets reps share Zoom recordings
  // and dialer exports straight from their phone or desktop.
  const incomingDocAudio =
    msg.document && (msg.document.mime_type?.startsWith('audio/') ?? false)
      ? msg.document.file_id
      : null
  const incomingVoiceFileId =
    msg.voice?.file_id ?? msg.audio?.file_id ?? incomingDocAudio ?? null

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

  // ── iMessage reply routing: rep replied to a BB inbound notification ──
  // Must run AFTER pitch/walkie/room/memo checks so those take priority.
  if (ctxEarly && replyToMessageId) {
    const tenantBB = ctxEarly.tenant
    const bbCfgReply = await getIntegrationConfig(tenantBB.id, 'bluebubbles')
    if (bbCfgReply?.url && bbCfgReply?.password) {
      // Find the inbound outbound_messages row whose tg_notification_id matches
      const { data: bbRows } = await supabase
        .from('outbound_messages')
        .select('id, to_address, metadata, rep_id')
        .eq('rep_id', tenantBB.id)
        .eq('direction', 'inbound')
        .eq('channel', 'imessage')
        .filter('metadata->>tg_notification_id', 'eq', String(replyToMessageId))
        .limit(1)

      const bbInbound = bbRows?.[0] as {
        id: string
        to_address: string
        metadata: Record<string, unknown> | null
        rep_id: string
      } | null

      if (bbInbound) {
        const replyText = (msg.text ?? '').trim()
        if (!replyText) {
          await sendTelegramMessage(
            chatId,
            '⚠️ Send a text message to reply via iMessage.',
            { replyToMessageId },
          )
          return NextResponse.json({ ok: true })
        }

        const handle = (bbInbound.metadata?.handle as string | null) ?? bbInbound.to_address
        const senderName = (bbInbound.metadata?.sender_name as string | null) ?? handle

        // Store as a pending outbound message
        const { data: pendingRow } = await supabase
          .from('outbound_messages')
          .insert({
            rep_id: tenantBB.id,
            lead_id: (bbInbound.metadata?.lead_id as string | null) ?? null,
            channel: 'imessage',
            direction: 'outbound',
            to_address: handle,
            body: replyText,
            status: 'pending',
            metadata: { sender_name: senderName, inbound_id: bbInbound.id },
          })
          .select('id')
          .single()

        const pendingId = pendingRow?.id

        // Send confirm message with inline keyboard
        const confirmText = [
          `📤 Send this iMessage to *${senderName}*?`,
          '',
          `"${replyText}"`,
        ].join('\n')

        await sendTelegramMessage(chatId, confirmText, {
          replyToMessageId,
          inlineKeyboard: pendingId
            ? [
                [
                  { text: '✅ Send', callback_data: `imessage:send:${pendingId}` },
                  { text: '❌ Cancel', callback_data: `imessage:cancel:${pendingId}` },
                ],
              ]
            : [],
        })
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
          'No recipient on that recording — re-run `/pitch <manager-name>` and try again. Nothing was sent.',
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
    // First-time KPI onboarding: only ask once. We mark kpi_onboarded once
    // they answer (via the create_kpi_card / log_kpi paths) or tap Skip.
    const linkedSettings = (linkedMember.settings ?? {}) as Record<string, unknown>
    if (!linkedSettings.kpi_onboarded) {
      await sendTelegramMessage(
        chatId,
        [
          `📊 Quick one — what KPIs do you want me to track for you?`,
          ``,
          `Examples: dials, convos, appointments set, doors knocked, demos, presentations, revenue, commission, referrals, follow-ups.`,
          ``,
          `Just tell me what matters ("track dials, convos, and revenue daily") and I'll pin them to your dashboard. Or text me numbers anytime ("100 dials, $5k commission today") and I'll offer to start tracking.`,
        ].join('\n'),
        {
          inlineKeyboard: [[{ text: '⏭ Skip for now', callback_data: 'kpi:onboard:skip' }]],
        },
      )
    }
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
    // Legacy accounts created before the timezone column existed may have
    // tenant.timezone = null/'UTC'. When the owner sets their TZ, mirror it
    // onto the tenant so any code path that still reads tenant.timezone
    // (and any new members added later) inherits a sane default.
    if (tzMember.role === 'owner' && (!tenant.timezone || tenant.timezone === 'UTC')) {
      try {
        await supabase.from('reps').update({ timezone: arg }).eq('id', tenant.id)
      } catch (err) {
        console.error('[telegram] tenant timezone backfill failed', err)
      }
    }
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
        '*Daily KPIs (dashboard cards)*',
        '• "Made 100 dials, 25 convos, and set 5 appointments today" — logs your numbers and offers to pin new metrics as cards on /dashboard.',
        '• "Track door knocks on my dashboard" / "add emails sent as a daily KPI with a goal of 50" — creates a custom widget.',
        '• "Set my dial goal to 150" — updates the goal on an existing card.',
        '• "Show my KPIs" — lists every card with today’s value.',
        '',
        '*Feature requests*',
        '• "Feature request: bot should chart my dials weekly" — logs it and emails the admin.',
        '',
        '*Pipeline / kanban*',
        '• Paste a list of prospects (names + details) and say "build a pipeline to track these" — I\'ll create the board, the stages, and every lead in one shot.',
        '• "Move Dana to Quoted" / "put Acme in Closed Won" — moves cards on the board (mirrors to your CRM if linked).',
        '• "Bryant is a $15k deal" — stamps deal value.',
        '• "Snooze Glenda for a week" — hides until then.',
        '• View at /dashboard/pipeline.',
        '',
        '*Talk to teammates*',
        '• "Tell Sarah I\'m running 5 late" — I\'ll confirm the right person and relay it.',
        '• "Let the managers know we shifted the demo to Friday" — posts to the Manager Room.',
        '• "Owners only: revenue is tracking +12% MoM" — posts to the Owners Room.',
        '• "Tell the Sales team standup is moved to 10" — posts to that team\'s room.',
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
        "Link your account first with `/link YOURCODE`, then send `/pitch <manager-name>` to send a call recording in for review.",
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
      await sendTelegramMessage(chatId, '✅ Review cancelled. Nothing was sent.')
      return NextResponse.json({ ok: true })
    }

    // No args → show who they can send a recording to and explain the command.
    if (!argRaw) {
      const candidates = await listPitchableManagers(ctxEarly.tenant.id, ctxEarly.member.id)
      const lines = [
        '*🎙 Send a call recording for review*',
        '',
        '1. Run `/pitch <manager-name>` (optionally `about <lead>`).',
        '2. Then drop the audio file from a real call — Zoom export, dialer download, or a voice memo from your phone.',
        '',
        candidates.length
          ? `*Who you can send a recording to:* ${candidates.map((c) => `*${c.display_name}*${c.telegram_chat_id ? '' : ' (not on Telegram yet)'}`).join(', ')}`
          : 'No managers or admins linked yet — ask your team to onboard first.',
        '',
        '_Recordings are *never* auto-broadcast. Only the person you name receives it._',
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
        pending_action_set_at: new Date().toISOString(),
        pending_pitch_recipient_member_id: recipient.id,
        pending_pitch_lead_id: leadId,
        pending_pitch_lead_hint: leadHint,
      },
    })
    await sendTelegramMessage(
      chatId,
      [
        `🎙 *Review armed* — the next audio file you send goes to *${recipient.display_name}*${leadHint ? ` about *${leadHint}*` : ''}.`,
        '',
        'Drop in the audio file from a real sales call (Zoom export, dialer download, voice memo app). Only that one person will hear it.',
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
        pending_action_set_at: new Date().toISOString(),
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
    let pending = settings.pending_action as string | undefined
    // ── Pending-action TTL: expire orphaned states after 30 min ──────────
    // Skips await_commission (rep may still be on the call).
    // Only fires when pending_action_set_at was stamped (new states).
    if (pending && pending !== 'await_commission') {
      const setAt = settings.pending_action_set_at as string | null | undefined
      if (setAt && Date.now() - new Date(setAt).getTime() > 30 * 60 * 1000) {
        await updateMember(member.id, {
          settings: { ...settings, pending_action: null, pending_action_set_at: null },
        })
        await sendTelegramMessage(
          chatId,
          '⏳ Your previous pending action expired (30 min timeout). Just say it again.',
        )
        pending = undefined
      }
    }
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
    if (pending === 'await_meeting_title' || pending === 'await_meeting_notes') {
      const reply = await handlePendingMeetingPrompt(text, tenant, member, settings, pending)
      if (reply !== null) {
        await sendTelegramMessage(chatId, reply)
      }
      return NextResponse.json({ ok: true })
    }
    if (pending === 'await_kpi_cards_confirm') {
      const trimmed = (text ?? '').trim().toLowerCase()
      const pendingMetrics = (settings.pending_kpi_metrics as Array<{
        key: string
        label: string
        value: number
        unit: string | null
      }>) ?? []
      const pendingDate =
        (settings.pending_kpi_date as string | null) ??
        new Date().toISOString().slice(0, 10)
      // Accept text answers in case the rep types instead of tapping a button.
      let chosenPeriod: 'day' | 'week' | 'month' | 'once' | 'cancel' | null = null
      if (/^(daily|day|every day|each day|d)\b/.test(trimmed)) chosenPeriod = 'day'
      else if (/^(weekly|week|every week|each week|w)\b/.test(trimmed)) chosenPeriod = 'week'
      else if (/^(monthly|month|every month|each month|m)\b/.test(trimmed)) chosenPeriod = 'month'
      else if (/^(once|just once|one off|one-off|just log|just log it|skip|no|n|nope|nah|don\u2019?t|do not)\b/.test(trimmed))
        chosenPeriod = 'once'
      else if (/^(cancel|abort|nvm|never mind)\b/.test(trimmed)) chosenPeriod = 'cancel'
      else if (/^(yes|y|yep|yeah|sure|ok|okay)\b/.test(trimmed)) chosenPeriod = 'day' // legacy YES → daily

      if (!pendingMetrics.length) {
        await updateMember(member.id, {
          settings: {
            ...settings,
            pending_action: null,
            pending_action_set_at: null,
            pending_kpi_metrics: null,
            pending_kpi_date: null,
          },
        })
        await sendTelegramMessage(
          chatId,
          'Lost the KPI draft \u2014 just send the numbers again.',
        )
        return NextResponse.json({ ok: true })
      }
      if (!chosenPeriod) {
        await sendTelegramMessage(
          chatId,
          'Tap one of the buttons above, or reply *daily*, *weekly*, *monthly*, or *once*.',
        )
        return NextResponse.json({ ok: true })
      }
      const clearPending = async () => {
        await updateMember(member.id, {
          settings: {
            ...settings,
            pending_action: null,
            pending_action_set_at: null,
            pending_kpi_metrics: null,
            pending_kpi_date: null,
          },
        })
      }
      if (chosenPeriod === 'cancel') {
        await clearPending()
        await sendTelegramMessage(chatId, 'Cancelled — nothing logged.')
        return NextResponse.json({ ok: true })
      }
      if (chosenPeriod === 'once') {
        const summary = pendingMetrics
          .map((m) => `${m.unit === 'USD' ? '$' + m.value.toLocaleString() : m.value} ${m.label}`)
          .join(', ')
        await clearPending()
        await sendTelegramMessage(
          chatId,
          `Cool \u2014 logged ${summary} as a one-off note. Nothing pinned to your dashboard. Anytime you want a permanent tracker, say "track dials daily".`,
        )
        return NextResponse.json({ ok: true })
      }
      // day | week | month → create cards (idempotent) + log entries.
      const period = chosenPeriod
      const created: string[] = []
      for (const m of pendingMetrics) {
        try {
          let card = await findKpiCard(tenant.id, member.id, m.key, period)
          if (!card) {
            card = await createKpiCard({
              repId: tenant.id,
              memberId: member.id,
              metricKey: m.key,
              label: m.label,
              unit: m.unit ?? null,
              period,
              pinnedToDashboard: true,
            })
            created.push(m.label)
          }
          await logKpiEntry({
            repId: tenant.id,
            memberId: member.id,
            cardId: card.id,
            day: pendingDate,
            value: m.value,
            mode: 'set',
          })
        } catch (err) {
          console.error('[telegram] kpi card create/log failed', err)
        }
      }
      await clearPending()
      const periodLabel = period === 'day' ? 'daily' : period === 'week' ? 'weekly' : 'monthly'
      const summary = pendingMetrics
        .map((m) => `*${m.unit === 'USD' ? '$' + m.value.toLocaleString() : m.value}* ${m.label}`)
        .join(' \u00b7 ')
      await sendTelegramMessage(
        chatId,
        `\u2705 Logged ${summary}. ${created.length ? `Pinned ${created.join(', ')} as ${periodLabel} card${created.length === 1 ? '' : 's'} on /dashboard.` : `Updated existing ${periodLabel} cards.`}\n\nFull history at /dashboard/analytics.`,
      )
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
    if (pending === 'confirm_assign') {
      const recipientId = settings.pending_assign_recipient_id as string | undefined
      const content = settings.pending_assign_content as string | undefined
      const dueDate = (settings.pending_assign_due_date as string | null | undefined) ?? null
      const priority = ((settings.pending_assign_priority as string | undefined) ?? 'normal') as 'low' | 'normal' | 'high'
      const timeframe = (settings.pending_assign_timeframe as 'now' | 'later' | null | undefined) ?? null
      const trimmed = (text ?? '').trim().toLowerCase()
      const isYes = /^(yes|y|yep|yeah|send|confirm|do it|go|ship it|sure|ok|okay|assign)\b/.test(trimmed)
      const clearAssign = async () => {
        await updateMember(member.id, {
          settings: {
            ...settings,
            pending_action: null,
            pending_assign_recipient_id: null,
            pending_assign_content: null,
            pending_assign_due_date: null,
            pending_assign_priority: null,
            pending_assign_timeframe: null,
          },
        })
      }
      if (!isYes) {
        await clearAssign()
        await sendTelegramMessage(chatId, 'Cancelled — nothing assigned.')
        return NextResponse.json({ ok: true })
      }
      if (!recipientId || !content) {
        await clearAssign()
        await sendTelegramMessage(chatId, 'Lost the draft — say it again and I\u2019ll re-confirm.')
        return NextResponse.json({ ok: true })
      }
      const { data: tRow } = await supabase
        .from('members')
        .select('id, telegram_chat_id, display_name')
        .eq('id', recipientId)
        .maybeSingle()
      const target = tRow as { id: string; telegram_chat_id: string | null; display_name: string } | null
      if (!target?.telegram_chat_id) {
        await clearAssign()
        await sendTelegramMessage(chatId, 'They\u2019re no longer reachable on Telegram.')
        return NextResponse.json({ ok: true })
      }
      // Create the brain_item on the assignee. status='open' so it appears
      // on their dashboard immediately; if they decline we flip to 'dismissed'.
      const horizon = timeframe === 'now' ? 'day' : timeframe === 'later' ? 'week' : 'none'
      const dump = await createBrainDump({
        repId: tenant.id,
        rawText: `[assigned-by:${member.id}] ${content}`,
        summary: `Assigned by ${member.display_name || member.email}`,
        source: 'manual',
        ownerMemberId: target.id,
      })
      const created = await createBrainItems(
        tenant.id,
        dump.id,
        [
          {
            item_type: 'task',
            content,
            priority,
            horizon,
            due_date: dueDate,
          },
        ],
        target.id,
      )
      const taskId = created[0]?.id
      const senderName = member.display_name || member.email
      const bits: string[] = []
      if (dueDate) bits.push(`due ${dueDate}`)
      if (priority !== 'normal') bits.push(`${priority} priority`)
      const meta = bits.length ? `\n_${bits.join(' · ')}_` : ''
      const body = `📨 *${senderName}* assigned you a task:\n\n*${content}*${meta}\n\nTap a button below.`
      const inlineKeyboard = taskId
        ? [
            [
              { text: '⚡ Got it (now)', callback_data: `task:now:${taskId}` },
              { text: '🕒 Got it (later)', callback_data: `task:later:${taskId}` },
            ],
            [{ text: '🚫 Decline', callback_data: `task:decline:${taskId}` }],
          ]
        : undefined
      await sendTelegramMessage(target.telegram_chat_id, body, { inlineKeyboard })
      await clearAssign()
      const first = target.display_name.split(/\s+/)[0]
      await sendTelegramMessage(chatId, `📡 Sent to *${first}*. I\u2019ll ping you when they accept or decline.`)
      return NextResponse.json({ ok: true })
    }
    if (pending === 'confirm_move') {
      const ids = Array.isArray(settings.pending_move_ids)
        ? (settings.pending_move_ids as string[])
        : []
      const labels = Array.isArray(settings.pending_move_labels)
        ? (settings.pending_move_labels as string[])
        : []
      const newDue = (settings.pending_move_new_due as string | null | undefined) ?? null
      const newContent = (settings.pending_move_new_content as string | null | undefined) ?? null
      const newPriority = (settings.pending_move_new_priority as 'low' | 'normal' | 'high' | null | undefined) ?? null
      const trimmed = (text ?? '').trim().toLowerCase()
      const clearMove = async () => {
        await updateMember(member.id, {
          settings: {
            ...settings,
            pending_action: null,
            pending_move_ids: null,
            pending_move_labels: null,
            pending_move_new_due: null,
            pending_move_new_content: null,
            pending_move_new_priority: null,
          },
        })
      }
      if (ids.length === 0) {
        await clearMove()
        await sendTelegramMessage(chatId, 'Lost track of which task — say it again.')
        return NextResponse.json({ ok: true })
      }
      const isNo = /^(no|n|nope|nvm|never\s*mind|cancel|stop)\b/.test(trimmed)
      if (isNo) {
        await clearMove()
        await sendTelegramMessage(chatId, '👍 Cancelled — nothing changed.')
        return NextResponse.json({ ok: true })
      }
      const isYes = /^(yes|y|yep|yeah|yup|confirm|do it|go|ship it|sure|ok|okay|update|move)\b/.test(trimmed)
      const numMatch = trimmed.match(/^(\d+)\b/)
      let pickIdx: number | null = null
      if (numMatch) {
        const n = parseInt(numMatch[1], 10)
        if (n >= 1 && n <= ids.length) pickIdx = n - 1
      } else if (isYes && ids.length === 1) {
        pickIdx = 0
      }
      if (pickIdx === null) {
        if (ids.length === 1) {
          await sendTelegramMessage(chatId, 'Reply *YES* to confirm, or *NO* to cancel.')
        } else {
          const list = labels.map((l, i) => `${i + 1}. ${l}`).join('\n')
          await sendTelegramMessage(chatId, `Pick one with a number (e.g. \`1\`), or *NO* to cancel.\n\n${list}`)
        }
        return NextResponse.json({ ok: true })
      }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (newDue) updates.due_date = newDue
      if (newContent) updates.content = newContent
      if (newPriority) updates.priority = newPriority
      try {
        const { error } = await supabase
          .from('brain_items')
          .update(updates)
          .eq('id', ids[pickIdx])
          .eq('rep_id', tenant.id)
        if (error) throw error
        await clearMove()
        const changes: string[] = []
        if (newDue) changes.push(`due → *${newDue}*`)
        if (newContent) changes.push(`renamed → *${newContent}*`)
        if (newPriority) changes.push(`priority → *${newPriority}*`)
        await sendTelegramMessage(
          chatId,
          `🔀 Updated *${labels[pickIdx]}*\n${changes.map((c) => '• ' + c).join('\n')}`,
        )
      } catch (err) {
        console.error('[telegram] move_task update failed', err)
        await clearMove()
        await sendTelegramMessage(chatId, 'Couldn\u2019t update it — try again in a sec.')
      }
      return NextResponse.json({ ok: true })
    }
    if (pending === 'complete_task') {
      const ids = Array.isArray(settings.pending_complete_task_ids)
        ? (settings.pending_complete_task_ids as string[])
        : []
      const labels = Array.isArray(settings.pending_complete_task_labels)
        ? (settings.pending_complete_task_labels as string[])
        : []
      const trimmed = (text ?? '').trim().toLowerCase()
      const clearPending = async () => {
        await updateMember(member.id, {
          settings: {
            ...settings,
            pending_action: null,
            pending_complete_task_ids: null,
            pending_complete_task_labels: null,
          },
        })
      }
      if (ids.length === 0) {
        await clearPending()
        await sendTelegramMessage(chatId, 'Lost track of which task \u2014 say it again.')
        return NextResponse.json({ ok: true })
      }
      const isNo = /^(no|n|nope|nvm|never\s*mind|cancel|stop)\b/.test(trimmed)
      if (isNo) {
        await clearPending()
        await sendTelegramMessage(chatId, '\ud83d\udc4d Cancelled \u2014 nothing changed.')
        return NextResponse.json({ ok: true })
      }
      // Deliberately excludes bare "done" / "complete" / "finish" / "all" — too
      // ambiguous. "done with my day" would otherwise mark all pending tasks.
      const isYes = /^(yes|y|yep|yeah|yup|confirm|do it|go|ship it|sure|ok|okay|mark them|mark all)\b/.test(trimmed)
      const numMatch = trimmed.match(/^(\d+)\b/)
      // Allow comma-separated picks ("1, 3" → mark items 1 and 3) and "all".
      const multiPicks: number[] = []
      if (/^(all|every|each)\b/.test(trimmed)) {
        for (let i = 0; i < ids.length; i++) multiPicks.push(i)
      } else {
        const csv = trimmed.match(/\d+/g)
        if (csv && csv.length > 0) {
          for (const tok of csv) {
            const n = parseInt(tok, 10)
            if (n >= 1 && n <= ids.length && !multiPicks.includes(n - 1)) multiPicks.push(n - 1)
          }
        }
      }
      let toMark: number[] = []
      if (multiPicks.length > 0) {
        toMark = multiPicks
      } else if (isYes) {
        // YES with a batch confirms ALL of them.
        for (let i = 0; i < ids.length; i++) toMark.push(i)
      } else if (numMatch) {
        const n = parseInt(numMatch[1], 10)
        if (n >= 1 && n <= ids.length) toMark = [n - 1]
      }
      if (toMark.length === 0) {
        if (ids.length === 1) {
          await sendTelegramMessage(chatId, 'Reply *YES* to mark it done, or *NO* to cancel.')
        } else {
          const list = labels.map((l, i) => `${i + 1}. ${l}`).join('\n')
          await sendTelegramMessage(chatId, `Reply *YES* to mark all ${ids.length} done, or numbers (e.g. \`1, 3\`) to pick specific ones, or *NO* to cancel.\n\n${list}`)
        }
        return NextResponse.json({ ok: true })
      }
      const idsToMark = toMark.map((i) => ids[i])
      const labelsToMark = toMark.map((i) => labels[i] ?? 'task')
      // Clear pending FIRST so Telegram retries don't loop back into this handler.
      await clearPending()
      // Policy (2026-04): completing tasks SOFT-DELETES the row — sets
      // status='done' + deleted_at so the rep can say "undo" within 10 min.
      const nowIso = new Date().toISOString()
      const { error: markError } = await supabase
        .from('brain_items')
        .update({ status: 'done', deleted_at: nowIso, updated_at: nowIso })
        .in('id', idsToMark)
        .eq('rep_id', tenant.id)
      if (markError) {
        console.error('[telegram] complete_task update failed', markError)
        await sendTelegramMessage(chatId, 'Couldn\u2019t mark them done \u2014 try again in a sec.')
      } else {
        const checklist = labelsToMark.map((l) => `\u2705 ${l}`).join('\n')
        const suffix = idsToMark.length === 1 ? "It\u2019s off your dashboard." : `${idsToMark.length} cleared from your dashboard.`
        await sendTelegramMessage(chatId, `${checklist}\n_${suffix}_\n_Say \"undo\" within 10 min to restore._`)
      }
      return NextResponse.json({ ok: true })
    }
  }

  try {
    const knownLeads = await getRecentLeadNames(tenant.id, 40)
    const ownerMemberId = member.id

    // If the user used Telegram's native "Reply" feature on a message that
    // wasn't a tracked memo/room delivery (e.g. they're replying to one of
    // our digest messages or to their own earlier note), surface the quoted
    // text to the NLU so phrases like "fix this", "mark that done", "remind
    // me about it tomorrow" actually have something to bind to. Without
    // this, short replies like "this is fixed" hit the model with zero
    // context and fall through to "Got it — nothing to file from that one."
    const quoted =
      msg.reply_to_message?.text?.trim() || msg.reply_to_message?.caption?.trim() || ''
    const interpretInput = quoted
      ? `[Replying to a previous message: "${quoted.length > 600 ? quoted.slice(0, 600) + '…' : quoted}"]\n${text}`
      : text

    // 2026-04 cutover: free-text now goes through the tool-using agent.
    // The agent reads the same data the dashboard sees (tasks, leads,
    // calendar, calls, targets) and returns either a final reply OR a
    // set of TelegramIntents to feed through the existing executeIntent
    // dispatch (writes) OR a propose_choice payload (inline keyboard).

    // Load the last 40 history entries (20 exchanges) from the agent_history
    // table so the agent can resolve long back-references and maintain
    // conversational context across a full working session.
    // Entries may carry listed_tasks metadata (IDs from list_brain_items calls)
    // used by the complete_task handler to bypass fuzzy matching.
    const { data: historyRows } = await supabase
      .from('agent_history')
      .select('role, content, listed_tasks')
      .eq('member_id', member.id)
      .order('created_at', { ascending: true })
      .limit(40)
    const agentHistory: Array<{ role: 'user' | 'assistant'; content: string; listed_tasks?: Array<{ id: string; content: string }> }> =
      (historyRows ?? []) as Array<{ role: 'user' | 'assistant'; content: string; listed_tasks?: Array<{ id: string; content: string }> }>

    // ── “repeat that” / “what did you say” ─────────────────────────────────────
    // Re-send the last assistant history entry without re-invoking the agent.
    if (/^(repeat|again|say that again|what did you( just)? say|what was that|send that again|can you repeat|repeat please|say it again)\b/i.test(text.trim())) {
      const { data: repeatRows } = await supabase
        .from('agent_history')
        .select('role, content')
        .eq('member_id', member.id)
        .order('created_at', { ascending: false })
        .limit(20)
      const lastAssistant = (repeatRows ?? []).find((h) => h.role === 'assistant')
      if (lastAssistant?.content) {
        await sendTelegramMessage(chatId, lastAssistant.content)
        return NextResponse.json({ ok: true })
      }
      await sendTelegramMessage(chatId, 'Nothing recent to repeat — ask me anything.')
      return NextResponse.json({ ok: true })
    }

    // ── “undo” / “bring it back” — restore recently soft-deleted tasks ────────
    // Tasks completed via Telegram are soft-deleted (status='done', deleted_at
    // stamped). This window is 10 minutes. After that, they’re gone.
    if (/^(undo|undo that|bring (it|that|them) back|restore( that| them| all)?|undelete|revert( that)?)([\s,!?]|$)/i.test(text.trim())) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const { data: deletedItems } = await supabase
        .from('brain_items')
        .select('id, content')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', member.id)
        .eq('status', 'done')
        .not('deleted_at', 'is', null)
        .gte('deleted_at', tenMinutesAgo)
        .order('deleted_at', { ascending: false })
        .limit(5)
      const restorable = (deletedItems ?? []) as Array<{ id: string; content: string }>
      if (restorable.length === 0) {
        await sendTelegramMessage(
          chatId,
          "Nothing recent to undo \u2014 tasks completed more than 10 minutes ago can't be restored.",
        )
        return NextResponse.json({ ok: true })
      }
      const { error: restoreErr } = await supabase
        .from('brain_items')
        .update({ status: 'open', deleted_at: null, updated_at: new Date().toISOString() })
        .in('id', restorable.map((i) => i.id))
        .eq('rep_id', tenant.id)
      if (restoreErr) {
        await sendTelegramMessage(chatId, "Couldn't restore \u2014 try again in a sec.")
        return NextResponse.json({ ok: true })
      }
      const list = restorable.map((i) => `\u2022 ${i.content}`).join('\n')
      await sendTelegramMessage(
        chatId,
        `\u21a9\ufe0f Restored ${restorable.length} task${restorable.length === 1 ? '' : 's'}:\n${list}`,
      )
      return NextResponse.json({ ok: true })
    }

    const agentResult = await runAgent({
      tenant,
      caller: member,
      text: interpretInput,
      history: agentHistory,
    })

    // If the agent asked the user to pick from buttons, render the
    // keyboard and stop. The choice tap is handled by the
    // `agent:choice:` callback_query branch above, which re-runs runAgent
    // with the chosen value as the user message.
    if (agentResult.choice) {
      const keyboard = agentResult.choice.options.map((opt) => [
        { text: opt.label, callback_data: `agent:choice:${opt.value}`.slice(0, 64) },
      ])
      await sendTelegramMessage(chatId, agentResult.choice.prompt, { inlineKeyboard: keyboard })
      return NextResponse.json({ ok: true })
    }

    // Map agent output into the existing post-processing pipeline shape.
    // We keep the rescue regex + complete_task batch confirmation flow
    // because they handle bulk completion ("mark all overdue done") via
    // candidate selection, which the agent shouldn't shortcut.
    const interp: { intents: TelegramIntent[]; reply_hint?: string } = {
      intents: agentResult.intentsToExecute,
      reply_hint: agentResult.replyText,
    }

    // Server-side safety net: rescue brain_items whose content is clearly a
    // completion report and convert them to complete_task.
    // Catches both object-first ("the Dana call is done") and subject-first
    // ("those are done", "them all finished") patterns that NLU may misroute.
    const completionRe =
      /\b(is|are|was|were|already)\s+(done|completed|finished|handled|complete|knocked\s+out|taken\s+care\s+of)\b|^\s*(finished|done\s+with|completed|knocked\s+out|handled|wipe|cross\s+off|mark)\s+|^(those|them|they|all\s*(of\s*)?(those|them|that|it)?|the\s+(above|ones|tasks|items))\s+(are|were)\s+(done|finished|complete|handled|knocked\s+out)/i
    // KPI rescue: catches "100 dials" / "made 25 convos" / "set 5 appts" /
    // "knocked 80 doors" / "50 cold calls 12 conversations 3 sets today" —
    // any digit + activity-noun pair the NLU may have shoved into brain_item.
    // Word-boundary on the noun avoids matching "5 leads" (not a KPI).
    const KPI_NOUN_RE = /(dials?|calls?|cold\s*calls?|outbound|outbounds|conversations?|convos?|talks?|contacts?|appointments?|appts?|sets?|bookings?|meetings\s*booked|voicemails?|vms?|no[\s-]?answers?|nas?|deals?|closes?|emails?|texts?|knocks?|doors?(?:\s*knocked)?)/i
    const KPI_NUMBER_RE = new RegExp(
      String.raw`(?:^|[^\w])(\d{1,4})\s*(?:${KPI_NOUN_RE.source.replace(/^\(|\)$/g, '')})\b`,
      'gi',
    )
    function extractKpiMetrics(content: string): Array<{ label: string; value: number }> {
      const matches: Array<{ label: string; value: number }> = []
      let m: RegExpExecArray | null
      const re = new RegExp(KPI_NUMBER_RE.source, 'gi')
      while ((m = re.exec(content)) !== null) {
        const val = Number(m[1])
        if (Number.isFinite(val) && val >= 0 && val <= 100000) {
          // Pull the matched noun back out of the original substring.
          const tail = content.slice(m.index, re.lastIndex)
          const nounMatch = tail.match(KPI_NOUN_RE)
          const label = nounMatch ? nounMatch[0].trim() : 'count'
          matches.push({ label, value: val })
        }
      }
      return matches
    }
    const rescued: TelegramIntent[] = interp.intents.flatMap((it): TelegramIntent[] => {
      if (it.kind === 'brain_item' && it.content) {
        // Completion-report rescue first.
        if (completionRe.test(it.content)) {
          const query = it.content
            .replace(/\b(is|are|was|were)\s+(done|completed|finished|handled|complete)\b.*$/i, '')
            .replace(/^(finished|done\s+with|completed|knocked\s+out|handled)\s+/i, '')
            .trim()
          return [{ kind: 'complete_task', query: query || it.content }]
        }
        // KPI rescue: brain_item content has "<digit> <activity-noun>" —
        // convert to log_kpi so the rep's numbers actually update their
        // dashboard instead of becoming a stale "100 dials" task.
        const kpiMetrics = extractKpiMetrics(it.content)
        if (kpiMetrics.length > 0) {
          return [
            {
              kind: 'log_kpi',
              metrics: kpiMetrics.map((m) => ({
                key: null,
                label: m.label,
                value: m.value,
                unit: null,
              })),
              date: null,
              mode: null,
              note: null,
            },
          ]
        }
      }
      // Same KPI rescue applied to question-intent fallbacks: NLU sometimes
      // routes "100 dials, 25 convos, 5 sets today" to a question reply.
      if (it.kind === 'question' && interpretInput) {
        const kpiMetrics = extractKpiMetrics(interpretInput)
        if (kpiMetrics.length >= 1) {
          return [
            {
              kind: 'log_kpi',
              metrics: kpiMetrics.map((m) => ({
                key: null,
                label: m.label,
                value: m.value,
                unit: null,
              })),
              date: null,
              mode: null,
              note: null,
            },
          ]
        }
      }
      return [it]
    })

    const completeIntents = rescued.filter((i): i is Extract<TelegramIntent, { kind: 'complete_task' }> => i.kind === 'complete_task')
    const otherIntents = rescued.filter((i) => i.kind !== 'complete_task')

    // Tracks pending_action set during this request (complete_task
    // confirmation flow). Merged with agent_history in the final settings
    // write so neither clobbers the other.
    let pendingCompleteTask: { ids: string[]; labels: string[] } | null = null

    const receipts: string[] = []
    const brainItemsQueued: Array<{
      item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
      content: string
      priority?: 'low' | 'normal' | 'high'
      horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
      due_date?: string | null
      lead_id?: string | null
    }> = []

    // Don't execute write intents if the agent errored mid-run — partial
    // writes on a failed turn produce inconsistent state.
    if (!agentResult.error) {
      for (const intent of otherIntents) {
        try {
          const r = await executeIntent(intent, tenant, knownLeads, brainItemsQueued, ownerMemberId, member, interpretInput)
          if (r) receipts.push(r)
        } catch (err) {
          console.error('[telegram webhook] intent failed', intent, err)
          receipts.push(`⚠️ Couldn't process one item — check your dashboard.`)
        }
      }
    }

    // Batch all complete_task intents into ONE confirmation flow so the
    // pending state survives across intents in the same message.
    if (completeIntents.length > 0) {
      const seen = new Set<string>()
      const candidates: Array<{ id: string; label: string; query: string }> = []
      const noMatch: string[] = []

      // Compute the rep's local date for overdue comparisons.
      const repTz = member.timezone || tenant.timezone || 'UTC'
      const todayLocal = (() => {
        try {
          return new Intl.DateTimeFormat('en-CA', {
            timeZone: repTz, year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date())
        } catch { return new Date().toISOString().slice(0, 10) }
      })()

      // Pull listed_tasks from the most recent assistant history entry that has
      // them. Falls back to a dedicated settings key (survives history rotation).
      // Both expire after 30 min so stale lists can’t mislead new requests.
      const historyListedTasks: Array<{ id: string; content: string }> = (() => {
        // First: walk back through the rolling 12-entry history window.
        for (let i = agentHistory.length - 1; i >= 0; i--) {
          const entry = agentHistory[i]
          if (entry.role === 'assistant' && entry.listed_tasks && entry.listed_tasks.length > 0) {
            return entry.listed_tasks
          }
        }
        // Fallback: dedicated settings key (survives history rotation). 30-min TTL.
        const cachedTasks = (member.settings as Record<string, unknown>)?.last_listed_tasks as
          | Array<{ id: string; content: string }>
          | null
        const cachedAt = (member.settings as Record<string, unknown>)?.last_listed_tasks_at as
          | string
          | null
        if (
          cachedTasks?.length &&
          cachedAt &&
          Date.now() - new Date(cachedAt).getTime() < 30 * 60 * 1000
        ) {
          return cachedTasks
        }
        return []
      })()

      for (const ct of completeIntents) {
        const raw = (ct.query ?? '').trim()
        if (!raw) continue

        // ── Ordinal resolution (#N or bare N) ────────────────────────────
        // "mark #2 done" / "done with 3" — treat as 1-indexed position.
        // With history: position in the listed set. Without: dashboard order.
        const ordinalOnly = raw.match(/^#?(\d+)$/)
        if (ordinalOnly) {
          const n = parseInt(ordinalOnly[1], 10)
          if (n >= 1 && n <= 20) {
            if (historyListedTasks.length > 0) {
              // Position within the bot’s most recent listed set (1-indexed).
              const cached = historyListedTasks[n - 1]
              if (cached && !seen.has(cached.id)) {
                seen.add(cached.id)
                candidates.push({ id: cached.id, label: cached.content, query: raw })
                continue
              }
            }
            // No history context → resolve by creation order (dashboard order).
            const { data: ordRows } = await supabase
              .from('brain_items')
              .select('id, content')
              .eq('rep_id', tenant.id)
              .eq('status', 'open')
              .eq('owner_member_id', member.id)
              .order('created_at', { ascending: true })
              .limit(n)
            const ordRow = ((ordRows ?? []) as Array<{ id: string; content: string }>)[n - 1]
            if (ordRow && !seen.has(ordRow.id)) {
              seen.add(ordRow.id)
              candidates.push({ id: ordRow.id, label: ordRow.content, query: raw })
              continue
            }
          }
        }

        // ── Step 1: history metadata match ───────────────────────────────────
        // If the bot listed tasks last turn and the query references any of
        // those tasks (by content substring, ordinal back-reference, or generic
        // "those/them/all"), resolve directly to the stored IDs — no DB query.

        const isBackReference = /^(those|them|all\s*\d*|the\s+(ones|tasks|items)|all\s+of\s+(those|them)|that\s+list|my\s+list|the\s+above|from\s+(before|earlier)|everything)$/i.test(raw.trim())

        if (isBackReference && historyListedTasks.length > 0) {
          // Generic back-reference → use the entire listed set.
          for (const cached of historyListedTasks) {
            if (!seen.has(cached.id)) {
              seen.add(cached.id)
              candidates.push({ id: cached.id, label: cached.content, query: raw })
            }
          }
          continue
        }

        if (historyListedTasks.length > 0) {
          // Specific task name → check if it content-matches anything in the
          // listed set. Prefer this over a DB fuzzy query because the DB query
          // can match unrelated open tasks with overlapping words.
          const rawLower = raw.toLowerCase()
          const historyMatch = historyListedTasks.find((cached) => {
            const cachedLower = cached.content.toLowerCase()
            return (
              !seen.has(cached.id) &&
              (cachedLower.includes(rawLower) || rawLower.includes(cachedLower) ||
                // word-level overlap: at least half the non-stop words in query appear in content
                (() => {
                  const stopWords = new Set(['the','and','for','with','task','item','about','that','this','all','done','finished','completed','a','an','to','of','in','on'])
                  const queryWords = rawLower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
                  if (queryWords.length === 0) return false
                  const matched = queryWords.filter(w => cachedLower.includes(w))
                  return matched.length >= Math.ceil(queryWords.length / 2)
                })()
              )
            )
          })
          if (historyMatch) {
            seen.add(historyMatch.id)
            candidates.push({ id: historyMatch.id, label: historyMatch.content, query: raw })
            continue
          }
        }

        // ── Step 2: overdue / all-tasks DB fetch ──────────────────────────────
        const isOverduePattern = /\boverdue\b|\bpast[\s-]?due\b/i.test(raw)
        const isAllPattern = /^(all|everything|every\s+task|all\s+(of\s+)?(them|it|my\s+tasks?|the\s+tasks?|tasks?|above|that)|them\s+all|all\s+the\s+above)$/i.test(raw.trim())

        // "all tasks" / "everything" with history → use exactly what the bot
        // showed the rep, not every open task in the DB.
        if (isAllPattern && !isOverduePattern && historyListedTasks.length > 0) {
          for (const cached of historyListedTasks) {
            if (!seen.has(cached.id)) {
              seen.add(cached.id)
              candidates.push({ id: cached.id, label: cached.content, query: raw })
            }
          }
          continue
        }

        if (isOverduePattern || isAllPattern) {
          let dbQuery = supabase
            .from('brain_items')
            .select('id, content, due_date')
            .eq('rep_id', tenant.id)
            .eq('status', 'open')
            .order('due_date', { ascending: true })
            .limit(15)
          if (isOverduePattern) {
            dbQuery = dbQuery.lt('due_date', todayLocal)
          } else {
            dbQuery = dbQuery.order('created_at', { ascending: false })
          }
          const { data: bulkRows } = await dbQuery
          const bulk = (bulkRows ?? []) as Array<{ id: string; content: string; due_date: string | null }>
          if (bulk.length === 0) {
            noMatch.push(raw)
          } else {
            for (const row of bulk) {
              if (!seen.has(row.id)) {
                seen.add(row.id)
                const dueSuffix = row.due_date ? ` _(was due ${row.due_date})_` : ''
                candidates.push({ id: row.id, label: row.content + (isOverduePattern ? dueSuffix : ''), query: raw })
              }
            }
          }
          continue
        }

        // ── Step 3: word-level DB fuzzy fallback ──────────────────────────────
        const words = raw
          .toLowerCase()
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 2 &&
              !['the', 'and', 'for', 'with', 'task', 'item', 'about', 'that', 'this', 'all', 'done', 'finished', 'completed'].includes(w),
          )
        const orClauses =
          words.length > 0
            ? words.map((w) => `content.ilike.%${w}%`).join(',')
            : `content.ilike.%${raw}%`
        const { data: matches } = await supabase
          .from('brain_items')
          .select('id, content')
          .eq('rep_id', tenant.id)
          .eq('status', 'open')
          .or(orClauses)
          .order('created_at', { ascending: false })
          .limit(5)
        const rows = (matches ?? []) as Array<{ id: string; content: string }>
        if (rows.length === 0) {
          noMatch.push(raw)
          continue
        }
        // Skip rows already claimed by another intent in this batch.
        const unused = rows.find((r) => !seen.has(r.id))
        if (unused) {
          seen.add(unused.id)
          candidates.push({ id: unused.id, label: unused.content, query: raw })
        } else {
          noMatch.push(raw)
        }
      }

      if (candidates.length > 0) {
        // Defer the settings write to the final consolidated write below
        // so it doesn't race against / clobber the agent_history write.
        pendingCompleteTask = {
          ids: candidates.map((c) => c.id),
          labels: candidates.map((c) => c.label),
        }
        const list = candidates.map((c, i) => `${i + 1}. ${c.label}`).join('\n')
        if (candidates.length === 1) {
          receipts.push(`✅ Mark this done?\n\n• *${candidates[0].label}*\n\nReply *YES* to confirm, *NO* to cancel.`)
        } else {
          receipts.push(`✅ Mark these ${candidates.length} done?\n\n${list}\n\nReply *YES* to mark all, numbers (e.g. \`1, 3\`) to pick specific ones, or *NO* to cancel.`)
        }
      }
      for (const q of noMatch) {
        receipts.push(`🤷 Didn't find an open task matching *"${q}"* — check your dashboard.`)
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

    // Merge agent_history + any pending_action into ONE awaited settings
    // write. Two separate writes used stale member.settings and the second
    // silently clobbered the first. await ensures Next.js serverless doesn't
    // terminate before the DB write completes.
    if (!agentResult.error || pendingCompleteTask) {
      const updatedSettings: Record<string, unknown> = { ...(member.settings ?? {}) }
      if (!agentResult.error) {
        // Build the new assistant history entry. If list_brain_items ran this
        // turn, embed the IDs directly into the entry so the complete_task
        // handler can resolve back-references ("those", "all 4") on the next
        // turn without a separate cache key or DB re-query.
        const assistantEntry: { role: 'assistant'; content: string; listed_tasks?: Array<{ id: string; content: string }> } = {
          role: 'assistant',
          content: reply,
        }
        if (agentResult.listedItems && agentResult.listedItems.length > 0) {
          assistantEntry.listed_tasks = agentResult.listedItems
          // Also write the rotation-safe dedicated key so back-references work
          // even after the entry scrolls out of the 12-message history window.
          updatedSettings.last_listed_tasks = agentResult.listedItems
          updatedSettings.last_listed_tasks_at = new Date().toISOString()
        }
        // Persist new turn to agent_history table. Awaited so the serverless
        // function doesn't terminate before the rows land.
        await supabase.from('agent_history').insert([
          { member_id: member.id, rep_id: tenant.id, role: 'user', content: interpretInput },
          { member_id: member.id, rep_id: tenant.id, role: 'assistant', content: assistantEntry.content, listed_tasks: assistantEntry.listed_tasks ?? null },
        ])
      }
      if (pendingCompleteTask) {
        updatedSettings.pending_action = 'complete_task'
        updatedSettings.pending_action_set_at = new Date().toISOString()
        updatedSettings.pending_complete_task_ids = pendingCompleteTask.ids
        updatedSettings.pending_complete_task_labels = pendingCompleteTask.labels
      }
      await updateMember(member.id, { settings: updatedSettings }).catch(
        async (e: unknown) => {
          console.error('[agent] failed to persist settings', e)
          await sendTelegramMessage(
            chatId,
            "\u26a0\ufe0f Session state couldn't be saved \u2014 if you were confirming something, just say it again.",
          ).catch(() => {})
        },
      )
    }
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
    lead_id?: string | null
  }>,
  ownerMemberId: string | null,
  callerMember: Member,
  rawUserText?: string,
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

      // Mirror to GHL contact if the rep has a GHL API key configured.
      mirrorLeadToGHL(tenant.id, lead).catch(() => null)

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
      mirrorLeadToGHL(tenant.id, updated, {
        note: intent.note ? `[Telegram update] ${intent.note}` : undefined,
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
        lead_id: target?.id ?? null,
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
      mirrorLeadToGHL(tenant.id, updatedLead, {
        note: `[Call logged] ${intent.outcome ? intent.outcome.replace(/_/g, ' ') + ' — ' : ''}${intent.summary.slice(0, 500)}${intent.next_step ? `\nNext step: ${intent.next_step}` : ''}`,
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

      // Conflict check via Google free/busy. Returns null if Google isn't
      // connected; we just skip the warning in that case.
      const conflict = await findConflict(tenant.id, startIso, endIso)

      // Two-step prompt: stash the booking details and ask the rep for a
      // clean title + notes. Without this, Claude sometimes stuffs the whole
      // user message ("Book a call with Dana Thursday at 3pm to talk pricing
      // and ROI for their team of 50") into the calendar event title, which
      // looks awful on the rep's calendar. We never auto-create here — the
      // event is created in handlePendingMeetingNotes once both fields land.
      const tz = callerMember.timezone || tenant.timezone || 'UTC'
      const whenStr = new Date(startIso).toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
      const defaultSummary =
        intent.summary && intent.summary.length <= 60
          ? intent.summary
          : `Meeting with ${contactName}`

      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'await_meeting_title',
          pending_action_set_at: new Date().toISOString(),
          pending_meeting: {
            startIso,
            endIso,
            contactName,
            attendeeEmail,
            defaultSummary,
            // Pre-fill notes from the intent if Claude split them out — rep
            // can still override when we ask "any notes?".
            initialNotes: intent.notes ?? null,
            conflict: conflict
              ? { startIso: conflict.startIso, endIso: conflict.endIso }
              : null,
            taskDueDate: startIso.slice(0, 10),
          },
        },
      })

      const conflictWarning = conflict
        ? `\n⚠️ Heads up — you already have something on your calendar from ${new Date(conflict.startIso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })} to ${new Date(conflict.endIso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}. Reply *cancel* to stop, or send the title to keep going.`
        : ''

      await sendTelegramMessage(
        callerMember.telegram_chat_id ?? '',
        [
          `📅 Setting up a *${duration}-min* meeting on *${whenStr}*${attendeeEmail ? ` with ${attendeeEmail}` : ''}.`,
          '',
          `What title should I put on the calendar event? Reply with the title, or \`default\` to use *${defaultSummary}*. Reply \`cancel\` to stop.${conflictWarning}`,
        ].join('\n'),
      )
      // Custom prompt sent — don't emit the standard receipt this turn.
      return null
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
          pending_action_set_at: new Date().toISOString(),
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

    case 'arm_voice_send': {
      // Plain-English version of `/walkie` and `/pitch`. The rep said they
      // want to send AUDIO to a teammate but hasn't attached the file yet.
      // Arm the next inbound voice file to relay to the matched recipient.
      // We never guess the name — if no clean match, ask who they meant.
      const allMembers = await listMembers(tenant.id)
      const target = matchMemberByName(allMembers, intent.member_name, callerMember.id)
      if (!target) {
        return `Couldn't match *${intent.member_name}* on your team. Who did you mean?`
      }
      if (!target.telegram_chat_id) {
        return `${target.display_name} hasn't linked Telegram yet — they can't receive a voice yet.`
      }
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      const flavor: 'walkie' | 'pitch' = intent.flavor === 'pitch' ? 'pitch' : 'walkie'

      if (flavor === 'pitch') {
        // Optional lead resolution — same logic as the /pitch slash handler.
        let leadId: string | null = null
        let leadHint: string | null = intent.lead_name || null
        if (intent.lead_name) {
          const knownLeads = await getRecentLeadNames(tenant.id, 80)
          const norm = (s: string) =>
            s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
          const t = norm(intent.lead_name)
          const hit = knownLeads.find(
            (l) => norm(l.name).includes(t) || (l.company && norm(l.company).includes(t)),
          )
          if (hit) {
            leadId = hit.id
            leadHint = hit.company ? `${hit.name} · ${hit.company}` : hit.name
          }
        }
        await updateMember(callerMember.id, {
          settings: {
            ...settingsNow,
            pending_action: 'pitch',
            pending_action_set_at: new Date().toISOString(),
            pending_pitch_recipient_member_id: target.id,
            pending_pitch_lead_id: leadId,
            pending_pitch_lead_hint: leadHint,
          },
        })
        return [
          `🎙 *Review armed* — your next audio file goes to *${target.display_name}*${leadHint ? ` about *${leadHint}*` : ''}.`,
          '',
          'Drop the audio in (Zoom export, dialer download, voice memo). Only that one person will hear it.',
          '',
          'Say "cancel" if you change your mind.',
        ].join('\n')
      }

      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'walkie',
          pending_action_set_at: new Date().toISOString(),
          pending_walkie_recipient_member_id: target.id,
        },
      })
      return [
        `📡 *Walkie armed* — your next voice goes to *${target.display_name}*.`,
        '',
        'Hit record and send. Say "cancel" if you change your mind.',
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
          pending_action_set_at: new Date().toISOString(),
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

    case 'defer_item': {
      // Park into the caller's deferred-items inbox. Source tracking comes
      // from context where possible — for now we record it as a self-deferral
      // (the inbox UI shows lead/memo links via the optional pointers below
      // when the model identifies them; reply-threaded handlers fill in
      // source_member_id / source_memo_id automatically elsewhere).
      let sourceLeadId: string | null = null
      if (intent.source_lead_name) {
        const lead =
          knownLeads.find(
            (l) => l.name.toLowerCase() === intent.source_lead_name!.toLowerCase(),
          ) ??
          knownLeads.find((l) =>
            l.name.toLowerCase().includes(intent.source_lead_name!.toLowerCase()),
          )
        sourceLeadId = lead?.id ?? null
      }
      const source: DeferredSource = sourceLeadId ? 'lead' : 'self'
      try {
        await createDeferredItem({
          repId: tenant.id,
          ownerMemberId: callerMember.id,
          source,
          sourceLeadId,
          title: intent.title,
          body: intent.body ?? null,
          remindAt: intent.remind_at_iso ?? null,
        })
      } catch (err) {
        console.error('[telegram] defer_item failed', err)
        return `Couldn't park that one — try again in a sec.`
      }
      const when = intent.remind_at_iso
        ? ` for ${intent.remind_at_iso.slice(0, 16).replace('T', ' ')}`
        : ''
      return `🗂️ Parked in your inbox${when}: *${intent.title}*`
    }

    case 'complete_task': {
      // Handled in batch by the main webhook handler before executeIntent
      // is reached. This case is unreachable in practice, but kept so the
      // TypeScript switch stays exhaustive.
      return null
    }

    case 'move_task': {
      // Fuzzy-match an open brain_item the caller owns, then stash a pending
      // confirm_move so the next reply is interpreted as YES / NO / numeric pick.
      const raw = (intent.query ?? '').trim()
      if (!raw) return "What task did you want to move? Tell me which one."
      const words = raw
        .toLowerCase()
        .split(/\s+/)
        .filter(
          (w) =>
            w.length > 2 &&
            !['the', 'and', 'for', 'with', 'task', 'item', 'about', 'that', 'this'].includes(w),
        )
      const orClauses =
        words.length > 0
          ? words.map((w) => `content.ilike.%${w}%`).join(',')
          : `content.ilike.%${raw}%`
      const { data: matches } = await supabase
        .from('brain_items')
        .select('id, content, due_date, priority')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', callerMember.id)
        .eq('status', 'open')
        .or(orClauses)
        .order('created_at', { ascending: false })
        .limit(5)
      const rows = (matches ?? []) as Array<{ id: string; content: string; due_date: string | null; priority: string | null }>
      if (rows.length === 0) {
        return `🤷 Didn't find an open task matching *"${raw}"* — check your dashboard.`
      }
      const newDue = intent.new_due_date ?? null
      const newContent = intent.new_content ?? null
      const newPriority = intent.new_priority ?? null
      if (!newDue && !newContent && !newPriority) {
        return `What should change on *${rows[0].content}*? Tell me a new date, new wording, or new priority.`
      }
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'confirm_move',
          pending_action_set_at: new Date().toISOString(),
          pending_move_ids: rows.map((r) => r.id),
          pending_move_labels: rows.map((r) => r.content),
          pending_move_new_due: newDue,
          pending_move_new_content: newContent,
          pending_move_new_priority: newPriority,
        },
      })
      const changes: string[] = []
      if (newDue) changes.push(`due → ${newDue}`)
      if (newContent) changes.push(`rename → "${newContent}"`)
      if (newPriority) changes.push(`priority → ${newPriority}`)
      if (rows.length === 1) {
        return `🔀 Update *${rows[0].content}*?\n${changes.map((c) => '• ' + c).join('\n')}\n\nReply *YES* to confirm, *NO* to cancel.`
      }
      const list = rows.map((r, i) => `${i + 1}. ${r.content}`).join('\n')
      return `🔀 Which one did you mean?\n\n${list}\n\nChange would be: ${changes.join(', ')}.\nReply with a number (e.g. \`1\`), or *NO* to cancel.`
    }

    case 'assign_task': {
      const allMembers = await listMembers(tenant.id)
      const target = matchMemberByName(allMembers, intent.member_name, callerMember.id)
      if (!target) {
        return `Couldn't find *${intent.member_name}* on your team. Who did you mean?`
      }
      if (!target.telegram_chat_id) {
        return `${target.display_name} hasn't linked Telegram yet — they won't see the assignment. Ping them to run \`/link\` first.`
      }
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'confirm_assign',
          pending_action_set_at: new Date().toISOString(),
          pending_assign_recipient_id: target.id,
          pending_assign_content: intent.content,
          pending_assign_due_date: intent.due_date ?? null,
          pending_assign_priority: intent.priority ?? 'normal',
          pending_assign_timeframe: intent.timeframe ?? null,
        },
      })
      const bits: string[] = []
      if (intent.due_date) bits.push(`due ${intent.due_date}`)
      if (intent.priority && intent.priority !== 'normal') bits.push(`${intent.priority} priority`)
      if (intent.timeframe) bits.push(`timeframe: ${intent.timeframe}`)
      const meta = bits.length ? ` _(${bits.join(' · ')})_` : ''
      return `📨 Assign to *${target.display_name}*?\n\n• ${intent.content}${meta}\n\nReply *YES* to send — they'll get [Got it now] / [Got it later] / [Decline] buttons. Anything else cancels.`
    }

    case 'log_kpi': {
      const today = new Date().toISOString().slice(0, 10)
      const day = intent.date ?? today
      const mode: 'set' | 'increment' = intent.mode === 'increment' ? 'increment' : 'set'
      const cleaned = (intent.metrics ?? [])
        .map((m) => {
          if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value)) return null
          if (m.value < 0 || m.value > 100_000_000) return null
          const norm = normalizeMetric({ key: m.key ?? null, label: m.label || m.key || 'metric' })
          // Auto-tag currency metrics so the dashboard formats them as money
          // even when the rep didn't say "USD".
          const unit =
            m.unit ?? (isCurrencyMetric(norm.key) ? 'USD' : null)
          return { ...norm, value: m.value, unit }
        })
        .filter((v): v is { key: string; label: string; value: number; unit: string | null } => !!v)
      if (!cleaned.length) {
        return "I caught you talking numbers but couldn't pin them to a metric. Try \"100 dials, 25 convos, 5 sets today\"."
      }

      const existing: Array<{ card: KpiCard; value: number; label: string }> = []
      const missing: Array<{ key: string; label: string; value: number; unit: string | null }> = []
      for (const m of cleaned) {
        // Match across any period — if the rep already chose week/month for
        // this metric, don't pester them again. We only stage as "missing"
        // when the metric has no card at all yet.
        const card = await findAnyCardForMetric(tenant.id, callerMember.id, m.key)
        if (card) existing.push({ card, value: m.value, label: card.label })
        else missing.push(m)
      }

      // Log every metric that already has a card.
      for (const e of existing) {
        try {
          await logKpiEntry({
            repId: tenant.id,
            memberId: callerMember.id,
            cardId: e.card.id,
            day,
            value: e.value,
            mode,
          })
        } catch (err) {
          console.error('[log_kpi] entry log failed', err)
        }
      }

      const dayLabel = day === today ? 'today' : day
      const fmt = (v: number, unit: string | null) =>
        unit === 'USD' ? `$${v.toLocaleString()}` : `${v}`
      if (!missing.length) {
        const summary = existing
          .map((e) => `*${fmt(e.value, e.card.unit)}* ${e.label}`)
          .join(' · ')
        return `📊 Logged ${summary} for ${dayLabel}. /dashboard for the full view.`
      }

      // Stage the missing metrics for the period-picker buttons. We do NOT
      // create the cards yet — the rep gets to opt in via inline keyboard.
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'await_kpi_cards_confirm',
          pending_action_set_at: new Date().toISOString(),
          pending_kpi_metrics: missing,
          pending_kpi_date: day,
        },
      })

      const existingLine = existing.length
        ? `Updated *${existing.map((e) => e.label).join(', ')}* on your dashboard. `
        : ''
      const missingList = missing
        .map((m) => `• *${fmt(m.value, m.unit)}* ${m.label}`)
        .join('\n')
      const promptText = `📊 ${existingLine}New ones I haven't seen before:\n${missingList}\n\nHow should I track ${missing.length === 1 ? 'this' : 'these'}?`
      try {
        const senderChatId = callerMember.telegram_chat_id
        if (senderChatId) {
          await sendTelegramMessage(senderChatId, promptText, {
            inlineKeyboard: [
              [
                { text: '📅 Daily', callback_data: 'kpi:period:day' },
                { text: '📆 Weekly', callback_data: 'kpi:period:week' },
                { text: '🗓 Monthly', callback_data: 'kpi:period:month' },
              ],
              [
                { text: 'Just log once', callback_data: 'kpi:period:once' },
                { text: '✖ Cancel', callback_data: 'kpi:period:cancel' },
              ],
            ],
          })
          return null
        }
      } catch (err) {
        console.error('[log_kpi] inline keyboard send failed', err)
      }
      return `${promptText}\n\nReply *daily*, *weekly*, *monthly*, or *once*.`
    }

    case 'create_kpi_card': {
      const norm = normalizeMetric({
        key: intent.metric_key ?? null,
        label: intent.label || intent.metric_key || 'metric',
      })
      const period: 'day' | 'week' | 'month' = intent.period ?? 'day'
      const existingCard = await findKpiCard(tenant.id, callerMember.id, norm.key, period)
      if (existingCard) {
        // If the rep is updating the goal ("set my dial goal to 150"),
        // patch the existing card instead of bouncing them back. Otherwise
        // just confirm it's already tracked.
        if (
          intent.goal_value !== null &&
          intent.goal_value !== undefined &&
          Number.isFinite(intent.goal_value) &&
          intent.goal_value !== existingCard.goal_value
        ) {
          await supabase
            .from('kpi_cards')
            .update({ goal_value: intent.goal_value, updated_at: new Date().toISOString() })
            .eq('id', existingCard.id)
            .eq('rep_id', tenant.id)
          return `🎯 Updated *${existingCard.label}* goal to *${intent.goal_value}* per ${period}. Send your number anytime to log progress.`
        }
        return `Already tracking *${existingCard.label}* on your dashboard${existingCard.goal_value ? ` (goal: ${existingCard.goal_value})` : ''}. Just send the number anytime to update it.`
      }
      try {
        const card = await createKpiCard({
          repId: tenant.id,
          memberId: callerMember.id,
          metricKey: norm.key,
          label: norm.label,
          unit: intent.unit ?? null,
          period,
          goalValue: intent.goal_value ?? null,
        })
        const goalLine = card.goal_value ? ` Daily goal: *${card.goal_value}*.` : ''
        return `📌 Added *${card.label}* to your dashboard.${goalLine} Send your number whenever ("${card.label.toLowerCase()} 50 today") and it'll update.`
      } catch (err) {
        console.error('[create_kpi_card] failed', err)
        return `Couldn't add that card — try again in a sec.`
      }
    }

    case 'list_kpi_cards': {
      const cards = await listKpiCards(tenant.id, callerMember.id)
      if (!cards.length) {
        return `No KPI cards yet. Tell me your numbers (e.g. "100 dials, 25 convos, 5 sets today") and I'll offer to pin them to your dashboard.`
      }
      const today = new Date().toISOString().slice(0, 10)
      const lines: string[] = []
      for (const c of cards) {
        const { data: row } = await supabase
          .from('kpi_entries')
          .select('value')
          .eq('kpi_card_id', c.id)
          .eq('day', today)
          .maybeSingle()
        const todayVal = row ? Number(row.value) : 0
        const goalSuffix = c.goal_value ? ` / ${c.goal_value}` : ''
        lines.push(`• *${c.label}* — ${todayVal}${goalSuffix} today`)
      }
      return `📊 Your KPI cards:\n${lines.join('\n')}\n\nUpdate any of them by sending the number, or say "add X to my dashboard" for a new one.`
    }

    case 'feature_request': {
      const summary = (intent.summary ?? '').trim().slice(0, 500)
      const context = (intent.context ?? '').trim().slice(0, 4000) || null
      if (!summary) {
        return `Tell me what you want added — like "feature request: bot should log dial KPIs and chart them daily".`
      }
      try {
        await supabase.from('feature_requests').insert({
          rep_id: tenant.id,
          member_id: callerMember.id,
          source: 'telegram',
          summary,
          context,
        })
      } catch (err) {
        console.error('[feature_request] db insert failed', err)
      }
      const tenantLabel = tenant.display_name || tenant.slug || tenant.id
      const res = await sendFeatureRequest({
        fromName: callerMember.display_name || 'Telegram user',
        fromEmail: callerMember.email || null,
        workspace: tenantLabel,
        summary,
        context,
      }).catch((err) => {
        console.error('[feature_request] email failed', err)
        return { ok: false, error: 'send failed', to: '' }
      })

      // Also ping the platform admin on Telegram if configured, so feature
      // requests don't sit in an inbox until someone checks email.
      const adminChat = process.env.ADMIN_TELEGRAM_CHAT_ID
      if (adminChat) {
        await sendTelegramMessage(
          adminChat,
          `💡 *Feature request* from ${callerMember.display_name} (${tenantLabel}):\n\n${summary}${context ? `\n\n_Context:_ ${context}` : ''}`,
        ).catch(() => null)
      }

      if (!res.ok) {
        return `Saved your request — but the email to admin didn't go through. They'll still see it in the queue. (${res.error ?? 'unknown error'})`
      }
      return `📬 Got it — feature request logged and emailed to admin. They'll reach out if they need detail. (Reference: "${summary.slice(0, 60)}${summary.length > 60 ? '…' : ''}")`
    }

    case 'place_call': {
      // Trigger the AI dialer for an existing meeting.
      const contactName = (intent.contact_name ?? '').trim()
      if (!contactName) {
        return `Tell me who to dial — like "confirm my appointment with Betty at 2".`
      }
      const purpose = intent.purpose === 'reschedule' ? 'reschedule' : 'confirm'
      try {
        const { listUpcomingMeetingsForRep } = await import('@/lib/meetings')
        const upcoming = await listUpcomingMeetingsForRep(tenant.id, {
          fromIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // grace: -2h
          toIso: new Date(Date.now() + 14 * 86400_000).toISOString(),       // +14 days
          limit: 50,
        })
        const lower = contactName.toLowerCase()
        const candidates = upcoming.filter((m) =>
          (m.attendee_name ?? '').toLowerCase().includes(lower) ||
          (m.attendee_email ?? '').toLowerCase().includes(lower),
        )
        if (!candidates.length) {
          return `No upcoming meeting matching "${contactName}" in the next 2 weeks. Book the meeting first, then I can have the dialer call them.`
        }
        // If when_hint mentions a time, prefer the closest meeting to that hint.
        let target = candidates[0]
        if (intent.when_hint && candidates.length > 1) {
          const hint = intent.when_hint.toLowerCase()
          const dayMatch = candidates.find((m) => {
            const local = new Date(m.scheduled_at).toString().toLowerCase()
            return local.includes(hint) || hint.includes(local.split(' ')[0])
          })
          if (dayMatch) target = dayMatch
        }
        if (!target.phone) {
          return `Found the meeting with ${target.attendee_name ?? contactName} — but no phone number on file. Add their phone first.`
        }
        const dialer = await import('@/lib/voice/dialer')
        const result =
          purpose === 'reschedule'
            ? await dialer.dispatchRescheduleCall(target.id)
            : await dialer.dispatchConfirmCall(target.id)
        if (!result.ok) {
          const reasonMsg: Record<string, string> = {
            no_phone: 'no phone number on the meeting',
            wrong_status: 'meeting is no longer scheduled',
            dialer_addon_not_active: 'the AI dialer add-on is not active on this account',
            vapi_not_configured: 'Vapi is not set up yet — paste an API key on /admin/clients',
            no_confirm_assistant: 'the confirm assistant has not been provisioned yet',
            no_reschedule_assistant: 'the reschedule assistant has not been provisioned yet',
          }
          const friendly = reasonMsg[result.reason] || result.reason
          return `Couldn't fire the dial: ${friendly}.`
        }
        const when = new Date(target.scheduled_at).toLocaleString('en-US', {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
        return `Dialer is ringing ${target.attendee_name ?? contactName} now (${when} appointment). I'll ping you with the outcome.`
      } catch (err) {
        console.error('[place_call] failed', err)
        return `Couldn't fire the dial: ${(err as Error).message}.`
      }
    }

    case 'product_help': {
      // Answer using Claude with the PRODUCT_KNOWLEDGE block already in the
      // system prompt. We just relay the topic + raw message back through
      // a quick generation call.
      try {
        const { generateText } = await import('@/lib/claude')
        const reply = await generateText({
          repName: callerMember.display_name,
          prompt: `The rep just asked about: "${intent.topic}"\n\nTheir exact message: "${rawUserText ?? intent.topic}"\n\nAnswer in 1-3 short sentences using ONLY the product knowledge in your system prompt. If the question is not covered there, say so plainly and suggest what they should ask the admin instead. Be direct, no filler.`,
          maxTokens: 280,
        })
        return reply.trim() || `Not sure about that one — ask your admin or check /dashboard.`
      } catch (err) {
        console.error('[product_help] generation failed', err)
        return `Hit an error answering that. Try again or ask your admin.`
      }
    }

    case 'question': {
      return intent.reply
    }

    case 'move_lead_stage': {
      let stages = await findStageByNameForTenant(tenant.id, intent.stage_name)

      // Autonomy: if the rep hasn't set up a pipeline yet, just build a
      // sensible default + the stage they named. They never have to go to
      // the dashboard first.
      if (!stages) {
        const { getPipelinesForRep, createPipeline, addStage } = await import('@/lib/pipelines')
        const existing = await getPipelinesForRep(tenant.id)
        if (!existing.length) {
          // Fresh account → bootstrap a default pipeline + ensure the named stage exists.
          const newPipeline = await createPipeline(tenant.id, 'Sales Pipeline')
          const wantedLower = intent.stage_name.trim().toLowerCase()
          const matched = newPipeline.stages.find((s) => s.name.toLowerCase() === wantedLower)
          if (matched) {
            stages = { ...matched, pipeline_id: newPipeline.id }
          } else {
            const added = await addStage(newPipeline.id, tenant.id, intent.stage_name.trim())
            stages = { ...added, pipeline_id: newPipeline.id }
          }
        } else {
          // They have at least one pipeline but no matching stage — list options.
          const allStageNames = existing.flatMap((p) => p.stages.map((s) => s.name))
          if (!allStageNames.length) {
            return `❓ Your pipeline has no stages yet. Just paste a list and say "build a pipeline to track these" and I'll set it up for you.`
          }
          return `❓ Couldn't find a stage matching "*${intent.stage_name}*". Your stages: ${allStageNames.join(', ')}`
        }
      }

      const lead =
        knownLeads.find((l) => l.name.toLowerCase() === intent.lead_name.toLowerCase()) ??
        knownLeads.find((l) => l.name.toLowerCase().includes(intent.lead_name.toLowerCase()))
      if (!lead) {
        return `❓ Couldn't find a lead matching "*${intent.lead_name}*".`
      }
      const { moveLeadToStage } = await import('@/lib/pipelines')
      const { crmPushed, crmSource } = await moveLeadToStage(
        lead.id,
        tenant.id,
        stages.pipeline_id,
        stages.id,
      )

      // GHL enrichment: add note + enroll in stage workflow. Best-effort — never throws.
      if (crmPushed && crmSource === 'ghl') {
        try {
          const { makeAgentCRMForRep, enrollContactInStageWorkflow } = await import('@/lib/agentcrm')
          const crm = await makeAgentCRMForRep(tenant.id)
          if (crm) {
            // Resolve GHL contact ID. Priority:
            //   1. crm_contact_id (cached contact ID from a previous mirrorLeadToGHL call)
            //   2. getOpportunity(crm_object_id).contactId  ← crm_object_id is the *opportunity* ID
            //   3. searchContacts by email or phone
            const { data: leadRow } = await supabase
              .from('leads')
              .select('crm_object_id, crm_contact_id, email, phone')
              .eq('id', lead.id)
              .maybeSingle()

            let contactId = (leadRow?.crm_contact_id as string | null | undefined) ?? null

            if (!contactId && leadRow?.crm_object_id) {
              const opp = await crm
                .getOpportunity(leadRow.crm_object_id as string)
                .catch(() => null)
              contactId = (opp?.contactId as string | null | undefined) ?? null
              // Cache it so future calls skip this lookup
              if (contactId) {
                void supabase
                  .from('leads')
                  .update({ crm_contact_id: contactId })
                  .eq('id', lead.id)
                  .eq('rep_id', tenant.id)
              }
            }

            if (!contactId) {
              const q = (leadRow?.email as string) || (leadRow?.phone as string) || ''
              if (q) {
                const matches = await crm.searchContacts(q).catch(() => [])
                contactId = matches[0]?.id ?? null
              }
            }

            if (contactId) {
              if (intent.note) {
                await crm
                  .addNote(contactId, `[VirtualCloser] ${intent.note}`)
                  .catch((err) => console.error('[move_lead_stage] addNote failed', err))
              }
              // Enroll in stage-specific GHL workflow if one is configured
              await enrollContactInStageWorkflow(tenant.id, contactId, stages.name)
            }
          }
        } catch (err) {
          console.error('[move_lead_stage] GHL enrichment failed', err)
        }
      }

      const crmNote = crmPushed
        ? ` _(also updated in ${crmSource?.toUpperCase()} — stage move will fire any "${stages.name}" workflows you have configured)_`
        : ''
      return `Moved *${lead.name}* → *${stages.name}*.${crmNote}`
    }

    case 'send_email': {
      return handleSendEmail({ intent, tenant, callerMember })
    }

    case 'send_sms': {
      return handleSendSms({ intent, tenant })
    }

    case 'bulk_import_leads': {
      // Deep parse the raw user message to pull out every prospect.
      if (!rawUserText || rawUserText.trim().length < 80) {
        return `❓ I couldn't see the prospect list — paste it in one message and I'll import everyone.`
      }
      const { extractBulkLeads } = await import('@/lib/claude')
      const { getPipelinesForRep } = await import('@/lib/pipelines')

      const parsed = await extractBulkLeads(rawUserText, tenant.display_name).catch((err) => {
        console.error('[bulk_import] extractor failed', err)
        return null
      })
      if (!parsed || !parsed.leads.length) {
        return `❓ I couldn't extract any prospects from that. Make sure each person has a name on its own line.`
      }

      const wantedName = (intent.pipeline_name || parsed.pipeline_name || 'Sales Pipeline').trim()
      const suggestedKind = (intent.pipeline_kind ?? 'sales') as
        | 'sales'
        | 'recruiting'
        | 'team'
        | 'project'
        | 'custom'

      // If they already have a pipeline with this exact name, skip the kind
      // prompt and go straight to import (kind is already locked in).
      const existing = await getPipelinesForRep(tenant.id)
      const exactMatch = existing.find((p) => p.name.toLowerCase() === wantedName.toLowerCase())
      if (exactMatch) {
        const message = await runBulkImport({
          tenant,
          ownerMemberId,
          parsedLeads: parsed.leads,
          suggestedStages: parsed.suggested_stages,
          wantedName,
          kind: (exactMatch.kind ?? 'sales') as 'sales' | 'recruiting' | 'team' | 'project' | 'custom',
          brainItemQueue,
          ambiguousAgainst: [],
        })
        return message
      }

      // No exact match → ALWAYS ask the rep to confirm board kind. We stash
      // the parsed leads in member.settings so the callback handler can
      // resume the import without re-parsing.
      const stash = {
        wantedName,
        suggestedKind,
        leads: parsed.leads,
        suggested_stages: parsed.suggested_stages,
        ownerMemberId,
        stashed_at: new Date().toISOString(),
      }
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: { ...settingsNow, pending_bulk_import: stash },
      })

      const chatId = callerMember.telegram_chat_id
      if (chatId) {
        const sameKindBoards = existing.filter((p) => (p.kind ?? 'sales') === suggestedKind)
        const heads_up =
          sameKindBoards.length > 0
            ? `\n\nℹ️ You already have ${sameKindBoards.length === 1 ? 'a board' : 'boards'} in this kind: *${sameKindBoards.map((p) => p.name).join('*, *')}*. Tap a kind below to create a new one, or tap Cancel and tell me which existing board to add them to.`
            : ''
        const promptText = `📋 I parsed *${parsed.leads.length}* people from "*${wantedName}*".\n\nWhat kind of board is this?${heads_up}`
        await sendTelegramMessage(chatId, promptText, {
          inlineKeyboard: [
            [
              { text: '💼 Sales', callback_data: 'bulk_kind:sales' },
              { text: '🧑‍💼 Recruiting', callback_data: 'bulk_kind:recruiting' },
            ],
            [
              { text: '👥 Team', callback_data: 'bulk_kind:team' },
              { text: '📂 Project', callback_data: 'bulk_kind:project' },
            ],
            [
              { text: '🗂️ Custom', callback_data: 'bulk_kind:custom' },
              { text: '❌ Cancel', callback_data: 'bulk_kind:cancel' },
            ],
          ],
        })
      }
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// send_email — sends from the rep's connected Gmail account
// ---------------------------------------------------------------------------

async function handleSendEmail(args: {
  intent: { kind: 'send_email'; lead_name: string; subject: string; body: string; to_email?: string | null }
  tenant: { id: string; display_name: string | null }
  callerMember: { display_name: string | null; email: string | null; telegram_chat_id: string | null }
}): Promise<string> {
  const { intent, tenant, callerMember } = args
  const { sendGmailMessage, getTokensForRep } = await import('@/lib/google')

  const leadName = (intent.lead_name ?? '').trim()
  const subject = (intent.subject ?? '').trim()
  const body = (intent.body ?? '').trim()

  if (!leadName || !subject || !body) {
    return `Tell me the subject and body — like "email Dana, subject: Pricing Follow-Up, body: Hey Dana, just checking in on the proposal…"`
  }

  // Resolve email address: prefer explicit override, then lead record.
  let toEmail = (intent.to_email ?? '').trim() || null
  if (!toEmail) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('email, name')
      .eq('rep_id', tenant.id)
      .ilike('name', `%${leadName}%`)
      .limit(1)
      .maybeSingle()
    toEmail = (leadRow?.email as string | null | undefined) ?? null
    if (!toEmail) {
      return `I don't have an email address for *${leadName}*. Send me their email and I'll use it: \`${leadName}'s email is …\``
    }
  }

  // Basic email address sanity check
  if (!toEmail.includes('@') || !toEmail.includes('.')) {
    return `That doesn't look like a valid email address: \`${toEmail}\`. Double-check and try again.`
  }

  // Check Gmail is connected + has the gmail.send scope.
  const tokens = await getTokensForRep(tenant.id)
  if (!tokens) {
    return `Your Google account isn't connected. Go to /dashboard/integrations and connect Google first — then I can send email from your Gmail.`
  }
  // If scope string is available, verify it contains gmail.send.
  if (tokens.scope && !tokens.scope.includes('gmail.send')) {
    return `Your Google connection doesn't have email-send permission yet. Go to /dashboard/integrations, disconnect Google, then reconnect — you'll see a new "Send email" permission to approve.`
  }

  const result = await sendGmailMessage(tenant.id, {
    to: toEmail,
    subject,
    body,
    fromName: callerMember.display_name ?? undefined,
  })

  if (!result.ok) {
    if (result.error === 'gmail_scope_missing') {
      return `Your Google connection needs the email-send permission. Go to /dashboard/integrations, disconnect Google, then reconnect to approve it.`
    }
    if (result.error === 'google_not_connected') {
      return `Google isn't connected. Head to /dashboard/integrations and connect your account first.`
    }
    console.error('[send_email] Gmail send failed', result.error)
    return `The email didn't go through (${result.error ?? 'unknown error'}). Try again or check your Google connection at /dashboard/integrations.`
  }

  return `Email sent to *${leadName}* (${toEmail}).\nSubject: _${subject}_`
}

// ---------------------------------------------------------------------------
// send_sms — sends via the tenant's Twilio account
// ---------------------------------------------------------------------------

async function handleSendSms(args: {
  intent: { kind: 'send_sms'; lead_name: string; message: string; to_phone?: string | null }
  tenant: { id: string }
}): Promise<string> {
  const { intent, tenant } = args

  const leadName = (intent.lead_name ?? '').trim()
  const message = (intent.message ?? '').trim()

  if (!leadName || !message) {
    return `Tell me who to text and what to say — like "text Dana: hey, just checking in on the proposal"`
  }

  // Resolve phone number: prefer explicit override, then lead record.
  // Also capture email + cached crm_contact_id for GHL fallbacks.
  let toPhone = (intent.to_phone ?? '').trim() || null
  let leadEmail: string | null = null
  let cachedGhlContactId: string | null = null

  if (!toPhone) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('phone, email, name, crm_contact_id')
      .eq('rep_id', tenant.id)
      .ilike('name', `%${leadName}%`)
      .limit(1)
      .maybeSingle()
    toPhone = (leadRow?.phone as string | null | undefined) ?? null
    leadEmail = (leadRow?.email as string | null | undefined) ?? null
    cachedGhlContactId = (leadRow?.crm_contact_id as string | null | undefined) ?? null
    if (!toPhone) {
      return `I don't have a phone number for *${leadName}*. Send me their number and I'll save it: \`${leadName}'s phone is …\``
    }
  }

  // ── Path 1: GHL — send through GHL's conversation inbox so it shows up
  //   in GHL and fires any "SMS sent" or "conversation message sent" workflows.
  try {
    const { makeAgentCRMForRep } = await import('@/lib/agentcrm')
    const crm = await makeAgentCRMForRep(tenant.id)
    if (crm) {
      // Use cached contact ID, then phone lookup, then email lookup
      let ghlContactId = cachedGhlContactId
      if (!ghlContactId) {
        ghlContactId = await crm.findContactByPhone(toPhone)
      }
      if (!ghlContactId && leadEmail) {
        const hits = await crm.searchContacts(leadEmail).catch(() => [])
        ghlContactId = hits[0]?.id ?? null
      }

      if (ghlContactId) {
        await crm.sendConversationMessage(ghlContactId, message)
        const preview = message.length > 100 ? message.slice(0, 100) + '…' : message
        return `Text sent to *${leadName}* via GHL (${toPhone}).\n_${preview}_`
      }
      // GHL connected but contact not found — fall through to Twilio
      console.warn('[send_sms] GHL contact not found for', toPhone, '— falling back to Twilio')
    }
  } catch (err) {
    // GHL send failed — log and fall through to Twilio
    console.error('[send_sms] GHL send error, falling back to Twilio', err)
  }

  // ── Path 2: Twilio direct send
  const { sendSms } = await import('@/lib/sms')
  const result = await sendSms(tenant.id, { to: toPhone, body: message })

  if (!result.ok) {
    const reason = result.reason ?? 'unknown'
    if (reason === 'twilio_not_configured') {
      return `Neither GHL nor Twilio is configured. Ask your admin to set up SMS at /admin/clients.`
    }
    if (reason === 'twilio_creds_incomplete') {
      return `Twilio is configured but missing credentials. Ask your admin to complete the Twilio setup.`
    }
    if (reason === 'invalid_to_number') {
      return `The phone number for *${leadName}* doesn't look right (\`${toPhone}\`). Update it and try again.`
    }
    console.error('[send_sms] Twilio send failed', reason)
    return `Text didn't send (${reason}). Check your SMS setup or try again.`
  }

  const preview = message.length > 100 ? message.slice(0, 100) + '…' : message
  return `Text sent to *${leadName}* (${toPhone}).\n_${preview}_`
}

/**
 * Execute the bulk import once we know the board kind. For 'sales' boards
 * the cards are written to the `leads` table (legacy + CRM mirror). For
 * every other kind we write generic cards to `pipeline_items` so the
 * recruiting/team/project boards never pollute the sales CRM.
 *
 * Both paths return the same success message shape.
 */
async function runBulkImport(args: {
  tenant: Tenant
  ownerMemberId: string | null
  parsedLeads: Array<{
    name: string
    company?: string | null
    email?: string | null
    phone?: string | null
    state?: string | null
    age?: number | null
    status?: string | null
    notes?: string | null
    deal_value?: number | null
    action_items?: string[]
    stage_name?: string | null
  }>
  suggestedStages: string[]
  wantedName: string
  kind: 'sales' | 'recruiting' | 'team' | 'project' | 'custom'
  brainItemQueue: Array<{
    item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
    content: string
    priority?: 'low' | 'normal' | 'high'
    horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
    due_date?: string | null
    lead_id?: string | null
  }>
  ambiguousAgainst: Array<{ name: string }>
}): Promise<string> {
  const {
    tenant,
    ownerMemberId,
    parsedLeads,
    suggestedStages,
    wantedName,
    kind,
    brainItemQueue,
    ambiguousAgainst,
  } = args
  const {
    getPipelinesForRep,
    createPipeline,
    addStage,
    deleteStage,
    moveLeadToStage,
    createItem,
  } = await import('@/lib/pipelines')

  // Re-check existing in case state changed between prompt and confirm.
  const existing = await getPipelinesForRep(tenant.id)
  let pipeline = existing.find((p) => p.name.toLowerCase() === wantedName.toLowerCase())

  if (!pipeline) {
    pipeline = await createPipeline(tenant.id, wantedName, { kind })
    // Replace seeded defaults with the rep's mentioned stages, if any.
    if (suggestedStages.length) {
      for (const s of pipeline.stages) {
        await deleteStage(s.id, tenant.id).catch(() => null)
      }
      const newStages = []
      for (const stageName of suggestedStages) {
        const s = await addStage(pipeline.id, tenant.id, stageName)
        newStages.push(s)
      }
      pipeline = { ...pipeline, stages: newStages }
    }
  } else {
    // Existing pipeline — append any missing stages.
    const have = new Set(pipeline.stages.map((s) => s.name.toLowerCase()))
    for (const stageName of suggestedStages) {
      if (!have.has(stageName.toLowerCase())) {
        const s = await addStage(pipeline.id, tenant.id, stageName)
        pipeline.stages.push(s)
      }
    }
  }

  const stageByName = new Map(pipeline.stages.map((s) => [s.name.toLowerCase(), s]))
  const defaultStage = pipeline.stages[0]
  let created = 0

  for (const p of parsedLeads) {
    try {
      const noteParts: string[] = []
      if (p.notes) noteParts.push(p.notes.trim())
      if (p.action_items?.length) {
        noteParts.push(`Action items:\n- ${p.action_items.join('\n- ')}`)
      }
      if (p.phone) noteParts.push(`Phone: ${p.phone}`)
      if (p.state) noteParts.push(`State: ${p.state}`)
      if (typeof p.age === 'number') noteParts.push(`Age: ${p.age}`)
      const combinedNotes = noteParts.join('\n\n') || null

      const stage =
        (p.stage_name && stageByName.get(p.stage_name.toLowerCase())) || defaultStage

      if (kind === 'sales') {
        // Sales path: write to leads (legacy + CRM mirror compatible).
        const lead = await upsertLead({
          repId: tenant.id,
          name: p.name,
          company: p.company ?? null,
          email: p.email ?? null,
          status: (p.status as LeadStatus) || 'warm',
          notes: combinedNotes,
          source: 'telegram_bulk_import',
          ownerMemberId,
        })
        if (typeof p.deal_value === 'number' && p.deal_value > 0) {
          await supabase
            .from('leads')
            .update({ deal_value: p.deal_value, deal_currency: 'USD' })
            .eq('id', lead.id)
            .eq('rep_id', tenant.id)
        }
        if (stage) {
          await moveLeadToStage(lead.id, tenant.id, pipeline.id, stage.id).catch(() => null)
        }
      } else {
        // Non-sales path: write generic items so the recruiting/team/project
        // boards have proper rendering on the kanban.
        const subtitleBits: string[] = []
        if (p.company) subtitleBits.push(p.company)
        if (p.phone) subtitleBits.push(p.phone)
        if (p.email) subtitleBits.push(p.email)
        const subtitle = subtitleBits.join(' · ') || null
        await createItem(tenant.id, pipeline.id, {
          title: p.name,
          subtitle,
          notes: combinedNotes,
          value: typeof p.deal_value === 'number' ? p.deal_value : null,
          pipeline_stage_id: stage?.id ?? null,
          owner_member_id: ownerMemberId,
          metadata: {
            source: 'telegram_bulk_import',
            email: p.email ?? null,
            phone: p.phone ?? null,
            state: p.state ?? null,
            age: p.age ?? null,
            status_hint: p.status ?? null,
          },
        })
      }

      // Per-person action items always become brain_items so the rep has a
      // task list regardless of what kind of board this is.
      if (p.action_items?.length) {
        for (const ai of p.action_items) {
          brainItemQueue.push({
            item_type: 'task',
            content: `${p.name}: ${ai}`,
            priority: p.status === 'hot' ? 'high' : 'normal',
            horizon: 'week',
            due_date: null,
          })
        }
      }
      created++
    } catch (err) {
      console.error('[bulk_import] failed item', p.name, err)
    }
  }

  const stageList = pipeline.stages.map((s) => s.name).join(' → ')
  const kindLabel: Record<typeof kind, string> = {
    sales: 'prospects',
    recruiting: 'candidates',
    team: 'teammates',
    project: 'tasks',
    custom: 'cards',
  }
  const noun = kindLabel[kind]
  const heads_up =
    ambiguousAgainst.length > 0
      ? `\n\nℹ️ Heads up — you already have boards: *${ambiguousAgainst.map((p) => p.name).join('*, *')}*. I created *${pipeline.name}* as a new one.`
      : ''

  const tipLine =
    kind === 'sales'
      ? '\n\n💡 *Try:* "Move Bryant to Quoted" · "Bryant is a $15k deal" · "Pipeline" → see board'
      : '\n\n💡 *Try:* drag cards between stages on /dashboard/pipeline, or "+ Add card" inside any stage'

  return `✅ Imported *${created}* ${noun} into *${pipeline.name}*${kind !== 'sales' ? ` (${kind} board)` : ''}.\nStages: ${stageList}\n\nView → /dashboard/pipeline${heads_up}${tipLine}`
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
 * Two-step booking flow for `book_meeting`. We don't write to Google
 * Calendar until we have a clean title + (optional) notes from the rep,
 * so the calendar entry doesn't end up with the entire user message as
 * its title. State is stashed in `member.settings.pending_meeting`.
 *
 * Returns the reply string to send back, or null if no reply is needed
 * (in practice we always return something, even on cancel/error).
 */
async function handlePendingMeetingPrompt(
  rawText: string,
  tenant: Tenant,
  member: Member,
  settings: Record<string, unknown>,
  pending: 'await_meeting_title' | 'await_meeting_notes',
): Promise<string | null> {
  const text = (rawText ?? '').trim()
  const lower = text.toLowerCase()
  const tz = member.timezone || tenant.timezone || 'UTC'
  type PendingMeeting = {
    startIso: string
    endIso: string
    contactName: string
    attendeeEmail: string | null
    defaultSummary: string
    initialNotes: string | null
    conflict: { startIso: string; endIso: string } | null
    taskDueDate: string
    title?: string
  }
  const pm = (settings.pending_meeting as PendingMeeting | null) ?? null

  const clearPending = async () => {
    await updateMember(member.id, {
      settings: { ...settings, pending_action: null, pending_meeting: null },
    })
  }

  if (!pm) {
    await clearPending()
    return 'Lost the booking draft — say it again and I\u2019ll re-prompt for the title.'
  }

  if (/^(cancel|stop|nevermind|never mind|abort|forget it)\b/.test(lower)) {
    await clearPending()
    return '🚫 Booking cancelled — nothing was added to your calendar.'
  }

  if (pending === 'await_meeting_title') {
    const useDefault = /^(default|skip|none|no title|use default)\b/.test(lower) || text === ''
    const title = useDefault ? pm.defaultSummary : text.slice(0, 120)
    await updateMember(member.id, {
      settings: {
        ...settings,
        pending_action: 'await_meeting_notes',
        pending_meeting: { ...pm, title },
      },
    })
    return [
      `Title set to *${title}*.`,
      '',
      'Any notes or agenda for the event? Reply with the notes, or `skip` to leave it blank.',
    ].join('\n')
  }

  // pending === 'await_meeting_notes' → finalize the booking.
  const skipNotes = /^(skip|none|no|n\/?a|nope|nothing)\b/.test(lower) || text === ''
  const notes = skipNotes
    ? pm.initialNotes ?? 'Booked via Virtual Closer Telegram bot.'
    : text.slice(0, 2000)
  const title = pm.title ?? pm.defaultSummary

  let ev: Awaited<ReturnType<typeof createCalendarEvent>> | null = null
  try {
    ev = await createCalendarEvent({
      repId: tenant.id,
      summary: title,
      description: notes,
      startIso: pm.startIso,
      endIso: pm.endIso,
      timezone: tz,
      attendees: pm.attendeeEmail
        ? [{ email: pm.attendeeEmail, displayName: pm.contactName }]
        : undefined,
    })
  } catch (err) {
    console.error('[telegram] createCalendarEvent failed', err)
  }

  // Mirror as a follow-up task so it appears in the dashboard.
  try {
    const dump = await createBrainDump({
      repId: tenant.id,
      rawText: `Booked: ${title}`,
      summary: '',
      source: 'mic',
      ownerMemberId: member.id,
    })
    await createBrainItems(
      tenant.id,
      dump.id,
      [
        {
          item_type: 'task',
          content: `${title} — ${new Date(pm.startIso).toLocaleString('en-US', { timeZone: tz })}`,
          priority: 'high',
          horizon: 'day',
          due_date: pm.taskDueDate,
        },
      ],
      member.id,
    )
  } catch (err) {
    console.error('[telegram] booking brain-item mirror failed', err)
  }

  await clearPending()

  const whenStr = new Date(pm.startIso).toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  if (!ev) {
    return `📅 Couldn't reach Google Calendar — saved *${title}* as a task for ${whenStr}. Connect Google on your dashboard to auto-book next time.`
  }
  const conflictWarning = pm.conflict
    ? `\n⚠️ Heads up — you already had something on your calendar from ${new Date(pm.conflict.startIso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })} to ${new Date(pm.conflict.endIso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}. Both events are now on the books — reply *cancel last* or move one if needed.`
    : ''
  return `📅 Booked *${title}* for ${whenStr}${pm.attendeeEmail ? ` with ${pm.attendeeEmail}` : ''} — added to your Google Calendar.${conflictWarning}`
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

