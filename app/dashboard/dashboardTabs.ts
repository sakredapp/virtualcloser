import type { Member } from '@/types'
import { getActiveAddonKeys } from '@/lib/entitlements'
import { isAtLeast, visibilityScope } from '@/lib/permissions'
import { ADDON_CATALOG, type AddonKey } from '@/lib/addons'
import type { DashboardNavTab } from './DashboardNav'

/**
 * Add-on offer surfaced in the "Upgrade" modal. Boiled down to the bare
 * minimum the client needs (label, blurb, price, bullet list) so we don't
 * ship the whole margin-floor table to the browser.
 */
export type UpgradeOption = {
  key: AddonKey
  label: string
  description: string
  monthly_price_cents: number
  whats_included: string[]
}

export type DashboardNavData = {
  tabs: DashboardNavTab[]
  /** Add-ons the tenant doesn't have. Powers the Upgrade pill. */
  lockedAddons: UpgradeOption[]
  /** Active add-on keys — surfaced so client widgets (bot how-to popup) can
   *  tailor copy to the actual build. */
  activeAddonKeys: AddonKey[]
}

/**
 * Build the standard pill-tab list shown above every /dashboard/* page.
 *
 * Owned features get a real pill. Missing add-ons are NOT rendered as
 * locked pills — they go into `lockedAddons` so the nav can render a
 * single "+ Upgrade" pill that pops a modal listing what's available.
 * Cleaner than greyed-out feature pills, and lets reps actually request
 * to add what they want.
 */
export async function buildDashboardTabs(
  repId: string,
  member: Member | null,
): Promise<DashboardNavData> {
  const active = await getActiveAddonKeys(repId)

  const hasDialer = active.has('addon_dialer_lite') || active.has('addon_dialer_pro')
  const hasRoleplay =
    active.has('addon_roleplay_lite') || active.has('addon_roleplay_pro')
  const hasLeaderboard = active.has('addon_team_leaderboard')
  const hasWavv = active.has('addon_wavv_kpi')

  const canSeeTeam = member ? visibilityScope(member.role) !== 'self' : false
  const canSeeOrg = member ? isAtLeast(member.role, 'admin') : false
  const canSeeManagerRoom = member ? isAtLeast(member.role, 'manager') : false
  const canSeeOwnersRoom = member ? isAtLeast(member.role, 'admin') : false

  const tabs: DashboardNavTab[] = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/dashboard/pipeline', label: 'Pipeline' },
  ]

  // Owned premium features go right after Pipeline so they feel central.
  if (hasDialer) tabs.push({ href: '/dashboard/dialer', label: 'AI Dialer' })
  if (hasWavv) tabs.push({ href: '/dashboard/wavv', label: 'WAVV' })
  if (hasRoleplay) tabs.push({ href: '/dashboard/roleplay', label: 'Roleplay' })

  tabs.push(
    { href: '/dashboard/calendar', label: 'Calendar' },
    { href: '/dashboard/inbox', label: 'Inbox' },
    { href: '/brain', label: 'Brain dump' },
    { href: '/dashboard/analytics', label: 'Analytics' },
    { href: '/dashboard/feedback', label: 'Feedback' },
    { href: '/dashboard/integrations', label: 'Integrations' },
  )

  if (canSeeTeam && hasLeaderboard) {
    tabs.push({
      href: '/dashboard/team',
      label: 'Team',
      matchPrefixes: ['/dashboard/team'],
    })
  }
  if (canSeeOrg) {
    tabs.push({ href: '/dashboard/org', label: 'Org' })
  }
  if (canSeeManagerRoom) {
    tabs.push({ href: '/dashboard/room/managers', label: 'Manager Room' })
  }
  if (canSeeOwnersRoom) {
    tabs.push({ href: '/dashboard/room/owners', label: 'Owners Room' })
  }

  tabs.push({ href: '/dashboard/settings', label: 'Settings' })

  // ── Upgrade catalog ──────────────────────────────────────────────────
  // One "best representative" entry per concept: if a tenant has dialer_lite,
  // surface dialer_pro as the upgrade; if neither, show dialer_lite as the
  // entry point. Same for roleplay. CRM only pitches if they have zero CRMs
  // (we don't push CRM-switching).
  const lockedAddons: UpgradeOption[] = []
  const push = (key: AddonKey) => {
    const def = ADDON_CATALOG[key]
    if (!def?.public) return
    if (active.has(key)) return
    lockedAddons.push({
      key,
      label: def.label,
      description: def.description,
      monthly_price_cents: def.monthly_price_cents,
      whats_included: def.whats_included,
    })
  }

  if (active.has('addon_dialer_lite')) {
    push('addon_dialer_pro')
  } else if (!active.has('addon_dialer_pro')) {
    push('addon_dialer_lite')
  }
  if (active.has('addon_roleplay_lite')) {
    push('addon_roleplay_pro')
  } else if (!active.has('addon_roleplay_pro')) {
    push('addon_roleplay_lite')
  }
  const hasAnyCrm =
    active.has('addon_ghl_crm') ||
    active.has('addon_hubspot_crm') ||
    active.has('addon_pipedrive_crm') ||
    active.has('addon_salesforce_crm')
  if (!hasAnyCrm) {
    push('addon_ghl_crm')
    push('addon_hubspot_crm')
  }
  push('addon_wavv_kpi')
  push('addon_white_label')
  push('addon_bluebubbles')
  push('addon_fathom')

  return {
    tabs,
    lockedAddons,
    activeAddonKeys: Array.from(active),
  }
}
