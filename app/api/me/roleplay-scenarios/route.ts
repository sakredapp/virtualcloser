import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import {
  PRESET_SCENARIOS,
  createScenario,
  deleteScenario,
  listScenarios,
  updateScenario,
  type RoleplayObjection,
} from '@/lib/roleplay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Tenant-side CRUD for roleplay scenarios.
 *
 * GET    → { scenarios, presets }
 * POST   → create new scenario (or materialize a preset by `preset_slug`)
 * PATCH  → update existing scenario by id
 * DELETE → soft-delete scenario by id (?id=...)
 */

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const scenarios = await listScenarios(ctx.tenant.id)
  return NextResponse.json({ ok: true, scenarios, presets: PRESET_SCENARIOS })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    preset_slug?: string
    name?: string
    product_brief?: string
    persona?: string
    difficulty?: 'easy' | 'standard' | 'hard' | 'brutal'
    objection_bank?: RoleplayObjection[]
  }

  if (body.preset_slug) {
    const p = PRESET_SCENARIOS.find((x) => x.slug === body.preset_slug)
    if (!p) return NextResponse.json({ ok: false, error: 'unknown preset' }, { status: 400 })
    const scenario = await createScenario(ctx.tenant.id, ctx.member.id, {
      name: p.name,
      persona: p.persona,
      difficulty: p.difficulty,
      objection_bank: p.objection_bank,
    })
    return NextResponse.json({ ok: true, scenario })
  }

  if (!body.name) {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  }
  const scenario = await createScenario(ctx.tenant.id, ctx.member.id, {
    name: body.name,
    product_brief: body.product_brief ?? null,
    persona: body.persona ?? null,
    difficulty: body.difficulty ?? 'standard',
    objection_bank: body.objection_bank ?? [],
  })
  return NextResponse.json({ ok: true, scenario })
}

export async function PATCH(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    name?: string
    product_brief?: string
    persona?: string
    difficulty?: 'easy' | 'standard' | 'hard' | 'brutal'
    objection_bank?: RoleplayObjection[]
    is_active?: boolean
  }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const scenario = await updateScenario(ctx.tenant.id, body.id, body)
  return NextResponse.json({ ok: true, scenario })
}

export async function DELETE(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  await deleteScenario(ctx.tenant.id, id)
  return NextResponse.json({ ok: true })
}
