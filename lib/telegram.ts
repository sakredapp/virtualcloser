const TELEGRAM_API = 'https://api.telegram.org'

type TgSendResult = { ok: boolean; message_id?: number }

export type TgInlineKeyboard = Array<Array<{ text: string; callback_data: string }>>

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  opts?: { replyToMessageId?: number; inlineKeyboard?: TgInlineKeyboard },
): Promise<TgSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
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
  opts?: { replyToMessageId?: number; inlineKeyboard?: TgInlineKeyboard },
): Promise<TgSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
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
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
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
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
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

export function telegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? 'VirtualCloserBot'
}
