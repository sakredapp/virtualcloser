/**
 * Mira tools for the Sales Plan and Employees pages (Suite CXO).
 *
 *  - plan_pacing             "how are we pacing vs plan"
 *  - next_allowance_unlock   "what's the next allowance unlock for Mutual of Omaha"
 *  - bonus_on_track          "who's on track for bonus this month"
 *  - top_performers          "top performers in contracting"
 *
 * Every figure comes from the saved plan, the live Pinnacle book and the
 * employee records. Bonus dollars are returned only to members who may see
 * comp; the data layer strips them for everyone else.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { loadPlanPage } from '@/lib/plan/data'
import {
  MONTHS,
  STATUS_WORDS,
  allowanceStatus,
  breakdownVsPlan,
  matchActual,
  money,
  norm,
  pacing,
  pct,
  periodElapsed,
  planByMonth,
  quarterOf,
} from '@/lib/plan/shared'
import { loadEmployees } from '@/lib/employees/data'
import {
  PAYOUT_STATUS_WORDS,
  canViewComp,
  latestReview,
  monthKey,
  payoutsForAll,
  periodLabel,
  quarterKey,
  rankEmployees,
  type RankRow,
} from '@/lib/employees/shared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function planYear(ctx: AgentContext, raw: unknown): number {
  const y = Number(raw)
  return Number.isInteger(y) && y >= 2020 && y <= 2100 ? y : Number(ctx.todayIso.slice(0, 4))
}

const handle_plan_pacing: Handler = async (ctx, args) => {
  const year = planYear(ctx, args.year)
  const data = await loadPlanPage(ctx.tenant.id, year, ctx.timezone)
  if (data.targets.length === 0) {
    return j({ ok: true, year, has_plan: false, say: `There is no ${year} sales plan yet. It can be imported on the Sales Plan page.` })
  }
  const p = pacing(planByMonth(data.targets), data.actuals.monthly, year, data.today)
  const byCarrier = breakdownVsPlan(data.targets, 'carrier', { rows: data.actuals.byCarrier, lines: data.actuals.byLine }, year, data.today)
  const byProduct = breakdownVsPlan(data.targets, 'product', { rows: data.actuals.byProduct, lines: data.actuals.byLine }, year, data.today)
  const line = (b: (typeof byCarrier)[number]) => ({
    name: b.name,
    plan_year: money(b.planYear),
    plan_to_date: money(b.planToDate),
    actual_to_date: money(b.actual),
    pct_of_plan_to_date: pct(b.pct),
  })
  return j({
    ok: true,
    year,
    has_plan: true,
    data_through: data.actuals.through,
    status: STATUS_WORDS[p.status],
    plan_for_year: money(p.planTotal),
    plan_to_date: money(p.planToDate),
    actual_to_date: money(p.actualToDate),
    pct_of_plan_to_date: pct(p.pctOfPlanToDate),
    pct_of_full_year: pct(p.pctOfYear),
    projected_year_end: money(p.projected),
    projected_pct_of_plan: pct(p.projectedPct),
    gap_to_plan_to_date: money(p.gap),
    by_carrier: byCarrier.map(line),
    by_product: byProduct.map(line),
    say: 'Lead with the status and the % of plan to date, then the biggest carrier or product gap. Use only these figures.',
  })
}

const handle_next_allowance_unlock: Handler = async (ctx, args) => {
  const carrierQ = str(args.carrier)
  const thisYear = Number(ctx.todayIso.slice(0, 4))
  const data = await loadPlanPage(ctx.tenant.id, thisYear, ctx.timezone)
  let tiers = data.tiers
  let usedYear = thisYear
  if (tiers.length === 0) {
    const next = await loadPlanPage(ctx.tenant.id, thisYear + 1, ctx.timezone)
    tiers = next.tiers
    usedYear = thisYear + 1
  }
  if (tiers.length === 0) return j({ ok: true, has_tiers: false, say: 'No marketing allowance tiers are saved yet. They are added on the Sales Plan page under Marketing allowance.' })
  const carriers = Array.from(new Map(tiers.map((t) => [`${norm(t.carrier)}|${t.period}`, { carrier: t.carrier, period: t.period }])).values())
  const wanted = carrierQ ? carriers.filter((c) => norm(c.carrier).includes(norm(carrierQ)) || norm(carrierQ).includes(norm(c.carrier))) : carriers
  if (carrierQ && wanted.length === 0) {
    return j({ ok: true, found: false, carriers_with_tiers: Array.from(new Set(carriers.map((c) => c.carrier))), say: `No allowance tiers are saved for "${carrierQ}". Name one of carriers_with_tiers.` })
  }
  const today = data.today
  const tm = Number(today.slice(5, 7))
  const current = usedYear === thisYear
  const out = wanted.map((g) => {
    const rows = g.period === 'month' ? data.actuals.carrierThisMonth : data.actuals.carrierThisQuarter
    const actual = current ? matchActual(g.carrier, rows).premium : 0
    const label = current ? (g.period === 'month' ? `${MONTHS[tm - 1]} ${usedYear}` : `Q${quarterOf(tm)} ${usedYear}`) : `starts ${usedYear}`
    const s = allowanceStatus(g.carrier, g.period, tiers, actual, current ? periodElapsed(g.period, today) : 0, label)
    return {
      carrier: s.carrier,
      period: s.periodLabel,
      measured: g.period === 'month' ? 'monthly premium' : 'quarterly premium',
      premium_so_far: money(s.actual),
      reached: s.reached ? `${money(s.reached.threshold)}: ${s.reached.unlocks}` : null,
      next_tier: s.next ? `${money(s.next.threshold)}: ${s.next.unlocks}` : null,
      more_needed: s.next ? money(s.toNext) : null,
      on_pace_to_reach: s.projectedTier ? `${money(s.projectedTier.threshold)}: ${s.projectedTier.unlocks}` : null,
      all_tiers_reached: !s.next && s.tiers.length > 0,
    }
  })
  return j({ ok: true, data_through: data.actuals.through, allowances: out, say: 'Answer as "$X more to unlock Y" per carrier. Use only these figures.' })
}

async function employeesFor(ctx: AgentContext) {
  const comp = canViewComp(ctx.caller)
  const data = await loadEmployees(ctx.tenant.id, comp)
  return { comp, data }
}

const handle_bonus_on_track: Handler = async (ctx, args) => {
  const { comp, data } = await employeesFor(ctx)
  if (data.employees.length === 0) return j({ ok: true, employees: 0, say: 'No employees are set up yet. They are added on the Employees page.' })
  const period = str(args.period) === 'quarter' ? 'quarter' : 'month'
  const key = period === 'quarter' ? quarterKey(ctx.todayIso) : monthKey(ctx.todayIso)
  const dept = str(args.department)
  const lines = payoutsForAll(data, key, ctx.todayIso).filter((l) => !dept || norm(l.department).includes(norm(dept)))
  const withPlan = lines.filter((l) => l.status !== 'no_plan')
  const row = (l: (typeof lines)[number]) => ({
    name: l.name,
    department: l.department || null,
    status: PAYOUT_STATUS_WORDS[l.status],
    overall_to_goal: pct(l.overallAtt),
    kpis: l.kpis.map((k) => ({ kpi: k.name, to_goal: pct(k.att), on_pace_for: pct(k.projectedAtt) })),
    ...(comp ? { bonus_so_far: money(l.total) } : {}),
  })
  return j({
    ok: true,
    period: periodLabel(key),
    on_track: withPlan.filter((l) => l.status === 'earned' || l.status === 'on_track').map(row),
    behind: withPlan.filter((l) => l.status === 'behind').map(row),
    no_bonus_plan: lines.filter((l) => l.status === 'no_plan').map((l) => l.name),
    comp_hidden: !comp,
    say: comp ? 'List who is on track first, then who is behind and by how much.' : 'List who is on track and who is behind. Do not mention bonus dollars; this person cannot see comp.',
  })
}

const handle_top_performers: Handler = async (ctx, args) => {
  const { comp, data } = await employeesFor(ctx)
  if (data.employees.length === 0) return j({ ok: true, employees: 0, say: 'No employees are set up yet. They are added on the Employees page.' })
  const dept = str(args.department)
  const by = str(args.by) === 'rating' ? 'rating' : 'attainment'
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 5))
  const mKey = monthKey(ctx.todayIso)
  const qKey = quarterKey(ctx.todayIso)
  const month = payoutsForAll(data, mKey, ctx.todayIso)
  const quarter = payoutsForAll(data, qKey, ctx.todayIso)
  const emps = data.employees.filter((e) => !dept || norm(e.department).includes(norm(dept)))
  if (dept && emps.length === 0) {
    return j({ ok: true, found: false, departments: Array.from(new Set(data.employees.map((e) => e.department).filter(Boolean))), say: `No one is in a department matching "${dept}". Name one of departments.` })
  }
  const rows: RankRow[] = emps.map((e) => {
    const mp = month.find((p) => p.employee_id === e.id)
    const qp = quarter.find((p) => p.employee_id === e.id)
    return {
      employee_id: e.id,
      name: e.name,
      department: e.department,
      title: e.title,
      att: mp?.overallAtt ?? qp?.overallAtt ?? null,
      rating: latestReview(data.reviews, e.id)?.overall ?? null,
      bonus: (mp?.total ?? 0) + (qp?.total ?? 0),
    }
  })
  const ranked = rankEmployees(rows, by).slice(0, limit)
  return j({
    ok: true,
    ranked_by: by === 'rating' ? 'latest review rating (1-5)' : `KPI attainment, ${periodLabel(mKey)}`,
    department: dept || 'all',
    top: ranked.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      title: r.title,
      department: r.department || null,
      to_goal: pct(r.att),
      latest_review: r.rating == null ? null : `${r.rating}/5`,
      ...(comp ? { bonus_so_far: money(r.bonus) } : {}),
    })),
    say: 'Name the top few with one figure each. Use only these figures.',
  })
}

export const CXO_PLAN_TOOL_HANDLERS: Record<string, Handler> = {
  plan_pacing: handle_plan_pacing,
  next_allowance_unlock: handle_next_allowance_unlock,
  bonus_on_track: handle_bonus_on_track,
  top_performers: handle_top_performers,
}

export const CXO_PLAN_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'plan_pacing',
    description:
      'Sales plan vs actual premium: "how are we pacing vs plan", "are we on plan for Life", "which carrier is behind plan". Returns status, % of plan to date, projected year end, and plan vs actual by carrier and product. Read it before answering any plan question; never estimate.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer', description: 'Plan year. Default: this year.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'next_allowance_unlock',
    description:
      'Carrier marketing allowance tiers: "what\'s the next allowance unlock for Mutual of Omaha", "how close are we to the next Aetna tier". Returns premium so far this period, the tier reached, the next tier and how much more premium unlocks it. Omit carrier for every carrier with tiers.',
    input_schema: {
      type: 'object',
      properties: { carrier: { type: 'string', description: 'Carrier as the executive said it. Optional.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'bonus_on_track',
    description:
      'Employee bonus tracking: "who\'s on track for bonus this month", "who is behind on their KPIs this quarter". Returns each employee\'s status against their KPI goals and bonus tiers. Bonus dollars are included only when this executive may see comp.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['month', 'quarter'], description: 'Default month.' },
        department: { type: 'string', description: 'Optional department filter, e.g. Contracting.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'top_performers',
    description:
      'Rank employees (staff, not agents): "top performers in contracting", "who has the best reviews". by=attainment (KPI % to goal this period, default) or rating (latest review). For agents\' sales production use pinnacle_revenue instead.',
    input_schema: {
      type: 'object',
      properties: {
        department: { type: 'string' },
        by: { type: 'string', enum: ['attainment', 'rating'] },
        limit: { type: 'integer', description: 'Default 5, max 20.' },
      },
      additionalProperties: false,
    },
  },
]
