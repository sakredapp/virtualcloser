import { NextRequest, NextResponse } from 'next/server'
import {
  createBrainDump,
  createBrainItems,
  getRecentLeadNames,
  supabase,
  upsertLead,
} from '@/lib/supabase'
import { interpretTelegramMessage, type TelegramIntent } from '@/lib/claude'
import { sendTelegramMessage, telegramBotUsername } from '@/lib/telegram'
import { transcribeTelegramVoice } from '@/lib/transcribe'
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
        'Try it:',
        '• "Call Dana Thursday about pricing"',
        '• "Goal: close 10 deals this month"',
        '• "Nina was a no-show, reschedule her for next week"',
      ].join('\n'),
    )
    return NextResponse.json({ ok: true })
  }

  // ── /help ───────────────────────────────────────────────────────────────
  if (/^\/help\b/i.test(text)) {
    await sendTelegramMessage(
      chatId,
      [
        '*How I work*',
        'Just message me like you\'d tell an assistant. Examples:',
        '• "New prospect Dana Kim at Acme, seems hot — follow up Thursday on pricing"',
        '• "Just called Ben, he\'s warm, wants a demo next week"',
        '• "Nina\'s gone dormant, dead deal"',
        '• "Goal: close 10 deals this month"',
        '• "Remind me tomorrow to call the HVAC leads"',
        '',
        '*Commands*',
        '/link CODE — connect this Telegram to your dashboard',
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
      return `📅 Follow-up with *${leadLabel}* on ${intent.due_date}: ${intent.content}`
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

    case 'question': {
      return intent.reply
    }
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    bot: telegramBotUsername(),
    hint: 'Point Telegram setWebhook at this URL with a secret_token.',
  })
}
