// POST /api/admin/local-presence/import
//
// Bulk-imports the 79 Telnyx local presence numbers into the pool.
// Admin only.
//
// Body: { repId: string, numbers: string[] }  ← E.164 strings
//   OR: { repId: string, numbers: { e164: string, trunk_sid?: string }[] }
//
// Returns: { ok: true, imported, skipped }

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { importLocalNumbers } from '@/lib/campaign/localPresence'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!isAtLeast(ctx.member.role, 'admin')) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as {
    repId?: string
    numbers?: (string | { e164: string; trunk_sid?: string })[]
  }

  const repId = body.repId ?? ctx.tenant.id
  const raw = body.numbers
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ ok: false, error: 'numbers[] required' }, { status: 400 })
  }

  const normalized = raw.map((n) =>
    typeof n === 'string' ? { e164: n } : n,
  )

  try {
    const result = await importLocalNumbers(repId, normalized)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'import_failed' },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!isAtLeast(ctx.member.role, 'admin')) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { data } = await supabase
    .from('local_presence_numbers')
    .select('e164, area_code, state, active, last_used_at')
    .eq('rep_id', ctx.tenant.id)
    .order('area_code')

  return NextResponse.json({ ok: true, numbers: data ?? [], count: data?.length ?? 0 })
}
