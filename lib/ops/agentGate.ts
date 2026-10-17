/**
 * The ops layer's hook into Mira's tool executor (runAgent). For a tenant
 * with reps.settings.cxo_employee_ops = true:
 *   - an action that sends outside the company or changes someone else's
 *     work, asked for by someone who cannot approve it, is queued for an
 *     executive instead of running (lib/ops/approvals);
 *   - every tool call gets an audit row (lib/ops/audit).
 * Switch off: the handler just runs, exactly as before.
 *
 * Ciao in Slack (ctx.channel 'slack', any Suite CXO company, switch or not):
 * anything that sends outside the app or changes something for someone is
 * never run from Slack. It is held for the asker's own yes in the app
 * (queueSlackHold), or, when it also needs an executive's OK, queued for one
 * exactly as above. The Slack reply links to the app.
 */
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { auditResultOf, classifyAction, isApprover, orgDirectory, slackHoldFor, type OrgDirectory } from '@/lib/ops/approvalsShared'
import { recordAudit } from '@/lib/ops/audit'

const NOBODY: OrgDirectory = { emails: new Set(), domains: new Set() }

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>

export async function runToolWithOps(name: string, ctx: AgentContext, args: Record<string, unknown>, handler: Handler): Promise<ToolHandlerResult> {
  if (ctx.channel === 'slack') {
    const hold = slackHoldFor(name, args)
    if (hold) return holdFromSlack(name, ctx, args, hold.summary)
  }
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

/** Slack: hold it. An executive's OK first when the switch is on and the asker cannot give one; else the asker's own yes. */
async function holdFromSlack(name: string, ctx: AgentContext, args: Record<string, unknown>, summary: string): Promise<ToolHandlerResult> {
  const approvals = await import('@/lib/ops/approvals')
  try {
    if (cxoEmployeeOps(ctx.tenant) && !isApprover(ctx.caller, ctx.tenant)) {
      const { loadMembers } = await import('@/lib/followups/engine')
      const cls = classifyAction(name, args, orgDirectory(await loadMembers(ctx.tenant.id)))
      if (cls) {
        const row = await approvals.queueAction({ tenant: ctx.tenant, requestedBy: ctx.caller, tool: name, args, cls })
        ctx.held?.push(row.id)
        void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: 'queued', approved: null, actionId: row.id })
        return { text: JSON.stringify({ ok: false, queued: true, approval_id: row.id, say: `This needs an executive's OK first (${cls.summary}). I've sent it to them in the app. Nothing has been sent yet.` }) }
      }
    }
    const row = await approvals.queueSlackHold({ tenant: ctx.tenant, requestedBy: ctx.caller, tool: name, args, cls: { reason: 'slack_hold', summary } })
    ctx.held?.push(row.id)
    if (cxoEmployeeOps(ctx.tenant)) void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: 'queued', approved: null, actionId: row.id })
    return { text: JSON.stringify({ ok: false, queued: true, approval_id: row.id, say: `Ready: ${summary}. I don't send or change things from Slack. Say yes in the app and it's done.` }) }
  } catch (err) {
    console.error('[agentGate] slack hold failed', err instanceof Error ? err.message : err)
    return { text: JSON.stringify({ ok: false, error: 'not_held', say: `I could not set that up from Slack. Nothing was sent. Ask me in the app instead.` }) }
  }
}

/** A role refusal is an action too: log it. */
export function auditRefusal(ctx: AgentContext, name: string, args: Record<string, unknown>): void {
  if (!cxoEmployeeOps(ctx.tenant)) return
  void recordAudit({ repId: ctx.tenant.id, memberId: ctx.caller.id, tool: name, args, result: 'refused', approved: null })
}
