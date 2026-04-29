import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getManagedTeamIds, getMemberTeamIds } from '@/lib/members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Scope = 'personal' | 'team' | 'account'
type DialerMode = 'concierge' | 'appointment_setter' | 'pipeline' | 'live_transfer'
type TriggerKind =
  | 'calendar_reminder'
  | 'calendar_reschedule_request'
  | 'crm_stage_changed'
  | 'payment_event'
  | 'csv_batch'
  | 'telegram_command'

type WorkflowInput = {
  name: string
  is_active?: boolean
  dialer_mode: DialerMode
  trigger_kind: TriggerKind
  trigger_config?: Record<string, unknown>
  script_profile?: string | null
  max_attempts?: number
  retry_delay_min?: number
  max_daily_calls?: number | null
  business_hours_only?: boolean
  timezone?: string | null
  priority?: number
  scope?: Scope
  team_id?: string | null
}

const OWNERISH = new Set(['owner', 'admin'])
const MANAGERISH = new Set(['owner', 'admin', 'manager'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const n = Math.round(v)
  return Math.max(min, Math.min(max, n))
}

async function canManageTeam(memberId: string, teamId: string): Promise<boolean> {
  const managed = await getManagedTeamIds(memberId)
  return managed.includes(teamId)
}

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const role = (ctx.member.role as string) || 'rep'
  const repId = ctx.tenant.id

  let query = supabase
    .from('dialer_workflow_rules')
    .select('*')
    .eq('rep_id', repId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (!OWNERISH.has(role)) {
    if (role === 'manager') {
      const [managedTeamIds, memberTeamIds] = await Promise.all([
        getManagedTeamIds(ctx.member.id),
        getMemberTeamIds(ctx.member.id),
      ])
      const teamIds = Array.from(new Set([...managedTeamIds, ...memberTeamIds]))
      if (teamIds.length) {
        query = query.or(
          `scope.eq.account,and(scope.eq.personal,owner_member_id.eq.${ctx.member.id}),and(scope.eq.team,team_id.in.(${teamIds.join(',')}))`,
        )
      } else {
        query = query.or(
          `scope.eq.account,and(scope.eq.personal,owner_member_id.eq.${ctx.member.id})`,
        )
      }
    } else {
      query = query.or(
        `scope.eq.account,and(scope.eq.personal,owner_member_id.eq.${ctx.member.id})`,
      )
    }
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, workflows: data ?? [] })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const role = (ctx.member.role as string) || 'rep'
  if (role === 'observer') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as WorkflowInput
  if (!body.name || !body.dialer_mode || !body.trigger_kind) {
    return NextResponse.json(
      { ok: false, error: 'name, dialer_mode, trigger_kind required' },
      { status: 400 },
    )
  }

  const desiredScope = (body.scope ?? 'personal') as Scope
  let scope: Scope = desiredScope
  let teamId: string | null = body.team_id ?? null
  let ownerMemberId: string | null = null

  if (ctx.tenant.tier === 'individual') {
    scope = 'personal'
    teamId = null
    ownerMemberId = ctx.member.id
  } else {
    if (!MANAGERISH.has(role) && desiredScope !== 'personal') {
      return NextResponse.json(
        { ok: false, error: 'only owner/admin/manager can create team/account workflows' },
        { status: 403 },
      )
    }

    if (desiredScope === 'personal') {
      ownerMemberId = ctx.member.id
      teamId = null
    } else if (desiredScope === 'team') {
      if (!teamId) {
        return NextResponse.json({ ok: false, error: 'team_id required for team scope' }, { status: 400 })
      }
      if (!OWNERISH.has(role) && !(await canManageTeam(ctx.member.id, teamId))) {
        return NextResponse.json({ ok: false, error: 'not team manager' }, { status: 403 })
      }
      ownerMemberId = null
    } else {
      ownerMemberId = null
      teamId = null
    }
  }

  const payload = {
    rep_id: ctx.tenant.id,
    created_by_member_id: ctx.member.id,
    owner_member_id: ownerMemberId,
    scope,
    team_id: teamId,
    name: body.name,
    is_active: body.is_active ?? true,
    dialer_mode: body.dialer_mode,
    trigger_kind: body.trigger_kind,
    trigger_config: isObject(body.trigger_config) ? body.trigger_config : {},
    script_profile: body.script_profile ?? null,
    max_attempts: clampInt(body.max_attempts, 1, 10, 2),
    retry_delay_min: clampInt(body.retry_delay_min, 1, 1440, 30),
    max_daily_calls:
      body.max_daily_calls == null ? null : clampInt(body.max_daily_calls, 1, 10000, 500),
    business_hours_only: Boolean(body.business_hours_only),
    timezone: body.timezone ?? null,
    priority: clampInt(body.priority, 1, 100, 10),
  }

  const { data, error } = await supabase
    .from('dialer_workflow_rules')
    .insert(payload)
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, workflow: data })
}

export async function PATCH(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const role = (ctx.member.role as string) || 'rep'
  if (role === 'observer') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<WorkflowInput> & { id?: string }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  const { data: existing, error: existingErr } = await supabase
    .from('dialer_workflow_rules')
    .select('*')
    .eq('id', body.id)
    .eq('rep_id', ctx.tenant.id)
    .maybeSingle()

  if (existingErr) return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const canOwnerManage = OWNERISH.has(role)
  const isCreator = existing.created_by_member_id === ctx.member.id
  const isPersonalOwner = existing.owner_member_id === ctx.member.id
  const isManager = role === 'manager'

  let canEdit = false
  if (canOwnerManage) canEdit = true
  else if (ctx.tenant.tier === 'individual') canEdit = true
  else if (isManager) {
    if (existing.scope === 'team' && existing.team_id) {
      canEdit = await canManageTeam(ctx.member.id, existing.team_id)
    } else if (existing.scope === 'account') {
      canEdit = true
    } else {
      canEdit = isCreator || isPersonalOwner
    }
  } else {
    canEdit = existing.scope === 'personal' && isPersonalOwner
  }

  if (!canEdit) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
  if (typeof body.script_profile === 'string' || body.script_profile === null) patch.script_profile = body.script_profile
  if (typeof body.max_attempts === 'number') patch.max_attempts = clampInt(body.max_attempts, 1, 10, existing.max_attempts)
  if (typeof body.retry_delay_min === 'number') patch.retry_delay_min = clampInt(body.retry_delay_min, 1, 1440, existing.retry_delay_min)
  if (typeof body.max_daily_calls === 'number') patch.max_daily_calls = clampInt(body.max_daily_calls, 1, 10000, existing.max_daily_calls ?? 500)
  if (body.max_daily_calls === null) patch.max_daily_calls = null
  if (typeof body.business_hours_only === 'boolean') patch.business_hours_only = body.business_hours_only
  if (typeof body.timezone === 'string' || body.timezone === null) patch.timezone = body.timezone
  if (typeof body.priority === 'number') patch.priority = clampInt(body.priority, 1, 100, existing.priority)
  if (isObject(body.trigger_config)) patch.trigger_config = body.trigger_config

  const { data, error } = await supabase
    .from('dialer_workflow_rules')
    .update(patch)
    .eq('id', body.id)
    .eq('rep_id', ctx.tenant.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, workflow: data })
}

export async function DELETE(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const role = (ctx.member.role as string) || 'rep'
  if (role === 'observer') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { id?: string }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  const { data: existing, error: existingErr } = await supabase
    .from('dialer_workflow_rules')
    .select('id, rep_id, scope, team_id, owner_member_id, created_by_member_id')
    .eq('id', body.id)
    .eq('rep_id', ctx.tenant.id)
    .maybeSingle()

  if (existingErr) return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  let canDelete = OWNERISH.has(role) || ctx.tenant.tier === 'individual'
  if (!canDelete && role === 'manager') {
    if (existing.scope === 'team' && existing.team_id) {
      canDelete = await canManageTeam(ctx.member.id, existing.team_id)
    } else {
      canDelete = existing.owner_member_id === ctx.member.id || existing.created_by_member_id === ctx.member.id
    }
  }
  if (!canDelete && role === 'rep') {
    canDelete = existing.scope === 'personal' && existing.owner_member_id === ctx.member.id
  }

  if (!canDelete) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const { error } = await supabase
    .from('dialer_workflow_rules')
    .delete()
    .eq('id', body.id)
    .eq('rep_id', ctx.tenant.id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
