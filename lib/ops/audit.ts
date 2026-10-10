/**
 * Mira's audit log (cxo_mira_audit): one row per action, who / what tool /
 * args summary / result / approved. Writes never block or fail a tool call.
 * Reads are scoped: employees see their own rows, executives their company's.
 */
import { supabase } from '@/lib/supabase'
import { auditScope, summarizeArgs, type AuditResult } from '@/lib/ops/approvalsShared'

export async function recordAudit(row: {
  repId: string
  memberId: string | null
  tool: string
  args?: Record<string, unknown>
  result: AuditResult
  approved?: boolean | null
  actionId?: string | null
}): Promise<void> {
  try {
    const { error } = await supabase.from('cxo_mira_audit').insert({
      rep_id: row.repId,
      member_id: row.memberId,
      tool: row.tool.slice(0, 80),
      args_summary: summarizeArgs(row.args ?? {}),
      result: row.result,
      approved: row.approved ?? null,
      action_id: row.actionId ?? null,
    })
    if (error) console.error('[audit]', error.message)
  } catch (err) {
    console.error('[audit]', err instanceof Error ? err.message : err)
  }
}

export type AuditRow = { id: string; rep_id: string; member_id: string | null; tool: string; args_summary: Record<string, unknown>; result: AuditResult; approved: boolean | null; action_id: string | null; created_at: string }

export async function listAudit(
  tenant: { id: string; brand?: string | null },
  viewer: { id: string; role?: string | null },
  opts: { limit?: number; memberId?: string | null } = {},
): Promise<AuditRow[]> {
  const scope = auditScope(viewer, tenant)
  let q = supabase
    .from('cxo_mira_audit')
    .select('id, rep_id, member_id, tool, args_summary, result, approved, action_id, created_at')
    .eq('rep_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
  if ('memberId' in scope) q = q.eq('member_id', scope.memberId)
  else if (opts.memberId) q = q.eq('member_id', opts.memberId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as AuditRow[]
}
