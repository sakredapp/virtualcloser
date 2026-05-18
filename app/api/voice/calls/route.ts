// List voice calls for the current tenant — drives the dashboard recordings
// + transcript view.

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { enforceRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-tenant list throttle. limit param can be up to 200 records, so a
// session hammering this endpoint can siphon a large window of call
// history fast — 60/min is plenty for legit dashboard polling.
const CALLS_LIST_LIMIT = 60
const CALLS_LIST_WINDOW_SEC = 60

export async function GET(req: Request) {
  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rl = await enforceRateLimit(`voice:calls:${tenant.id}`, CALLS_LIST_LIMIT, CALLS_LIST_WINDOW_SEC)
  if (!rl.allowed) return rateLimitResponse(rl)

  const url = new URL(req.url)
  const meetingId = url.searchParams.get('meeting_id')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200)

  let q = supabase
    .from('voice_calls')
    .select('*')
    .eq('rep_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (meetingId) q = q.eq('meeting_id', meetingId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, calls: data ?? [] })
}
