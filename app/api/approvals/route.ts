/**
 * Approvals (Suite CXO employee ops, switch-gated). An executive sees the
 * Mira actions waiting for an OK in their company and decides them; the
 * audit log is scoped by lib/ops/audit (execs: company, others: own rows).
 *   GET            pending approvals + pending meeting-note actions + recent audit
 *   POST {id, approve}   approve (runs the stored call as the asker) or decline
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { ApprovalError, decideApproval, listApprovals, listPlaudPending } from '@/lib/ops/approvals'
import { isApprover } from '@/lib/ops/approvalsShared'
import { listAudit } from '@/lib/ops/audit'
import { loadMembers } from '@/lib/followups/engine'
import { nameOf } from '@/lib/followups/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  if (!cxoEmployeeOps(ctx.tenant)) return NextResponse.json({ enabled: false, pending: [], plaud: [], audit: [] })
  const all = req.nextUrl.searchParams.get('status') === 'all'
  try {
    const [pending, plaud, audit, members] = await Promise.all([
      listApprovals(ctx.tenant.id, all ? 'all' : 'pending').catch(() => []),
      listPlaudPending(ctx.tenant.id),
      listAudit(ctx.tenant, ctx.member, { limit: 100 }).catch(() => []),
      loadMembers(ctx.tenant.id).catch(() => []),
    ])
    const name = (id: string | null) => (id ? nameOf(members.find((m) => m.id === id)) : 'Mira')
    return NextResponse.json({
      enabled: true,
      canApprove: isApprover(ctx.member, ctx.tenant),
      pending: pending.map((r) => ({ id: r.id, summary: r.summary, reason: r.reason, status: r.status, tool: r.tool, requested_by: name(r.requested_by), decided_by: r.decided_by ? name(r.decided_by) : null, decided_at: r.decided_at, created_at: r.created_at })),
      plaud: plaud.map((p) => ({ id: p.id, kind: p.kind, to: p.target_email, subject: typeof p.payload?.subject === 'string' ? p.payload.subject : typeof p.payload?.title === 'string' ? p.payload.title : null, created_at: p.created_at })),
      audit: audit.map((a) => ({ id: a.id, who: name(a.member_id), tool: a.tool, result: a.result, approved: a.approved, args: a.args_summary, created_at: a.created_at })),
    })
  } catch (err) {
    console.error('[approvals] get', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load approvals.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  if (!cxoEmployeeOps(ctx.tenant)) return NextResponse.json({ error: 'Not switched on.' }, { status: 404 })
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown; approve?: unknown }
  if (typeof b.id !== 'string' || typeof b.approve !== 'boolean') return NextResponse.json({ error: 'id and approve are required.' }, { status: 400 })
  try {
    const row = await decideApproval({ tenant: ctx.tenant, approver: ctx.member, id: b.id, approve: b.approve })
    return NextResponse.json({ ok: true, status: row.status, result: row.result ?? null })
  } catch (err) {
    if (err instanceof ApprovalError) return NextResponse.json({ error: err.message }, { status: 409 })
    console.error('[approvals] decide', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'That did not go through.' }, { status: 500 })
  }
}
