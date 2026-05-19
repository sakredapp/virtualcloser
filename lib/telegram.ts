import {
  brandTelegramToken,
  brandTelegramUsername,
  type BrandKey,
} from './brand'
import { currentBrand } from './telegram-context'

const TELEGRAM_API = 'https://api.telegram.org'

type TgSendResult = { ok: boolean; message_id?: number }

export type TgInlineKeyboard = Array<Array<{ text: string; callback_data: string }>>

/**
 * Brand-aware bot token resolver. Three-level priority:
 *   1. Explicit `brand` argument (CRM jobs, scheduled fanout, etc.)
 *   2. AsyncLocalStorage brand (set at the webhook route entry — every
 *      outbound call inside that request automatically uses the right bot)
 *   3. Default to VirtualCloser (legacy behavior)
 */
function resolveToken(brand?: BrandKey): string | undefined {
  return brandTelegramToken(brand ?? currentBrand() ?? 'virtualcloser')
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  opts?: {
    replyToMessageId?: number
    inlineKeyboard?: TgInlineKeyboard
    brand?: BrandKey
  },
): Promise<TgSendResult> {
  const token = resolveToken(opts?.brand)
  if (!token) return { ok: false }
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  }
  if (opts?.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId
  if (opts?.inlineKeyboard) body.reply_markup = { inline_keyboard: opts.inlineKeyboard }
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false }
  try {
    const j = (await res.json()) as { ok?: boolean; result?: { message_id?: number } }
    return { ok: !!j.ok, message_id: j.result?.message_id }
  } catch {
    return { ok: true }
  }
}

/**
 * Forward a voice file (by Telegram file_id) to another chat with an optional
 * Markdown caption + optional inline keyboard.
 */
export async function sendTelegramVoice(
  chatId: string | number,
  fileId: string,
  caption?: string,
  opts?: {
    replyToMessageId?: number
    inlineKeyboard?: TgInlineKeyboard
    brand?: BrandKey
  },
): Promise<TgSendResult> {
  const token = resolveToken(opts?.brand)
  if (!token) return { ok: false }
  const body: Record<string, unknown> = {
    chat_id: chatId,
    voice: fileId,
  }
  if (caption) {
    body.caption = caption
    body.parse_mode = 'Markdown'
  }
  if (opts?.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId
  if (opts?.inlineKeyboard) body.reply_markup = { inline_keyboard: opts.inlineKeyboard }
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendVoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false }
  try {
    const j = (await res.json()) as { ok?: boolean; result?: { message_id?: number } }
    return { ok: !!j.ok, message_id: j.result?.message_id }
  } catch {
    return { ok: true }
  }
}

/** Acknowledge a callback_query (so the client stops the loading spinner). */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  opts?: { brand?: BrandKey },
): Promise<void> {
  const token = resolveToken(opts?.brand)
  if (!token) return
  await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text?.slice(0, 200) }),
  })
}

/** Strip the inline keyboard off a previously-sent message (post-decision). */
export async function editTelegramReplyMarkup(
  chatId: string | number,
  messageId: number,
  inlineKeyboard?: TgInlineKeyboard,
  opts?: { brand?: BrandKey },
): Promise<void> {
  const token = resolveToken(opts?.brand)
  if (!token) return
  await fetch(`${TELEGRAM_API}/bot${token}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : { inline_keyboard: [] },
    }),
  })
}

/**
 * Bot username for the given brand. Used by the invite email so each new
 * member is pointed at the right `t.me/<bot>?start=<code>` link.
 * Falls back to the request-scoped brand (ALS), then to VC.
 */
export function telegramBotUsername(brand?: BrandKey): string {
  return brandTelegramUsername(brand ?? currentBrand() ?? 'virtualcloser')
}
