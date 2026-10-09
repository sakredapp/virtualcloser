/**
 * One timestamp for the executive pages: when the book of business last
 * synced from Airtable. The header stamp, the eyebrow and the footer all read
 * this, so they can never disagree (the cache rebuild time is not shown:
 * rebuilding the cache does not make the numbers any newer).
 */
export function syncedAtOf(data: {
  lastRun?: { started_at: string; finished_at: string | null } | null
  computedAt?: string | null
}): string | null {
  return data.lastRun?.finished_at ?? data.lastRun?.started_at ?? data.computedAt ?? null
}

/** "Last synced today 5:31am" / "yesterday 9:02pm" / "Oct 3 8:00am", in `timeZone` (viewer's when omitted). */
export function syncStampLabel(iso: string, now: Date = new Date(), timeZone?: string): string {
  const d = new Date(iso)
  const dayKey = (x: Date) => x.toLocaleDateString('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const time = d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '')
  const day = dayKey(d) === dayKey(now)
    ? 'today'
    : dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))
      ? 'yesterday'
      : d.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })
  return `Last synced ${day} ${time}`
}
