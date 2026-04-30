import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getSalespersonForRep } from '@/lib/ai-salesperson'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function canManage(role: string, tier: string): boolean {
  if (tier === 'individual') return true
  return ['owner', 'admin', 'manager'].includes(role)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const setter = await getSalespersonForRep(ctx.tenant.id, id)
  if (!setter) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const status = req.nextUrl.searchParams.get('status')
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50

  let q = supabase
    .from('ai_salesperson_followups')
    .select('id, lead_id, queue_id, source_call_id, due_at, channel, reason, status, created_at')
    .eq('rep_id', ctx.tenant.id)
    .eq('ai_salesperson_id', id)
    .order('due_at', { ascending: true })
    .limit(limit)

  if (status && ['pending', 'queued', 'done', 'cancelled'].includes(status)) {
    q = q.eq('status', status)
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, items: data ?? [] })
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
  const setter = await getSalespersonForRep(ctx.tenant.id, id)
  if (!setter) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  let body: { followup_id?: string; status?: 'pending' | 'queued' | 'done' | 'cancelled' }
  try {
    body = (await req.json()) as { followup_id?: string; status?: 'pending' | 'queued' | 'done' | 'cancelled' }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  if (!body.followup_id || !body.status) {
    return NextResponse.json({ ok: false, error: 'followup_id_and_status_required' }, { status: 400 })
  }
  if (!['pending', 'queued', 'done', 'cancelled'].includes(body.status)) {
    return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('ai_salesperson_followups')
    .select('id')
    .eq('id', body.followup_id)
    .eq('rep_id', ctx.tenant.id)
    .eq('ai_salesperson_id', id)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'followup_not_found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('ai_salesperson_followups')
    .update({ status: body.status })
    .eq('id', body.followup_id)
    .eq('rep_id', ctx.tenant.id)
    .eq('ai_salesperson_id', id)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
