/**
 * On-demand breakdown for the Pinnacle dashboard. The breakdown tables
 * (team/agent/carrier/state/product) are too high-cardinality to ship in
 * the initial page payload, so the client fetches them here whenever the
 * tab / timeframe / line changes.
 *
 * Gated by the same PINNACLE_VIEWER_REP_IDS beta check as the page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { fetchBreakdown, BREAKDOWN_DIMS, type BreakdownDim } from '@/lib/pinnacle/rollup'

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
  const dim = sp.get('dim') as BreakdownDim | null
  const line = sp.get('line') ?? 'All'
  const start = sp.get('start') ?? ''
  const end = sp.get('end') ?? ''

  if (!dim || !BREAKDOWN_DIMS.includes(dim)) {
    return NextResponse.json({ error: `dim must be one of ${BREAKDOWN_DIMS.join(', ')}` }, { status: 400 })
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: 'start and end must be YYYY-MM-DD' }, { status: 400 })
  }
  if (!['All', 'Health', 'Life', 'Annuity'].includes(line)) {
    return NextResponse.json({ error: 'invalid line' }, { status: 400 })
  }

  try {
    const rows = await fetchBreakdown(dim, line, start, end, 25)
    return NextResponse.json({ rows })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
