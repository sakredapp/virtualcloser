import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { provisionVapiForRep } from '@/lib/voice/vapiProvision'

/**
 * POST /api/admin/vapi-provision
 * Body: { repId: string, force?: boolean }
 *
 * Idempotently provisions Vapi resources (phone number + assistants) for a
 * client. Safe to call repeatedly — re-runs PATCH on existing assistants to
 * sync the latest product/objections/addendum into the Vapi prompt.
 *
 * Pass force:true to delete the saved assistant ids and clone fresh ones.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { repId?: string; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.repId) {
    return NextResponse.json({ error: 'repId required' }, { status: 400 })
  }

  try {
    const result = await provisionVapiForRep(body.repId, {
      forceReprovision: !!body.force,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}
