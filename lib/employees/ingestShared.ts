/**
 * "Give it to Mira" for Employees: pure normalising + review building.
 * Claude reads an upload into RawPerson[]; this file turns that into review
 * items (matched / new / ambiguous / problem) the exec fixes or skips before
 * anything is saved, and re-validates on apply (the client copy is never
 * trusted). Shared by the API, the page and the tests. No server imports.
 */
import { estimateCostUsd } from '@/lib/aiProvider'
import {
  matchEmployee,
  parsePeriod,
  parseQuotaType,
  periodKeyFor,
  periodOfKey,
  PERIOD_KEY_RE,
  QUOTA_TYPES,
  TIME_OFF_KINDS,
  type Employee,
  type Kpi,
  type Period,
  type QuotaType,
  type TimeOffKind,
} from './shared'

export type RawQuota = { type?: string; name?: string; target?: unknown; period?: string; period_key?: string; actual?: unknown; tiers?: Array<{ attain_pct?: unknown; bonus?: unknown }> }
export type RawTimeOff = { start_date?: string; end_date?: string; days?: unknown; kind?: string; note?: string }
export type RawPerson = {
  name?: string
  email?: string
  title?: string
  department?: string
  manager?: string
  start_date?: string
  base_salary?: unknown
  hourly_rate?: unknown
  hours_per_week?: unknown
  pto_allowed_days?: unknown
  pto_balance_days?: unknown
  book_name?: string
  quotas?: RawQuota[]
  time_off?: RawTimeOff[]
}

export type CleanQuota = { quota_type: QuotaType; name: string; target: number; period: Period; period_key: string; actual: number | null; tiers: Array<{ attain_pct: number; bonus: number }> }
export type CleanTimeOff = { start_date: string; end_date: string; days: number | null; kind: TimeOffKind; note: string | null }
export type CleanPerson = {
  name: string
  email: string | null
  title: string | null
  department: string | null
  manager: string | null
  start_date: string | null
  base_salary: number | null
  hourly_rate: number | null
  hours_per_week: number | null
  pto_allowed_days: number | null
  pto_balance_days: number | null
  book_name: string | null
  quotas: CleanQuota[]
  time_off: CleanTimeOff[]
}

export type ReviewStatus = 'matched' | 'new' | 'ambiguous' | 'problem'
export type ReviewItem = {
  key: string
  status: ReviewStatus
  person: CleanPerson
  /** Existing employee this row updates (matched), or null. */
  match: { id: string; name: string } | null
  /** When ambiguous: the people it could be. */
  candidates: Array<{ id: string; name: string }>
  /** Short plain lines: what saving this row will do. */
  changes: string[]
  /** Short plain lines: what is wrong or was dropped. */
  problems: string[]
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/[$,\s]/g, '').replace(/%$/, '')
  const m = s.match(/^(-?\d+(?:\.\d+)?)([km])?$/i)
  if (!m) return null
  const n = Number(m[1]) * (m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1)
  return Number.isFinite(n) ? n : null
}

export function toIso(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (ISO.test(s)) return s
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3]
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  }
  return null
}

const str = (v: unknown, max = 120) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return s ? s.slice(0, max) : null
}
const nonNeg = (v: unknown, max = 1e9) => {
  const n = toNum(v)
  return n == null || n < 0 || n > max ? null : n
}

/** Clean one person; problems are what was dropped and why. */
export function cleanPerson(raw: RawPerson, today: string, comp: boolean): { person: CleanPerson | null; problems: string[] } {
  const problems: string[] = []
  const name = str(raw.name)
  if (!name) return { person: null, problems: ['No name on this row.'] }
  let email = str(raw.email, 200)?.toLowerCase() ?? null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push(`Email "${email}" does not look right; left out.`)
    email = null
  }
  const quotas: CleanQuota[] = []
  for (const q of raw.quotas ?? []) {
    const type: QuotaType = QUOTA_TYPES.some((t) => t.type === q.type) ? (q.type as QuotaType) : parseQuotaType(`${q.type ?? ''} ${q.name ?? ''}`)
    const target = toNum(q.target)
    const label = QUOTA_TYPES.find((t) => t.type === type)!.label.replace(/ \$$/, '')
    const qname = str(q.name) || label
    if (target == null || target <= 0) {
      problems.push(`${qname}: no target, so it was left out.`)
      continue
    }
    let period: Period = q.period ? parsePeriod(q.period) : 'month'
    let key = String(q.period_key ?? '').trim()
    if (key && PERIOD_KEY_RE.test(key)) period = periodOfKey(key)
    else key = periodKeyFor(period, today)
    const actual = toNum(q.actual)
    const tiers = (q.tiers ?? [])
      .map((t) => ({ attain_pct: toNum(t.attain_pct) ?? 0, bonus: toNum(t.bonus) ?? 0 }))
      .filter((t) => t.attain_pct > 0 && t.attain_pct <= 1000 && t.bonus >= 0)
      .sort((a, b) => a.attain_pct - b.attain_pct)
      .slice(0, 12)
    if (!comp && tiers.length) problems.push(`${qname}: bonus tiers are for the exec team; left out.`)
    quotas.push({ quota_type: type, name: qname, target, period, period_key: key, actual: actual != null && actual >= 0 ? actual : null, tiers: comp ? tiers : [] })
  }
  const time_off: CleanTimeOff[] = []
  for (const t of raw.time_off ?? []) {
    const start = toIso(t.start_date)
    if (!start) {
      problems.push('A time-off entry has no readable start date; left out.')
      continue
    }
    const endRaw = toIso(t.end_date)
    const end = endRaw && endRaw >= start ? endRaw : start
    const kind: TimeOffKind = TIME_OFF_KINDS.includes(String(t.kind ?? '').toLowerCase() as TimeOffKind)
      ? (String(t.kind).toLowerCase() as TimeOffKind)
      : /sick|ill|medical/i.test(String(t.kind ?? '')) ? 'sick' : /pto|vacation|holiday|leave/i.test(String(t.kind ?? '')) ? 'vacation' : /personal/i.test(String(t.kind ?? '')) ? 'personal' : 'other'
    time_off.push({ start_date: start, end_date: end, days: nonNeg(t.days, 366), kind, note: str(t.note, 300) })
  }
  const salary = nonNeg(raw.base_salary, 1e8)
  const rate = nonNeg(raw.hourly_rate, 10_000)
  if (!comp && (salary != null || rate != null)) problems.push('Pay is for the exec team only; left out.')
  const balRaw = toNum(raw.pto_balance_days)
  return {
    person: {
      name,
      email,
      title: str(raw.title),
      department: str(raw.department, 80),
      manager: str(raw.manager),
      start_date: toIso(raw.start_date),
      base_salary: comp ? salary : null,
      hourly_rate: comp ? rate : null,
      hours_per_week: nonNeg(raw.hours_per_week, 168),
      pto_allowed_days: nonNeg(raw.pto_allowed_days, 366),
      pto_balance_days: balRaw != null && Math.abs(balRaw) <= 366 ? balRaw : null,
      book_name: str(raw.book_name),
      quotas,
      time_off,
    },
    problems,
  }
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
function quotaWords(q: CleanQuota): string {
  const usd = QUOTA_TYPES.find((t) => t.type === q.quota_type)?.unit === 'usd'
  const v = (n: number) => (usd ? money(n) : n.toLocaleString('en-US'))
  const tiers = q.tiers.length ? `, bonus at ${q.tiers.map((t) => `${t.attain_pct}%`).join('/')}` : ''
  return `${q.name}: ${v(q.target)} per ${q.period} (${q.period_key})${q.actual != null ? `, actual ${v(q.actual)}` : ''}${tiers}`
}

/** Review items for an upload, matched against the people already here. */
export function buildReview(
  raw: RawPerson[],
  existing: Array<Pick<Employee, 'id' | 'name' | 'email'>>,
  existingKpis: Array<Pick<Kpi, 'employee_id' | 'quota_type' | 'period' | 'name'>>,
  today: string,
  comp: boolean,
): ReviewItem[] {
  const items: ReviewItem[] = []
  const seen = new Map<string, number>()
  raw.slice(0, 500).forEach((r, i) => {
    const { person, problems } = cleanPerson(r, today, comp)
    if (!person) {
      items.push({ key: `row-${i}`, status: 'problem', person: { ...emptyPerson(), name: str(r.email) ?? `Row ${i + 1}` }, match: null, candidates: [], changes: [], problems })
      return
    }
    const dupKey = person.email || person.name.toLowerCase()
    const dup = seen.has(dupKey)
    if (dup) problems.push('This person appears more than once in the file; this row is skipped unless you include it.')
    else seen.set(dupKey, i)
    const { match, candidates } = matchEmployee(existing, person.name, person.email)
    const changes: string[] = []
    if (!match && candidates.length === 0) changes.push('Adds a new employee')
    if (person.title) changes.push(`Title: ${person.title}`)
    if (person.department) changes.push(`Department: ${person.department}`)
    if (person.manager) changes.push(`Reports to ${person.manager}`)
    if (person.base_salary != null) changes.push(`Salary ${money(person.base_salary)}/yr`)
    if (person.hourly_rate != null) changes.push(`Pay $${person.hourly_rate}/hr`)
    if (person.hours_per_week != null) changes.push(`${person.hours_per_week} hrs/week`)
    if (person.pto_allowed_days != null || person.pto_balance_days != null)
      changes.push(`PTO${person.pto_allowed_days != null ? ` ${person.pto_allowed_days} days a year` : ''}${person.pto_balance_days != null ? `, ${person.pto_balance_days} left` : ''}`)
    if (person.book_name) changes.push(`Book name: ${person.book_name}`)
    for (const q of person.quotas) {
      const exists = match && existingKpis.some((k) => k.employee_id === match.id && k.quota_type === q.quota_type && k.period === q.period && (q.quota_type !== 'custom' || k.name.toLowerCase() === q.name.toLowerCase()))
      changes.push(`${exists ? 'Updates' : 'Quota'} ${quotaWords(q)}`)
    }
    if (person.time_off.length) changes.push(`${person.time_off.length} time-off ${person.time_off.length === 1 ? 'entry' : 'entries'}`)
    const status: ReviewStatus = dup ? 'problem' : match ? 'matched' : candidates.length > 0 ? 'ambiguous' : 'new'
    if (status === 'ambiguous') problems.unshift(`Could be ${candidates.map((c) => c.name).join(' or ')}. Pick one, or add as new.`)
    items.push({
      key: `row-${i}`,
      status,
      person,
      match: match ? { id: match.id, name: match.name } : null,
      candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
      changes,
      problems,
    })
  })
  return items
}

function emptyPerson(): CleanPerson {
  return { name: '', email: null, title: null, department: null, manager: null, start_date: null, base_salary: null, hourly_rate: null, hours_per_week: null, pto_allowed_days: null, pto_balance_days: null, book_name: null, quotas: [], time_off: [] }
}

/** Approximate AI cost in USD, priced by the model that ran (GLM; older rows may name other models). */
export function claudeCostUsd(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
  model?: string | null,
): number {
  if (!usage) return 0
  return estimateCostUsd(model ?? 'claude-sonnet', usage.input_tokens ?? 0, usage.output_tokens ?? 0)
}
