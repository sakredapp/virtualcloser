/**
 * Repeating calendar events (QA gap 10, 2026-10-18): "every Monday at 9 for
 * 10 weeks" is ONE Google event with an RRULE, not ten separate events.
 *
 * Pure: turns what the assistant passes (an RRULE string, or a small object
 * of freq / by_day / count / until / interval) into one validated RRULE line
 * for Google Calendar's `recurrence` field, plus a plain-English readback.
 */

export const RECURRENCE_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number]

/** A repeat longer than this is almost always a mistake; Google allows more, we do not. */
export const RECURRENCE_MAX_COUNT = 260

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
const DAY_NAME: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }
const DAY_ALIASES: Record<string, string> = {
  mon: 'MO', monday: 'MO', mo: 'MO',
  tue: 'TU', tues: 'TU', tuesday: 'TU', tu: 'TU',
  wed: 'WE', wednesday: 'WE', we: 'WE',
  thu: 'TH', thur: 'TH', thurs: 'TH', thursday: 'TH', th: 'TH',
  fri: 'FR', friday: 'FR', fr: 'FR',
  sat: 'SA', saturday: 'SA', sa: 'SA',
  sun: 'SU', sunday: 'SU', su: 'SU',
}

export type Recurrence = {
  /** The one line Google takes: "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10". */
  rrule: string
  freq: RecurrenceFreq
  interval: number
  byDay: string[]
  count: number | null
  /** YYYYMMDD (date) or YYYYMMDDTHHMMSSZ, as Google wants it. */
  until: string | null
  /** "every Monday, 10 times". */
  label: string
}

export type RecurrenceResult = { ok: true; recurrence: Recurrence } | { ok: false; error: string }

function dayCode(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/s$/, '')
  if (!s) return null
  const up = s.toUpperCase()
  if ((DAYS as readonly string[]).includes(up)) return up
  return DAY_ALIASES[s] ?? DAY_ALIASES[s + 's'] ?? null
}

/** "2026-12-31", "20261231", "2026-12-31T17:00:00Z" → Google's UNTIL form. */
function untilValue(raw: string): string | null {
  const s = raw.trim()
  if (/^\d{8}$/.test(s)) return s
  if (/^\d{8}T\d{6}Z$/.test(s)) return s
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (d) return `${d[1]}${d[2]}${d[3]}`
  const t = Date.parse(s)
  if (Number.isFinite(t) && /^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return null
}

function untilLabel(u: string): string {
  return `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') return v.split(/[,\s]+/).filter(Boolean)
  return []
}

function build(freq: RecurrenceFreq, interval: number, byDay: string[], count: number | null, until: string | null): RecurrenceResult {
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) return { ok: false, error: 'interval must be a whole number from 1 to 52' }
  if (count !== null && (!Number.isInteger(count) || count < 1)) return { ok: false, error: 'count must be a whole number of 1 or more' }
  if (count !== null && count > RECURRENCE_MAX_COUNT) return { ok: false, error: `count is capped at ${RECURRENCE_MAX_COUNT}` }
  if (count !== null && until) return { ok: false, error: 'use count or until, not both' }
  if (byDay.length && freq !== 'WEEKLY' && freq !== 'DAILY') return { ok: false, error: 'by_day works with a daily or weekly repeat' }
  const parts = [`FREQ=${freq}`]
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (byDay.length) parts.push(`BYDAY=${byDay.join(',')}`)
  if (count !== null) parts.push(`COUNT=${count}`)
  if (until) parts.push(`UNTIL=${until}`)
  return { ok: true, recurrence: { rrule: `RRULE:${parts.join(';')}`, freq, interval, byDay, count, until, label: describe(freq, interval, byDay, count, until) } }
}

function describe(freq: RecurrenceFreq, interval: number, byDay: string[], count: number | null, until: string | null): string {
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq]
  let base: string
  const weekdays = byDay.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => byDay.includes(d))
  if (byDay.length) {
    const days = weekdays ? 'weekday' : byDay.map((d) => DAY_NAME[d]).join(', ').replace(/, ([^,]*)$/, ' and $1')
    base = interval > 1 ? `every ${interval} weeks on ${days}` : `every ${days}`
  } else {
    base = interval > 1 ? `every ${interval} ${unit}s` : freq === 'DAILY' ? 'every day' : `every ${unit}`
  }
  if (count !== null) return `${base}, ${count} time${count === 1 ? '' : 's'}`
  if (until) return `${base}, until ${untilLabel(until)}`
  return `${base}, no end date`
}

/** An RRULE line ("RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10", the prefix optional). */
function fromRule(raw: string): RecurrenceResult {
  const body = raw.trim().replace(/^RRULE:/i, '')
  const kv = new Map<string, string>()
  for (const part of body.split(';').filter(Boolean)) {
    const [k, v] = part.split('=')
    if (!k || v === undefined) return { ok: false, error: `bad RRULE part "${part}"` }
    kv.set(k.trim().toUpperCase(), v.trim().toUpperCase())
  }
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL'])
  for (const k of kv.keys()) if (!known.has(k)) return { ok: false, error: `RRULE part ${k} is not supported; use FREQ, INTERVAL, BYDAY, COUNT or UNTIL` }
  const freq = kv.get('FREQ') as RecurrenceFreq | undefined
  if (!freq || !(RECURRENCE_FREQS as readonly string[]).includes(freq)) return { ok: false, error: 'FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY' }
  const byDay: string[] = []
  for (const d of list(kv.get('BYDAY') ?? '')) {
    const c = dayCode(d)
    if (!c) return { ok: false, error: `BYDAY "${d}" is not a day` }
    if (!byDay.includes(c)) byDay.push(c)
  }
  const until = kv.has('UNTIL') ? untilValue(kv.get('UNTIL')!) : null
  if (kv.has('UNTIL') && !until) return { ok: false, error: 'UNTIL must be a date like 20261231' }
  return build(freq, kv.has('INTERVAL') ? Number(kv.get('INTERVAL')) : 1, byDay, kv.has('COUNT') ? Number(kv.get('COUNT')) : null, until)
}

/**
 * What the tool got → one RRULE, or null when the event does not repeat.
 * Accepts "RRULE:..." / "FREQ=..." strings, or { freq, interval, by_day, count, until }.
 */
export function parseRecurrence(raw: unknown): RecurrenceResult | null {
  if (raw === undefined || raw === null || raw === '' || raw === false) return null
  if (typeof raw === 'string') return fromRule(raw)
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'recurrence must be an RRULE string or { freq, by_day, count, until }' }
  const o = raw as Record<string, unknown>
  const freq = String(o.freq ?? o.frequency ?? '').trim().toUpperCase() as RecurrenceFreq
  if (!(RECURRENCE_FREQS as readonly string[]).includes(freq)) return { ok: false, error: 'freq must be daily, weekly, monthly or yearly' }
  const byDay: string[] = []
  for (const d of list(o.by_day ?? o.byday ?? o.days)) {
    const c = dayCode(d)
    if (!c) return { ok: false, error: `"${d}" is not a day` }
    if (!byDay.includes(c)) byDay.push(c)
  }
  const countRaw = o.count ?? o.times ?? o.occurrences
  const count = countRaw === undefined || countRaw === null || countRaw === '' ? null : Number(countRaw)
  const untilRaw = typeof o.until === 'string' ? o.until : ''
  const until = untilRaw ? untilValue(untilRaw) : null
  if (untilRaw && !until) return { ok: false, error: 'until must be a date like 2026-12-31' }
  const interval = o.interval === undefined || o.interval === null || o.interval === '' ? 1 : Number(o.interval)
  return build(freq, interval, byDay, count, until)
}
