import type { Member } from '@/types'
import { getActiveAddonKeys } from '@/lib/entitlements'
import { isAtLeast, visibilityScope } from '@/lib/permissions'
import type { DashboardNavTab } from './DashboardNav'

/**
 * Build the standard pill-tab list shown above every /dashboard/* page.
 * Tabs the tenant hasn't purchased come back with `unlocked: false` so
 * the nav renders them greyed-out + 🔒 instead of hiding them. This is
 * the marketing-driven design: visible upsell, never silent gating.
 */
export async function buildDashboardTabs(
  repId: string,
  member: Member | null,
): Promise<DashboardNavTab[]> {
  const active = await getActiveAddonKeys(repId)

  const hasDialer = active.has('addon_dialer_lite') || active.has('addon_dialer_pro')
  const hasRoleplay =
    active.has('addon_roleplay_lite') || active.has('addon_roleplay_pro')
  // Pipeline ships to every tenant — the kanban + drag UI is part of the
  // base build. CRM mirroring is a separate add-on that gates only the
  // *sync* behavior, not visibility of the board.
  const hasLeaderboard = active.has('addon_team_leaderboard')

  const canSeeTeam = member ? visibilityScope(member.role) !== 'self' : false
  const canSeeManagerRoom = member ? isAtLeast(member.role, 'manager') : false
  const canSeeOwnersRoom = member ? isAtLeast(member.role, 'admin') : false

  const tabs: DashboardNavTab[] = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/dashboard/pipeline', label: 'Pipeline' },
    { href: '/dashboard/dialer', label: 'AI Dialer', unlocked: hasDialer },
    { href: '/dashboard/roleplay', label: 'Roleplay', unlocked: hasRoleplay },
    { href: '/dashboard/inbox', label: 'Inbox' },
    { href: '/brain', label: 'Brain dump' },
    { href: '/dashboard/analytics', label: 'Analytics' },
    { href: '/dashboard/feedback', label: 'Feedback' },
    { href: '/dashboard/integrations', label: 'Integrations' },
  ]

  if (canSeeTeam) {
    tabs.push({
      href: '/dashboard/team',
      label: 'Team',
      matchPrefixes: ['/dashboard/team'],
      unlocked: hasLeaderboard,
    })
  }
  if (canSeeManagerRoom) {
    tabs.push({ href: '/dashboard/room/managers', label: 'Manager Room' })
  }
  if (canSeeOwnersRoom) {
    tabs.push({ href: '/dashboard/room/owners', label: 'Owners Room' })
  }

  return tabs
}
