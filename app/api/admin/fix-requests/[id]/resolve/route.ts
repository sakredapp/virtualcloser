// Mark a fix-request resolved after the fix ships. Dev-only (CRON_SECRET auth).
// Always clears the matching "known limitation" from the education brain; pings
// the reporter ONLY if they directly asked for it (source 'manual').
//
// Usage:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     -H 'Content-Type: application/json' \
//     -d '{"message":"PDF export is live now","notify":true}' \
//     https://<prod>/api/admin/fix-requests/<id>/resolve

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { resolveFixRequest } from '@/lib/feedback/resolveFixRequest'

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
  const body = (await req.json().catch(() => ({}))) as { message?: string; notify?: boolean }
  const result = await resolveFixRequest(id, { message: body.message, notify: body.notify })
  const status = result.ok ? 200 : 404
  return NextResponse.json(result, { status })
}
