/**
 * Per-tenant Suite CXO feature switches. Pure (no DB, no next/headers) so the
 * Hetzner worker, routes, Mira's tools and tests all read the same answer.
 *
 * cxo_employee_ops (owner 10-10): the employee ops layer (follow-up nudges,
 * scheduled reports, approvals queue, Mira's follow-up tools). OFF unless the
 * tenant's reps.settings.cxo_employee_ops is exactly true. Built to run in the
 * background and be demoed later; Pinnacle stays off until it is switched on.
 */
import { isPinnacleEdition } from '@/lib/storeDemo'

type TenantLike = { settings?: unknown } | null | undefined

function settingsOf(tenant: TenantLike): Record<string, unknown> {
  const s = tenant?.settings
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
}

/** True only when reps.settings.cxo_employee_ops === true. */
export function cxoEmployeeOps(tenant: TenantLike): boolean {
  return settingsOf(tenant).cxo_employee_ops === true
}

/**
 * The email inbox (owner 2026-10-17). Suite CXO does not offer an inbox or any
 * Gmail feature to customers: Gmail's restricted scopes need Google's CASA
 * assessment, and the inbox is not finished at scale. The Pinnacle edition is
 * the one exception (its own internal Google app, no user cap): the Pinnacle
 * org and its store-review account. Everything Gmail (the Inbox tab, inbox
 * routes, Gmail OAuth scopes, Ciao's email tools, MCP email tools, background
 * Gmail sync and triage) asks here.
 */
/** True only for the Pinnacle edition (the Pinnacle org or its review login). */
export function cxoInboxEnabled(tenantId: string | null | undefined): boolean {
  return isPinnacleEdition(tenantId)
}

type InboxTenant = { id?: string | null; brand?: string | null } | null | undefined

/**
 * May this tenant use the inbox / Gmail? Scoped to Suite CXO: a tenant on any
 * other brand (the Virtual Closer side served by the same app) keeps exactly
 * what it had. A Suite CXO tenant gets it only on the Pinnacle edition.
 */
export function inboxAllowed(tenant: InboxTenant): boolean {
  if (!tenant) return false
  if (tenant.brand !== 'cxo') return true
  return cxoInboxEnabled(tenant.id)
}
