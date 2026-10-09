/**
 * Employees — pure math for KPIs, bonus payouts, reviews and ranking.
 * Shared by the page, the API, Mira's tools and the tests. No server imports.
 *
 * Bonus rule (kept simple so an exec can check it by hand):
 *   attainment = actual ÷ target (target ÷ actual when lower is better)
 *   per-KPI tiers: the highest tier reached pays; tiers do not stack
 *   overall tiers: read off the weighted-average attainment of every KPI
 *   for the same period. The employee's bonus = per-KPI bonuses + overall bonus.
 */

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
export type KpiUnit = 'count' | 'usd' | 'pct' | 'days' | 'hours'
export type Period = 'month' | 'quarter' | 'year'
export const PERIODS: Period[] = ['month', 'quarter', 'year']
export const PERIOD_WORDS: Record<Period, string> = { month: 'Month', quarter: 'Quarter', year: 'Year' }

/** What a quota counts. Each type implies a unit; Custom is named by the exec. */
export type QuotaType = 'revenue' | 'premium' | 'policies' | 'recruits' | 'appointments' | 'custom'
export const QUOTA_TYPES: Array<{ type: QuotaType; label: string; unit: KpiUnit; bookable: boolean }> = [
  { type: 'revenue', label: 'Revenue $', unit: 'usd', bookable: false },
  { type: 'premium', label: 'Premium $', unit: 'usd', bookable: true },
  { type: 'policies', label: 'Policies / deals', unit: 'count', bookable: true },
  { type: 'recruits', label: 'Agent growth (recruits)', unit: 'count', bookable: false },
  { type: 'appointments', label: 'Appointments', unit: 'count', bookable: false },
  { type: 'custom', label: 'Custom', unit: 'count', bookable: false },
]
export function quotaTypeInfo(t: string | null | undefined) {
  return QUOTA_TYPES.find((q) => q.type === t) ?? QUOTA_TYPES[QUOTA_TYPES.length - 1]
}
/** Loose words → a quota type ("premium", "AP", "apps", "recruits"...). */
export function parseQuotaType(raw: string | null | undefined): QuotaType {
  const s = String(raw ?? '').toLowerCase()
  if (/premium|\bap\b|annuali[sz]ed/.test(s)) return 'premium'
  if (/revenue|sales \$|income|commission/.test(s)) return 'revenue'
  if (/polic|deal|apps?\b|applications|submitted|written|issued/.test(s)) return 'policies'
  if (/recruit|agent growth|new agents|hires|onboard/.test(s)) return 'recruits'
  if (/appoint|meeting|booked|calls? set/.test(s)) return 'appointments'
  return 'custom'
}
export function parsePeriod(raw: string | null | undefined): Period {
  const s = String(raw ?? '').toLowerCase()
  if (/year|annual|yr|ytd/.test(s)) return 'year'
  if (/quarter|qtr|\bq[1-4]?\b/.test(s)) return 'quarter'
  return 'month'
}

export type Employee = {
  id: string
  name: string
  title: string | null
  department: string
  manager_id: string | null
  start_date: string | null
  email: string | null
  /** Null when the viewer may not see comp. */
  base_salary: number | null
  pay_frequency: PayFrequency
  member_id: string | null
  active: boolean
  /** HR basics, all optional. Pay (hourly_rate) is null when the viewer may not see comp. */
  hourly_rate: number | null
  hours_per_week: number | null
  pto_allowed_days: number | null
  pto_balance_days: number | null
  /** Agent or team name this person is credited with in the book (Premium / Policies quotas). */
  book_match: string | null
  book_dim: 'agent' | 'team' | null
  qbo_employee_id: string | null
}

export type TimeOffKind = 'vacation' | 'sick' | 'personal' | 'other'
export const TIME_OFF_KINDS: TimeOffKind[] = ['vacation', 'sick', 'personal', 'other']
export type TimeOff = { id: string; employee_id: string; start_date: string; end_date: string; days: number; kind: TimeOffKind; note: string | null }

/** Weekdays from start to end inclusive (a quick default for "days"). */
export function weekdaysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0
  let n = 0
  for (let t = a; t <= b && n < 400; t += 86_400_000) {
    const d = new Date(t).getUTCDay()
    if (d !== 0 && d !== 6) n++
  }
  return n
}

/** Days used this year by kind, plus allowed and left (left = balance when set, else allowed − used). */
export function ptoSummary(log: TimeOff[], year: string, allowed: number | null, balance: number | null) {
  const mine = log.filter((t) => t.start_date.slice(0, 4) === year)
  const byKind: Record<TimeOffKind, number> = { vacation: 0, sick: 0, personal: 0, other: 0 }
  for (const t of mine) byKind[t.kind] = (byKind[t.kind] ?? 0) + (Number(t.days) || 0)
  const used = byKind.vacation + byKind.sick + byKind.personal + byKind.other
  const left = balance != null ? balance : allowed != null ? Math.max(0, allowed - used) : null
  return { used, byKind, allowed, left, entries: mine.sort((a, b) => b.start_date.localeCompare(a.start_date)) }
}

export type Kpi = {
  id: string
  employee_id: string
  name: string
  unit: KpiUnit
  target: number
  period: Period
  weight: number
  lower_is_better: boolean
  sort: number
  quota_type: QuotaType
  /** 'book' = actual read live from the book for the employee's book_match. */
  actual_source: 'manual' | 'book'
}

export type KpiActual = { kpi_id: string; employee_id: string; period_key: string; actual: number }

export type CompTier = { id?: string; employee_id: string; kpi_id: string | null; period: Period; attain_pct: number; bonus: number }

export type Review = {
  id: string
  employee_id: string
  period_type: 'month' | 'quarter' | 'year'
  period_key: string
  overall: number | null
  kpi_ratings: Record<string, number>
  notes: string | null
  reviewer_name: string | null
  created_at: string
}

export type PayoutLock = { period_key: string; approved_at: string; approved_by_name: string | null; total: number; lines: PayoutLine[] }

// ── Periods ──────────────────────────────────────────────────────────────

export function monthKey(today: string): string {
  return today.slice(0, 7)
}

export function quarterKey(today: string): string {
  const [y, m] = today.split('-').map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

export function yearKey(today: string): string {
  return today.slice(0, 4)
}

export function periodKeyFor(period: Period, today: string): string {
  return period === 'month' ? monthKey(today) : period === 'quarter' ? quarterKey(today) : yearKey(today)
}

export function periodOfKey(key: string): Period {
  if (/^\d{4}$/.test(key)) return 'year'
  return /-Q[1-4]$/.test(key) ? 'quarter' : 'month'
}

/** A month ('2026-10'), quarter ('2026-Q4') or year ('2026') key. */
export const PERIOD_KEY_RE = /^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/

/** First and last day (inclusive) of a period key. */
export function periodRange(key: string): { start: string; end: string } | null {
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
  const y = /^(\d{4})$/.exec(key)
  if (y) return { start: `${y[1]}-01-01`, end: `${y[1]}-12-31` }
  const q = /^(\d{4})-Q([1-4])$/.exec(key)
  if (q) {
    const yr = Number(q[1])
    const m0 = (Number(q[2]) - 1) * 3 + 1
    return { start: `${yr}-${pad(m0)}-01`, end: `${yr}-${pad(m0 + 2)}-${pad(last(yr, m0 + 2))}` }
  }
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (m) return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${pad(last(Number(m[1]), Number(m[2])))}` }
  return null
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "October 2026" / "Q4 2026" / "2026" */
export function periodLabel(key: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(key)
  if (q) return `Q${q[2]} ${q[1]}`
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (m) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`
  return key
}

/** Share of the period elapsed on `today` (0..1), when today falls inside it; 1 for a past period, 0 for a future one. */
export function elapsedShare(key: string, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number)
  const t = Date.UTC(ty, tm - 1, td) + 86_400_000 // through the end of today
  let start: number
  let end: number
  const q = /^(\d{4})-Q([1-4])$/.exec(key)
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  const yr = /^(\d{4})$/.exec(key)
  if (yr) {
    start = Date.UTC(Number(yr[1]), 0, 1)
    end = Date.UTC(Number(yr[1]) + 1, 0, 1)
  } else if (q) {
    const y = Number(q[1])
    const qi = Number(q[2])
    start = Date.UTC(y, (qi - 1) * 3, 1)
    end = Date.UTC(y, qi * 3, 1)
  } else if (m) {
    start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)
    end = Date.UTC(Number(m[1]), Number(m[2]), 1)
  } else return 1
  if (t <= start) return 0
  if (t >= end) return 1
  return (t - start) / (end - start)
}

// ── Attainment and bonus ─────────────────────────────────────────────────

/** 1 = 100% of target. Null when there is no target or no actual yet. */
export function attainment(kpi: Pick<Kpi, 'target' | 'lower_is_better'>, actual: number | null | undefined): number | null {
  if (actual == null || !Number.isFinite(actual)) return null
  if (!kpi.target || kpi.target <= 0) return null
  if (kpi.lower_is_better) {
    if (actual <= 0) return null
    return kpi.target / actual
  }
  return actual / kpi.target
}

/** Highest tier whose attain_pct (100 = 100%) is reached; tiers do not stack. */
export function tierFor(tiers: CompTier[], att: number | null): CompTier | null {
  if (att == null) return null
  const pct = att * 100 + 1e-9
  let best: CompTier | null = null
  for (const t of tiers) if (pct >= t.attain_pct && (!best || t.attain_pct > best.attain_pct)) best = t
  return best
}

/** The next tier up from where the employee is, if any. */
export function nextTierFor(tiers: CompTier[], att: number | null): CompTier | null {
  const pct = (att ?? 0) * 100 + 1e-9
  return [...tiers].sort((a, b) => a.attain_pct - b.attain_pct).find((t) => t.attain_pct > pct) ?? null
}

/** Weighted-average attainment across KPIs that have one. */
export function weightedAttainment(items: Array<{ weight: number; att: number | null }>): number | null {
  let w = 0
  let s = 0
  for (const it of items) {
    if (it.att == null) continue
    const wt = it.weight > 0 ? it.weight : 1
    w += wt
    s += wt * it.att
  }
  return w > 0 ? s / w : null
}

export type PayoutKpiLine = {
  kpi_id: string
  name: string
  unit: KpiUnit
  target: number
  actual: number | null
  att: number | null
  /** Straight-line attainment by period end at today's pace. */
  projectedAtt: number | null
  tier: CompTier | null
  bonus: number
  next: CompTier | null
}

export type PayoutLine = {
  employee_id: string
  name: string
  department: string
  period_key: string
  kpis: PayoutKpiLine[]
  overallAtt: number | null
  overallTier: CompTier | null
  overallBonus: number
  total: number
  /** earned = a tier is already reached; on_track = pace reaches the first tier; behind = it does not; no_plan = no tiers set. */
  status: 'earned' | 'on_track' | 'behind' | 'no_plan'
}

/**
 * Bonus for one employee for one period. `elapsed` (0..1) is how far through
 * the period today is, used for the on-track call (count KPIs only: a rate
 * like a % or days is already a rate, so it is not projected).
 */
export function payoutFor(
  emp: Pick<Employee, 'id' | 'name' | 'department'>,
  kpis: Kpi[],
  actuals: KpiActual[],
  tiers: CompTier[],
  periodKey: string,
  elapsed = 1,
): PayoutLine {
  const period = periodOfKey(periodKey)
  const mine = kpis.filter((k) => k.employee_id === emp.id && k.period === period).sort((a, b) => a.sort - b.sort)
  const myTiers = tiers.filter((t) => t.employee_id === emp.id && t.period === period)
  const lines: PayoutKpiLine[] = mine.map((k) => {
    const a = actuals.find((x) => x.kpi_id === k.id && x.period_key === periodKey)
    const actual = a ? a.actual : null
    const att = attainment(k, actual)
    const projectable = !k.lower_is_better && (k.unit === 'count' || k.unit === 'usd')
    const projectedAtt = att == null ? null : projectable && elapsed > 0 && elapsed < 1 ? att / elapsed : att
    const kt = myTiers.filter((t) => t.kpi_id === k.id)
    const tier = tierFor(kt, att)
    return { kpi_id: k.id, name: k.name, unit: k.unit, target: k.target, actual, att, projectedAtt, tier, bonus: tier ? tier.bonus : 0, next: nextTierFor(kt, att) }
  })
  const overallTiers = myTiers.filter((t) => t.kpi_id == null)
  const overallAtt = weightedAttainment(lines.map((l, i) => ({ weight: mine[i].weight, att: l.att })))
  const overallTier = tierFor(overallTiers, overallAtt)
  const overallBonus = overallTier ? overallTier.bonus : 0
  const total = lines.reduce((s, l) => s + l.bonus, 0) + overallBonus

  let status: PayoutLine['status'] = 'no_plan'
  if (myTiers.length > 0) {
    if (total > 0) status = 'earned'
    else {
      const projOverall = weightedAttainment(lines.map((l, i) => ({ weight: mine[i].weight, att: l.projectedAtt })))
      const reachesKpi = lines.some((l) => {
        const kt = myTiers.filter((t) => t.kpi_id === l.kpi_id)
        return kt.length > 0 && tierFor(kt, l.projectedAtt) != null
      })
      const reachesOverall = overallTiers.length > 0 && tierFor(overallTiers, projOverall) != null
      status = reachesKpi || reachesOverall ? 'on_track' : 'behind'
    }
  }
  return { employee_id: emp.id, name: emp.name, department: emp.department, period_key: periodKey, kpis: lines, overallAtt, overallTier, overallBonus, total, status }
}

export const PAYOUT_STATUS_WORDS: Record<PayoutLine['status'], string> = {
  earned: 'Bonus earned',
  on_track: 'On track',
  behind: 'Behind',
  no_plan: 'No bonus plan',
}

/** Payroll export: one row per employee with a bonus line, plus each KPI on its own row. */
export function payoutCsv(lines: PayoutLine[], periodKey: string, approved?: { at: string; by: string | null } | null): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const out = [['Period', 'Employee', 'Department', 'Item', 'Target', 'Actual', 'Attainment %', 'Tier', 'Bonus'].join(',')]
  for (const l of lines) {
    for (const k of l.kpis) {
      out.push([periodLabel(periodKey), l.name, l.department, k.name, k.target, k.actual ?? '', k.att == null ? '' : (k.att * 100).toFixed(1), k.tier ? `${k.tier.attain_pct}%` : '', k.bonus.toFixed(2)].map(esc).join(','))
    }
    if (l.overallTier || l.overallAtt != null) {
      out.push([periodLabel(periodKey), l.name, l.department, 'Overall', '', '', l.overallAtt == null ? '' : (l.overallAtt * 100).toFixed(1), l.overallTier ? `${l.overallTier.attain_pct}%` : '', l.overallBonus.toFixed(2)].map(esc).join(','))
    }
    out.push([periodLabel(periodKey), l.name, l.department, 'TOTAL BONUS', '', '', '', '', l.total.toFixed(2)].map(esc).join(','))
  }
  if (approved) out.push(['', '', '', `Approved ${approved.at.slice(0, 10)}${approved.by ? ` by ${approved.by}` : ''}`, '', '', '', '', ''].map(esc).join(','))
  return out.join('\n') + '\n'
}

// ── Reviews and ranking ──────────────────────────────────────────────────

export function latestReview(reviews: Review[], employeeId: string): Review | null {
  return reviews.filter((r) => r.employee_id === employeeId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

export type RankRow = { employee_id: string; name: string; department: string; title: string | null; att: number | null; rating: number | null; bonus: number }

/** Rank by attainment (default) or by the latest review rating; ties fall back to the other. Nulls last. */
export function rankEmployees(rows: RankRow[], by: 'attainment' | 'rating' = 'attainment'): RankRow[] {
  const a = (r: RankRow) => (by === 'attainment' ? r.att : r.rating)
  const b = (r: RankRow) => (by === 'attainment' ? r.rating : r.att)
  return [...rows].sort((x, y) => {
    const ax = a(x)
    const ay = a(y)
    if (ax == null && ay != null) return 1
    if (ay == null && ax != null) return -1
    if (ax != null && ay != null && ax !== ay) return ay - ax
    const bx = b(x) ?? -1
    const by2 = b(y) ?? -1
    if (bx !== by2) return by2 - bx
    return x.name.localeCompare(y.name)
  })
}

// ── Org chart ────────────────────────────────────────────────────────────

export type OrgNode = { emp: Employee; reports: OrgNode[] }

/** Each department's people as a tree: managers with their reports. A manager in another department still anchors their own department's tree. */
export function orgByDepartment(emps: Employee[]): Array<{ department: string; roots: OrgNode[]; count: number }> {
  const byDept = new Map<string, Employee[]>()
  for (const e of emps) {
    const d = e.department?.trim() || 'No department'
    byDept.set(d, [...(byDept.get(d) ?? []), e])
  }
  const out: Array<{ department: string; roots: OrgNode[]; count: number }> = []
  for (const [department, people] of byDept) {
    const ids = new Set(people.map((p) => p.id))
    const build = (e: Employee, seen: Set<string>): OrgNode => ({
      emp: e,
      reports: people
        .filter((p) => p.manager_id === e.id && !seen.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => build(p, new Set([...seen, p.id]))),
    })
    const roots = people
      .filter((p) => !p.manager_id || !ids.has(p.manager_id) || p.manager_id === p.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => build(p, new Set([p.id])))
    out.push({ department, roots, count: people.length })
  }
  return out.sort((a, b) => (a.department === 'No department' ? 1 : b.department === 'No department' ? -1 : a.department.localeCompare(b.department)))
}

// ── Access ───────────────────────────────────────────────────────────────

/**
 * Salary and bonus are for the exec team only. An explicit
 * `settings.can_view_comp` (true/false) wins; otherwise owners and admins see
 * comp and everyone else does not.
 */
export function canViewComp(member: { role?: string | null; settings?: Record<string, unknown> | null } | null | undefined): boolean {
  if (!member) return false
  const flag = member.settings?.can_view_comp
  if (flag === true) return true
  if (flag === false) return false
  return member.role === 'owner' || member.role === 'admin'
}

// ── Import ───────────────────────────────────────────────────────────────

export const EMPLOYEE_TEMPLATE_HEADER = ['Name', 'Title', 'Department', 'Manager', 'Start date', 'Email', 'Base salary', 'Pay frequency']

export function employeeTemplateCsv(): string {
  return [
    '# One row per employee. Manager is the manager\'s name exactly as written in the Name column. Pay frequency: weekly, biweekly, semimonthly or monthly. Delete this example row.',
    EMPLOYEE_TEMPLATE_HEADER.join(','),
    'Jordan Example,Contracting Specialist,Contracting,,2025-03-01,jordan@example.com,52000,biweekly',
  ].join('\n') + '\n'
}

export type EmployeeImportRow = {
  name: string
  title: string | null
  department: string
  manager: string | null
  start_date: string | null
  email: string | null
  base_salary: number | null
  pay_frequency: PayFrequency
}

function toIsoDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
  if (us) {
    const y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3])
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null
}

export function parseFrequency(raw: string): PayFrequency {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (s.startsWith('week')) return 'weekly'
  if (s.startsWith('semi') || s === 'twiceamonth' || s === 'twicemonthly') return 'semimonthly'
  if (s.startsWith('month')) return 'monthly'
  return 'biweekly'
}

/** Rows (already split) → employees. Header names are matched loosely. */
export function parseEmployeeRows(rows: string[][]): { employees: EmployeeImportRow[]; skipped: number; problems: string[] } {
  const body = rows.filter((r) => !r[0]?.startsWith('#'))
  if (body.length === 0) return { employees: [], skipped: 0, problems: ['Nothing to read.'] }
  const head = body[0].map((h) => h.toLowerCase().trim())
  const col = (...n: string[]) => head.findIndex((h) => n.some((x) => h === x || h.startsWith(x)))
  const iName = col('name', 'employee', 'full name')
  if (iName === -1) return { employees: [], skipped: body.length - 1, problems: ['Add a Name column.'] }
  const iTitle = col('title', 'role', 'position')
  const iDept = col('department', 'dept', 'team')
  const iMgr = col('manager', 'reports to', 'supervisor')
  const iStart = col('start', 'hire')
  const iEmail = col('email')
  const iSal = col('base', 'salary', 'pay rate', 'annual')
  const iFreq = col('pay freq', 'frequency', 'pay schedule')
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const employees: EmployeeImportRow[] = []
  let skipped = 0
  for (const r of body.slice(1)) {
    const name = at(r, iName)
    if (!name) {
      skipped++
      continue
    }
    const salRaw = at(r, iSal).replace(/[$,\s]/g, '')
    const sal = salRaw ? Number(salRaw.replace(/k$/i, '000')) : null
    employees.push({
      name,
      title: at(r, iTitle) || null,
      department: at(r, iDept),
      manager: at(r, iMgr) || null,
      start_date: toIsoDate(at(r, iStart)),
      email: at(r, iEmail) || null,
      base_salary: sal != null && Number.isFinite(sal) ? sal : null,
      pay_frequency: parseFrequency(at(r, iFreq)),
    })
  }
  return { employees, skipped, problems: [] }
}

export function fmtKpiValue(unit: KpiUnit, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (unit === 'usd') return `$${Math.round(v).toLocaleString('en-US')}`
  if (unit === 'pct') return `${Number(v.toFixed(1))}%`
  if (unit === 'days') return `${Number(v.toFixed(1))} days`
  if (unit === 'hours') return `${Number(v.toFixed(1))} hrs`
  return Math.round(v * 10) % 10 === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)
}

/** Every employee's payout for one period (client-safe). */
export function payoutsForAll(
  data: { employees: Array<Pick<Employee, 'id' | 'name' | 'department'>>; kpis: Kpi[]; actuals: KpiActual[]; tiers: CompTier[] },
  periodKey: string,
  today: string,
): PayoutLine[] {
  const elapsed = elapsedShare(periodKey, today)
  return data.employees.map((e) => payoutFor(e, data.kpis, data.actuals, data.tiers, periodKey, elapsed))
}

// ── Quota snapshot (list view, detail, self-view, Mira) ──────────────────

export type QuotaPace = 'met' | 'on_pace' | 'behind' | 'no_data'

export type QuotaLine = {
  kpi: Kpi
  periodKey: string
  actual: number | null
  att: number | null
  /** Straight-line attainment at period end at today's pace ($ and counts only). */
  projectedAtt: number | null
  elapsed: number
  /** This quota's bonus tiers, lowest first (empty without comp). */
  tiers: CompTier[]
  tier: CompTier | null
  next: CompTier | null
  bonus: number
  bonusMax: number
  /** How much more of the quota (in its unit) reaches the next tier. */
  moreToNext: number | null
  pace: QuotaPace
}

export type OverallLine = { periodKey: string; att: number | null; tiers: CompTier[]; tier: CompTier | null; next: CompTier | null; bonus: number; bonusMax: number }

export type EmployeeSnapshot = {
  employee_id: string
  quotas: QuotaLine[]
  overall: OverallLine[]
  /** Weighted attainment across every quota at its own current period. */
  att: number | null
  bonusEarned: number
  bonusPossible: number
  status: 'met' | 'on_pace' | 'behind' | 'no_quota'
}

export const SNAPSHOT_STATUS_WORDS: Record<EmployeeSnapshot['status'], string> = {
  met: 'Hit quota',
  on_pace: 'On pace',
  behind: 'Behind',
  no_quota: 'No quota yet',
}

const maxBonus = (ts: CompTier[]) => ts.reduce((m, t) => Math.max(m, t.bonus), 0)

export function quotaLine(kpi: Kpi, actuals: KpiActual[], tiers: CompTier[], today: string, periodKey = periodKeyFor(kpi.period, today)): QuotaLine {
  const a = actuals.find((x) => x.kpi_id === kpi.id && x.period_key === periodKey)
  const actual = a ? a.actual : null
  const att = attainment(kpi, actual)
  const elapsed = elapsedShare(periodKey, today)
  const projectable = !kpi.lower_is_better && (kpi.unit === 'count' || kpi.unit === 'usd')
  const projectedAtt = att == null ? null : projectable && elapsed > 0 && elapsed < 1 ? att / elapsed : att
  const kt = tiers.filter((t) => t.kpi_id === kpi.id && t.employee_id === kpi.employee_id && t.period === kpi.period).sort((x, y) => x.attain_pct - y.attain_pct)
  const tier = tierFor(kt, att)
  const next = nextTierFor(kt, att)
  let moreToNext: number | null = null
  if (next && kpi.target > 0 && !kpi.lower_is_better) moreToNext = Math.max(0, (next.attain_pct / 100) * kpi.target - (actual ?? 0))
  let pace: QuotaPace = 'no_data'
  if (att != null) pace = att >= 1 - 1e-9 ? 'met' : (projectedAtt ?? att) >= 0.95 ? 'on_pace' : 'behind'
  return { kpi, periodKey, actual, att, projectedAtt, elapsed, tiers: kt, tier, next, bonus: tier ? tier.bonus : 0, bonusMax: maxBonus(kt), moreToNext, pace }
}

export function employeeSnapshot(
  emp: Pick<Employee, 'id'>,
  data: { kpis: Kpi[]; actuals: KpiActual[]; tiers: CompTier[] },
  today: string,
): EmployeeSnapshot {
  const mine = data.kpis.filter((k) => k.employee_id === emp.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
  const quotas = mine.map((k) => quotaLine(k, data.actuals, data.tiers, today))
  const overall: OverallLine[] = []
  for (const period of PERIODS) {
    const ot = data.tiers.filter((t) => t.employee_id === emp.id && t.kpi_id == null && t.period === period).sort((a, b) => a.attain_pct - b.attain_pct)
    if (ot.length === 0) continue
    const lines = quotas.filter((q) => q.kpi.period === period)
    const att = weightedAttainment(lines.map((l) => ({ weight: l.kpi.weight, att: l.att })))
    const tier = tierFor(ot, att)
    overall.push({ periodKey: periodKeyFor(period, today), att, tiers: ot, tier, next: nextTierFor(ot, att), bonus: tier ? tier.bonus : 0, bonusMax: maxBonus(ot) })
  }
  const att = weightedAttainment(quotas.map((q) => ({ weight: q.kpi.weight, att: q.att })))
  const bonusEarned = quotas.reduce((s, q) => s + q.bonus, 0) + overall.reduce((s, o) => s + o.bonus, 0)
  const bonusPossible = quotas.reduce((s, q) => s + q.bonusMax, 0) + overall.reduce((s, o) => s + o.bonusMax, 0)
  let status: EmployeeSnapshot['status'] = 'no_quota'
  const withData = quotas.filter((q) => q.pace !== 'no_data')
  if (quotas.length > 0) {
    if (withData.some((q) => q.pace === 'behind') || withData.length === 0) status = 'behind'
    else if (withData.every((q) => q.pace === 'met')) status = 'met'
    else status = 'on_pace'
  }
  return { employee_id: emp.id, quotas, overall, att, bonusEarned, bonusPossible, status }
}

/** "$1,200 more" / "6 more policies" to the next tier. */
export function moreWords(q: Pick<QuotaLine, 'moreToNext' | 'kpi'>): string | null {
  if (q.moreToNext == null) return null
  const v = q.moreToNext
  if (q.kpi.unit === 'usd') return `$${Math.ceil(v).toLocaleString('en-US')} more`
  const n = Math.ceil(v - 1e-9)
  const noun = q.kpi.quota_type === 'policies' ? 'policies' : q.kpi.quota_type === 'recruits' ? 'recruits' : q.kpi.quota_type === 'appointments' ? 'appointments' : ''
  return `${n.toLocaleString('en-US')} more${noun ? ` ${n === 1 ? noun.replace(/ies$/, 'y').replace(/s$/, '') : noun}` : ''}`
}

/** Loose name match for imports and Mira ("Joe" → "Joe Smith", emails win). */
export function matchEmployee<T extends { id: string; name: string; email?: string | null }>(people: T[], name: string | null | undefined, email?: string | null): { match: T | null; candidates: T[] } {
  const e = String(email ?? '').trim().toLowerCase()
  if (e) {
    const byEmail = people.find((p) => (p.email ?? '').trim().toLowerCase() === e)
    if (byEmail) return { match: byEmail, candidates: [byEmail] }
  }
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!n) return { match: null, candidates: [] }
  const exact = people.filter((p) => p.name.trim().toLowerCase().replace(/\s+/g, ' ') === n)
  if (exact.length === 1) return { match: exact[0], candidates: exact }
  if (exact.length > 1) return { match: null, candidates: exact }
  const tokens = n.split(' ')
  const loose = people.filter((p) => {
    const pn = p.name.toLowerCase().split(/\s+/)
    return tokens.every((t) => pn.some((x) => x === t || (t.length >= 3 && x.startsWith(t))))
  })
  if (loose.length === 1) return { match: loose[0], candidates: loose }
  return { match: null, candidates: loose }
}
