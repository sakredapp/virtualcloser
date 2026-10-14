/**
 * Meetings for the phone app: today's calendar (null = no calendar
 * connected) and the newest meeting notes with what Ciao took from each
 * (mira_digest). Transcripts stay on the web; the phone shows the summary,
 * decisions and follow-ups. Scoped to the signed-in account, never the request,
 * and to notes that are shared or this member's own (same rule as /api/today).
 */
import { NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { supabase } from '@/lib/supabase'
import { todaysMeetings } from '@/lib/today'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLS = 'id, title, summary, action_items, occurred_at, duration_seconds, mira_digest'

export async function GET() {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (e) {
    if (e instanceof NotExec) return NextResponse.json({ error: 'This app is for the executive team.' }, { status: 403 })
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  }
  const { tenant, member } = ctx
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  const [notes, today] = await Promise.all([
    supabase.from('plaud_notes').select(COLS).eq('rep_id', tenant.id).or(`owner_member_id.is.null,owner_member_id.eq.${member.id}`).order('occurred_at', { ascending: false }).limit(50),
    todaysMeetings(tenant.id, member.id, tz).catch(() => null),
  ])
  return NextResponse.json(
    { timezone: tz, today, notes: notes.error ? [] : (notes.data ?? []) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
