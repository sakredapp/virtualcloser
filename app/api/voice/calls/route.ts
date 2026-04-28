// List voice calls for the current tenant — drives the dashboard recordings
// + transcript view.

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
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
