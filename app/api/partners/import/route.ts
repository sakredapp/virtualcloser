import { NextRequest, NextResponse } from 'next/server'
import { importPartners, partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY, type PartnerInput } from '@/lib/partnersShared'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST { rows: PartnerInput[] } — a CSV or vCard the exec uploaded on the
 * Partners page, already mapped to contact fields in the browser. Dedupes on
 * email, then name + company, inside the signed-in org only. Never called by
 * anything but that upload.
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  if (!(await partnersReady())) return NextResponse.json({ error: PARTNERS_NOT_READY, notReady: true }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { rows?: unknown }
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 })
  if (body.rows.length > 5000) return NextResponse.json({ error: 'That file has more than 5,000 contacts. Split it and import each part.' }, { status: 400 })
  const rows: PartnerInput[] = body.rows
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map((r) => {
      const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null)
      return {
        name: s('name') ?? '',
        org: s('org'),
        role: s('role'),
        kind: (s('kind') ?? 'other') as PartnerInput['kind'],
        on_platform: r.on_platform === true,
        email: s('email'),
        email_secondary: s('email_secondary'),
        email_support: s('email_support'),
        phone: s('phone'),
        phone_office: s('phone_office'),
        phone_office_ext: s('phone_office_ext'),
        website: s('website'),
        address: s('address'),
        notes: s('notes'),
        tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      }
    })
  try {
    const result = await importPartners(ctx.tenant.id, rows, ctx.member.id)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[partners] import', err)
    return NextResponse.json({ error: 'The import stopped partway. Run it again; rows already added are matched, not doubled.' }, { status: 500 })
  }
}
