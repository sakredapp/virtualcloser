import type { Member, MemberRole } from '@/types'

/**
 * Permission model — explicit + boring on purpose. Roles:
 *  - owner    : everything, including billing + deleting the account
 *  - admin    : everything except billing/account-delete
 *  - manager  : full read across account; edit only own + own team's data; can set team targets
 *  - rep      : only their own data; can set personal targets
 *  - observer : read-only across account
 *
 * Multi-tenant isolation is enforced separately in queries (every query is
 * scoped by rep_id). This module governs WITHIN an account.
 */

export type Action =
  // member + team management
  | 'member.invite'
  | 'member.update'
  | 'member.remove'
  | 'member.set_role'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'team.assign'
  // data
  | 'lead.read'
  | 'lead.write'
  | 'lead.delete'
  | 'lead.reassign'
  | 'call_log.read'
  | 'call_log.write'
  | 'brain.read'
  | 'brain.write'
  | 'target.set_personal'
  | 'target.set_team'
  | 'target.set_account'
  // account-level
  | 'billing.manage'
  | 'integrations.manage'
  | 'account.delete'

type Ctx = {
  /** member_id of the row's owner (when relevant). */
  ownerMemberId?: string | null
  /** team_id of the row (when relevant). */
  rowTeamId?: string | null
  /** team_ids the actor belongs to / manages. */
  actorTeamIds?: string[]
}

const RANK: Record<MemberRole, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  rep: 40,
  observer: 20,
}

export function isAtLeast(role: MemberRole, min: MemberRole): boolean {
  return RANK[role] >= RANK[min]
}

export function can(member: Member, action: Action, ctx: Ctx = {}): boolean {
  if (!member.is_active) return false
  const role = member.role

  // Account-level
  if (action === 'account.delete') return role === 'owner'
  if (action === 'billing.manage') return role === 'owner'
  if (action === 'integrations.manage') return isAtLeast(role, 'admin')

  // Member + team management
  if (
    action === 'member.invite' ||
    action === 'member.update' ||
    action === 'member.remove' ||
    action === 'member.set_role' ||
    action === 'team.create' ||
    action === 'team.update' ||
    action === 'team.delete' ||
    action === 'team.assign'
  ) {
    return isAtLeast(role, 'admin')
  }

  // Targets
  if (action === 'target.set_account') return isAtLeast(role, 'admin')
  if (action === 'target.set_team') return isAtLeast(role, 'manager')
  if (action === 'target.set_personal') return isAtLeast(role, 'rep')

  // Reads — observer+ can read everything within account
  if (action === 'lead.read' || action === 'call_log.read' || action === 'brain.read') {
    return isAtLeast(role, 'observer')
  }

  // Writes
  const ownsRow = ctx.ownerMemberId != null && ctx.ownerMemberId === member.id
  const inSameTeam =
    ctx.rowTeamId != null && (ctx.actorTeamIds ?? []).includes(ctx.rowTeamId)

  if (action === 'lead.write' || action === 'call_log.write' || action === 'brain.write') {
    if (isAtLeast(role, 'admin')) return true
    if (role === 'manager') return ownsRow || inSameTeam
    if (role === 'rep') return ownsRow
    return false // observer
  }

  if (action === 'lead.delete' || action === 'lead.reassign') {
    if (isAtLeast(role, 'admin')) return true
    if (role === 'manager') return inSameTeam || ownsRow
    return false
  }

  return false
}

export function requirePermission(member: Member, action: Action, ctx: Ctx = {}): void {
  if (!can(member, action, ctx)) {
    throw new Error(`Forbidden: ${member.role} cannot ${action}`)
  }
}

/**
 * What scope of rows should this member see/edit by default?
 *   - 'self'    : only rows where owner_member_id = member.id
 *   - 'team'    : rows owned by self OR with team_id ∈ actor's teams
 *   - 'account' : all rows for the rep_id
 */
export function visibilityScope(role: MemberRole): 'self' | 'team' | 'account' {
  if (isAtLeast(role, 'admin')) return 'account'
  if (role === 'manager') return 'team'
  return 'self'
}
