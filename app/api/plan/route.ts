import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { addTier, deletePlanRow, deleteTier, saveEcon, saveTargets } from '@/lib/plan/data'
import { parseAmount, planTemplateCsv, type PlanTarget } from '@/lib/plan/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}

const yearOf = (v: unknown) => {
  const y = Math.round(Number(v))
  return y >= 2020 && y <= 2100 ? y : null
}
const amt = (v: unknown) => (v == null || v === '' ? null : parseAmount(typeof v === 'number' ? v : String(v)))
const txt = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** GET ?template=1&year=2027 → the CSV template. */
export async function GET(req: NextRequest) {
  try {
    await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const year = yearOf(req.nextUrl.searchParams.get('year')) ?? new Date().getUTCFullYear() + 1
  return new NextResponse(planTemplateCsv(year), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="sales-plan-${year}-template.csv"` },
  })
}

/** POST { action, year, ... } — every write is scoped to the signed-in org. */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const year = yearOf(body.year)
  if (!year) return NextResponse.json({ error: 'Pick a plan year.' }, { status: 400 })
  try {
    switch (body.action) {
      case 'save_cells':
      case 'import': {
        const raw = Array.isArray(body.cells) ? (body.cells as Array<Record<string, unknown>>) : []
        if (raw.length > 20000) return NextResponse.json({ error: 'That is more rows than a plan needs. Split it up.' }, { status: 400 })
        const cells: PlanTarget[] = raw.map((c) => ({
          year,
          month: Math.round(Number(c.month)),
          product: txt(c.product),
          carrier: txt(c.carrier),
          premium: amt(c.premium) ?? 0,
          policies: amt(c.policies) == null ? null : Math.round(amt(c.policies)!),
        }))
        const saved = await saveTargets(repId, year, cells, body.action === 'import' && body.replace === true)
        return NextResponse.json({ ok: true, saved })
      }
      case 'delete_row':
        await deletePlanRow(repId, year, txt(body.product), txt(body.carrier))
        return NextResponse.json({ ok: true })
      case 'save_econ':
        await saveEcon(repId, {
          year,
          product: txt(body.product),
          carrier: txt(body.carrier),
          commission_pct: amt(body.commission_pct),
          avg_premium: amt(body.avg_premium),
          override_pct: amt(body.override_pct),
          acquisition_cost: amt(body.acquisition_cost),
        })
        return NextResponse.json({ ok: true })
      case 'add_tier': {
        const threshold = amt(body.threshold)
        const carrier = txt(body.carrier)
        const unlocks = txt(body.unlocks, 300)
        if (!carrier || threshold == null || threshold <= 0 || !unlocks) return NextResponse.json({ error: 'Add the carrier, the dollar threshold and what it unlocks.' }, { status: 400 })
        await addTier(repId, { year, carrier, period: body.period === 'quarter' ? 'quarter' : 'month', threshold, unlocks })
        return NextResponse.json({ ok: true })
      }
      case 'delete_tier':
        await deleteTier(repId, txt(body.id, 64))
        return NextResponse.json({ ok: true })
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
  } catch (err) {
    console.error('[plan] write', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save.' }, { status: 500 })
  }
}
