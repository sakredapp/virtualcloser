/**
 * Formatting helpers for the Mira agent.
 */

/**
 * Render a date-only ISO ('YYYY-MM-DD') in a friendly form for chat replies.
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
