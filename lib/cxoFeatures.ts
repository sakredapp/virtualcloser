/**
 * Per-tenant Suite CXO feature switches. Pure (no DB, no next/headers) so the
 * Hetzner worker, routes, Mira's tools and tests all read the same answer.
 *
 * cxo_employee_ops (owner 10-10): the employee ops layer (follow-up nudges,
 * scheduled reports, approvals queue, Mira's follow-up tools). OFF unless the
 * tenant's reps.settings.cxo_employee_ops is exactly true. Built to run in the
 * background and be demoed later; Pinnacle stays off until it is switched on.
 */
type TenantLike = { settings?: unknown } | null | undefined

function settingsOf(tenant: TenantLike): Record<string, unknown> {
  const s = tenant?.settings
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
}

/** True only when reps.settings.cxo_employee_ops === true. */
export function cxoEmployeeOps(tenant: TenantLike): boolean {
  return settingsOf(tenant).cxo_employee_ops === true
}
