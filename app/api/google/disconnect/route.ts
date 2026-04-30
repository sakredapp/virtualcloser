import { NextResponse } from 'next/server'
import { disconnectRep } from '@/lib/google'
import { getSessionPayload } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

// Disconnects the caller's Google connection. For enterprise members we
// only delete their per-member row, leaving any tenant-level fallback (and
// other members' connections) untouched.
export async function POST() {
  const session = await getSessionPayload()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const { data: rep } = await supabase
    .from('reps')
    .select('id')
    .eq('slug', session.slug)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false }, { status: 404 })
  await disconnectRep(rep.id, { memberId: session.memberId ?? null })
  return NextResponse.redirect(`https://${session.slug}.${ROOT_DOMAIN}/dashboard?gcal=disconnected`, 303)
}
