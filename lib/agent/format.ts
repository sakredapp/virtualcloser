/**
 * Telegram message formatting helpers for the agent.
 *
 * The agent emits plain Markdown. The webhook already calls
 * sendTelegramMessage(), which uses Telegram's classic 'Markdown' parse_mode
 * (NOT MarkdownV2) \u2014 so we just need to keep the agent's output compatible
 * with that parser and chunk anything over the 4096-char hard limit.
 *
 * We intentionally don't escape markdown characters: the agent is producing
 * its own text and the model already knows how to use bold/italic carefully.
 * If we hit a parse error in the wild, sendTelegramMessage() retries plain.
 */

const TG_MAX = 3900 // leave headroom for parse_mode + emoji byte expansion

/**
 * Split `text` into Telegram-safe chunks of <= TG_MAX chars, preferring
 * paragraph breaks then line breaks then sentence boundaries.
 */
export function chunkForTelegram(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= TG_MAX) return [trimmed]

  const out: string[] = []
  let remaining = trimmed
  while (remaining.length > TG_MAX) {
    let cut = remaining.lastIndexOf('\n\n', TG_MAX)
    if (cut < TG_MAX * 0.5) cut = remaining.lastIndexOf('\n', TG_MAX)
    if (cut < TG_MAX * 0.5) cut = remaining.lastIndexOf('. ', TG_MAX)
    if (cut < TG_MAX * 0.5) cut = TG_MAX
    out.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) out.push(remaining)
  return out
}

/**
 * Render a date-only ISO ('YYYY-MM-DD') in a friendly form for Telegram.
 * Examples: "today", "tomorrow", "Mon May 4".
 */
export function friendlyDate(iso: string | null | undefined, todayIso: string): string {
  if (!iso) return ''
  if (iso === todayIso) return 'today'
  const today = new Date(todayIso + 'T12:00:00Z')
  const target = new Date(iso + 'T12:00:00Z')
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days >= 2 && days <= 6) {
    return target.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  }
  if (days < 0 && days >= -7) {
    return `${Math.abs(days)}d overdue`
  }
  return target.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
