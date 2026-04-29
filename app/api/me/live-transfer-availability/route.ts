import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getManagedTeamIds } from '@/lib/members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type WindowInput = {
  day_of_week: number
  start_local: string
  end_local: string
  timezone?: string | null
  accepts_live_transfer?: boolean
}

function validTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)
}

function clampDay(v: number): number | null {
  if (!Number.isFinite(v)) return null
  const n = Math.round(v)
  if (n < 0 || n > 6) return null
  return n
}

async function canManageMember(actorId: string, role: string, targetMemberId: string): Promise<boolean> {
  if (role === 'owner' || role === 'admin') return true
  if (actorId === targetMemberId) return true
  if (role !== 'manager') return false

  const [managedTeams, memberTeams] = await Promise.all([
    getManagedTeamIds(actorId),
    supabase.from('team_members').select('team_id').eq('member_id', targetMemberId),
  ])

  const targetTeamIds = ((memberTeams.data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id)
  return targetTeamIds.some((id) => managedTeams.includes(id))
}

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (ctx.tenant.tier !== 'enterprise') {
    return NextResponse.json(
      { ok: false, error: 'live transfer availability is enterprise-only' },
      { status: 403 },
    )
  }

  const memberId = req.nextUrl.searchParams.get('member_id') || ctx.member.id
  const allowed = await canManageMember(ctx.member.id, ctx.member.role, memberId)
  if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('dialer_transfer_availability')
    .select('*')
    .eq('rep_id', ctx.tenant.id)
    .eq('member_id', memberId)
    .order('day_of_week', { ascending: true })
    .order('start_local', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, availability: data ?? [] })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (ctx.tenant.tier !== 'enterprise') {
    return NextResponse.json(
      { ok: false, error: 'live transfer availability is enterprise-only' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    member_id?: string
    windows?: WindowInput[]
  }

  const memberId = body.member_id || ctx.member.id
  const windows = Array.isArray(body.windows) ? body.windows : []

  const allowed = await canManageMember(ctx.member.id, ctx.member.role, memberId)
  if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  for (const w of windows) {
    const day = clampDay(w.day_of_week)
    if (day == null) {
      return NextResponse.json({ ok: false, error: 'day_of_week must be 0..6' }, { status: 400 })
    }
    if (!validTime(w.start_local) || !validTime(w.end_local)) {
      return NextResponse.json(
        { ok: false, error: 'start_local/end_local must be HH:MM or HH:MM:SS' },
        { status: 400 },
      )
    }
    if (w.end_local <= w.start_local) {
      return NextResponse.json(
        { ok: false, error: 'end_local must be after start_local' },
        { status: 400 },
      )
    }
  }

  const repId = ctx.tenant.id
  const { error: delErr } = await supabase
    .from('dialer_transfer_availability')
    .delete()
    .eq('rep_id', repId)
    .eq('member_id', memberId)

  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

  if (windows.length) {
    const rows = windows.map((w) => ({
      rep_id: repId,
      member_id: memberId,
      day_of_week: clampDay(w.day_of_week)!,
      start_local: w.start_local,
      end_local: w.end_local,
      timezone: w.timezone ?? ctx.member.timezone ?? ctx.tenant.timezone ?? 'UTC',
      accepts_live_transfer: w.accepts_live_transfer ?? true,
    }))

    const { error: insErr } = await supabase
      .from('dialer_transfer_availability')
      .insert(rows)

    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('dialer_transfer_availability')
    .select('*')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .order('day_of_week', { ascending: true })
    .order('start_local', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, availability: data ?? [] })
}
