import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../../DashboardNav'
import { buildDashboardTabs } from '../../dashboardTabs'
import { isAtLeast } from '@/lib/permissions'
import { getManagedTeamIds, listMembers, logAuditEvent } from '@/lib/members'
import { getActiveTargets, setTarget, supabase } from '@/lib/supabase'
import { broadcastNewTeamGoal, describeTarget } from '@/lib/team-goals'
import type { Target, TargetMetric, TargetPeriod, TargetScope } from '@/types'

export const dynamic = 'force-dynamic'

const METRICS: TargetMetric[] = ['calls', 'conversations', 'meetings_booked', 'deals_closed', 'revenue']
const PERIODS: TargetPeriod[] = ['day', 'week', 'month', 'quarter', 'year']

type TeamRow = { id: string; name: string; manager_member_id: string | null }

export default async function TeamGoalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'manager')) {
    redirect('/dashboard')
  }
  const navTabs = await buildDashboardTabs(tenant.id, member)
  const sp = (await searchParams) ?? {}
  const isAdmin = isAtLeast(member.role, 'admin')

  // Teams the viewer can target.
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, manager_member_id')
    .eq('rep_id', tenant.id)
    .order('name')
  const allTeams = (teamRows ?? []) as TeamRow[]
  const managedIds = isAdmin ? null : new Set(await getManagedTeamIds(member.id))
  const visibleTeams = managedIds ? allTeams.filter((t) => managedIds.has(t.id)) : allTeams

  // Pull active targets for the rep, then narrow to scope=team/account ones the
  // viewer is allowed to see.
  const allTargets = await getActiveTargets(tenant.id)
  const teamGoals = allTargets.filter((t) => {
    if (t.scope === 'account') return true
    if (t.scope === 'team' && t.team_id) {
      if (isAdmin) return true
      return managedIds?.has(t.team_id) ?? false
    }
    return false
  })

  const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]))
  const allMembers = await listMembers(tenant.id)
  const memberNameById = new Map(allMembers.map((m) => [m.id, m.display_name || m.email]))

  // ── Server actions ────────────────────────────────────────────────────
  async function onCreateGoal(formData: FormData) {
    'use server'
    const { tenant, member } = await requireMember()
    if (!isAtLeast(member.role, 'manager')) redirect('/dashboard')

    const scopeIn = String(formData.get('scope') ?? 'team') as TargetScope
    const periodType = String(formData.get('period_type') ?? 'week') as TargetPeriod
    const metric = String(formData.get('metric') ?? 'calls') as TargetMetric
    const targetValue = Number(formData.get('target_value') ?? 0)
    const teamId = (formData.get('team_id') ? String(formData.get('team_id')) : null) || null
    const notes = String(formData.get('notes') ?? '').trim() || null
    const visibilityIn = String(formData.get('visibility') ?? 'all')
    const isAdmin = isAtLeast(member.role, 'admin')
    let visibility: 'all' | 'managers' | 'owners' = 'all'
    if (visibilityIn === 'owners' && isAdmin) visibility = 'owners'
    else if (visibilityIn === 'managers') visibility = 'managers'
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      redirect('/dashboard/team/goals?status=invalid')
    }
    if (scopeIn === 'account' && !isAdmin) {
      redirect('/dashboard/team/goals?status=forbidden')
    }
    if (scopeIn === 'team') {
      if (!teamId) redirect('/dashboard/team/goals?status=team-required')
      if (!isAdmin) {
        const managed = await getManagedTeamIds(member.id)
        if (!managed.includes(teamId)) {
          redirect('/dashboard/team/goals?status=forbidden')
        }
      }
    }

    const target = await setTarget({
      repId: tenant.id,
      periodType,
      metric,
      targetValue,
      notes,
      ownerMemberId: member.id,
      teamId: scopeIn === 'team' ? teamId : null,
      scope: scopeIn === 'account' ? 'account' : 'team',
      visibility,
    })

    await logAuditEvent({
      repId: tenant.id,
      memberId: member.id,
      action: 'target.set',
      entityType: 'target',
      entityId: target.id,
      diff: { scope: target.scope, metric: target.metric, target_value: target.target_value, period_type: target.period_type },
    })

    let teamName: string | null = null
    if (target.team_id) {
      const { data: trow } = await supabase
        .from('teams')
        .select('name')
        .eq('id', target.team_id)
        .maybeSingle()
      teamName = (trow as { name: string } | null)?.name ?? null
    }
    try {
      await broadcastNewTeamGoal(target, member.display_name || member.email, teamName)
    } catch (err) {
      console.error('[team-goals UI] broadcast failed', err)
    }

    revalidatePath('/dashboard/team/goals')
    revalidatePath('/dashboard')
    redirect('/dashboard/team/goals?status=created')
  }

  async function onArchiveGoal(formData: FormData) {
    'use server'
    const { tenant, member } = await requireMember()
    if (!isAtLeast(member.role, 'manager')) redirect('/dashboard')
    const id = String(formData.get('id') ?? '')
    if (!id) return
    const { data: row } = await supabase
      .from('targets')
      .select('id, rep_id, scope, team_id')
      .eq('id', id)
      .eq('rep_id', tenant.id)
      .maybeSingle()
    const t = row as Pick<Target, 'id' | 'rep_id' | 'scope' | 'team_id'> | null
    if (!t) return
    if (!isAtLeast(member.role, 'admin')) {
      if (t.scope === 'account') return
      if (t.scope === 'team' && t.team_id) {
        const managed = await getManagedTeamIds(member.id)
        if (!managed.includes(t.team_id)) return
      }
    }
    await supabase.from('targets').update({ status: 'archived' }).eq('id', t.id).eq('rep_id', tenant.id)
    await logAuditEvent({
      repId: tenant.id,
      memberId: member.id,
      action: 'target.archive',
      entityType: 'target',
      entityId: t.id,
    })
    revalidatePath('/dashboard/team/goals')
  }

  const banner =
    sp.status === 'created' ? 'Goal saved and team has been pinged on Telegram.' :
    sp.status === 'invalid' ? 'Enter a positive target value.' :
    sp.status === 'team-required' ? 'Pick a team for team-scope goals.' :
    sp.status === 'forbidden' ? 'You don\u2019t have permission for that scope.' :
    null

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">{tenant.display_name}</p>
          <h1>Team goals</h1>
          <p className="sub">
            Set the team or account number. Every member in scope gets a Telegram ping now and a daily reminder until it&rsquo;s hit.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {banner && (
        <p className="card" style={{ marginTop: '0.8rem', padding: '0.7rem 1rem' }}>{banner}</p>
      )}

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <h2 style={{ marginTop: 0 }}>Set a goal</h2>
        <form action={onCreateGoal} style={{ display: 'grid', gap: '0.7rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: '0.7rem' }}>
            <label style={lbl}>
              Scope
              <select name="scope" defaultValue={isAdmin ? 'team' : 'team'} style={inp}>
                <option value="team">A team</option>
                {isAdmin && <option value="account">Whole account</option>}
              </select>
            </label>
            <label style={lbl}>
              Team
              <select name="team_id" style={inp} defaultValue={visibleTeams[0]?.id ?? ''}>
                <option value="">— none —</option>
                {visibleTeams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label style={lbl}>
              Metric
              <select name="metric" defaultValue="calls" style={inp}>
                {METRICS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label style={lbl}>
              Period
              <select name="period_type" defaultValue="week" style={inp}>
                {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label style={lbl}>
              Target value
              <input name="target_value" type="number" min={1} step={1} required style={inp} />
            </label>
            <label style={lbl}>
              Visibility
              <select name="visibility" defaultValue="all" style={inp}>
                <option value="all">Everyone in scope</option>
                <option value="managers">Managers + admins only</option>
                {isAdmin && <option value="owners">Admins/owners only</option>}
              </select>
            </label>
          </div>
          <label style={lbl}>
            Notes (optional — context the team will see)
            <textarea name="notes" rows={2} style={{ ...inp, fontFamily: 'inherit' }} placeholder="e.g. focus on outbound to mid-market this week" />
          </label>
          <div>
            <button type="submit" className="btn btn-primary">Save & ping team</button>
          </div>
        </form>
      </section>

      <section className="card" style={{ marginTop: '0.8rem', padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
          <thead>
            <tr style={{ background: 'var(--panel-2, #f7f4ef)', textAlign: 'left' }}>
              <th style={th}>Goal</th>
              <th style={th}>Scope</th>
              <th style={th}>Visibility</th>
              <th style={th}>Period start</th>
              <th style={thNum}>Progress</th>
              <th style={th}>Set by</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {teamGoals.map((t) => {
              const pct = t.target_value > 0 ? Math.min(100, Math.round((Number(t.current_value) / Number(t.target_value)) * 100)) : 0
              const scopeLabel = t.scope === 'account'
                ? 'Whole account'
                : `Team · ${t.team_id ? teamNameById.get(t.team_id) ?? '—' : '—'}`
              return (
                <tr key={t.id} style={{ borderTop: '1px solid var(--panel-border, #e8e2d4)' }}>
                  <td style={td}><strong>{describeTarget(t)}</strong>{t.notes ? <div style={{ color: 'var(--muted, #5a5a5a)', fontSize: '0.85rem' }}>{t.notes}</div> : null}</td>
                  <td style={td}>{scopeLabel}</td>
                  <td style={td}>{t.visibility === 'owners' ? 'Owners only' : t.visibility === 'managers' ? 'Managers only' : 'Everyone'}</td>
                  <td style={td}>{t.period_start}</td>
                  <td style={tdNum}>{Number(t.current_value)} / {Number(t.target_value)} <span style={{ color: 'var(--muted, #5a5a5a)' }}>({pct}%)</span></td>
                  <td style={td}>{t.owner_member_id ? memberNameById.get(t.owner_member_id) ?? '—' : '—'}</td>
                  <td style={td}>
                    <form action={onArchiveGoal}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="btn" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>Archive</button>
                    </form>
                  </td>
                </tr>
              )
            })}
            {teamGoals.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', padding: '1.5rem', color: 'var(--muted, #5a5a5a)' }}>
                  No team goals set yet — start with one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600 }
const inp: React.CSSProperties = { padding: '0.5rem 0.6rem', border: '1px solid var(--panel-border, #e8e2d4)', borderRadius: 6, background: 'var(--panel, #fff)', color: 'var(--text, #0f0f0f)' }
const th: React.CSSProperties = { padding: '0.7rem 0.9rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }
const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '0.65rem 0.9rem', verticalAlign: 'middle' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
