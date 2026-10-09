import { NextResponse } from 'next/server'
import { disconnectRep } from '@/lib/google'
import { getSessionPayload, sessionHomeHost } from '@/lib/client-auth'
import { getBrand } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { getMemberById, getOwnerMember } from '@/lib/members'
import { ownsGoogleAccount } from '@/lib/googleAccountOwner'

export const dynamic = 'force-dynamic'

// Disconnects the caller's OWN Google connection. Only the member who owns a
// connection may remove it (owner 10-09): a member's row belongs to that
// member, the tenant-level row (member_id null) belongs to the workspace
// owner. Admin rights do not reach another person's calendar; a request for
// an account the caller does not own is refused with 403 and deletes nothing.
export async function POST(req: Request) {
  const session = await getSessionPayload()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const { data: rep } = await supabase
    .from('reps')
    .select('id, tier, brand')
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
  // The caller: the signed member, or the owner for a legacy slug-only cookie
  // (same rule as getCurrentMember).
  const viewer = session.memberId
    ? await getMemberById(session.memberId)
    : await getOwnerMember(rep.id)
  if (!viewer || !viewer.is_active || viewer.rep_id !== rep.id) {
    return NextResponse.json({ ok: false }, { status: 403 })
  }
  if (accountId) {
    const { data: row } = await supabase
      .from('google_tokens')
      .select('id, member_id')
      .eq('rep_id', rep.id)
      .eq('id', accountId)
      .maybeSingle()
    if (!row) return NextResponse.json({ ok: false }, { status: 404 })
    const memberId = (row as { member_id: string | null }).member_id
    if (!ownsGoogleAccount({ memberId }, viewer)) {
      return NextResponse.json({ ok: false, error: 'Only the person who connected this calendar can disconnect it.' }, { status: 403 })
    }
    await disconnectRep(rep.id, { accountId })
  } else {
    // No account named: remove the caller's own connection. Enterprise keeps
    // per-member rows; elsewhere the owner's lives at tenant level and every
    // other member's under their own id.
    const ownMemberId =
      rep.tier === 'enterprise'
        ? session.memberId ?? null
        : viewer.role === 'owner'
          ? null
          : viewer.id
    await disconnectRep(rep.id, { memberId: ownMemberId })
  }
  const brandRoot = getBrand((rep as { brand?: string }).brand).rootDomain
  return NextResponse.redirect(`https://${sessionHomeHost(session)}.${brandRoot}${retPath}?gcal=disconnected`, 303)
}
