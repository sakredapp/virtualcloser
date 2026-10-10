/** Usage tracking helpers shared by the beacon, the API and the Settings view. */

const ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{20,}|[A-Za-z0-9_-]{24,})$/i

/**
 * One row per page, not per record: ids become [id], query strings and
 * anything outside /dashboard are dropped. Returns null for paths we do not
 * count.
 */
export function normalizeUsagePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let p = raw.split(/[?#]/)[0].trim()
  if (!p.startsWith('/dashboard')) return null
  p = p.replace(/\/+$/, '') || '/dashboard'
  if (p !== '/dashboard' && !p.startsWith('/dashboard/')) return null
  const parts = p.split('/').filter(Boolean).slice(0, 4).map((seg) => (ID_RE.test(seg) ? '[id]' : seg.toLowerCase()))
  if (parts.some((seg) => !/^[a-z0-9_\-[\]]{1,40}$/.test(seg))) return null
  return '/' + parts.join('/')
}

const NAMES: Record<string, string> = {
  '/dashboard': 'Today',
  '/dashboard/today': 'Today',
  '/dashboard/boards': 'Boards',
  '/dashboard/calendar': 'Calendar',
  '/dashboard/meetings': 'Meetings',
  '/dashboard/revenue': 'Revenue',
  '/dashboard/partners': 'Partners',
  '/dashboard/settings': 'Settings',
  '/dashboard/pinnacle': 'Pinnacle',
  '/dashboard/team': 'Team',
  '/dashboard/org': 'Team',
}

/** "Boards", "Revenue › Carriers" — plain names for the Usage table. */
export function pageName(path: string): string {
  if (NAMES[path]) return NAMES[path]
  const parts = path.split('/').filter((s) => s && s !== 'dashboard' && s !== '[id]')
  if (!parts.length) return 'Today'
  return parts.map((s) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(' › ')
}

export type UsageRow = {
  member_id: string
  name: string
  email: string | null
  role: string
  last_login_at: string | null
  logins7: number
  logins30: number
  days_active30: number
  top_pages: Array<{ name: string; views: number }>
  mira30: number
  /** Mira questions this calendar month (tenant timezone), counted against the plan's monthly allowance. */
  miraMonth: number
}

/** Mira questions included per person per month (owner offer: 500). Tenant override: settings.mira_included_monthly. */
export const MIRA_INCLUDED_MONTHLY_DEFAULT = 500

