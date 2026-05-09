import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { signSession } from '@/lib/client-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
const COOKIE_NAME = 'vc_session'
const TTL_MS = 1000 * 60 * 60 * 4 // 4 hours

// GET /api/admin/impersonate?rep_id=xxx
// Signs a short-lived client session and redirects into their portal.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const repId = req.nextUrl.searchParams.get('rep_id')
  if (!repId) {
    return NextResponse.json({ error: 'rep_id required' }, { status: 400 })
  }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug, is_active')
    .eq('id', repId)
    .maybeSingle()

  if (!rep) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })

  const { data: member } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', repId)
    .eq('role', 'owner')
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'no_owner_member' }, { status: 404 })

  const token = await signSession(rep.slug as string, {
    memberId: member.id as string,
    ttlMs: TTL_MS,
  })

  const portalUrl = `https://${rep.slug}.${ROOT}/dashboard`

  const res = NextResponse.redirect(portalUrl)
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    domain: `.${ROOT}`,
    maxAge: Math.floor(TTL_MS / 1000),
  })

  return res
}
