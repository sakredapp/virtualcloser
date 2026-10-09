/**
 * Who may read Pinnacle data — the one server-side rule.
 *
 * The pinnacle_* tables (Airtable mirror, rollups, people stats) carry no
 * tenant column: they are Pinnacle Life Group's book, nobody else's. Being a
 * Suite CXO exec is NOT enough to read them. Only tenants on this allow-list
 * may, and every reader (pages, API routes, Mira tools, MCP, crons) asks here.
 *
 * Allow-list: PINNACLE_VIEWER_REP_IDS (comma-separated tenant ids) when set,
 * otherwise the built-in default below. Fail closed: an empty or unknown
 * tenant is never allowed, and an unset env never means "everyone".
 */

/** Pinnacle Life Group's tenant. The default when the env is unset. */
export const PINNACLE_TENANT_DEFAULT: readonly string[] = ['rep_spence']

export function pinnacleTenantIds(): string[] {
  const env = (process.env.PINNACLE_VIEWER_REP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return env.length ? env : [...PINNACLE_TENANT_DEFAULT]
}

/** True only for a tenant mapped to the Pinnacle book. */
export function pinnacleAllowed(tenantId: string | null | undefined): boolean {
  if (!tenantId) return false
  return pinnacleTenantIds().includes(tenantId)
}

export class PinnacleForbidden extends Error {
  constructor() {
    super('This account is not connected to the Pinnacle book.')
    this.name = 'PinnacleForbidden'
  }
}

/** Throws PinnacleForbidden unless the tenant may read Pinnacle data. */
export function assertPinnacleTenant(tenantId: string | null | undefined): void {
  if (!pinnacleAllowed(tenantId)) throw new PinnacleForbidden()
}
