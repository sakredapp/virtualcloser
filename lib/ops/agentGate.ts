/**
 * The ops layer's hook into Mira's tool executor (runAgent). For a tenant
 * with reps.settings.cxo_employee_ops = true:
 *   - an action that sends outside the company or changes someone else's
 *     work, asked for by someone who cannot approve it, is queued for an
 *     executive instead of running (lib/ops/approvals);
 *   - every tool call gets an audit row (lib/ops/audit).
 * Switch off: the handler just runs, exactly as before.
 */
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { auditResultOf, classifyAction, isApprover, orgDirectory, type OrgDirectory } from '@/lib/ops/approvalsShared'
import { recordAudit } from '@/lib/ops/audit'

const NOBODY: OrgDirectory = { emails: new Set(), domains: new Set() }

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>

export async function runToolWithOps(name: string, ctx: AgentContext, args: Record<string, unknown>, handler: Handler): Promise<ToolHandlerResult> {
  if (!cxoEmployeeOps(ctx.tenant)) return handler(ctx, args)

  // With nobody counted as inside, a null here means it never leaves the company.
  let cls = classifyAction(name, args, NOBODY)
  const approver = isApprover(ctx.caller, ctx.tenant)
  if (cls && !approver) {
    const { loadMembers } = await import('@/lib/followups/engine')
    cls = classifyAction(name, args, orgDirectory(await loadMembers(ctx.tenant.id)))
    if (cls) {
      const { queueAction } = await import('@/lib/ops/approvals')
      const row = await queueAction({ tenant: ctx.tenant, requestedBy: ctx.caller, tool: name, args, cls })
      void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: 'queued', approved: null, actionId: row.id })
      return {
        text: JSON.stringify({
          ok: false,
          queued: true,
          approval_id: row.id,
          say: `This needs an executive's OK first (${cls.summary}). I've sent it to them; you'll see it here once it's approved or declined.`,
        }),
      }
    }
  }

  try {
    const out = await handler(ctx, args)
    void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: auditResultOf(out.text), approved: cls && approver ? true : null })
    return out
  } catch (err) {
    void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: 'error', approved: null })
    throw err
  }
}

/** A role refusal is an action too: log it. */
export function auditRefusal(ctx: AgentContext, name: string, args: Record<string, unknown>): void {
  if (!cxoEmployeeOps(ctx.tenant)) return
  void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: 'refused', approved: null })
}
