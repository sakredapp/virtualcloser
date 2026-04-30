import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import {
  getSalespersonForRep,
  updateSalesperson,
  archiveSalesperson,
} from '@/lib/ai-salesperson'
import { resolveMemberDataScope } from '@/lib/permissions'
import type { AiSalespersonInput } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function canManage(role: string, tier: string): boolean {
  if (tier === 'individual') return true
  return ['owner', 'admin', 'manager'].includes(role)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const item = await getSalespersonForRep(ctx.tenant.id, id)
  if (!item) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, item })
}

async function assertRepScope(ctx: Awaited<ReturnType<typeof requireMember>>, id: string) {
  if (ctx.tenant.tier !== 'enterprise' || ctx.member.role !== 'rep') return null
  const setter = await getSalespersonForRep(ctx.tenant.id, id)
  if (!setter) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const scope = await resolveMemberDataScope(ctx.member)
  if (scope.memberIds && !scope.memberIds.includes(setter.assigned_member_id ?? '')) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!canManage(ctx.member.role, ctx.tenant.tier)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { id } = await params
  const scopeErr = await assertRepScope(ctx, id)
  if (scopeErr) return scopeErr

  let body: Partial<AiSalespersonInput>
  try {
    body = (await req.json()) as Partial<AiSalespersonInput>
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  try {
    const updated = await updateSalesperson(ctx.tenant.id, id, body)
    return NextResponse.json({ ok: true, item: updated })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!canManage(ctx.member.role, ctx.tenant.tier)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const { id } = await params
  const scopeErr = await assertRepScope(ctx, id)
  if (scopeErr) return scopeErr
  try {
    await archiveSalesperson(ctx.tenant.id, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
