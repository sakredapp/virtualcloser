/**
 * Approvals queue (cxo_mira_approvals), server side. A Mira action that
 * needs an executive's OK is stored here instead of running; approvers get
 * an in-app notice; Approve runs the exact tool call as the person who
 * asked, Decline drops it. Either way the asker is told once, and the
 * decision is in the audit log.
 *
 * The approvals list also shows pending meeting-note emails and invites
 * (plaud_actions), which keep their own approve/dismiss routes.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices, loadMembers, type OpsTenant } from '@/lib/followups/engine'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { isApprover, type Classification } from '@/lib/ops/approvalsShared'
import { recordAudit } from '@/lib/ops/audit'

export type ApprovalRow = {
  id: string
  rep_id: string
  requested_by: string
  tool: string
  args: Record<string, unknown>
  summary: string
  reason: 'outside_send' | 'others_work'
  status: 'pending' | 'approved' | 'declined' | 'executed' | 'failed'
  decided_by: string | null
  decided_at: string | null
  result: unknown
  created_at: string
}
const COLS = 'id, rep_id, requested_by, tool, args, summary, reason, status, decided_by, decided_at, result, created_at'

export class ApprovalError extends Error {}

/** Store the action and tell every approver in the company. */
export async function queueAction(input: { tenant: OpsTenant; requestedBy: { id: string; display_name?: string | null; email?: string | null }; tool: string; args: Record<string, unknown>; cls: Classification }): Promise<ApprovalRow> {
  const { data, error } = await supabase
    .from('cxo_mira_approvals')
    .insert({ rep_id: input.tenant.id, requested_by: input.requestedBy.id, tool: input.tool, args: input.args, summary: input.cls.summary.slice(0, 500), reason: input.cls.reason })
    .select(COLS)
    .single()
  if (error) throw error
  const row = data as ApprovalRow
  const members = await loadMembers(input.tenant.id)
  const who = (input.requestedBy.display_name || input.requestedBy.email || 'A teammate').trim()
  const approvers = members.filter((m) => m.is_active && m.id !== input.requestedBy.id && isApprover(m, input.tenant))
  await insertNotices(
    approvers.map((m) => ({
      rep_id: input.tenant.id,
      member_id: m.id,
      key: `approval|${row.id}|${m.id}`,
      kind: 'approval',
      item_kind: 'approval',
      item_id: row.id,
      title: `Needs your OK: ${row.summary}`.slice(0, 300),
      body: `${who} asked Mira to do this. Approve or decline it on Approvals.`,
      href: '/dashboard/approvals',
      due_date: null,
    })),
  ).catch((e) => console.error('[approvals] notify', e))
  return row
}

export async function listApprovals(repId: string, status: 'pending' | 'all' = 'pending', limit = 100): Promise<ApprovalRow[]> {
  let q = supabase.from('cxo_mira_approvals').select(COLS).eq('rep_id', repId).order('created_at', { ascending: false }).limit(limit)
  if (status === 'pending') q = q.eq('status', 'pending')
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ApprovalRow[]
}

/** Pending meeting-note emails and invites (the existing plaud_actions approvals). */
export async function listPlaudPending(repId: string, limit = 50) {
  const { data, error } = await supabase
    .from('plaud_actions')
    .select('id, kind, status, payload, target_email, created_at')
    .eq('rep_id', repId)
    .eq('status', 'pending')
    .in('kind', ['send_email', 'create_calendar_event'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data ?? []) as Array<{ id: string; kind: string; status: string; payload: Record<string, unknown> | null; target_email: string | null; created_at: string }>
}

/**
 * Approve or decline. Only an approver in the same company; only a pending
 * row (claimed with a conditional update, so a double click runs it once).
 * Approve runs the tool as the person who asked, with confirmed: true.
 */
export async function decideApproval(input: { tenant: OpsTenant; approver: { id: string; role?: string | null }; id: string; approve: boolean }): Promise<ApprovalRow> {
  if (!isApprover(input.approver, input.tenant)) throw new ApprovalError('Only an executive can approve this.')
  const { data, error } = await supabase
    .from('cxo_mira_approvals')
    .update({ status: input.approve ? 'approved' : 'declined', decided_by: input.approver.id, decided_at: new Date().toISOString() })
    .eq('rep_id', input.tenant.id)
    .eq('id', input.id)
    .eq('status', 'pending')
    .select(COLS)
  if (error) throw error
  const row = (data ?? [])[0] as ApprovalRow | undefined
  if (!row) throw new ApprovalError('That request was already decided or does not exist.')

  let final = row
  let say = 'Declined.'
  if (input.approve) {
    const run = await executeApproved(input.tenant, row)
    say = run.ok ? 'Approved and done.' : `Approved, but it did not go through: ${run.error ?? 'unknown error'}`
    const { data: upd } = await supabase
      .from('cxo_mira_approvals')
      .update({ status: run.ok ? 'executed' : 'failed', result: run.result ?? { error: run.error } })
      .eq('id', row.id)
      .select(COLS)
    final = ((upd ?? [])[0] as ApprovalRow | undefined) ?? row
    await recordAudit({ repId: row.rep_id, memberId: row.requested_by, tool: row.tool, args: row.args, result: run.ok ? 'ok' : 'error', approved: true, actionId: row.id })
  } else {
    await recordAudit({ repId: row.rep_id, memberId: row.requested_by, tool: row.tool, args: row.args, result: 'not_done', approved: false, actionId: row.id })
  }

  // Tell the person who asked, once.
  const members = await loadMembers(input.tenant.id)
  const asker = members.find((m) => m.id === row.requested_by)
  if (asker && asker.is_active && asker.role !== 'assistant') {
    await insertNotices([
      {
        rep_id: row.rep_id,
        member_id: asker.id,
        key: `approval_result|${row.id}`,
        kind: 'approval_result',
        item_kind: 'approval',
        item_id: row.id,
        title: `${input.approve ? 'Approved' : 'Declined'}: ${row.summary}`.slice(0, 300),
        body: say,
        href: isEmployeeOnlyMember(asker, input.tenant) ? '/dashboard/me' : '/dashboard/approvals',
        due_date: null,
      },
    ]).catch((e) => console.error('[approvals] tell asker', e))
  }
  return final
}

/** Run the stored tool call as the member who asked for it. */
async function executeApproved(tenant: OpsTenant, row: ApprovalRow): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const [{ data: rep }, { data: member }] = await Promise.all([
      supabase.from('reps').select('*').eq('id', tenant.id).maybeSingle(),
      supabase.from('members').select('*').eq('rep_id', tenant.id).eq('id', row.requested_by).maybeSingle(),
    ])
    if (!rep || !member || member.is_active === false) return { ok: false, error: 'The person who asked is no longer on the team.' }
    const { TOOL_HANDLERS } = await import('@/lib/agent/tools')
    const { isEmployeeCaller } = await import('@/lib/agent/access')
    const handler = TOOL_HANDLERS[row.tool]
    if (!handler) return { ok: false, error: `unknown tool ${row.tool}` }
    const tz = (member.timezone as string | null) || (rep.timezone as string | null) || 'America/New_York'
    const ctx = {
      tenant: rep,
      caller: member,
      timezone: tz,
      todayIso: new Date().toLocaleDateString('en-CA', { timeZone: tz }),
      ownerMemberId: member.id as string,
      selfOnly: isEmployeeCaller(member, rep),
    } as Parameters<typeof handler>[0]
    const out = await handler(ctx, { ...row.args, confirmed: true })
    let parsed: unknown = out.text
    try {
      parsed = JSON.parse(out.text)
    } catch {
      /* keep text */
    }
    const failed = !!parsed && typeof parsed === 'object' && (parsed as { ok?: unknown }).ok === false
    return failed ? { ok: false, result: parsed, error: String((parsed as { error?: unknown; say?: unknown }).error ?? (parsed as { say?: unknown }).say ?? 'not done') } : { ok: true, result: parsed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
