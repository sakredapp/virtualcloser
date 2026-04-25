const TELEGRAM_API = 'https://api.telegram.org'

type TgSendResult = { ok: boolean; message_id?: number }

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  opts?: { replyToMessageId?: number },
): Promise<TgSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false }
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_to_message_id: opts?.replyToMessageId,
    }),
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
 * Markdown caption. Use the same file_id we received on the inbound webhook —
 * Telegram lets us reuse it across chats.
 */
export async function sendTelegramVoice(
  chatId: string | number,
  fileId: string,
  caption?: string,
  opts?: { replyToMessageId?: number },
): Promise<TgSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false }
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendVoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      voice: fileId,
      caption,
      parse_mode: caption ? 'Markdown' : undefined,
      reply_to_message_id: opts?.replyToMessageId,
    }),
  })
  if (!res.ok) return { ok: false }
  try {
    const j = (await res.json()) as { ok?: boolean; result?: { message_id?: number } }
    return { ok: !!j.ok, message_id: j.result?.message_id }
  } catch {
    return { ok: true }
  }
}

export function telegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? 'VirtualCloserBot'
}
