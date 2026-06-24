// "Request a change / report an issue" — captures product feedback that needs
// a human code fix into fix_requests. Surfaced to the developer in the daily
// digest email (app/api/cron/fix-digest). Any authenticated member can file.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { logFixRequest, type FixRequestSeverity } from '@/lib/feedback/fixRequests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SEVERITIES: FixRequestSeverity[] = ['low', 'normal', 'high']

export async function POST(req: NextRequest) {
  const ctx = await requireMember().catch(() => null)
  if (!ctx) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    body?: string
    area?: string
    severity?: string
  }
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ ok: false, error: 'description required' }, { status: 400 })

  const severity = (SEVERITIES as string[]).includes(body.severity ?? '')
    ? (body.severity as FixRequestSeverity)
    : 'normal'

  const row = await logFixRequest({
    repId: ctx.tenant.id,
    memberId: ctx.member?.id ?? null,
    source: 'manual',
    body: text,
    area: typeof body.area === 'string' ? body.area : null,
    severity,
    createdBy: ctx.member?.display_name ?? null,
  })
  if (!row) return NextResponse.json({ ok: false, error: 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, id: row.id })
}
