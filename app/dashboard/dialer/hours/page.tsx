// AI Dialer · Hours & Shifts.
//
// Where reps + owners + managers manage the SDR's working hours like a
// real employee:
//   - Rep view: weekly budget pill, mode allocator, shift scheduler.
//   - Manager view: budget given by owner + sub-allocate to direct reports.
//   - Owner view: pool mode toggle, per-rep allocator, all of the above.
//
// All mutations are server actions — no client JS, the page reloads after
// each form submit.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { listMembers, getMemberById } from '@/lib/members'
import { getActiveAddonKeys } from '@/lib/entitlements'
import { getAddon } from '@/lib/addons'
import {
  getTenantWeeklyCapSeconds,
  getTopLevelGrantedSeconds,
  getMemberWeeklyBudgetSeconds,
  getMemberUsedSeconds,
  listGrantsForWeek,
  listModeAllocations,
  upsertHourGrant,
  upsertModeAllocation,
  upsertShift,
  deleteShift,
  listShifts,
  getModeBuckets,
} from '@/lib/dialerHours'
import { weekStartForDate, weekPeriodForDate } from '@/lib/usage'
import { resolveActiveHourPackage } from '@/lib/entitlements'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../../DashboardNav'
import { buildDashboardTabs } from '../../dashboardTabs'
import ModePillNav from '../ModePillNav'
import type { DialerMode } from '@/lib/voice/dialerSettings'
import type { Member } from '@/types'

export const dynamic = 'force-dynamic'

const MODE_DEFS: Array<{ key: DialerMode; label: string; bg: string; color: string }> = [
  { key: 'concierge', label: 'Receptionist', bg: '#dcfce7', color: '#166534' },
  { key: 'appointment_setter', label: 'Appointment Setter', bg: '#dbeafe', color: '#1d4ed8' },
  { key: 'live_transfer', label: 'Live Transfer', bg: '#fff7ed', color: '#c2410c' },
  { key: 'pipeline', label: 'Workflows', bg: '#f3e8ff', color: '#6b21a8' },
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtHrs(seconds: number): string {
  if (seconds <= 0) return '0h'
  const h = seconds / 3600
  return h >= 10 ? `${h.toFixed(0)}h` : `${h.toFixed(1)}h`
}

function fmtMinute(m: number): string {
  const hh = Math.floor(m / 60)
  const mm = m % 60
  const ap = hh >= 12 ? 'pm' : 'am'
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h12}${ap}` : `${h12}:${String(mm).padStart(2, '0')}${ap}`
}

function parseTimeToMinute(raw: string): number | null {
  // HH:MM 24-hour from <input type="time">
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const h = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return h * 60 + mm
}

// ── Server actions ───────────────────────────────────────────────────────

async function actionGrantHours(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'manager')) return
  const granteeId = String(fd.get('grantee_member_id') ?? '').trim()
  const hoursRaw = String(fd.get('hours') ?? '').trim()
  if (!granteeId) return
  const hours = Math.max(0, Math.min(168, Number(hoursRaw)))
  if (!Number.isFinite(hours)) return

  // A manager can only grant down to members in their team. Owner/admin
  // can grant to anyone in the tenant.
  if (!isAtLeast(member.role, 'admin')) {
    const target = await getMemberById(granteeId)
    if (!target || target.rep_id !== tenant.id) return
    // Manager grants only flow within their managed teams.
    const { getManagedTeamIds } = await import('@/lib/members')
    const managedTeamIds = await getManagedTeamIds(member.id)
    if (managedTeamIds.length === 0) return
    const { data: teamMember } = await supabase
      .from('team_members')
      .select('member_id')
      .eq('member_id', granteeId)
      .in('team_id', managedTeamIds)
      .maybeSingle()
    if (!teamMember) return
  }

  // Owner/admin grants come direct from tenant pool (granter NULL).
  // Manager grants are sub-allocations from the manager's own pool.
  const granterMemberId = isAtLeast(member.role, 'admin') ? null : member.id

  await upsertHourGrant({
    repId: tenant.id,
    granterMemberId,
    granteeMemberId: granteeId,
    grantedSeconds: Math.round(hours * 3600),
  })
  revalidatePath('/dashboard/dialer/hours')
}

async function actionTogglePoolMode(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const newMode = String(fd.get('pool_mode') ?? '').trim()
  if (!['shared', 'per_rep'].includes(newMode)) return
  await supabase.from('reps').update({ dialer_pool_mode: newMode }).eq('id', tenant.id)
  revalidatePath('/dashboard/dialer/hours')
}

async function actionSetModeAllocation(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  const mode = String(fd.get('mode') ?? '').trim() as DialerMode
  const hoursRaw = String(fd.get('hours') ?? '').trim()
  if (!['concierge', 'appointment_setter', 'live_transfer', 'pipeline'].includes(mode)) return
  const hours = Math.max(0, Math.min(168, Number(hoursRaw)))
  if (!Number.isFinite(hours)) return
  await upsertModeAllocation({
    repId: tenant.id,
    memberId: member.id,
    mode,
    allocatedSeconds: Math.round(hours * 3600),
  })
  revalidatePath('/dashboard/dialer/hours')
}

async function actionAddShift(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  const weekday = Number(fd.get('weekday') ?? '-1')
  const startRaw = String(fd.get('start_time') ?? '')
  const endRaw = String(fd.get('end_time') ?? '')
  const modeRaw = String(fd.get('mode') ?? '').trim()
  if (weekday < 0 || weekday > 6) return
  const start = parseTimeToMinute(startRaw)
  const end = parseTimeToMinute(endRaw)
  if (start === null || end === null || end <= start) return
  const mode =
    modeRaw && ['concierge', 'appointment_setter', 'live_transfer', 'pipeline'].includes(modeRaw)
      ? (modeRaw as DialerMode)
      : null
  await upsertShift({
    repId: tenant.id,
    memberId: member.id,
    weekday,
    startMinute: start,
    endMinute: end,
    mode,
  })
  revalidatePath('/dashboard/dialer/hours')
}

async function actionDeleteShift(fd: FormData): Promise<void> {
  'use server'
  const { tenant } = await requireMember()
  const id = String(fd.get('shift_id') ?? '')
  if (!id) return
  await deleteShift(tenant.id, id)
  revalidatePath('/dashboard/dialer/hours')
}

// ── Page ─────────────────────────────────────────────────────────────────

export default async function DialerHoursPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  let tenantId: string
  let viewer: Member
  let tenantPoolMode: 'shared' | 'per_rep'
  try {
    const ctx = await requireMember()
    tenantId = ctx.tenant.id
    viewer = ctx.member
  } catch {
    redirect('/login')
    return null
  }

  const { data: repRow } = await supabase
    .from('reps')
    .select('dialer_pool_mode')
    .eq('id', tenantId)
    .maybeSingle()
  tenantPoolMode = ((repRow as { dialer_pool_mode: string | null } | null)?.dialer_pool_mode ?? 'per_rep') as
    | 'shared'
    | 'per_rep'

  const navTabs = await buildDashboardTabs(tenantId, viewer)
  const activeAddons = await getActiveAddonKeys(tenantId)
  const hourPackageKey = await resolveActiveHourPackage(tenantId)
  const hourPackage = hourPackageKey ? getAddon(hourPackageKey) : null

  const isOwner = isAtLeast(viewer.role, 'admin')
  const isManager = viewer.role === 'manager'

  const weekStart = weekStartForDate()
  const weekPeriod = weekPeriodForDate(weekStart)

  const { capSeconds, capHours } = await getTenantWeeklyCapSeconds(tenantId)
  const grantedTopLevel = await getTopLevelGrantedSeconds(tenantId, weekStart)

  const allMembers = await listMembers(tenantId)
  const grants = await listGrantsForWeek(tenantId, weekStart)

  // Per-member roll-up: granted, sub-granted, used.
  const memberRows = await Promise.all(
    allMembers
      .filter((m) => m.role !== 'observer')
      .map(async (m) => {
        const [budget, used, modeAllocs] = await Promise.all([
          getMemberWeeklyBudgetSeconds(tenantId, m.id, weekStart),
          getMemberUsedSeconds(tenantId, m.id, weekStart),
          listModeAllocations(tenantId, m.id, weekStart),
        ])
        return { member: m, budget, used, modeAllocs }
      }),
  )

  // Viewer's own snapshot (all roles see this)
  const myBudget = memberRows.find((r) => r.member.id === viewer.id) ?? null
  const myShifts = await listShifts(tenantId, viewer.id)
  const myModeBuckets = await getModeBuckets(tenantId, viewer.id, weekStart)

  // Manager's reachable reps for sub-allocation
  let managedReps: Member[] = []
  if (isManager && !isOwner) {
    const { getManagedTeamIds } = await import('@/lib/members')
    const teamIds = await getManagedTeamIds(viewer.id)
    if (teamIds.length > 0) {
      const { data } = await supabase
        .from('team_members')
        .select('member_id')
        .in('team_id', teamIds)
      const memberIds = (data ?? []).map((r) => (r as { member_id: string }).member_id)
      managedReps = allMembers.filter((m) => memberIds.includes(m.id) && m.id !== viewer.id)
    }
  }

  if (!hourPackage) {
    return (
      <main>
        <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
        <ModePillNav active={'hours'} />
        <section className="wrap" style={{ paddingTop: '1.5rem' }}>
          <div style={emptyCard}>
            <h2 style={{ margin: 0, fontSize: 18 }}>No SDR plan active</h2>
            <p className="meta" style={{ marginTop: 6 }}>
              The Hours &amp; Shifts page becomes available once your tenant has an active{' '}
              <strong>AI SDR · Nh/wk</strong> add-on. Pick a package on the offer page or ask your account manager
              to enable it.
            </p>
            <Link href="/offer" className="btn approve" style={{ marginTop: 10, display: 'inline-block' }}>
              See SDR packages →
            </Link>
          </div>
        </section>
      </main>
    )
  }

  const unallocated = Math.max(0, capSeconds - grantedTopLevel)

  return (
    <main>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active={'receptionist'} />

      <section className="wrap" style={{ paddingTop: '1rem' }}>
        <header style={{ marginBottom: '1rem' }}>
          <p className="eyebrow">AI Dialer · Hours &amp; shifts</p>
          <h1 style={{ margin: '4px 0 8px' }}>Your SDR&apos;s schedule</h1>
          <p className="sub" style={{ margin: 0 }}>
            {hourPackage.label} · {capHours} hrs/week · resets every Monday · ISO week {weekPeriod}
          </p>
        </header>

        {/* ── Tenant pool snapshot ── */}
        <section style={poolCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={pillLabel}>Tenant pool · this week</p>
              <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0' }}>
                {fmtHrs(unallocated)} <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 14 }}>unallocated of {capHours}h</span>
              </p>
            </div>
            {isOwner && (
              <form action={actionTogglePoolMode} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={pillLabel}>Pool mode</span>
                <select
                  name="pool_mode"
                  defaultValue={tenantPoolMode}
                  style={{ ...inputSm, minWidth: 130 }}
                >
                  <option value="per_rep">Per-rep grants</option>
                  <option value="shared">Shared pool</option>
                </select>
                <button type="submit" className="btn" style={{ fontSize: 12, padding: '4px 12px' }}>
                  Save
                </button>
              </form>
            )}
          </div>
          {tenantPoolMode === 'shared' ? (
            <p className="meta" style={{ marginTop: 8, fontSize: 13 }}>
              <strong>Shared pool mode.</strong> Any rep can dial against the tenant pool until it&apos;s exhausted.
              Per-rep grants below are ignored.
            </p>
          ) : (
            <p className="meta" style={{ marginTop: 8, fontSize: 13 }}>
              <strong>Per-rep grants.</strong> Owner/admin grants hours to managers and reps. Managers can
              sub-allocate their pool to their direct reports. Reps split their grant across modes.
            </p>
          )}
        </section>

        {/* ── My week (all roles) ── */}
        {myBudget && (
          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Your week</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <Stat label="Granted" value={fmtHrs(myBudget.budget.granted)} />
              <Stat label="Sub-granted out" value={fmtHrs(myBudget.budget.subGranted)} />
              <Stat label="Your budget" value={fmtHrs(myBudget.budget.budget)} accent />
              <Stat label="Used" value={fmtHrs(myBudget.used)} />
              <Stat
                label="Remaining"
                value={fmtHrs(Math.max(0, myBudget.budget.budget - myBudget.used))}
                accent
              />
            </div>

            {/* Mode allocator (rep view) */}
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>Split your hours across modes</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {MODE_DEFS.map((mode) => {
                  const bucket = myModeBuckets[mode.key]
                  const allocatedHrs = (bucket.allocated ?? 0) / 3600
                  const usedHrs = (bucket.used ?? 0) / 3600
                  const pct = bucket.allocated > 0 ? Math.min(100, Math.round((bucket.used / bucket.allocated) * 100)) : 0
                  return (
                    <form key={mode.key} action={actionSetModeAllocation} style={{ ...modeCard, background: mode.bg }}>
                      <input type="hidden" name="mode" value={mode.key} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <strong style={{ color: mode.color, fontSize: 13 }}>{mode.label}</strong>
                        <span style={{ fontSize: 11, color: mode.color, fontWeight: 700 }}>{pct}% used</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          name="hours"
                          min="0"
                          max="168"
                          step="0.5"
                          defaultValue={allocatedHrs.toFixed(1)}
                          style={{ ...inputSm, flex: 1 }}
                        />
                        <span style={{ fontSize: 12, color: mode.color }}>hrs/wk</span>
                        <button
                          type="submit"
                          style={{ ...btnTiny, background: mode.color, color: 'white' }}
                        >
                          Save
                        </button>
                      </div>
                      <p style={{ fontSize: 11, color: mode.color, margin: '6px 0 0' }}>
                        Used {usedHrs.toFixed(1)} / {allocatedHrs.toFixed(1)} hrs
                      </p>
                    </form>
                  )
                })}
              </div>
            </div>

            {/* Shift scheduler */}
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>
                Shifts · {myShifts.length} active
              </p>
              <p className="meta" style={{ fontSize: 12, marginBottom: 8 }}>
                Define windows when the dialer can run. No shifts = always on. Mode-specific shifts only run that mode.
              </p>
              <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                {myShifts.length === 0 && (
                  <p className="meta" style={{ fontSize: 12 }}>No shifts yet — dialer runs whenever budget remains.</p>
                )}
                {myShifts
                  .sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute)
                  .map((s) => (
                    <div key={s.id} style={shiftRow}>
                      <span style={{ fontWeight: 600, minWidth: 36 }}>{WEEKDAYS[s.weekday]}</span>
                      <span style={{ flex: 1 }}>
                        {fmtMinute(s.start_minute)} → {fmtMinute(s.end_minute)}
                        {s.mode && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              padding: '1px 7px',
                              borderRadius: 999,
                              background: MODE_DEFS.find((m) => m.key === s.mode)?.bg ?? '#f3f4f6',
                              color: MODE_DEFS.find((m) => m.key === s.mode)?.color ?? '#374151',
                              fontWeight: 700,
                            }}
                          >
                            {MODE_DEFS.find((m) => m.key === s.mode)?.label ?? s.mode}
                          </span>
                        )}
                      </span>
                      <form action={actionDeleteShift}>
                        <input type="hidden" name="shift_id" value={s.id} />
                        <button type="submit" style={btnGhost}>×</button>
                      </form>
                    </div>
                  ))}
              </div>

              <form action={actionAddShift} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <select name="weekday" defaultValue="0" style={inputSm}>
                  {WEEKDAYS.map((wd, i) => (
                    <option key={wd} value={i}>{wd}</option>
                  ))}
                </select>
                <input type="time" name="start_time" defaultValue="09:00" required style={inputSm} />
                <span>→</span>
                <input type="time" name="end_time" defaultValue="17:00" required style={inputSm} />
                <select name="mode" defaultValue="" style={inputSm}>
                  <option value="">Any mode</option>
                  {MODE_DEFS.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
                <button type="submit" className="btn approve" style={{ fontSize: 12, padding: '4px 12px' }}>
                  + Shift
                </button>
              </form>
            </div>
          </section>
        )}

        {/* ── Owner allocator ── */}
        {isOwner && (
          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Org allocation</h2>
            <p className="meta" style={{ fontSize: 13, marginBottom: 12 }}>
              Grant hours to each member of your org. Manager grants flow down to their reps automatically.
              Direct rep grants bypass the manager pool.
            </p>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={tableHeader}>
                <span style={{ flex: 1.4 }}>Member</span>
                <span style={{ flex: 0.8 }}>Role</span>
                <span style={{ flex: 1 }}>Granted</span>
                <span style={{ flex: 1 }}>Used</span>
                <span style={{ flex: 1.4 }}>Set hrs/wk</span>
              </div>
              {memberRows
                .filter((r) => r.member.role !== 'owner')
                .map((r) => {
                  const directGrant = grants.find(
                    (g) => g.granter_member_id === null && g.grantee_member_id === r.member.id,
                  )
                  const directHrs = directGrant ? directGrant.granted_seconds / 3600 : 0
                  return (
                    <form key={r.member.id} action={actionGrantHours} style={tableRow}>
                      <input type="hidden" name="grantee_member_id" value={r.member.id} />
                      <span style={{ flex: 1.4, fontWeight: 600, fontSize: 13 }}>{r.member.display_name}</span>
                      <span style={{ flex: 0.8, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>{r.member.role}</span>
                      <span style={{ flex: 1, fontSize: 13 }}>{fmtHrs(r.budget.granted)}</span>
                      <span style={{ flex: 1, fontSize: 13 }}>{fmtHrs(r.used)}</span>
                      <span style={{ flex: 1.4, display: 'flex', gap: 6 }}>
                        <input
                          type="number"
                          name="hours"
                          min="0"
                          max="168"
                          step="0.5"
                          defaultValue={directHrs.toFixed(1)}
                          style={{ ...inputSm, flex: 1 }}
                        />
                        <button type="submit" style={btnTiny}>Save</button>
                      </span>
                    </form>
                  )
                })}
            </div>
          </section>
        )}

        {/* ── Manager sub-allocator ── */}
        {isManager && !isOwner && managedReps.length > 0 && (
          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Distribute to your team</h2>
            <p className="meta" style={{ fontSize: 13, marginBottom: 12 }}>
              You have {fmtHrs(myBudget?.budget.budget ?? 0)} this week. Pass any portion of it down to your reps.
            </p>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={tableHeader}>
                <span style={{ flex: 1.4 }}>Rep</span>
                <span style={{ flex: 1 }}>From you</span>
                <span style={{ flex: 1 }}>Used</span>
                <span style={{ flex: 1.4 }}>Set hrs/wk</span>
              </div>
              {managedReps.map((rep) => {
                const subGrant = grants.find(
                  (g) => g.granter_member_id === viewer.id && g.grantee_member_id === rep.id,
                )
                const subGrantHrs = subGrant ? subGrant.granted_seconds / 3600 : 0
                const repRow = memberRows.find((r) => r.member.id === rep.id)
                return (
                  <form key={rep.id} action={actionGrantHours} style={tableRow}>
                    <input type="hidden" name="grantee_member_id" value={rep.id} />
                    <span style={{ flex: 1.4, fontWeight: 600, fontSize: 13 }}>{rep.display_name}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{fmtHrs(subGrant?.granted_seconds ?? 0)}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{fmtHrs(repRow?.used ?? 0)}</span>
                    <span style={{ flex: 1.4, display: 'flex', gap: 6 }}>
                      <input
                        type="number"
                        name="hours"
                        min="0"
                        max="168"
                        step="0.5"
                        defaultValue={subGrantHrs.toFixed(1)}
                        style={{ ...inputSm, flex: 1 }}
                      />
                      <button type="submit" style={btnTiny}>Save</button>
                    </span>
                  </form>
                )
              })}
            </div>
          </section>
        )}

        {!activeAddons.has(hourPackageKey!) && (
          <p className="meta" style={{ marginTop: 12, fontSize: 12 }}>
            ⚠ Hour package addon not in active state — caps will not enforce until reactivated.
          </p>
        )}
      </section>
    </main>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? '#fef3c7' : 'var(--paper-2)',
      borderRadius: 8,
      padding: '8px 12px',
      border: '1px solid var(--border-soft)',
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', margin: 0, letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0' }}>{value}</p>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  padding: '16px 18px',
  marginTop: '0.8rem',
}

const poolCard: React.CSSProperties = {
  ...cardStyle,
  background: 'linear-gradient(120deg, #f0f9ff 0%, #ecfeff 100%)',
  borderColor: '#bae6fd',
}

const emptyCard: React.CSSProperties = {
  ...cardStyle,
  background: '#fef3c7',
  borderColor: '#fde68a',
  textAlign: 'center',
}

const modeCard: React.CSSProperties = {
  borderRadius: 10,
  padding: '10px 12px',
  border: '1px solid rgba(0,0,0,0.05)',
}

const tableHeader: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '4px 6px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--muted)',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border-soft)',
}

const tableRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '6px',
  alignItems: 'center',
  borderBottom: '1px solid #f3f4f6',
}

const shiftRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '6px 10px',
  borderRadius: 8,
  background: 'var(--paper-2)',
  border: '1px solid var(--border-soft)',
  fontSize: 13,
}

const pillLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--muted)',
  margin: 0,
}

const inputSm: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 7,
  border: '1px solid var(--border-soft)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'inherit',
}

const btnTiny: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

const btnGhost: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border-soft)',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 13,
  cursor: 'pointer',
  color: '#6b7280',
}
