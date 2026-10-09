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
export async function POST(req: Request) {
  const session = await getSessionPayload()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const { data: rep } = await supabase
    .from('reps')
    .select('id, tier')
    // Signed slug may be the org's slug or one of its host aliases.
    .or(`slug.eq.${session.slug},host_aliases.cs.{${session.slug}}`)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false }, { status: 404 })
  // Optional form fields: account=<google_tokens row id> disconnects that one
  // account only (multi-calendar); return=<path> is where to land afterwards.
  let accountId: string | null = null
  let retPath = '/dashboard'
  try {
    const form = await req.formData()
    const a = form.get('account')
    if (typeof a === 'string' && /^[0-9a-f-]{36}$/i.test(a)) accountId = a
    const r = form.get('return')
    if (typeof r === 'string' && /^\/dashboard(\/[a-z0-9\-\/]*)?$/i.test(r)) retPath = r
  } catch {}
  if (accountId) {
    await disconnectRep(rep.id, { accountId })
  } else {
    const memberIdToDisconnect =
      rep.tier === 'enterprise' ? session.memberId ?? null : null
    await disconnectRep(rep.id, { memberId: memberIdToDisconnect })
  }
  return NextResponse.redirect(`https://${session.slug}.${ROOT_DOMAIN}${retPath}?gcal=disconnected`, 303)
}
