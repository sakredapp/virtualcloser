import { NextResponse } from 'next/server'
import { disconnectRep } from '@/lib/google'
import { getSessionPayload } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

// Disconnects the caller's Google connection. For enterprise members we
// only delete their per-member row, leaving any tenant-level fallback (and
// other members' connections) untouched. Individual tier always disconnects
// the tenant-level row — that's where their connection lives.
export async function POST() {
  const session = await getSessionPayload()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const { data: rep } = await supabase
    .from('reps')
    .select('id, tier')
    .eq('slug', session.slug)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false }, { status: 404 })
  const memberIdToDisconnect =
    rep.tier === 'enterprise' ? session.memberId ?? null : null
  await disconnectRep(rep.id, { memberId: memberIdToDisconnect })
  return NextResponse.redirect(`https://${session.slug}.${ROOT_DOMAIN}/dashboard?gcal=disconnected`, 303)
}
