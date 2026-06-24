// "What your assistant has learned" — list + add learned-guidance rules.
// Each rule is a durable instruction the Plaud agent/planner reads back into
// its prompts (lib/plaud/guidance.ts). Scoped to the authenticated tenant.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import {
  listGuidance,
  addManualGuidance,
  type GuidanceScope,
  type GuidanceKind,
} from '@/lib/plaud/guidance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCOPES: GuidanceScope[] = ['note_agent', 'planner', 'both']
const KINDS: GuidanceKind[] = ['avoid', 'prefer', 'correction', 'fact']

export async function GET() {
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const rules = await listGuidance(tenant.id)
  return NextResponse.json({ ok: true, rules })
}

export async function POST(req: NextRequest) {
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    rule?: string
    scope?: string
    kind?: string
  }
  const rule = typeof body.rule === 'string' ? body.rule.trim() : ''
  if (!rule) return NextResponse.json({ ok: false, error: 'rule required' }, { status: 400 })

  const scope = (SCOPES as string[]).includes(body.scope ?? '') ? (body.scope as GuidanceScope) : 'both'
  const kind = (KINDS as string[]).includes(body.kind ?? '') ? (body.kind as GuidanceKind) : 'avoid'

  const created = await addManualGuidance(tenant.id, rule, scope, kind)
  if (!created) return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 })
  return NextResponse.json({ ok: true, rule: created })
}
