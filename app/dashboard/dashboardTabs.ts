import type { Member } from '@/types'
import { getActiveAddonKeys } from '@/lib/entitlements'
import { isAtLeast, visibilityScope } from '@/lib/permissions'
import { ADDON_CATALOG, type AddonKey } from '@/lib/addons'
import type { DashboardNavTab } from './DashboardNav'
import { supabase } from '@/lib/supabase'
import { getBrand, type BrandKey } from '@/lib/brand'

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

  const { data: repRow } = await supabase
    .from('reps')
    .select('integrations, brand, tier')
    .eq('id', repId)
    .maybeSingle()
  const hasTrello = Boolean((repRow?.integrations as Record<string, unknown> | null)?.trello_token)
  const hasPlaud = Boolean((repRow?.integrations as Record<string, unknown> | null)?.plaud_webhook_secret)
  const brandKey = ((repRow as { brand?: BrandKey } | null)?.brand ?? 'virtualcloser') as BrandKey
  const brand = getBrand(brandKey)
  const isExec = brand.tabPreset === 'executive'

  // Team / Org / Rooms / Feedback are multi-seat concepts. They must not leak
  // onto individual-tier accounts: an individual is the owner of their own
  // single-seat rep, so the role checks below would otherwise always pass
  // (e.g. Spencer, an individual-tier owner, was seeing Org + both Rooms).
  // Default missing/unknown tier to individual so enterprise tabs stay hidden
  // unless the account is explicitly enterprise.
  const isEnterprise = ((repRow as { tier?: string } | null)?.tier ?? 'individual') === 'enterprise'

  const hasDialer = active.has('addon_dialer_lite') || active.has('addon_dialer_pro')
  const hasRoleplay =
    active.has('addon_roleplay_lite') || active.has('addon_roleplay_pro')
  const hasLeaderboard = active.has('addon_team_leaderboard')
  const hasWavv = active.has('addon_wavv_kpi')

  const canSeeTeam = isEnterprise && member ? visibilityScope(member.role) !== 'self' : false
  const canSeeOrg = isEnterprise && member ? isAtLeast(member.role, 'admin') : false
  const canSeeManagerRoom = isEnterprise && member ? isAtLeast(member.role, 'manager') : false
  const canSeeOwnersRoom = isEnterprise && member ? isAtLeast(member.role, 'admin') : false

  const tabs: DashboardNavTab[] = []

  // Brain dump nests under the home tab (Command Center / Overview) — it's a
  // capture surface tied to the daily workspace, not a top-level destination.
  const brainChild: DashboardNavTab = { href: '/brain', label: 'Brain dump' }

  if (isExec) {
    // ── CXO Suite preset: executive operating system ─────────────────────
    tabs.push(
      { href: '/dashboard', label: 'Command Center', children: [brainChild] },
      { href: '/dashboard/pipeline', label: 'Pipeline' },
      { href: '/dashboard/projects', label: 'Projects', matchPrefixes: ['/dashboard/projects'] },
    )
    if (canSeeTeam) {
      tabs.push({ href: '/dashboard/team', label: 'Team Performance', matchPrefixes: ['/dashboard/team'] })
    }
    // Inbox = email (the exec preset has no standalone SMS tab). Calendar is
    // its own top-level tab — it's a daily-driver surface for execs.
    tabs.push({
      href: '/dashboard/inbox',
      label: 'Inbox',
      matchPrefixes: ['/dashboard/inbox'],
    })
    tabs.push({ href: '/dashboard/calendar', label: 'Calendar', matchPrefixes: ['/dashboard/calendar'] })
    tabs.push({ href: '/dashboard/analytics', label: 'Reports' })
    tabs.push({ href: '/dashboard/payroll', label: 'Payroll', matchPrefixes: ['/dashboard/payroll'] })
    if (hasTrello) tabs.push({ href: '/dashboard/trello', label: 'Trello' })
    if (hasPlaud) tabs.push({ href: '/dashboard/plaud', label: 'Plaud' })

    // Rooms hub: re-labeled for the executive audience; routes stay the same.
    const execRooms: DashboardNavTab[] = []
    if (canSeeManagerRoom) execRooms.push({ href: '/dashboard/room/managers', label: 'Leadership Channel' })
    if (canSeeOwnersRoom) execRooms.push({ href: '/dashboard/room/owners', label: 'Owners Room' })
    if (execRooms.length > 0) {
      tabs.push({ href: execRooms[0].href, label: 'Rooms', matchPrefixes: ['/dashboard/room'], children: execRooms })
    }
    if (canSeeOrg) tabs.push({ href: '/dashboard/org', label: 'Org' })
  } else {
    // ── Virtual Closer preset: sales-rep operating system ────────────────
    tabs.push(
      { href: '/dashboard', label: 'Overview', children: [brainChild] },
      { href: '/dashboard/pipeline', label: 'Pipeline' },
      { href: '/dashboard/prospects', label: 'Prospects', matchPrefixes: ['/dashboard/prospects'] },
      { href: '/dashboard/projects', label: 'Projects', matchPrefixes: ['/dashboard/projects'] },
    )

    // Inbox hub: email + SMS + calendar — all the rep's comms in one place.
    tabs.push({
      href: '/dashboard/inbox',
      label: 'Inbox',
      matchPrefixes: ['/dashboard/inbox'],
      children: [
        { href: '/dashboard/inbox', label: 'Email' },
        { href: '/dashboard/sms', label: 'SMS' },
        { href: '/dashboard/calendar', label: 'Calendar' },
      ],
    })

    // Dialer hub: AI Dialer + WAVV + Shifts (all dialer-adjacent). Shown when
    // the rep owns either dialing product; Shifts only matters with a dialer.
    if (hasDialer || hasWavv) {
      const dialerChildren: DashboardNavTab[] = []
      if (hasDialer) dialerChildren.push({ href: '/dashboard/dialer', label: 'AI Dialer', matchPrefixes: ['/dashboard/dialer'] })
      if (hasWavv) dialerChildren.push({ href: '/dashboard/wavv', label: 'WAVV' })
      dialerChildren.push({ href: '/dashboard/shifts', label: 'Shifts' })
      tabs.push({
        href: hasDialer ? '/dashboard/dialer' : '/dashboard/wavv',
        label: 'Dialer',
        matchPrefixes: ['/dashboard/dialer', '/dashboard/wavv', '/dashboard/shifts'],
        children: dialerChildren,
      })
    }
    if (hasRoleplay) tabs.push({ href: '/dashboard/roleplay', label: 'Roleplay' })

    if (hasTrello) tabs.push({ href: '/dashboard/trello', label: 'Trello' })
    if (hasPlaud) tabs.push({ href: '/dashboard/plaud', label: 'Plaud' })
    tabs.push({ href: '/dashboard/analytics', label: 'Analytics' })

    // Feedback is the enterprise rep→client coaching channel (reps ask /
    // managers reply), not platform feedback — only meaningful multi-seat.
    if (isEnterprise) tabs.push({ href: '/dashboard/feedback', label: 'Feedback' })
    if (canSeeTeam && hasLeaderboard) {
      tabs.push({ href: '/dashboard/team', label: 'Team', matchPrefixes: ['/dashboard/team'] })
    }
    if (canSeeOrg) tabs.push({ href: '/dashboard/org', label: 'Org' })

    const rooms: DashboardNavTab[] = []
    if (canSeeManagerRoom) rooms.push({ href: '/dashboard/room/managers', label: 'Manager Room' })
    if (canSeeOwnersRoom) rooms.push({ href: '/dashboard/room/owners', label: 'Owners Room' })
    if (rooms.length > 0) {
      tabs.push({ href: rooms[0].href, label: 'Rooms', matchPrefixes: ['/dashboard/room'], children: rooms })
    }
  }

  const pinnacleAllowed = (process.env.PINNACLE_VIEWER_REP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (pinnacleAllowed.includes(repId)) {
    tabs.push({ href: '/dashboard/pinnacle', label: 'Pinnacle' })
  }

  // Settings hub: account (the page itself) + Integrations + Billing. Billing
  // is still self-serve for every member; it just lives under Settings now
  // instead of as its own top-level tab.
  tabs.push({
    href: '/dashboard/settings',
    label: 'Settings',
    matchPrefixes: ['/dashboard/settings'],
    children: [
      { href: '/dashboard/integrations', label: 'Integrations', matchPrefixes: ['/dashboard/integrations'] },
      // Point at the weekly account view — that's the model customers are
      // actually charged on (Stripe subscriptions + weekly invoices). The
      // /dashboard/billing page is the plan/payment editor, linked from there.
      { href: '/dashboard/billing/account', label: 'Billing', matchPrefixes: ['/dashboard/billing'] },
    ],
  })

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
