/**
 * Minimal iCalendar (RFC 5545) reader for subscribed calendars (Apple /
 * iCloud public links, any .ics feed). No dependency: unfolding, escaping,
 * DATE vs DATE-TIME (UTC, TZID, X-WR-TIMEZONE, floating), DURATION, and
 * the common RRULE shapes (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL,
 * COUNT, UNTIL, BYDAY incl. ordinals, BYMONTHDAY, BYMONTH, BYSETPOS),
 * RDATE, EXDATE, RECURRENCE-ID overrides and STATUS:CANCELLED.
 *
 * Output is expanded occurrences inside a window: timed events as UTC ISO
 * strings, all-day events as YYYY-MM-DD (end exclusive), the same shape
 * the Calendar page uses for Google.
 */

export type IcsEvent = {
  uid: string
  summary: string
  location: string | null
  start: string
  end: string
  allDay: boolean
}

export type IcsCalendar = { name: string | null; events: IcsEvent[]; truncated: boolean }

type Prop = { name: string; params: Record<string, string>; value: string }

// ── Lexing ────────────────────────────────────────────────────────────────

export function unfold(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.length > 0)
}

export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=val;PARAM="v:al":VALUE — the first ':' outside quotes splits.
  let inQ = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQ = !inQ
    else if (ch === ':' && !inQ) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts: string[] = []
  let cur = ''
  inQ = false
  for (const ch of head) {
    if (ch === '"') inQ = !inQ
    if (ch === ';' && !inQ) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  const name = parts.shift()!.toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value }
}

// ── Time ──────────────────────────────────────────────────────────────────

/** Wall-clock fields; for all-day values only y/m/d matter. */
type Wall = { y: number; m: number; d: number; hh: number; mi: number; ss: number }
type IcsTime = { wall: Wall; allDay: boolean; utc: boolean; tz: string | null }

const WINDOWS_TZ: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
  'UTC': 'UTC',
}

function validTz(tz: string | null | undefined): string | null {
  if (!tz) return null
  const name = WINDOWS_TZ[tz] ?? tz.replace(/^\/[^/]+\/[^/]+\//, '') // strip "/mozilla.org/20050126_1/" style prefixes
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return name
  } catch {
    return null
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function tzParts(ms: number, tz: string): Wall {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    fmtCache.set(tz, f)
  }
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mi: o.minute, ss: o.second }
}

const wallMs = (w: Wall) => Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mi, w.ss)

/** The UTC instant for a wall-clock time in a zone (DST-safe, two passes). */
export function zonedToUtc(w: Wall, tz: string): number {
  const guess = wallMs(w)
  let ms = guess - (wallMs(tzParts(guess, tz)) - guess)
  ms = guess - (wallMs(tzParts(ms, tz)) - ms)
  return ms
}

export function parseIcsTime(p: Prop, calTz: string | null): IcsTime | null {
  const v = p.value.trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v)
  if (!m) return null
  const wall: Wall = { y: +m[1], m: +m[2], d: +m[3], hh: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, ss: m[6] ? +m[6] : 0 }
  const allDay = !m[4] || p.params.VALUE === 'DATE'
  if (allDay) return { wall: { ...wall, hh: 0, mi: 0, ss: 0 }, allDay: true, utc: false, tz: null }
  if (m[7]) return { wall, allDay: false, utc: true, tz: null }
  return { wall, allDay: false, utc: false, tz: validTz(p.params.TZID) ?? calTz }
}

function instant(t: IcsTime): number {
  if (t.allDay) return Date.UTC(t.wall.y, t.wall.m - 1, t.wall.d)
  if (t.utc || !t.tz) return wallMs(t.wall)
  return zonedToUtc(t.wall, t.tz)
}

export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000
  return m[1] === '-' ? -ms : ms
}

const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
const fromDayNum = (n: number) => {
  const dt = new Date(n * 86_400_000)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const weekday = (n: number) => (new Date(n * 86_400_000).getUTCDay() + 6) % 7 // 0 = Monday

// ── RRULE ─────────────────────────────────────────────────────────────────

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
type ByDay = { wd: number; nth: number | null }
export type RRule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  until: IcsTime | null
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
}

export function parseRRule(v: string, calTz: string | null): RRule | null {
  const kv: Record<string, string> = {}
  for (const part of v.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase()
  }
  const freq = kv.FREQ as RRule['freq']
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null // SECONDLY..HOURLY not supported
  const nums = (s?: string) => (s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0) : [])
  const byDay: ByDay[] = []
  for (const d of kv.BYDAY ? kv.BYDAY.split(',') : []) {
    const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(d.trim())
    if (m) byDay.push({ wd: DAYS.indexOf(m[2]), nth: m[1] ? Number(m[1]) : null })
  }
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    count: kv.COUNT ? Math.max(0, Number(kv.COUNT) || 0) : null,
    until: kv.UNTIL ? parseIcsTime({ name: 'UNTIL', params: {}, value: kv.UNTIL }, calTz) : null,
    byDay,
    byMonthDay: nums(kv.BYMONTHDAY),
    byMonth: nums(kv.BYMONTH).filter((n) => n >= 1 && n <= 12),
    bySetPos: nums(kv.BYSETPOS),
  }
}

/** Days (as day numbers) in [first, last] that match BYDAY, honouring ordinals within that span. */
function byDayIn(first: number, last: number, rules: ByDay[]): number[] {
  const out = new Set<number>()
  for (const r of rules) {
    const hits: number[] = []
    for (let n = first; n <= last; n++) if (weekday(n) === r.wd) hits.push(n)
    if (r.nth === null) hits.forEach((h) => out.add(h))
    else {
      const h = r.nth > 0 ? hits[r.nth - 1] : hits[hits.length + r.nth]
      if (h !== undefined) out.add(h)
    }
  }
  return [...out]
}

function monthDays(y: number, m: number, byMonthDay: number[]): number[] {
  const dim = daysInMonth(y, m)
  const out: number[] = []
  for (const md of byMonthDay) {
    const d = md > 0 ? md : dim + md + 1
    if (d >= 1 && d <= dim) out.push(dayNum(y, m, d))
  }
  return out
}

/** Candidate days for one period of the rule, sorted. */
function periodDays(rule: RRule, k: number, start: { y: number; m: number; d: number; n: number }): number[] {
  let days: number[] = []
  if (rule.freq === 'DAILY') {
    days = [start.n + k * rule.interval]
  } else if (rule.freq === 'WEEKLY') {
    const monday = start.n - weekday(start.n) + k * 7 * rule.interval
    const wds = rule.byDay.length ? rule.byDay.map((b) => b.wd) : [weekday(start.n)]
    days = [...new Set(wds)].map((wd) => monday + wd)
  } else if (rule.freq === 'MONTHLY') {
    const total = start.y * 12 + (start.m - 1) + k * rule.interval
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    const first = dayNum(y, m, 1)
    const last = first + daysInMonth(y, m) - 1
    if (rule.byMonthDay.length && rule.byDay.length) {
      const allowed = new Set(rule.byDay.map((b) => b.wd))
      days = monthDays(y, m, rule.byMonthDay).filter((n) => allowed.has(weekday(n)))
    } else if (rule.byMonthDay.length) days = monthDays(y, m, rule.byMonthDay)
    else if (rule.byDay.length) days = byDayIn(first, last, rule.byDay)
    else days = start.d <= daysInMonth(y, m) ? [dayNum(y, m, start.d)] : []
  } else {
    const y = start.y + k * rule.interval
    const months = rule.byMonth.length ? rule.byMonth : [start.m]
    if (!rule.byMonth.length && rule.byDay.length && !rule.byMonthDay.length) {
      days = byDayIn(dayNum(y, 1, 1), dayNum(y, 12, 31), rule.byDay)
    } else {
      for (const m of months) {
        const first = dayNum(y, m, 1)
        const last = first + daysInMonth(y, m) - 1
        if (rule.byMonthDay.length) {
          let ds = monthDays(y, m, rule.byMonthDay)
          if (rule.byDay.length) {
            const allowed = new Set(rule.byDay.map((b) => b.wd))
            ds = ds.filter((n) => allowed.has(weekday(n)))
          }
          days.push(...ds)
        } else if (rule.byDay.length) days.push(...byDayIn(first, last, rule.byDay))
        else if (start.d <= daysInMonth(y, m)) days.push(dayNum(y, m, start.d))
      }
    }
  }
  if (rule.byMonth.length && rule.freq !== 'YEARLY') days = days.filter((n) => rule.byMonth.includes(fromDayNum(n).m))
  if (rule.freq === 'DAILY' && rule.byMonthDay.length) {
    days = days.filter((n) => {
      const f = fromDayNum(n)
      const dim = daysInMonth(f.y, f.m)
      return rule.byMonthDay.some((md) => (md > 0 ? md : dim + md + 1) === f.d)
    })
  }
  if (rule.freq === 'DAILY' && rule.byDay.length) days = days.filter((n) => rule.byDay.some((b) => b.wd === weekday(n)))
  days.sort((a, b) => a - b)
  if (rule.bySetPos.length && days.length) {
    const picked = new Set<number>()
    for (const p of rule.bySetPos) {
      const v = p > 0 ? days[p - 1] : days[days.length + p]
      if (v !== undefined) picked.add(v)
    }
    days = [...picked].sort((a, b) => a - b)
  }
  return days
}

function periodStart(rule: RRule, k: number, start: { y: number; m: number; n: number }): number {
  if (rule.freq === 'DAILY') return start.n + k * rule.interval
  if (rule.freq === 'WEEKLY') return start.n - weekday(start.n) + k * 7 * rule.interval
  if (rule.freq === 'MONTHLY') {
    const total = start.y * 12 + (start.m - 1) + k * rule.interval
    return dayNum(Math.floor(total / 12), (total % 12) + 1, 1)
  }
  return dayNum(start.y + k * rule.interval, 1, 1)
}

/**
 * Start instants (ms) of the occurrences that start in [fromMs, toMs). The
 * first occurrence is always DTSTART itself (RFC 5545); COUNT counts every
 * occurrence, including the ones before the window.
 */
export function expandRRule(dtstart: IcsTime, rule: RRule, toMs: number, opts: { fromMs?: number; maxIterations?: number; maxOut?: number } = {}): number[] {
  const fromMs = opts.fromMs ?? -Infinity
  const maxIt = opts.maxIterations ?? 60_000
  const maxOut = opts.maxOut ?? 5_000
  const w = dtstart.wall
  const start = { y: w.y, m: w.m, d: w.d, n: dayNum(w.y, w.m, w.d) }
  const startMs = instant(dtstart)
  const untilMs = rule.until ? (rule.until.allDay ? instant(rule.until) + 86_400_000 - 1 : instant(rule.until)) : Infinity
  const stopMs = Math.min(untilMs, toMs)
  const at = (n: number): number => {
    const f = fromDayNum(n)
    return instant({ ...dtstart, wall: { ...w, y: f.y, m: f.m, d: f.d } })
  }
  const out: number[] = []
  if (rule.count === 0) return out
  if (startMs >= fromMs && startMs < toMs) out.push(startMs)
  let produced = 1
  if (rule.count !== null && produced >= rule.count) return out
  for (let k = 0; k < maxIt; k++) {
    if (k > 0 && at(periodStart(rule, k, start)) > stopMs) return out
    for (const n of periodDays(rule, k, start)) {
      if (n <= start.n) continue
      const ms = at(n)
      if (ms > untilMs || ms >= toMs) return out
      produced++
      if (ms >= fromMs) out.push(ms)
      if ((rule.count !== null && produced >= rule.count) || out.length >= maxOut) return out
    }
  }
  return out
}

// ── Calendar ──────────────────────────────────────────────────────────────

type RawEvent = { props: Prop[] }

function first(e: RawEvent, name: string): Prop | undefined {
  return e.props.find((p) => p.name === name)
}

function timesOf(p: Prop, calTz: string | null): IcsTime[] {
  return p.value
    .split(',')
    .map((v) => parseIcsTime({ ...p, value: v }, calTz))
    .filter((t): t is IcsTime => !!t)
}

const asOut = (ms: number, allDay: boolean) => (allDay ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString())

/**
 * Parse an .ics file and expand its events into [from, to). Caps keep a
 * hostile or huge feed from blowing up the page.
 */
export function parseIcs(text: string, window: { from: Date; to: Date }, opts: { maxEvents?: number } = {}): IcsCalendar {
  const maxEvents = opts.maxEvents ?? 3_000
  const lines = unfold(text)
  let calName: string | null = null
  let calTz: string | null = null
  const events: RawEvent[] = []
  let cur: RawEvent | null = null
  let depth = 0 // nested components inside a VEVENT (VALARM) are skipped
  let inTz = 0
  for (const line of lines) {
    const p = parseLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase()
      if (cur) depth++
      else if (what === 'VEVENT') cur = { props: [] }
      else if (what === 'VTIMEZONE') inTz++
      continue
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase()
      if (cur && depth > 0) depth--
      else if (cur && what === 'VEVENT') {
        events.push(cur)
        cur = null
      } else if (what === 'VTIMEZONE') inTz = Math.max(0, inTz - 1)
      continue
    }
    if (cur) {
      if (depth === 0) cur.props.push(p)
    } else if (!inTz) {
      if (p.name === 'X-WR-CALNAME') calName = unescapeText(p.value).trim() || null
      if (p.name === 'X-WR-TIMEZONE') calTz = validTz(p.value.trim())
    }
  }

  const fromMs = window.from.getTime()
  const toMs = window.to.getTime()
  const out: IcsEvent[] = []
  let truncated = false

  // RECURRENCE-ID overrides replace one occurrence of their series.
  const overrides = new Map<string, Set<number>>()
  for (const e of events) {
    const rid = first(e, 'RECURRENCE-ID')
    const uid = first(e, 'UID')?.value ?? ''
    if (!rid) continue
    const t = parseIcsTime(rid, calTz)
    if (!t) continue
    if (!overrides.has(uid)) overrides.set(uid, new Set())
    overrides.get(uid)!.add(instant(t))
  }

  for (const e of events) {
    if (out.length >= maxEvents) {
      truncated = true
      break
    }
    const dtP = first(e, 'DTSTART')
    if (!dtP) continue
    const dt = parseIcsTime(dtP, calTz)
    if (!dt) continue
    const uid = first(e, 'UID')?.value ?? `${dtP.value}-${out.length}`
    const cancelled = (first(e, 'STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED'
    const startMs = instant(dt)
    let durMs: number
    const endP = first(e, 'DTEND') ?? first(e, 'DUE')
    const endT = endP ? parseIcsTime(endP, calTz) : null
    const durP = first(e, 'DURATION')
    if (endT) durMs = instant(endT) - startMs
    else if (durP && parseDuration(durP.value) !== null) durMs = parseDuration(durP.value)!
    else durMs = dt.allDay ? 86_400_000 : 0
    if (!(durMs >= 0)) durMs = 0
    if (dt.allDay) durMs = Math.max(86_400_000, Math.round(durMs / 86_400_000) * 86_400_000)

    const isOverride = !!first(e, 'RECURRENCE-ID')
    let starts: number[]
    const rr = !isOverride ? first(e, 'RRULE') : undefined
    const rule = rr ? parseRRule(rr.value, calTz) : null
    if (rule) starts = expandRRule(dt, rule, toMs, { fromMs: fromMs - durMs })
    else starts = [startMs]
    for (const rd of e.props.filter((p) => p.name === 'RDATE')) for (const t of timesOf(rd, calTz)) starts.push(instant(t))
    const ex = new Set<number>()
    for (const xp of e.props.filter((p) => p.name === 'EXDATE')) for (const t of timesOf(xp, calTz)) ex.add(instant(t))
    const replaced = !isOverride ? overrides.get(uid) : undefined
    if (cancelled) continue
    const summary = unescapeText(first(e, 'SUMMARY')?.value ?? '').trim() || '(No title)'
    const location = unescapeText(first(e, 'LOCATION')?.value ?? '').trim() || null
    const seen = new Set<number>()
    for (const s of starts.sort((a, b) => a - b)) {
      if (seen.has(s) || ex.has(s) || replaced?.has(s)) continue
      seen.add(s)
      const end = s + durMs
      if (end <= fromMs && !(durMs === 0 && s >= fromMs)) continue
      if (s >= toMs) continue
      out.push({ uid, summary, location, start: asOut(s, dt.allDay), end: asOut(end, dt.allDay), allDay: dt.allDay })
      if (out.length >= maxEvents) {
        truncated = true
        break
      }
    }
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  return { name: calName, events: out, truncated }
}

