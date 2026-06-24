/**
 * Arbitrary-window premium summary for the Command Center revenue strip.
 * Backed by the same `pinnacle_window_summary` filters as the Pinnacle
 * dashboard KPI, so the home strip and the Pinnacle page reconcile for the
 * same window. Gated by the same PINNACLE_VIEWER_REP_IDS beta check.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { fetchWindowSummary } from '@/lib/pinnacle/rollup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function allowedRepIds(): Set<string> {
  const raw = process.env.PINNACLE_VIEWER_REP_IDS?.trim()
  if (!raw) return new Set()
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  let tenantId: string
  try {
    const ctx = await requireMember()
    tenantId = ctx.tenant.id
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const allowed = allowedRepIds()
  if (allowed.size > 0 && !allowed.has(tenantId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const start = sp.get('start') ?? ''
  const end = sp.get('end') ?? ''
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: 'start and end must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const summary = await fetchWindowSummary(start, end)
    return NextResponse.json({ summary })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
