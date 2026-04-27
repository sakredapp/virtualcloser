import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { updateMember } from '@/lib/members'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Browser-detected timezone POSTed once when the dashboard loads. We only
 * write it if:
 *   - the caller doesn't already have a timezone set, OR
 *   - the caller's timezone is the legacy 'UTC' default and the browser
 *     reports something more specific.
 * This means an explicit /timezone command from Telegram always wins.
 *
 * If the caller is the owner and the tenant timezone is null/UTC, we mirror
 * the value onto the tenant too so legacy accounts stop defaulting to UTC.
 */
export async function POST(req: NextRequest) {
  let body: { timezone?: string } = {}
  try {
    body = (await req.json()) as { timezone?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }
  const tz = (body.timezone ?? '').trim()
  if (!tz) return NextResponse.json({ ok: false, error: 'missing timezone' }, { status: 400 })

  // Validate the IANA name.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid timezone' }, { status: 400 })
  }

  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { tenant, member } = ctx

  const memberHasTz = !!member.timezone && member.timezone !== 'UTC'
  if (!memberHasTz) {
    await updateMember(member.id, { timezone: tz })
  }

  if (member.role === 'owner' && (!tenant.timezone || tenant.timezone === 'UTC')) {
    try {
      await supabase.from('reps').update({ timezone: tz }).eq('id', tenant.id)
    } catch (err) {
      console.error('[me/timezone] tenant backfill failed', err)
    }
  }

  return NextResponse.json({ ok: true, applied: !memberHasTz, timezone: tz })
}
