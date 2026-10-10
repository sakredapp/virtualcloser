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

/** Mira questions each paid seat adds to the org's monthly pool (owner offer: 500). Tenant override: settings.mira_included_monthly. */
export const MIRA_INCLUDED_MONTHLY_DEFAULT = 500

/**
 * Roles that ride on someone else's seat: exec assistants only. Employee
 * logins (rep, observer) pay the same seat as an exec and add the same
 * questions to the pool (owner 10-10: one price for everyone).
 */
const NON_SEAT_ROLES = new Set(['assistant'])

/** True when this role pays a seat (and adds to the Mira pool). One rule for billing and the pool. */
export function isSeatRole(role: string | null | undefined): boolean {
  return !NON_SEAT_ROLES.has(String(role ?? ''))
}

export type MiraPool = { seats: number; perSeat: number; included: number; used: number; over: number }

/**
 * Owner 2026-10-10: Mira is one pool for the whole org, not a per-person
 * allowance. Pool = perSeat x paid seats (at least one); anyone can draw on it
 * and nobody is capped. Questions above the pool bill to the agency card.
 */
export function miraPool(roles: Array<string | null | undefined>, used: number, perSeat = MIRA_INCLUDED_MONTHLY_DEFAULT): MiraPool {
  const seats = Math.max(1, roles.filter(isSeatRole).length)
  const included = seats * perSeat
  return { seats, perSeat, included, used, over: Math.max(0, used - included) }
}

