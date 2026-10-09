/**
 * Employee self-view (owner 10-09). Pure and edge-safe: used by middleware,
 * lib/tenant.ts and the tests.
 *
 * An employee login is a member with role 'rep' or 'observer' on an executive
 * (Suite CXO) tenant. It sees only /dashboard/me: their own quotas, bonus,
 * KPIs and time off. Everything else is refused on the server:
 *   - middleware: the session carries scope 'employee' (set at login), so any
 *     other page redirects to /dashboard/me and any other API answers 403;
 *   - getCurrentMember: re-checks the role from the database on every request
 *     and returns no member outside the allowed paths, so a stale or missing
 *     scope never opens anything.
 */

export const EMPLOYEE_ROLES = ['rep', 'observer'] as const

export const EMPLOYEE_HOME = '/dashboard/me'

/** Paths an employee login may use. Everything else is refused. */
const ALLOWED_PREFIXES = [EMPLOYEE_HOME, '/api/employees/me', '/api/me/liability/sign', '/set-password', '/logout', '/login']
const STATIC_FILE = /\.(png|jpe?g|svg|ico|webp|gif|css|js|map|woff2?|ttf|txt|webmanifest)$/i

export function employeePathAllowed(pathname: string | null | undefined): boolean {
  const p = String(pathname ?? '')
  if (!p.startsWith('/')) return false
  if (p.startsWith('/_next/') || p.startsWith('/brands/')) return true
  if (!p.startsWith('/api/') && STATIC_FILE.test(p)) return true
  return ALLOWED_PREFIXES.some((a) => p === a || p.startsWith(`${a}/`))
}

type TenantLike = { id: string; brand?: string | null }

/** Executive tenant: the cxo brand, or a Pinnacle viewer org. */
export function isExecTenant(tenant: TenantLike | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!tenant) return false
  if (tenant.brand === 'cxo') return true
  return (env.PINNACLE_VIEWER_REP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(tenant.id)
}

export function isEmployeeOnlyMember(member: { role?: string | null } | null | undefined, tenant: TenantLike | null | undefined, env?: Record<string, string | undefined>): boolean {
  if (!member || !isExecTenant(tenant, env)) return false
  return (EMPLOYEE_ROLES as readonly string[]).includes(String(member.role ?? ''))
}
