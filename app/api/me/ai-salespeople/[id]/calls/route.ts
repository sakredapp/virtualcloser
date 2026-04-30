import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let tenant
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: setterId } = await params

  // Verify setter belongs to this tenant
  const { data: setter } = await supabase
    .from('ai_salespeople')
    .select('id')
    .eq('id', setterId)
    .eq('rep_id', tenant.id)
    .single()
  if (!setter) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)
  const offset = Number(url.searchParams.get('offset') ?? '0')

  const { data: calls, count, error } = await supabase
    .from('voice_calls')
    .select('id, to_number, outcome, duration_seconds, started_at, summary, status, raw', {
      count: 'exact',
    })
    .eq('ai_salesperson_id', setterId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, calls: calls ?? [], total: count ?? 0, offset, limit })
}
