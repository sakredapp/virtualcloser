/**
 * Read-only tool calls: which ones may run side by side, and how to spot the
 * same read asked twice in one answer.
 *
 * Ciao refinement 2026-10-18: a 1:1 brief that read five sources waited on
 * each in turn and hit the 35s limit, and GLM sometimes repeated one read
 * eight times (it dropped the argument it meant to change). Only tools that
 * never write anything are listed; anything else keeps its strict order.
 */

export const PARALLEL_READ_TOOLS: ReadonlySet<string> = new Set([
  'producer_production',
  'search_company',
  'list_my_todos',
  'list_my_meeting_notes',
  'list_calendar_events',
  'list_followups',
  'list_approvals',
  'list_members',
  'list_one_on_ones',
  'decision_log',
  'plan_pacing',
  'next_allowance_unlock',
  'top_performers',
  'employee_quota_status',
  'my_quota',
  'quickbooks_financials',
  'payroll',
  'team_adoption',
  'what_can_you_do',
])

export const REPEAT_READ_NOTE =
  'Note: this is the exact same call as one you already made in this answer, so it returned the same result. If you meant different figures, change the arguments (for example pass period explicitly). Otherwise answer from what you have.'

/** Stable key for a read-only call (argument order ignored); null for anything that may write. */
export function readCallKey(name: string, args: Record<string, unknown> | null | undefined): string | null {
  if (!PARALLEL_READ_TOOLS.has(name)) return null
  return `${name}:${stableJson(args ?? {})}`
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** True when a batch of tool calls can run in parallel: two or more, all read-only. */
export function isParallelReadBatch(names: readonly string[]): boolean {
  return names.length > 1 && names.every((n) => PARALLEL_READ_TOOLS.has(n))
}
