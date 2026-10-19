/**
 * Calendar facts Ciao connects to other work (Ciao QA 2026-10-18). Pure, no I/O.
 *
 *  - firstOccurrences: the first few dates of a repeating event, so a proposed
 *    weekly 1:1 is checked for clashes beyond its first date.
 *  - meetingTimeInText: the meeting time a reply draft accepts ("Tuesday at
 *    2pm works"), so the draft can be checked against the calendar.
 */
import type { Recurrence } from '@/lib/cxoRecurrence'
import { localToUtcMs } from '@/lib/cxoFreeTime'

export type Occurrence = { startIso: string; endIso: string }

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

/** The local calendar date and wall time of an instant in tz. */
function localParts(iso: string, tz: string): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') % 24, mm: get('minute') }
}

/** A plain date as a UTC-midnight day number, so date maths never meets a timezone. */
const dayNum = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
const fromDayNum = (n: number) => {
  const dt = new Date(n * 86_400_000)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() }
}

/**
 * The first `n` occurrences of a repeating event that starts at startIso (its
 * first time) and lasts until endIso, keeping the same wall-clock time in tz
 * across daylight-saving changes. Follows FREQ, INTERVAL, BYDAY, COUNT and
 * UNTIL as Google does for the rules parseRecurrence accepts.
 */
export function firstOccurrences(rec: Pick<Recurrence, 'freq' | 'interval' | 'byDay' | 'count' | 'until'>, startIso: string, endIso: string, tz: string, n = 4): Occurrence[] {
  const durMs = Math.max(0, Date.parse(endIso) - Date.parse(startIso))
  const s = localParts(startIso, tz)
  const d0 = dayNum(s.y, s.m, s.d)
  const until = rec.until ? dayNum(Number(rec.until.slice(0, 4)), Number(rec.until.slice(4, 6)), Number(rec.until.slice(6, 8))) : null
  const cap = Math.min(n, rec.count ?? n)
  const interval = Math.max(1, rec.interval || 1)
  const days = new Set(rec.byDay)
  const out: Occurrence[] = []
  const push = (dn: number): boolean => {
    if (until !== null && dn > until) return false
    const p = fromDayNum(dn)
    const ms = localToUtcMs(p.y, p.m, p.d, s.hh, s.mm, tz)
    out.push({ startIso: new Date(ms).toISOString(), endIso: new Date(ms + durMs).toISOString() })
    return out.length < cap
  }
  // Bounded walk: 400 steps covers every rule we accept for the first few dates.
  for (let k = 0, guard = 0; guard < 400; guard++) {
    if (rec.freq === 'DAILY') {
      const dn = d0 + guard
      if (guard % interval === 0 && (!days.size || days.has(DAY_CODES[fromDayNum(dn).dow]))) {
        if (!push(dn)) break
      }
    } else if (rec.freq === 'WEEKLY') {
      if (!days.size) {
        if (!push(d0 + 7 * interval * k++)) break
        continue
      }
      // Weeks start Monday (Google's default WKST); every `interval` weeks from the first one.
      const dn = d0 + guard
      const mondayOf = (x: number) => x - ((fromDayNum(x).dow + 6) % 7)
      const weekIdx = Math.round((mondayOf(dn) - mondayOf(d0)) / 7)
      if (weekIdx % interval === 0 && days.has(DAY_CODES[fromDayNum(dn).dow])) {
        if (!push(dn)) break
      }
    } else {
      // MONTHLY / YEARLY: the same day of the month; a month without that day is skipped.
      const step = rec.freq === 'MONTHLY' ? interval * guard : 12 * interval * guard
      const mi = s.m - 1 + step
      const y = s.y + Math.floor(mi / 12)
      const m = (mi % 12) + 1
      if (new Date(Date.UTC(y, m - 1, s.d)).getUTCMonth() !== m - 1) continue
      if (!push(dayNum(y, m, s.d))) break
    }
  }
  return out
}

/**
 * Where a repeating event really starts (Ciao QA 2026-10-19): "weekly 1:1 every
 * Monday at 9 for 10 weeks" asked Monday at 7:55am started a week later and
 * silently skipped today's 9am. The first occurrence is the next slot that
 * matches the rule and is still in the future, today included when its time
 * has not passed. The rule's days come from BYDAY, or for a rule without BYDAY
 * from the proposed start (its weekday, day of the month, or date). The
 * proposed wall-clock time and length are kept. Returns the proposed start
 * when it already is that slot, or when the person named a later first date
 * (keepLater). Pure.
 */
export function firstFutureStart(
  rec: Pick<Recurrence, 'freq' | 'byDay'>,
  startIso: string,
  endIso: string,
  tz: string,
  now: Date,
  opts: { keepLater?: boolean } = {},
): Occurrence & { moved: boolean; isToday: boolean } {
  const durMs = Math.max(0, Date.parse(endIso) - Date.parse(startIso))
  const s = localParts(startIso, tz)
  const t = localParts(now.toISOString(), tz)
  const today = dayNum(t.y, t.m, t.d)
  const startDow = fromDayNum(dayNum(s.y, s.m, s.d)).dow
  const days = new Set(rec.byDay)
  const matches = (dn: number): boolean => {
    const p = fromDayNum(dn)
    if (rec.freq === 'DAILY') return !days.size || days.has(DAY_CODES[p.dow])
    if (rec.freq === 'WEEKLY') return days.size ? days.has(DAY_CODES[p.dow]) : p.dow === startDow
    if (rec.freq === 'MONTHLY') return p.d === s.d
    return p.m === s.m && p.d === s.d
  }
  const nowMs = now.getTime()
  const startMs = Date.parse(startIso)
  // 800 days covers a yearly rule (and a Feb 29 one) from any day.
  for (let k = 0; k < 800; k++) {
    const dn = today + k
    if (!matches(dn)) continue
    const p = fromDayNum(dn)
    const ms = localToUtcMs(p.y, p.m, p.d, s.hh, s.mm, tz)
    if (ms <= nowMs) continue
    // The proposed start is in the future and the person named it: keep it.
    if (opts.keepLater && startMs > nowMs) break
    if (ms === startMs) break
    return { startIso: new Date(ms).toISOString(), endIso: new Date(ms + durMs).toISOString(), moved: true, isToday: k === 0 }
  }
  const sp = localParts(startIso, tz)
  return { startIso, endIso, moved: false, isToday: dayNum(sp.y, sp.m, sp.d) === today }
}

const WEEKDAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 }
const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 }

/** Words that say the reply takes (or offers) a time, not that it turns one down. */
const ACCEPT_RE = /\b(works?( for me| great| well)?|that works|see you|confirm(ed)?|sounds good|i can do|i can make|let'?s do|lets do|perfect|i'?ll be there|count me in|happy to (meet|chat|talk)|book(ed)? (it|that)|(i am|i'?m) (free|available)|looking forward|talk (to you )?then|speak then)\b/i
const DECLINE_RE = /\b(can'?t|cannot|won'?t|not able|unable|doesn'?t work|does not work|no longer)\b/i

/**
 * The meeting time a reply accepts, as an instant in tz, or null. Needs a day
 * (today, tomorrow, a weekday, "Oct 22", "10/22") and a time ("2pm", "2:30 pm",
 * "14:00", "noon") and words that accept it. todayIso is the person's local date.
 */
export function meetingTimeInText(text: string, todayIso: string, tz: string): { startIso: string; matched: string } | null {
  const t = text.replace(/\s+/g, ' ')
  if (!ACCEPT_RE.test(t)) return null
  const timeRe = /\b(noon|midday|(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|([01]?\d|2[0-3]):([0-5]\d))\b/i
  const dayRe = new RegExp(
    `\\b(today|tomorrow|(?:next |this )?(${Object.keys(WEEKDAYS).join('|')})|(${Object.keys(MONTHS).join('|')})\\.? (\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})/(\\d{1,2}))\\b`,
    'i',
  )
  // Look sentence by sentence so a day and a time from different sentences are never joined.
  for (const sentence of t.split(/(?<=[.!?\n])\s+/)) {
    if (DECLINE_RE.test(sentence) && !ACCEPT_RE.test(sentence.replace(DECLINE_RE, ''))) continue
    const tm = timeRe.exec(sentence)
    const dm = dayRe.exec(sentence)
    if (!tm || !dm) continue
    let hh: number
    let mm = 0
    if (/^(noon|midday)$/i.test(tm[1])) hh = 12
    else if (tm[4]) {
      hh = Number(tm[2]) % 12 + (/p/i.test(tm[4]) ? 12 : 0)
      mm = tm[3] ? Number(tm[3]) : 0
    } else {
      hh = Number(tm[5])
      mm = Number(tm[6])
    }
    if (hh > 23 || mm > 59) continue
    const [ty, tmo, td] = todayIso.split('-').map(Number)
    const today = dayNum(ty, tmo, td)
    let dn: number | null = null
    const word = dm[1].toLowerCase()
    if (word === 'today') dn = today
    else if (word === 'tomorrow') dn = today + 1
    else if (dm[2]) {
      const want = WEEKDAYS[dm[2].toLowerCase()]
      const dow = fromDayNum(today).dow
      let ahead = (want - dow + 7) % 7
      // "Tuesday" / "next Tuesday": the coming one, never today (a same-day time says "today").
      if (ahead === 0) ahead = 7
      dn = today + ahead
    } else if (dm[3]) {
      const mo = MONTHS[dm[3].toLowerCase()]
      const day = Number(dm[4])
      let y = ty
      if (dayNum(y, mo, day) < today) y += 1
      dn = dayNum(y, mo, day)
    } else if (dm[5]) {
      const mo = Number(dm[5])
      const day = Number(dm[6])
      if (mo < 1 || mo > 12 || day < 1 || day > 31) continue
      let y = ty
      if (dayNum(y, mo, day) < today) y += 1
      dn = dayNum(y, mo, day)
    }
    if (dn === null) continue
    const p = fromDayNum(dn)
    return { startIso: new Date(localToUtcMs(p.y, p.m, p.d, hh, mm, tz)).toISOString(), matched: `${dm[0]} ${tm[0]}`.trim() }
  }
  return null
}
