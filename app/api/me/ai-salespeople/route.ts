import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import {
  listSalespeople,
  createSalesperson,
  getOrCreateDefaultSalesperson,
} from '@/lib/ai-salesperson'
import type { AiSalespersonInput } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function canManage(role: string, tier: string): boolean {
  if (tier === 'individual') return true
  return ['owner', 'admin', 'manager'].includes(role)
}

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const includeArchived = url.searchParams.get('includeArchived') === '1'
  const ensureDefault = url.searchParams.get('ensureDefault') === '1'

  try {
    if (ensureDefault) {
      // Lazy-migrate the legacy single-config row
      await getOrCreateDefaultSalesperson(ctx.tenant.id)
    }
    const items = await listSalespeople(ctx.tenant.id, { includeArchived })
    return NextResponse.json({ ok: true, items })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!canManage(ctx.member.role, ctx.tenant.tier)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let body: AiSalespersonInput
  try {
    body = (await req.json()) as AiSalespersonInput
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ ok: false, error: 'name_required' }, { status: 400 })
  }

  try {
    const created = await createSalesperson(ctx.tenant.id, body, ctx.member.id)
    return NextResponse.json({ ok: true, item: created })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
