// Update (edit text / scope / kind / mute) or delete a single learned-guidance
// rule. Scoped to the authenticated tenant via rep_id match in the lib.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import {
  updateGuidanceRule,
  deleteGuidance,
  type GuidanceScope,
  type GuidanceKind,
} from '@/lib/plaud/guidance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCOPES: GuidanceScope[] = ['note_agent', 'planner', 'both']
const KINDS: GuidanceKind[] = ['avoid', 'prefer', 'correction', 'fact']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    rule?: string
    scope?: string
    kind?: string
    active?: boolean
  }
  const patch: { rule?: string; scope?: GuidanceScope; kind?: GuidanceKind; active?: boolean } = {}
  if (typeof body.rule === 'string') patch.rule = body.rule
  if (body.scope && (SCOPES as string[]).includes(body.scope)) patch.scope = body.scope as GuidanceScope
  if (body.kind && (KINDS as string[]).includes(body.kind)) patch.kind = body.kind as GuidanceKind
  if (typeof body.active === 'boolean') patch.active = body.active

  const ok = await updateGuidanceRule(id, tenant.id, patch)
  if (!ok) return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const ok = await deleteGuidance(id, tenant.id)
  if (!ok) return NextResponse.json({ ok: false, error: 'delete failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
