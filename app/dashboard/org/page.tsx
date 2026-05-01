// Org chart — owner/admin only.
//
// Shows the full enterprise hierarchy: owner at top, teams with their
// manager + rep roster, unassigned members at the bottom.
// All mutations are server actions — no client JS required.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import {
  listMembers,
  createMember,
  getMemberByEmail,
  getSeatUsage,
  assertSeatAvailable,
  logAuditEvent,
} from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { sendEmail, memberInviteEmail, generatePassword } from '@/lib/email'
import { telegramBotUsername } from '@/lib/telegram'
import {
  listTeamsWithMembers,
  getAssignedMemberIds,
  createTeam,
  renameTeam,
  deleteTeam,
  setTeamManager,
  addMemberToTeam,
  removeMemberFromTeam,
} from '@/lib/teams'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import type { Member, MemberRole } from '@/types'

export const dynamic = 'force-dynamic'

// ── Server actions ────────────────────────────────────────────────────────

async function actionCreateTeam(fd: FormData) {
  'use server'
  const { tenant } = await requireMember()
  const name = String(fd.get('name') ?? '').trim()
  if (!name) return
  await createTeam(tenant.id, name)
  revalidatePath('/dashboard/org')
}

async function actionRenameTeam(fd: FormData) {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const teamId = String(fd.get('team_id') ?? '')
  const name = String(fd.get('name') ?? '').trim()
  if (!teamId || !name) return
  await renameTeam(teamId, name)
  revalidatePath('/dashboard/org')
}

async function actionDeleteTeam(fd: FormData) {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const teamId = String(fd.get('team_id') ?? '')
  if (!teamId) return
  await deleteTeam(teamId)
  revalidatePath('/dashboard/org')
}

async function actionSetManager(fd: FormData) {
  'use server'
  const { member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const teamId = String(fd.get('team_id') ?? '')
  const memberId = String(fd.get('member_id') ?? '').trim() || null
  if (!teamId) return
  await setTeamManager(teamId, memberId)
  revalidatePath('/dashboard/org')
}

async function actionAddMember(fd: FormData) {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const teamId = String(fd.get('team_id') ?? '')
  const memberId = String(fd.get('member_id') ?? '').trim()
  if (!teamId || !memberId) return
  // Look up display name server-side — never trust form data for this
  const allMembers = await listMembers(tenant.id)
  const target = allMembers.find((m) => m.id === memberId)
  if (!target) return
  await addMemberToTeam(tenant.id, teamId, memberId, target.display_name)
  revalidatePath('/dashboard/org')
}

async function actionRemoveMember(fd: FormData) {
  'use server'
  const { member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const teamId = String(fd.get('team_id') ?? '')
  const memberId = String(fd.get('member_id') ?? '')
  if (!teamId || !memberId) return
  await removeMemberFromTeam(teamId, memberId)
  revalidatePath('/dashboard/org')
}

async function actionClearManager(fd: FormData) {
  'use server'
  const { member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) return
  const teamId = String(fd.get('team_id') ?? '')
  if (!teamId) return
  await setTeamManager(teamId, null)
  revalidatePath('/dashboard/org')
}

const INVITABLE_ROLES: MemberRole[] = ['admin', 'manager', 'rep', 'observer']

/**
 * Owner-side rep invite: same shape as the admin-side invite at
 * /admin/clients/[id]/members but gated to owner/admin within the tenant
 * and bound by the seat cap (reps.max_seats) so the super-admin can throttle
 * how many seats this enterprise can self-serve into.
 *
 * On error we redirect back with ?invite_error= so the caller can render a
 * banner. On success ?invited=<email>.
 */
async function actionInviteMember(fd: FormData): Promise<void> {
  'use server'
  const { tenant, member } = await requireMember()
  if (!isAtLeast(member.role, 'admin')) {
    redirect('/dashboard/org?invite_error=permission')
  }

  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const displayName = String(fd.get('display_name') ?? '').trim()
  const role = String(fd.get('role') ?? 'rep') as MemberRole
  if (!email || !displayName) {
    redirect('/dashboard/org?invite_error=' + encodeURIComponent('Email and name are required.'))
  }
  if (!INVITABLE_ROLES.includes(role)) {
    redirect('/dashboard/org?invite_error=' + encodeURIComponent('Invalid role.'))
  }

  // Block dup invites — if the email already has an active member, point the
  // owner at the existing record instead of creating a second one.
  const existing = await getMemberByEmail(tenant.id, email)
  if (existing) {
    redirect('/dashboard/org?invite_error=' + encodeURIComponent(`${email} is already on this account.`))
  }

  try {
    await assertSeatAvailable(tenant.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Seat cap reached.'
    redirect('/dashboard/org?invite_error=' + encodeURIComponent(msg))
  }

  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  const newMember = await createMember({
    repId: tenant.id,
    email,
    displayName,
    role,
    passwordHash,
    invitedBy: member.id,
  })

  void logAuditEvent({
    repId: tenant.id,
    memberId: member.id,
    action: 'member.invite',
    entityType: 'member',
    entityId: newMember.id,
    diff: { email, role, display_name: displayName, source: 'owner_self_serve' },
  })

  // Best-effort invite email — same template the admin-side flow uses, so
  // the rep gets one consistent welcome message regardless of who invited
  // them. Failures are logged but don't roll back the member creation.
  try {
    const tpl = memberInviteEmail({
      toEmail: email,
      displayName,
      role,
      workspaceLabel: tenant.display_name || tenant.slug,
      slug: tenant.slug,
      password,
      invitedByName: member.display_name || 'The team',
      telegramLinkCode: newMember.telegram_link_code,
      telegramBotUsername: telegramBotUsername(),
    })
    await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    })
  } catch (err) {
    console.error('[org invite] email send failed', err)
  }

  revalidatePath('/dashboard/org')
  redirect('/dashboard/org?invited=' + encodeURIComponent(email))
}

// ── Page ─────────────────────────────────────────────────────────────────

export default async function OrgPage({
  searchParams,
}: {
  searchParams?: Promise<{ invite_error?: string; invited?: string }>
}) {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenantId: string
  let viewerMember: Member
  try {
    const ctx = await requireMember()
    tenantId = ctx.tenant.id
    viewerMember = ctx.member
  } catch {
    redirect('/login')
    return null
  }

  if (!isAtLeast(viewerMember.role, 'admin')) redirect('/dashboard')

  const sp = (await searchParams) ?? {}
  const inviteError = typeof sp.invite_error === 'string' ? sp.invite_error : null
  const justInvited = typeof sp.invited === 'string' ? sp.invited : null

  const navTabs = await buildDashboardTabs(tenantId, viewerMember)

  const [teams, allMembers, assignedIds, seats] = await Promise.all([
    listTeamsWithMembers(tenantId),
    listMembers(tenantId),
    getAssignedMemberIds(tenantId),
    getSeatUsage(tenantId),
  ])

  const owner = allMembers.find((m) => m.role === 'owner') ?? null
  const unassigned = allMembers.filter((m) => m.role !== 'owner' && !assignedIds.has(m.id))
  const atCap = seats.max !== null && seats.used >= seats.max
  const seatLabel =
    seats.max === null ? `${seats.used} seats` : `${seats.used}/${seats.max} seats used`

  // Available manager candidates: managers/admins not already managing a team
  const managingMemberIds = new Set(teams.map((t) => t.manager_member_id).filter(Boolean) as string[])
  const availableManagers = allMembers.filter(
    (m) => (m.role === 'manager' || m.role === 'admin') && !managingMemberIds.has(m.id),
  )

  // Available rep candidates: not yet in any team, not a manager/owner
  const availableReps = allMembers.filter(
    (m) => m.role !== 'owner' && !assignedIds.has(m.id),
  )

  const isAdmin = isAtLeast(viewerMember.role, 'admin')

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Enterprise · Org chart</p>
          <h1>Organization</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Build your team hierarchy. Assign managers to teams, add reps, and rearrange
            as your org grows. Each rep can only be in one team at a time — reassigning
            moves them automatically.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* ── Onboarding walkthrough — collapses once 2+ members are linked ── */}
      {isAdmin && allMembers.length < 3 && (
        <section style={onboardCard}>
          <RoleLabel>Get your org running</RoleLabel>
          <ol style={{ margin: '6px 0 0 0', paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13 }}>
            <li>Create a team for each pod or region you want to roll up.</li>
            <li>Set a manager — the highest non-owner role on that team.</li>
            <li>Invite reps below. Each gets an email with their password and a Telegram link code.</li>
            <li>Reps log in, link Telegram (one DM to the bot), and connect their Google Calendar.</li>
            <li>The AI assistant relays walkies, books meetings, and rolls up KPIs across your org.</li>
          </ol>
        </section>
      )}

      {/* ── Status banners ── */}
      {inviteError && (
        <section style={{ ...statusBanner, background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
          {inviteError}
        </section>
      )}
      {justInvited && !inviteError && (
        <section style={{ ...statusBanner, background: '#dcfce7', borderColor: '#bbf7d0', color: '#166534' }}>
          ✓ Invite sent to <strong>{justInvited}</strong>. They&apos;ll get an email with login + Telegram code.
        </section>
      )}

      {/* ── Invite reps + seat usage ── */}
      {isAdmin && (
        <section style={inviteCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <RoleLabel>Invite a member</RoleLabel>
              <p className="meta" style={{ margin: '2px 0 0', fontSize: 12 }}>
                {atCap
                  ? 'You\'ve reached your seat cap. Contact your account manager to add more.'
                  : 'They\'ll get an email with their password, a Telegram link code, and a Connect Google prompt.'}
              </p>
            </div>
            <span style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 999,
              background: atCap ? '#fee2e2' : '#e0f2fe',
              color: atCap ? '#991b1b' : '#075985',
            }}>
              {seatLabel}
            </span>
          </div>
          <form
            action={actionInviteMember}
            style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr auto', gap: 6, alignItems: 'stretch' }}
          >
            <input
              type="email"
              name="email"
              required
              placeholder="rep@company.com"
              style={inputSm}
              disabled={atCap}
            />
            <input
              type="text"
              name="display_name"
              required
              placeholder="Full name"
              style={inputSm}
              disabled={atCap}
            />
            <select name="role" defaultValue="rep" style={selectSm} disabled={atCap}>
              <option value="rep">Rep</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="observer">Observer</option>
            </select>
            <button
              type="submit"
              className="btn approve"
              style={{ fontSize: 13, padding: '6px 14px' }}
              disabled={atCap}
            >
              Send invite
            </button>
          </form>
        </section>
      )}

      {/* ── Owner ── */}
      {owner && (
        <section style={{ marginTop: '1.2rem', marginBottom: '0.6rem' }}>
          <RoleLabel>Owner</RoleLabel>
          <MemberChip member={owner} />
        </section>
      )}

      {/* ── Teams ── */}
      <section style={{ marginTop: '0.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
          <RoleLabel>Teams ({teams.length})</RoleLabel>
          {isAdmin && (
            <form action={actionCreateTeam} style={{ display: 'flex', gap: 6 }}>
              <input
                name="name"
                required
                placeholder="New team name"
                style={inputSm}
              />
              <button type="submit" className="btn approve" style={{ fontSize: 12, padding: '4px 12px' }}>
                + Team
              </button>
            </form>
          )}
        </div>

        {teams.length === 0 && (
          <p className="meta" style={{ padding: '1rem 0' }}>No teams yet — create one above.</p>
        )}

        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {teams.map((team) => {
            // Per-team available managers: global list + this team's current manager
            const managerOptionsForTeam = [
              ...availableManagers,
              ...(team.manager && !availableManagers.find((m) => m.id === team.manager_member_id)
                ? [team.manager]
                : []),
            ]
            // Per-team available reps: unassigned globally + members already in THIS team
            const repOptionsForTeam = [
              ...availableReps.filter((m) => !team.members.find((tm) => tm.id === m.id)),
            ]

            return (
              <div key={team.id} style={teamCard}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <strong style={{ fontSize: 15, flex: 1 }}>{team.name}</strong>
                  {isAdmin && (
                    <>
                      <RenameForm teamId={team.id} currentName={team.name} action={actionRenameTeam} />
                      <form action={actionDeleteTeam}>
                        <input type="hidden" name="team_id" value={team.id} />
                        <button
                          type="submit"
                          style={btnGhost}
                          title="Delete team"
                          onClick={undefined}
                        >
                          ×
                        </button>
                      </form>
                    </>
                  )}
                </div>

                {/* Manager row */}
                <div style={{ marginBottom: 12 }}>
                  <p style={sectionLabel}>Manager</p>
                  {team.manager ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MemberChip member={team.manager} compact />
                      {isAdmin && (
                        <form action={actionClearManager}>
                          <input type="hidden" name="team_id" value={team.id} />
                          <button type="submit" style={btnGhost} title="Remove manager">×</button>
                        </form>
                      )}
                    </div>
                  ) : isAdmin ? (
                    <form action={actionSetManager} style={{ display: 'flex', gap: 6 }}>
                      <input type="hidden" name="team_id" value={team.id} />
                      <select name="member_id" required style={selectSm}>
                        <option value="">— select manager —</option>
                        {managerOptionsForTeam.map((m) => (
                          <option key={m.id} value={m.id}>{m.display_name} · {m.role}</option>
                        ))}
                      </select>
                      <button type="submit" className="btn approve" style={{ fontSize: 12, padding: '4px 12px' }}>Set</button>
                    </form>
                  ) : (
                    <p className="meta">No manager assigned</p>
                  )}
                </div>

                {/* Reps */}
                <div>
                  <p style={sectionLabel}>Reps ({team.members.length})</p>
                  {team.members.length === 0 && (
                    <p className="meta" style={{ marginBottom: 8, fontSize: 12 }}>No reps yet.</p>
                  )}
                  <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'grid', gap: 4 }}>
                    {team.members.map((m) => (
                      <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MemberChip member={m} compact />
                        {isAdmin && (
                          <form action={actionRemoveMember}>
                            <input type="hidden" name="team_id" value={team.id} />
                            <input type="hidden" name="member_id" value={m.id} />
                            <button type="submit" style={btnGhost} title="Remove from team">×</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>

                  {isAdmin && repOptionsForTeam.length > 0 && (
                    <form action={actionAddMember} style={{ display: 'flex', gap: 6 }}>
                      <input type="hidden" name="team_id" value={team.id} />
                      <select name="member_id" required style={selectSm}>
                        <option value="">— add rep —</option>
                        {repOptionsForTeam.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.display_name} · {m.role}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn approve" style={{ fontSize: 12, padding: '4px 12px' }}>Add</button>
                    </form>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Unassigned ── */}
      {unassigned.length > 0 && (
        <section style={{ marginTop: '1.2rem' }}>
          <RoleLabel>Unassigned ({unassigned.length})</RoleLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {unassigned.map((m) => (
              <MemberChip key={m.id} member={m} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function RoleLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', margin: '0 0 6px' }}>
      {children}
    </p>
  )
}

const ROLE_COLOR: Record<string, string> = {
  owner: '#7c3aed',
  admin: '#1d4ed8',
  manager: '#0369a1',
  rep: '#374151',
  observer: '#9ca3af',
}

function MemberChip({ member, compact = false }: { member: Member; compact?: boolean }) {
  const color = ROLE_COLOR[member.role] ?? '#374151'
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      background: 'var(--paper)',
      border: '1px solid var(--border-soft)',
      borderRadius: 8,
      padding: compact ? '5px 10px' : '8px 12px',
      fontSize: compact ? 13 : 14,
    }}>
      <span style={{ fontWeight: 600 }}>{member.display_name}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}18`, borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {member.role}
      </span>
    </div>
  )
}

function RenameForm({ teamId, currentName, action }: { teamId: string; currentName: string; action: (fd: FormData) => Promise<void> }) {
  return (
    <form action={action} style={{ display: 'flex', gap: 4 }}>
      <input type="hidden" name="team_id" value={teamId} />
      <input
        name="name"
        defaultValue={currentName}
        required
        style={{ ...inputSm, width: 130 }}
      />
      <button type="submit" style={{ ...btnGhost, fontSize: 11 }}>Rename</button>
    </form>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const teamCard: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  padding: '14px 16px',
  boxShadow: 'var(--shadow-card)',
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--muted)',
  margin: '0 0 6px',
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

const selectSm: React.CSSProperties = {
  ...inputSm,
  minWidth: 180,
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

const onboardCard: React.CSSProperties = {
  background: '#f0f9ff',
  border: '1px solid #bae6fd',
  borderRadius: 12,
  padding: '14px 16px',
  marginTop: '1rem',
}

const inviteCard: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  padding: '14px 16px',
  marginTop: '1rem',
}

const statusBanner: React.CSSProperties = {
  borderRadius: 10,
  padding: '10px 14px',
  marginTop: '1rem',
  border: '1px solid',
  fontSize: 13,
}
