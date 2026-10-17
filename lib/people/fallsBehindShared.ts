/**
 * "Someone fell behind" (Suite CXO, Ciao): the pure half. No DB, no model.
 *
 *  - What counts: a quota whose pace is 'behind' (the same quotaLine pace as
 *    employee_quota_status and the people page), or a bonus plan whose
 *    status is 'behind' (the same payoutFor rule as bonus_on_track). Early in
 *    a period a straight-line pace is noise, so nothing is judged before
 *    MIN_ELAPSED of the period has gone.
 *  - Who hears: the person's manager (cxo_employees.manager_id, that row's
 *    login). No manager with a login: the owner and admins. Never the person
 *    themselves, never their peers.
 *  - How often: at most one notice per person per ISO week, and only when
 *    the episode is new (they were not behind before, or it is a new
 *    period) or it got worse (a new quota went behind, or the worst pace fell
 *    WORSE_BY points since the last notice). Recovering clears the episode,
 *    so slipping again is new.
 *  - Every number is from deterministic code; the talking point is a template.
 *
 * Client-safe: the one-tap action reads the talking point back from the body.
 */
import { BEHIND_NOTICE_PREFIX } from '@/lib/followups/noticeActionsShared'
import { fmtKpiValue, periodLabel, type KpiUnit } from '@/lib/employees/shared'

export const BEHIND_PREFIX = BEHIND_NOTICE_PREFIX
/** Share of the period that must be gone before a pace is judged. */
export const MIN_ELAPSED = 0.15
/** Points the worst pace must fall, since the last notice, to count as worse. */
export const WORSE_BY = 10
/** Weekdays, from 9am in the company's zone. */
export const CHECK_HOUR = 9
export const TALKING_POINT_LABEL = 'Talking point: '
export const EXEC_ROLES = ['owner', 'admin'] as const

export const behindKey = (week: string, employeeId: string, memberId: string) => `${BEHIND_PREFIX}${week}-${employeeId}-${memberId}`

export function isCheckTime(p: { weekday: number; hour: number }): boolean {
  return p.weekday >= 1 && p.weekday <= 5 && p.hour >= CHECK_HOUR
}

// ── What is behind ──────────────────────────────────────────────────────────

/** The parts of a quota line this needs (lib/employees/shared QuotaLine). */
export type QuotaFacts = {
  kpi: { id: string; name: string; unit: KpiUnit; target: number; lower_is_better: boolean }
  periodKey: string
  actual: number | null
  att: number | null
  projectedAtt: number | null
  elapsed: number
  pace: 'met' | 'on_pace' | 'behind' | 'no_data'
}
/** The parts of a payout line this needs (lib/employees/shared PayoutLine). */
export type BonusFacts = { period_key: string; status: 'earned' | 'on_track' | 'behind' | 'no_plan'; overallAtt: number | null; elapsed: number }

export type BehindItem =
  | { key: string; kind: 'quota'; name: string; period: string; line: string; pacePct: number; projectable: boolean }
  | { key: string; kind: 'bonus'; period: string; line: string; pacePct: null }

const pct = (x: number) => Math.round(x * 100)
const periodWord = (key: string) => (/^\d{4}-Q[1-4]$/.test(key) ? 'quarter' : /^\d{4}$/.test(key) ? 'year' : 'month')

export function quotaItem(q: QuotaFacts): BehindItem | null {
  if (q.pace !== 'behind' || q.att == null || q.elapsed < MIN_ELAPSED) return null
  const unit = q.kpi.unit
  const projectable = !q.kpi.lower_is_better && (unit === 'count' || unit === 'usd') && q.elapsed < 1
  const pace = projectable && q.projectedAtt != null ? q.projectedAtt : q.att
  const word = periodWord(q.periodKey)
  const so = `${fmtKpiValue(unit, q.actual)} of ${fmtKpiValue(unit, q.kpi.target)} (${pct(q.att)}%)`
  const line = q.kpi.lower_is_better
    ? `${q.kpi.name} (${periodLabel(q.periodKey)}): ${fmtKpiValue(unit, q.actual)} against a target of ${fmtKpiValue(unit, q.kpi.target)}.`
    : projectable
      ? `${q.kpi.name} (${periodLabel(q.periodKey)}): ${so} with ${pct(q.elapsed)}% of the ${word} gone. On pace for ${pct(pace)}%.`
      : `${q.kpi.name} (${periodLabel(q.periodKey)}): ${so}.`
  return { key: `q:${q.kpi.id}:${q.periodKey}`, kind: 'quota', name: q.kpi.name, period: q.periodKey, line, pacePct: pct(pace), projectable }
}

export function bonusItem(b: BonusFacts): BehindItem | null {
  if (b.status !== 'behind' || b.elapsed < MIN_ELAPSED) return null
  const word = periodWord(b.period_key)
  const so = b.overallAtt != null ? ` ${pct(b.overallAtt)}% to goal so far.` : ''
  return { key: `b:${b.period_key}`, kind: 'bonus', period: b.period_key, line: `Bonus (${periodLabel(b.period_key)}): not on pace for a bonus tier this ${word}.${so}`, pacePct: null }
}

/** Behind items for one person, worst quota first, bonus last. */
export function behindItems(quotas: QuotaFacts[], bonus: BonusFacts[]): BehindItem[] {
  const q = quotas.map(quotaItem).filter((x): x is BehindItem => !!x).sort((a, b) => (a.pacePct ?? 0) - (b.pacePct ?? 0))
  const bs = new Map<string, BehindItem>()
  for (const b of bonus) {
    const it = bonusItem(b)
    if (it) bs.set(it.key, it)
  }
  return [...q, ...bs.values()]
}

// ── Once per episode ────────────────────────────────────────────────────────

/** cxo_behind_watch, one row per person. */
export type WatchState = { behind: boolean; notified_items: string[]; notified_worst: number | null; last_week: string | null }

export const worstPace = (items: BehindItem[]): number | null => {
  const ps = items.map((i) => i.pacePct).filter((x): x is number => x != null)
  return ps.length ? Math.min(...ps) : null
}

/**
 * Tell the manager now? Returns the state to store once the notice is out
 * (or, when notify is false, right away). If a due notice reached nobody,
 * the caller keeps the old row so it is due again next check.
 */
export function decide(prev: WatchState | null, items: BehindItem[], week: string): { notify: boolean; next: WatchState } {
  if (!items.length) return { notify: false, next: { behind: false, notified_items: [], notified_worst: null, last_week: prev?.last_week ?? null } }
  const was = prev?.behind ? prev : null
  const told = new Set(was?.notified_items ?? [])
  const worst = worstPace(items)
  const fresh = items.some((i) => !told.has(i.key))
  const worse = worst != null && was?.notified_worst != null && worst <= was.notified_worst - WORSE_BY
  const notify = (fresh || worse) && prev?.last_week !== week
  if (!notify) return { notify: false, next: { behind: true, notified_items: was?.notified_items ?? [], notified_worst: was?.notified_worst ?? null, last_week: prev?.last_week ?? null } }
  return { notify: true, next: { behind: true, notified_items: items.map((i) => i.key), notified_worst: worst, last_week: week } }
}

// ── Who hears ───────────────────────────────────────────────────────────────

export type EmpLite = { id: string; name: string; manager_id: string | null; member_id: string | null }
export type MemberLite = { id: string; role: string | null; employee_only: boolean }

/** The manager's login, else the owner and admins. Never the person, never a peer. */
export function recipientsFor(emp: EmpLite, employees: EmpLite[], members: MemberLite[]): string[] {
  const byId = new Map(members.map((m) => [m.id, m]))
  const mgr = emp.manager_id ? employees.find((e) => e.id === emp.manager_id) : null
  if (mgr?.member_id && mgr.member_id !== emp.member_id && byId.has(mgr.member_id)) return [mgr.member_id]
  return members.filter((m) => !m.employee_only && (EXEC_ROLES as readonly string[]).includes(String(m.role)) && m.id !== emp.member_id).map((m) => m.id)
}

// ── The words ───────────────────────────────────────────────────────────────

const first = (name: string) => name.trim().split(/\s+/)[0] || name

export function talkingPoint(personName: string, items: BehindItem[]): string {
  const f = first(personName)
  const q = items.find((i) => i.kind === 'quota')
  if (q && q.kind === 'quota') {
    const where = q.projectable ? `on pace for ${q.pacePct}% of ${q.name} this ${periodWord(q.period)}` : `at ${q.pacePct}% of ${q.name} this ${periodWord(q.period)}`
    return `${f} is ${where}. Ask what is in the way and agree on one step for this week.`
  }
  const b = items[0]
  return `${f} is not on pace for a bonus this ${periodWord(b?.period ?? '')}. Ask what would get them to the first tier and agree on one step for this week.`
}

/**
 * The notice for one person, for one reader. Bonus lines only for readers
 * who may see comp; null when that leaves nothing to say.
 */
export function composeNotice(personName: string, items: BehindItem[], opts: { comp: boolean }): { title: string; body: string; talking: string } | null {
  const shown = items.filter((i) => i.kind === 'quota' || opts.comp)
  if (!shown.length) return null
  const quotas = shown.filter((i) => i.kind === 'quota')
  const title =
    quotas.length === 1 && shown.length === 1
      ? `${personName} is behind on ${quotas[0].kind === 'quota' ? quotas[0].name : 'quota'}`
      : quotas.length === 0
        ? `${personName} is not on pace for a bonus`
        : `${personName} is behind on ${shown.length} goals`
  const talking = talkingPoint(personName, shown)
  const body = [...shown.map((i) => i.line), '', `${TALKING_POINT_LABEL}${talking}`].join('\n')
  return { title, body, talking }
}

/** The talking point back out of a notice body (the "Add to 1:1" tap). */
export function talkingPointFrom(body: string | null | undefined): string | null {
  const line = String(body ?? '')
    .split('\n')
    .find((l) => l.startsWith(TALKING_POINT_LABEL))
  const t = line ? line.slice(TALKING_POINT_LABEL.length).trim() : ''
  return t ? t.slice(0, 2000) : null
}
