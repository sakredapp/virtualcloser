import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { canSeeFinancials } from '@/lib/qbo/access'
import { qboConfig } from '@/lib/qbo/shared'
import { syncQbo } from '@/lib/qbo/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** "Sync now" (exec only). Read-only pull; at most once every 2 minutes. */
export async function POST() {
  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'Sign in again.' }, { status: 401 })
  }
  if (!canSeeFinancials(ctx.member)) return NextResponse.json({ ok: false, error: 'Financials are for the exec team.' }, { status: 403 })
  if (!qboConfig()) return NextResponse.json({ ok: false, error: "QuickBooks isn't set up yet." }, { status: 409 })
  const { data: row } = await supabase.from('cxo_qbo_connections').select('last_sync_at').eq('rep_id', ctx.tenant.id).maybeSingle()
  const last = (row as { last_sync_at?: string | null } | null)?.last_sync_at
  if (last && Date.now() - Date.parse(last) < 2 * 60_000) {
    return NextResponse.json({ ok: true, skipped: 'Synced in the last two minutes.' })
  }
  const res = await syncQbo(ctx.tenant.id)
  if (!res.ok) return NextResponse.json({ ok: false, error: res.skipped === 'not connected' ? 'QuickBooks is not connected.' : 'QuickBooks did not answer. Try again in a minute.' }, { status: 502 })
  return NextResponse.json({ ok: true, months: res.months })
}
