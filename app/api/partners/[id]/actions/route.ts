import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { getPartner, getPartnerAction, markActionStatus, recordPartnerAction, sendPartnerDraft, type ActionKind } from '@/lib/partners'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST
 *   { op: 'send', draft_id, from_account? }           send a saved draft as the exec (Gmail → SES → gap)
 *   { op: 'record', kind: 'note'|'task', subject?, body, due_at? }   log a note / assign a task
 *   { op: 'done', action_id }                          close a task
 */
export async function POST(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const { id } = await params
  const partner = await getPartner(ctx.tenant.id, id)
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const op = String(body.op ?? '')

  if (op === 'send') {
    const draft = typeof body.draft_id === 'string' ? await getPartnerAction(ctx.tenant.id, body.draft_id) : null
    if (!draft || draft.partner_id !== partner.id) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 })
    if (draft.status === 'sent') return NextResponse.json({ error: 'Already sent.', action: draft }, { status: 409 })
    // Gmail drafts.send on the saved draft (or deliverPartnerEmail when the From/recipient changed). One path with Mira's send_partner_message.
    const { outcome, action } = await sendPartnerDraft({
      repId: ctx.tenant.id,
      memberId: ctx.member.id,
      action: draft,
      senderName: ctx.member.display_name,
      senderEmail: ctx.member.email,
      to: (typeof body.to === 'string' && body.to.trim()) || partner.email,
      fromAccount: typeof body.from_account === 'string' ? body.from_account : null,
    })
    if (!outcome.sent) return NextResponse.json({ sent: false, reason: outcome.reason, gap: outcome.gap, action })
    return NextResponse.json({ sent: true, via: outcome.channel, from: outcome.from, action })
  }

  if (op === 'record') {
    const kind: ActionKind = body.kind === 'task' ? 'task' : 'note'
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 8000) : ''
    if (!text) return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
    const action = await recordPartnerAction({
      repId: ctx.tenant.id,
      partnerId: partner.id,
      kind,
      subject: typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) || null : null,
      body: text,
      status: kind === 'task' ? 'draft' : 'done',
      dueAt: typeof body.due_at === 'string' && body.due_at ? new Date(body.due_at).toISOString() : null,
      createdBy: ctx.member.id,
    })
    return NextResponse.json({ action })
  }

  if (op === 'done') {
    if (typeof body.action_id !== 'string') return NextResponse.json({ error: 'action_id required' }, { status: 400 })
    await markActionStatus(ctx.tenant.id, body.action_id, 'done')
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
}
