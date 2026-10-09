/**
 * Who may do what with QuickBooks (owner 10-09). Pure, unit-tested.
 *
 *  - See the figures, connect, Sync now, ask Mira: the exec team only. Same
 *    rule as comp (canViewComp): owners and admins, or a member whose
 *    settings.can_view_comp is true; an explicit false always wins.
 *  - Disconnect: the workspace owner only, like a calendar connection (the
 *    org-level connection belongs to the owner).
 */
import { canViewComp } from '@/lib/employees/shared'

type Viewer = { role?: string | null; settings?: Record<string, unknown> | null } | null | undefined

export function canSeeFinancials(member: Viewer): boolean {
  return canViewComp(member)
}

export function canDisconnectQbo(member: Viewer): boolean {
  return !!member && member.role === 'owner'
}

/** Same-app return paths only. */
export function safeQboReturn(raw: string | null | undefined): string {
  const r = String(raw ?? '')
  return /^\/dashboard(\/[a-z0-9\-\/]*)?$/i.test(r) ? r : '/dashboard/integrations'
}
