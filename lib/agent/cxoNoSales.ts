/**
 * Suite CXO has no sales tools (owner 2026-10-20: "why would we have sales
 * tools on suite cxo"). No CRM, leads, pipeline, dialer, sales KPI cards,
 * sales targets or roleplay on the executive product.
 *
 * This is the one list. It is enforced three times, so a forged or
 * hallucinated call never reaches the Virtual Closer CRM from a Suite CXO
 * tenant:
 *   1. toolDefsForTenant never offers these tools on a CXO tenant;
 *   2. authorizeToolCall refuses them on a CXO tenant (lib/agent/access);
 *   3. executeIntent refuses every delegate_intents kind not listed in
 *      CXO_INTENT_KINDS (lib/mira/intents).
 *
 * Virtual Closer tenants are unchanged. Pure: no imports.
 */

/** Ciao tools that are Virtual Closer sales tools. Never on a Suite CXO tenant. */
export const CXO_SALES_TOOL_NAMES: ReadonlySet<string> = new Set([
  'list_leads',
  'list_pipeline_boards',
  'list_pipeline_leads',
  'list_kpi_history',
  'list_targets',
  'list_roleplay_sessions',
  // Calls and texting: Suite CXO has neither (owner 2026-10-17).
  'list_recent_calls',
  'get_call_stats',
])

/**
 * The delegate_intents kinds a Suite CXO tenant may run: dashboard notes and
 * tasks, calendar meetings, parking an item, a Gmail send, product feedback.
 * Everything else (leads, pipeline, follow-ups on leads, targets, KPI cards,
 * forecasts, leaderboards, commissions, projects, imports) is a sales tool.
 */
export const CXO_INTENT_KINDS: ReadonlySet<string> = new Set([
  'brain_item',
  'complete_task',
  'move_task',
  'defer_item',
  'book_meeting',
  'reschedule_meeting',
  'cancel_meeting',
  'send_email',
  'feature_request',
  'product_help',
  'question',
  'report',
])

/**
 * Report types a Suite CXO tenant may run. today/week/goals/metrics/pipeline
 * read leads, call stats and sales targets; only the calendar one does not.
 */
export const CXO_REPORT_TYPES: ReadonlySet<string> = new Set(['calendar'])

type TenantLike = { brand?: string | null } | null | undefined

export function isCxoTenant(tenant: TenantLike): boolean {
  return (tenant?.brand ?? 'virtualcloser') === 'cxo'
}

/** May this tool run for this tenant? False only for a sales tool on Suite CXO. */
export function cxoToolAllowed(name: string, tenant: TenantLike): boolean {
  return !isCxoTenant(tenant) || !CXO_SALES_TOOL_NAMES.has(name)
}

/** May this delegate_intents intent run for this tenant? */
export function cxoIntentAllowed(intent: { kind?: unknown; report_type?: unknown } | null | undefined, tenant: TenantLike): boolean {
  if (!isCxoTenant(tenant)) return true
  const kind = typeof intent?.kind === 'string' ? intent.kind : ''
  if (!CXO_INTENT_KINDS.has(kind)) return false
  if (kind === 'report') return typeof intent?.report_type === 'string' && CXO_REPORT_TYPES.has(intent.report_type)
  return true
}

export const CXO_NO_SALES_SAY =
  'Suite CXO has no sales tools: no CRM, leads, pipeline, dialer or sales targets. I can help with revenue and production from the book, the plan, people, partners, finance, your calendar, email and to-dos.'

/** The receipt executeIntent returns for a refused intent. */
export const CXO_NO_SALES_RECEIPT = `Not available on Suite CXO. ${CXO_NO_SALES_SAY}`
