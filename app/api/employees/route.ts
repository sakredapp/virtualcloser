import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import {
  addReview,
  approvePeriod,
  importEmployees,
  loadEmployees,
  payoutsFor,
  removeEmployee,
  removeKpi,
  removeReview,
  saveActual,
  saveKpi,
  saveTiers,
  unlockPeriod,
  upsertEmployee,
} from '@/lib/employees/data'
import { bookToday } from '@/lib/pinnacle/kpis'
import { canViewComp, employeeTemplateCsv, parseEmployeeRows, parseFrequency, payoutCsv, periodOfKey, type EmployeeImportRow, type KpiUnit } from '@/lib/employees/shared'
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
const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/
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
    if (!PERIOD_KEY.test(key)) return NextResponse.json({ error: 'Pick a month or quarter.' }, { status: 400 })
    const data = await loadEmployees(ctx.tenant.id, true)
    const lock = data.locks.find((l) => l.period_key === key)
    const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
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
        const touchesComp = body.base_salary !== undefined || body.pay_frequency !== undefined
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
        const unit = UNITS.includes(body.unit as KpiUnit) ? (body.unit as KpiUnit) : 'count'
        const id = await saveKpi(repId, {
          id: txt(body.id, 64) || undefined,
          employee_id: txt(body.employee_id, 64),
          name: txt(body.name, 120),
          unit,
          target: numOrNull(body.target) ?? 0,
          period: body.period === 'quarter' ? 'quarter' : 'month',
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
        await saveTiers(repId, txt(body.employee_id, 64), body.period === 'quarter' ? 'quarter' : 'month', txt(body.kpi_id, 64) || null, tiers)
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
        const data = await loadEmployees(repId, true)
        const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
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
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
  } catch (err) {
    console.error('[employees] write', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save.' }, { status: 500 })
  }
}
