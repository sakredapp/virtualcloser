/**
 * POST /api/ops/private-server/report
 *
 * A client's private server checks in here every minute (selfhost/health/
 * agent.mjs, HEALTH_REPORT_URL). Body: the agent's health result
 * { box, at, ok, checks: [{ name, ok, ms, detail?, error? }] }. Auth: the box's
 * licence as the bearer (lib/privateServerReport.ts). Upserts one row per box
 * in private_server_boxes; read the fleet from the view private_server_box_status.
 *
 * Ours only: a client box itself answers 404 here (SELFHOST=1).
 */
import { NextRequest, NextResponse } from 'next/server'
import { parseBoxReport } from '@/lib/privateServerReport'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BYTES = 16_384

export async function POST(req: NextRequest) {
  if (process.env.SELFHOST === '1') return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: NO_STORE })
  const text = await req.text()
  if (text.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413, headers: NO_STORE })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400, headers: NO_STORE })
  }
  const parsed = parseBoxReport(req.headers.get('authorization'), body)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status, headers: NO_STORE })

  const { error } = await supabase.from('private_server_boxes').upsert(parsed.row, { onConflict: 'box_id' })
  if (error) {
    console.error('[ops/private-server/report]', error.message)
    return NextResponse.json({ ok: false, error: 'store_failed' }, { status: 503, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true, box: parsed.row.box_id, status: parsed.row.status }, { headers: NO_STORE })
}
