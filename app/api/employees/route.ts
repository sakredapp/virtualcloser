import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import {
  addReview,
  addTimeOff,
  approvePeriod,
  importEmployees,
  loadEmployees,
  payoutsFor,
  removeEmployee,
  removeKpi,
  removeReview,
  removeTimeOff,
  saveActual,
  saveKpi,
  saveTiers,
  unlockPeriod,
  upsertEmployee,
} from '@/lib/employees/data'
import { bookToday } from '@/lib/pinnacle/kpis'
import { canViewComp, employeeTemplateCsv, parseEmployeeRows, parseFrequency, parsePeriod, payoutCsv, periodOfKey, PERIOD_KEY_RE, QUOTA_TYPES, TIME_OFF_KINDS, type EmployeeImportRow, type KpiUnit, type QuotaType, type TimeOffKind } from '@/lib/employees/shared'
import { inviteEmployee } from '@/lib/employees/invite'
import { readTable } from '@/lib/plan/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}
const noComp = () => NextResponse.json({ error: 'Salary and bonus are for the exec team only.' }, { status: 403 })
const txt = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(String(v).replace(/[$,\s]/g, ''))) ? Number(String(v).replace(/[$,\s]/g, '')) : null)
const PERIOD_KEY = PERIOD_KEY_RE
const ISO = /^\d{4}-\d{2}-\d{2}$/
const UNITS: KpiUnit[] = ['count', 'usd', 'pct', 'days', 'hours']

/**
 * GET ?template=1 → employee import template.
 * GET ?export=payouts&period=2026-10 → payroll CSV (comp viewers only).
 */
export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const sp = req.nextUrl.searchParams
  if (sp.get('template')) {
    return new NextResponse(employeeTemplateCsv(), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="employees-template.csv"' } })
  }
  if (sp.get('export') === 'payouts') {
    if (!canViewComp(ctx.member)) return noComp()
    const key = sp.get('period') ?? ''
    if (!PERIOD_KEY.test(key)) return NextResponse.json({ error: 'Pick a month, quarter or year.' }, { status: 400 })
    const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
    const data = await loadEmployees(ctx.tenant.id, true, today)
    const lock = data.locks.find((l) => l.period_key === key)
    const lines = lock ? lock.lines : payoutsFor(data, periodOfKey(key), today, key)
    const csv = payoutCsv(lines, key, lock ? { at: lock.approved_at, by: lock.approved_by_name } : null)
    return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="bonus-payouts-${key}.csv"` } })
  }
  return NextResponse.json({ error: 'Nothing asked for.' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const comp = canViewComp(ctx.member)
  const me = { id: ctx.member.id, name: ctx.member.display_name || ctx.member.email || null }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    switch (body.action) {
      case 'save_employee': {
        const id = txt(body.id, 64) || null
        const touchesComp = body.base_salary !== undefined || body.pay_frequency !== undefined || body.hourly_rate !== undefined
        if (touchesComp && !comp) return noComp()
        const newId = await upsertEmployee(
          repId,
          id,
          {
            name: body.name === undefined ? undefined : txt(body.name, 120),
            title: body.title === undefined ? undefined : txt(body.title, 120) || null,
            department: body.department === undefined ? undefined : txt(body.department, 80),
            manager_id: body.manager_id === undefined ? undefined : txt(body.manager_id, 64) || null,
            start_date: body.start_date === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date)) ? String(body.start_date) : null,
            email: body.email === undefined ? undefined : txt(body.email, 200) || null,
            base_salary: body.base_salary === undefined ? undefined : numOrNull(body.base_salary),
            pay_frequency: body.pay_frequency === undefined ? undefined : parseFrequency(String(body.pay_frequency)),
            hourly_rate: body.hourly_rate === undefined ? undefined : numOrNull(body.hourly_rate),
            hours_per_week: body.hours_per_week === undefined ? undefined : numOrNull(body.hours_per_week),
            pto_allowed_days: body.pto_allowed_days === undefined ? undefined : numOrNull(body.pto_allowed_days),
            pto_balance_days: body.pto_balance_days === undefined ? undefined : numOrNull(body.pto_balance_days),
            book_match: body.book_match === undefined ? undefined : txt(body.book_match, 120) || null,
            book_dim: body.book_dim === undefined ? undefined : body.book_dim === 'team' ? 'team' : body.book_match ? 'agent' : null,
            qbo_employee_id: body.qbo_employee_id === undefined ? undefined : txt(body.qbo_employee_id, 64) || null,
          },
          comp,
        )
        return NextResponse.json({ ok: true, id: newId })
      }
      case 'remove_employee':
        await removeEmployee(repId, txt(body.id, 64))
        return NextResponse.json({ ok: true })
      case 'import': {
        const text = typeof body.text === 'string' ? body.text.slice(0, 2_000_000) : ''
        const parsed = parseEmployeeRows(readTable(text))
        if (parsed.problems.length) return NextResponse.json({ error: parsed.problems.join(' ') }, { status: 400 })
        if (parsed.employees.length > 2000) return NextResponse.json({ error: 'Up to 2,000 people per import.' }, { status: 400 })
        const rows: EmployeeImportRow[] = comp ? parsed.employees : parsed.employees.map((e) => ({ ...e, base_salary: null }))
        const res = await importEmployees(repId, rows, comp)
        return NextResponse.json({ ok: true, ...res, skipped: parsed.skipped })
      }
      case 'save_kpi': {
        const qt: QuotaType = QUOTA_TYPES.some((q) => q.type === body.quota_type) ? (body.quota_type as QuotaType) : 'custom'
        const info = QUOTA_TYPES.find((q) => q.type === qt)!
        const unit = qt !== 'custom' ? info.unit : UNITS.includes(body.unit as KpiUnit) ? (body.unit as KpiUnit) : 'count'
        const name = txt(body.name, 120) || (qt !== 'custom' ? info.label.replace(/ \$$/, '') : '')
        const id = await saveKpi(repId, {
          id: txt(body.id, 64) || undefined,
          employee_id: txt(body.employee_id, 64),
          name,
          unit,
          target: numOrNull(body.target) ?? 0,
          period: parsePeriod(String(body.period ?? 'month')),
          quota_type: qt,
          actual_source: body.actual_source === 'book' && info.bookable ? 'book' : 'manual',
          weight: numOrNull(body.weight) ?? 1,
          lower_is_better: body.lower_is_better === true,
          sort: numOrNull(body.sort) ?? 0,
        })
        return NextResponse.json({ ok: true, id })
      }
      case 'remove_kpi':
        await removeKpi(repId, txt(body.id, 64))
        return NextResponse.json({ ok: true })
      case 'save_actual': {
        const key = txt(body.period_key, 10)
        if (!PERIOD_KEY.test(key)) return NextResponse.json({ error: 'Bad period.' }, { status: 400 })
        await saveActual(repId, txt(body.kpi_id, 64), key, numOrNull(body.actual))
        return NextResponse.json({ ok: true })
      }
      case 'save_tiers': {
        if (!comp) return noComp()
        const tiers = Array.isArray(body.tiers) ? (body.tiers as Array<Record<string, unknown>>).slice(0, 12).map((t) => ({ attain_pct: numOrNull(t.attain_pct) ?? 0, bonus: numOrNull(t.bonus) ?? 0 })) : []
        await saveTiers(repId, txt(body.employee_id, 64), parsePeriod(String(body.period ?? 'month')), txt(body.kpi_id, 64) || null, tiers)
        return NextResponse.json({ ok: true })
      }
      case 'add_review': {
        const type = body.period_type === 'year' ? 'year' : body.period_type === 'quarter' ? 'quarter' : 'month'
        const ratings = typeof body.kpi_ratings === 'object' && body.kpi_ratings ? (body.kpi_ratings as Record<string, number>) : {}
        await addReview(repId, { employee_id: txt(body.employee_id, 64), period_type: type, period_key: txt(body.period_key, 16), overall: numOrNull(body.overall), kpi_ratings: ratings, notes: txt(body.notes, 4000) || null }, me)
        return NextResponse.json({ ok: true })
      }
      case 'remove_review':
        await removeReview(repId, txt(body.id, 64))
        return NextResponse.json({ ok: true })
      case 'approve': {
        if (!comp) return noComp()
        const key = txt(body.period_key, 10)
        if (!PERIOD_KEY.test(key)) return NextResponse.json({ error: 'Bad period.' }, { status: 400 })
        const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
        const data = await loadEmployees(repId, true, today)
        await approvePeriod(repId, key, payoutsFor(data, periodOfKey(key), today, key), me)
        return NextResponse.json({ ok: true })
      }
      case 'unlock': {
        if (!comp) return noComp()
        const key = txt(body.period_key, 10)
        if (!PERIOD_KEY.test(key)) return NextResponse.json({ error: 'Bad period.' }, { status: 400 })
        await unlockPeriod(repId, key)
        return NextResponse.json({ ok: true })
      }
      case 'add_time_off': {
        const start = String(body.start_date ?? '')
        if (!ISO.test(start)) return NextResponse.json({ error: 'Pick a start date.' }, { status: 400 })
        const kind: TimeOffKind = TIME_OFF_KINDS.includes(body.kind as TimeOffKind) ? (body.kind as TimeOffKind) : 'vacation'
        const id = await addTimeOff(repId, {
          employee_id: txt(body.employee_id, 64),
          start_date: start,
          end_date: ISO.test(String(body.end_date ?? '')) ? String(body.end_date) : null,
          days: numOrNull(body.days),
          kind,
          note: txt(body.note, 300) || null,
        })
        return NextResponse.json({ ok: true, id })
      }
      case 'remove_time_off':
        await removeTimeOff(repId, txt(body.id, 64))
        return NextResponse.json({ ok: true })
      case 'invite_employee': {
        // Exec action: owners and admins only (same rule as Settings invites).
        if (!['owner', 'admin'].includes(String(ctx.member.role))) return NextResponse.json({ error: 'Only owners and admins can invite.' }, { status: 403 })
        const res = await inviteEmployee(
          { id: repId, slug: ctx.tenant.slug, display_name: ctx.tenant.display_name, brand: (ctx.tenant as { brand?: string }).brand ?? null },
          { id: ctx.member.id, display_name: ctx.member.display_name },
          txt(body.employee_id, 64),
          { email: txt(body.email, 200) || null },
        )
        return NextResponse.json({ ok: true, ...res })
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
  } catch (err) {
    console.error('[employees] write', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save.' }, { status: 500 })
  }
}
