import { NextRequest, NextResponse } from 'next/server'
import { partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { createPartnerDraft, getPartner, senderStatus } from '@/lib/partners'
import { asReportLine, asWindow, composePartnerReport } from '@/lib/partnerReport'
import { Loader } from '@/lib/mcp/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST → a saved draft (status=draft) on cxo_partner_actions.
 *   { kind: 'report', items: [{line, window}], intro?, closing? }  Mira writes it from live rollups
 *   { kind: 'email' | 'note', subject, body }                        the exec's own words
 */
export async function POST(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  if (!(await partnersReady())) return NextResponse.json({ error: PARTNERS_NOT_READY, notReady: true }, { status: 503 })
  const { id } = await params
  const partner = await getPartner(ctx.tenant.id, id)
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const kind = body.kind === 'report' ? 'report' : body.kind === 'note' ? 'note' : 'email'
  const company = ctx.tenant.company || ctx.tenant.display_name

  let subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  let text = typeof body.body === 'string' ? body.body.trim().slice(0, 8000) : ''
  let missing: string[] = []
  let dataThrough: string | null = null
  if (kind === 'report') {
    const itemsRaw = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : []
    const items = itemsRaw.map((it) => ({ line: asReportLine(it.line), window: asWindow(it.window) }))
    if (items.length === 0) return NextResponse.json({ error: 'Pick at least one line and period.' }, { status: 400 })
    const r = await composePartnerReport(new Loader(ctx.tenant), partner, { items, intro: typeof body.intro === 'string' ? body.intro : null, closing: typeof body.closing === 'string' ? body.closing : null }, { name: ctx.member.display_name, company })
    subject = subject || r.subject
    text = r.body
    missing = r.missing
    dataThrough = r.data_through
  } else if (!text) {
    return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
  }
  if (!subject) subject = kind === 'note' ? `Note from ${ctx.member.display_name}` : `From ${ctx.member.display_name}, ${company}`

  // Saves the row AND a draft in the exec's Gmail Drafts when Google is connected.
  const action = await createPartnerDraft({
    repId: ctx.tenant.id,
    memberId: ctx.member.id,
    partnerId: partner.id,
    kind,
    subject,
    body: text,
    to: partner.email,
    senderName: ctx.member.display_name,
    senderEmail: ctx.member.email,
    fromAccount: typeof body.from_account === 'string' ? body.from_account : null,
    createdBy: ctx.member.id,
  })
  const sender = await senderStatus(ctx.tenant.id, ctx.member.id, ctx.member.display_name)
  return NextResponse.json({ draft: action, subject, body: text, missing, data_through: dataThrough, sender })
}
