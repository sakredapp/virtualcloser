import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { sendTelegramMessage } from '@/lib/telegram'
import type { Tenant } from '@/lib/tenant'
import type { Lead } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── BlueBubbles webhook payload shape ──────────────────────────────────────
type BBHandle = { address: string; country?: string }
type BBChat   = { guid: string }
type BBMessageData = {
  guid?: string
  text?: string | null
  handle?: BBHandle
  chats?: BBChat[]
  isFromMe?: boolean
  dateCreated?: number
  attachments?: Array<{ transferName?: string; mimeType?: string }>
}
type BBWebhookBody = {
  type?: string
  data?: BBMessageData
}

// Normalise a phone number to E.164-ish for DB matching: strip all non-digits,
// prefix +1 if it looks like a US number without country code.
function normalisePhone(raw: string): string {
  // Extract only the iMessage handle part after the last semicolon
  // e.g. "iMessage;-;+15551234567" → "+15551234567"
  const stripped = raw.split(';').pop() ?? raw
  const digits = stripped.replace(/\D/g, '')
  if (!stripped.startsWith('+')) {
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  }
  return stripped
}

// Find a lead in this tenant's lead table by phone number (loose match).
async function findLeadByPhone(repId: string, handle: string): Promise<Lead | null> {
  // Try exact match first
  const { data: exact } = await supabase
    .from('leads')
    .select('*')
    .eq('rep_id', repId)
    .eq('phone', handle)
    .maybeSingle()
  if (exact) return exact as Lead

  // Try stripping formatting — search by last 10 digits
  const digits = handle.replace(/\D/g, '')
  if (digits.length >= 10) {
    const last10 = digits.slice(-10)
    const { data: rows } = await supabase
      .from('leads')
      .select('*')
      .eq('rep_id', repId)
      .ilike('phone', `%${last10}`)
      .limit(1)
    if (rows && rows.length > 0) return rows[0] as Lead
  }

  // Try matching by email if it looks like one (Apple ID can be an email)
  if (handle.includes('@')) {
    const { data: byEmail } = await supabase
      .from('leads')
      .select('*')
      .eq('rep_id', repId)
      .ilike('email', handle)
      .maybeSingle()
    if (byEmail) return byEmail as Lead
  }

  return null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> },
) {
  const { repId } = await params

  // Load the rep and verify they have BlueBubbles configured.
  const { data: repRow } = await supabase
    .from('reps')
    .select('id, display_name, telegram_chat_id, integrations, is_active')
    .eq('id', repId)
    .maybeSingle()

  if (!repRow || !repRow.is_active) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const tenant = repRow as Tenant & { integrations: Record<string, string> | null }
  const integrations = (tenant.integrations ?? {}) as Record<string, string>
  const bbPassword = integrations.bluebubbles_password

  if (!integrations.bluebubbles_url || !bbPassword) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 400 })
  }

  // Optional password verification via ?pw= query param.
  // Clients configure their BB webhook URL as:
  //   https://virtualcloser.com/api/webhooks/bluebubbles/<repId>?pw=<their_bb_password>
  // This adds a second layer of auth on top of the hard-to-guess repId UUID.
  const pw = req.nextUrl.searchParams.get('pw')
  if (pw) {
    // Constant-time comparison to prevent timing attacks.
    const a = Buffer.from(pw)
    const b = Buffer.from(bbPassword)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
  }

  let body: BBWebhookBody
  try {
    body = (await req.json()) as BBWebhookBody
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  // Only process inbound messages (isFromMe = false).
  // BlueBubbles also fires webhooks for sent messages — ignore those.
  const type = body.type ?? ''
  const data = body.data ?? {}
  if (!['new-message', 'updated-message'].includes(type)) {
    return NextResponse.json({ ok: true, skipped: true })
  }
  if (data.isFromMe === true) {
    return NextResponse.json({ ok: true, skipped: 'from_me' })
  }

  const messageText = (data.text ?? '').trim()
  const rawHandle = data.handle?.address ?? data.chats?.[0]?.guid ?? null

  if (!rawHandle || !messageText) {
    return NextResponse.json({ ok: true, skipped: 'no_handle_or_text' })
  }

  const handle = normalisePhone(rawHandle)
  const messageGuid = data.guid ?? null

  // Find matching lead
  const lead = await findLeadByPhone(repId, handle)

  // Store in outbound_messages (direction=inbound)
  const { data: msgRow, error: msgErr } = await supabase
    .from('outbound_messages')
    .insert({
      rep_id: repId,
      lead_id: lead?.id ?? null,
      channel: 'imessage',
      direction: 'inbound',
      to_address: handle,
      body: messageText,
      status: 'delivered',
      external_id: messageGuid,
      metadata: { handle, lead_id: lead?.id ?? null },
    })
    .select('id')
    .single()

  if (msgErr) {
    console.error('[bb/webhook] insert failed:', msgErr)
    // Don't return error — still try to notify the rep
  }

  const msgRowId = msgRow?.id ?? null

  // Send Telegram notification to the rep's chat
  const tgChat = tenant.telegram_chat_id
  if (!tgChat) {
    return NextResponse.json({ ok: true, notified: false, reason: 'no_telegram' })
  }

  const senderName = lead?.name ?? handle
  const companyLine = lead?.company ? ` · ${lead.company}` : ''

  const notifText = [
    `📱 *${senderName}*${companyLine} texted you:`,
    '',
    `"${messageText}"`,
    '',
    `_Reply to this message to respond via iMessage_`,
  ].join('\n')

  const sent = await sendTelegramMessage(tgChat, notifText)

  // Store the Telegram message_id so we can match replies later
  if (sent.ok && sent.message_id && msgRowId) {
    await supabase
      .from('outbound_messages')
      .update({
        metadata: {
          handle,
          lead_id: lead?.id ?? null,
          tg_notification_id: sent.message_id,
          sender_name: senderName,
        },
      })
      .eq('id', msgRowId)
  }

  return NextResponse.json({ ok: true, notified: !!sent.ok, lead_matched: !!lead })
}
