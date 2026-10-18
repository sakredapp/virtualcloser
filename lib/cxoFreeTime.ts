/**
 * "When am I free?" — the pure part of Ciao's find_free_time tool
 * (lib/agent/cxoTools.ts). Given busy blocks from Google's freeBusy API
 * (lib/google getBusySlots, one call per connected account), it returns the
 * open stretches inside working hours in the person's timezone, labelled in
 * plain words. No I/O here, so it is tested directly.
 */

export type BusyBlock = { startIso: string; endIso: string }
export type FreeWindow = { startIso: string; endIso: string; minutes: number; label: string }

/** Minutes the zone is ahead of UTC at this instant (New York in October = -240). */
export function zoneOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** The local calendar date (y, m 1-12, d) and weekday (0 = Sunday) of an instant in a zone. */
function localDate(ms: number, tz: string): { y: number; m: number; d: number; wd: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd }
}

/** The instant a local wall-clock time happens in a zone (DST-safe: the offset is re-read at the answer). */
export function localToUtcMs(y: number, m: number, d: number, hour: number, minute: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d, hour, minute)
  let ms = naive - zoneOffsetMinutes(new Date(naive), tz) * 60_000
  ms = naive - zoneOffsetMinutes(new Date(ms), tz) * 60_000
  return ms
}

/**
 * The default window: from now through the end of the 5th business day
 * (today counts when it is a weekday).
 */
export function businessDaysWindow(nowMs: number, tz: string, days = 5): { fromIso: string; toIso: string } {
  let { y, m, d } = localDate(nowMs, tz)
  let counted = 0
  let endMs = nowMs
  for (let i = 0; i < 14 && counted < days; i++) {
    const noon = localToUtcMs(y, m, d, 12, 0, tz)
    const wd = localDate(noon, tz).wd
    if (wd !== 0 && wd !== 6) {
      counted++
      endMs = localToUtcMs(y, m, d, 23, 59, tz)
    }
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate()
  }
  return { fromIso: new Date(nowMs).toISOString(), toIso: new Date(endMs).toISOString() }
}

function fmtDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms))
}
function fmtTime(ms: number, tz: string, zone = false): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', ...(zone ? { timeZoneName: 'short' as const } : {}) }).format(new Date(ms))
}

/**
 * One meeting's own time range, always with minutes and one AM/PM when both
 * ends share it: "1:00 – 2:45 PM", "11:30 AM – 1:00 PM". Each meeting gets its
 * own label, so two overlapping meetings are never read as one garbled range.
 */
export function timeRangeLabel(startMs: number, endMs: number, tz: string): string {
  const parts = (ms: number) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))
    const hm = f.filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal').map((p) => p.value).join('').trim()
    const ap = (f.find((p) => p.type === 'dayPeriod')?.value ?? '').toUpperCase()
    return { hm, ap }
  }
  const a = parts(startMs)
  const b = parts(endMs)
  return a.ap === b.ap ? `${a.hm} – ${b.hm} ${b.ap}` : `${a.hm} ${a.ap} – ${b.hm} ${b.ap}`
}

/** "Mon, Oct 19, 9:00 AM – 11:30 AM EDT" */
export function windowLabel(startMs: number, endMs: number, tz: string): string {
  return `${fmtDay(startMs, tz)}, ${fmtTime(startMs, tz)} – ${fmtTime(endMs, tz, true)}`
}

/**
 * Open stretches of at least `durationMin` inside working hours, earliest
 * first, at most `max`. Busy blocks from every calendar are merged first, so
 * an overlap across two calendars is one block. Weekends are skipped unless
 * includeWeekends. Nothing starts before now + 5 minutes; starts round up to
 * the next quarter hour.
 */
export function findFreeWindows(
  busy: BusyBlock[],
  opts: { fromIso: string; toIso: string; tz: string; durationMin?: number; startHour?: number; endHour?: number; max?: number; includeWeekends?: boolean; nowMs?: number },
): FreeWindow[] {
  const tz = opts.tz || 'UTC'
  const dur = Math.max(5, opts.durationMin ?? 30) * 60_000
  const startHour = Math.min(Math.max(opts.startHour ?? 9, 0), 23)
  const endHour = Math.min(Math.max(opts.endHour ?? 17, startHour + 1), 24)
  const max = Math.min(Math.max(opts.max ?? 8, 1), 20)
  const quarter = 15 * 60_000
  const earliest = Math.ceil(Math.max(new Date(opts.fromIso).getTime(), (opts.nowMs ?? Date.now()) + 5 * 60_000) / quarter) * quarter
  const latest = new Date(opts.toIso).getTime()
  if (!(latest > earliest)) return []

  const blocks = busy
    .map((b) => ({ s: new Date(b.startIso).getTime(), e: new Date(b.endIso).getTime() }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s)
    .sort((a, b) => a.s - b.s)
  const merged: Array<{ s: number; e: number }> = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e)
    else merged.push({ ...b })
  }

  const out: FreeWindow[] = []
  let { y, m, d } = localDate(earliest, tz)
  for (let i = 0; i < 62 && out.length < max; i++) {
    const dayStart = localToUtcMs(y, m, d, startHour, 0, tz)
    if (dayStart > latest) break
    const wd = localDate(localToUtcMs(y, m, d, 12, 0, tz), tz).wd
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    const day = { y, m, d }
    y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate()
    if (!opts.includeWeekends && (wd === 0 || wd === 6)) continue
    const dayEnd = endHour === 24 ? localToUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz) : localToUtcMs(day.y, day.m, day.d, endHour, 0, tz)
    let cursor = Math.max(dayStart, earliest)
    const stop = Math.min(dayEnd, latest)
    for (const b of merged) {
      if (b.e <= cursor) continue
      if (b.s >= stop) break
      if (b.s - cursor >= dur) out.push({ startIso: new Date(cursor).toISOString(), endIso: new Date(b.s).toISOString(), minutes: Math.round((b.s - cursor) / 60_000), label: windowLabel(cursor, b.s, tz) })
      cursor = Math.max(cursor, b.e)
      if (out.length >= max) break
    }
    if (out.length < max && stop - cursor >= dur) out.push({ startIso: new Date(cursor).toISOString(), endIso: new Date(stop).toISOString(), minutes: Math.round((stop - cursor) / 60_000), label: windowLabel(cursor, stop, tz) })
  }
  return out.slice(0, max)
}

/** Granted scopes allow a freeBusy query. Unknown (null, an older row) = assume yes and let Google answer. */
export function scopeAllowsFreeBusy(scope: string | null | undefined): boolean {
  if (!scope) return true
  const s = scope.split(/\s+/)
  return s.some((x) => /\/auth\/calendar(\.readonly|\.freebusy|\.events|\.events\.readonly|\.events\.freebusy)?$/.test(x))
}

/** Granted scopes allow creating a spreadsheet (Sheets API spreadsheets.create). */
export function scopeAllowsSheets(scope: string | null | undefined): boolean {
  if (!scope) return true
  const s = scope.split(/\s+/)
  return s.some((x) => /\/auth\/(spreadsheets|drive|drive\.file)$/.test(x))
}
