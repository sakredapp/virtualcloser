import { NextRequest, NextResponse } from 'next/server'
import { partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { asKind, createPartner, listPartners, PARTNER_KINDS, type PartnerInput, type PartnerKind } from '@/lib/partners'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  if (!(await partnersReady())) return NextResponse.json({ items: [], notReady: true, message: PARTNERS_NOT_READY })
  const sp = req.nextUrl.searchParams
  const kindRaw = sp.get('kind')
  const kind = kindRaw && (PARTNER_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as PartnerKind) : undefined
  const items = await listPartners(ctx.tenant.id, { q: sp.get('q') ?? undefined, kind })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  if (!(await partnersReady())) return NextResponse.json({ error: PARTNERS_NOT_READY, notReady: true }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as Partial<PartnerInput>
  try {
    const partner = await createPartner(ctx.tenant.id, {
      name: String(body.name ?? ''),
      org: body.org ?? null,
      role: body.role ?? null,
      kind: asKind(body.kind),
      email: body.email ?? null,
      phone: body.phone ?? null,
      notes: body.notes ?? null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      owner_member_id: ctx.member.id,
    })
    return NextResponse.json({ partner })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not add partner.' }, { status: 400 })
  }
}
