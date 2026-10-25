// Tell the member who filed a fix-request that work started, or give them a
// progress note, at the pace they chose (lib/feedback/fixRequestUpdates.ts).
// Dev-only (CRON_SECRET auth), the twin of ../resolve which sends "done".
//
// Usage:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     -H 'Content-Type: application/json' \
//     -d '{"kind":"started","note":"Looking at the export button now"}' \
//     https://<prod>/api/admin/fix-requests/<id>/update
//
// `note` is the client-facing "Customer note:" (plain words, no internals).
// A progress note is skipped when their pace says so (start_done never,
// daily once a day); the answer says why.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { sendFixRequestUpdate } from '@/lib/feedback/fixRequestUpdates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { kind?: string; note?: string }
  if (body.kind !== 'started' && body.kind !== 'progress') {
    return NextResponse.json({ error: 'kind must be "started" or "progress" (use ../resolve for done)' }, { status: 400 })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
  if (body.kind === 'progress' && !note) return NextResponse.json({ error: 'a progress update needs a note' }, { status: 400 })
  const result = await sendFixRequestUpdate(id, body.kind, note)
  return NextResponse.json(result, { status: result.reason === 'not_found' ? 404 : 200 })
}
