import { NextRequest, NextResponse } from 'next/server'
import { partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { asKind, createPartner, listPartners, PARTNER_KINDS, type PartnerInput, type PartnerKind } from '@/lib/partners'
import { CONTACT_TYPES, DIRECTORY_SCOPES, type ContactType, type DirectoryScope } from '@/lib/partnersShared'

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
  const typeRaw = sp.get('type')
  // ?type= is the directory filter (executive | carrier | vendor | other, where
  // other also covers the older agency/board/producer kinds); ?kind= is exact.
  const type = typeRaw && (CONTACT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as ContactType) : undefined
  const kind = !type && kindRaw && (PARTNER_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as PartnerKind) : undefined
  // ?scope=execs | partners: which directory page is asking.
  const scopeRaw = sp.get('scope')
  const scope = scopeRaw && (DIRECTORY_SCOPES as readonly string[]).includes(scopeRaw) ? (scopeRaw as DirectoryScope) : undefined
  try {
    // Scoped to the signed-in org (ctx.tenant.id), never to anything in the request.
    const items = await listPartners(ctx.tenant.id, { q: sp.get('q') ?? undefined, kind, type, scope })
    return NextResponse.json({ items })
  } catch (err) {
    console.error('[partners] list', err)
    return NextResponse.json({ items: [], notReady: !(await partnersReady()), message: PARTNERS_NOT_READY })
  }
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
      on_platform: body.on_platform === true,
      email_secondary: body.email_secondary ?? null,
      email_support: body.email_support ?? null,
      phone_office: body.phone_office ?? null,
      phone_office_ext: body.phone_office_ext ?? null,
      website: body.website ?? null,
      address: body.address ?? null,
      owner_member_id: ctx.member.id,
    })
    return NextResponse.json({ partner })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not add partner.' }, { status: 400 })
  }
}
