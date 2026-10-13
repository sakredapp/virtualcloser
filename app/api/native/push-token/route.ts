/**
 * The store app posts the phone's push token here after the member signs in
 * and allows notifications. Stored per member so a later sender can reach
 * that phone. Nothing sends a push yet; this only keeps the address.
 *
 * Quiet by design: a signed-out call, a bad body or a database that does not
 * have the table yet (supabase/cxo_native_push_tokens.sql) all answer 204,
 * so the app never shows an error for it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PLATFORMS = new Set(['ios', 'android'])

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown; platform?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const platform = typeof body?.platform === 'string' ? body.platform : ''
  if (!token || token.length > 4096 || !PLATFORMS.has(platform)) return new NextResponse(null, { status: 204 })

  try {
    await supabase.from('cxo_native_push_tokens').upsert(
      {
        token,
        platform,
        rep_id: ctx.tenant.id,
        member_id: ctx.member.id,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    )
  } catch {
    // Table not created yet, or the database is unreachable: the app sends again on its next open.
  }
  return new NextResponse(null, { status: 204 })
}
