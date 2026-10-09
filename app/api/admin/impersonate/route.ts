import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { signSession, sessionHostsFor } from '@/lib/client-auth'
import { canonicalHost } from '@/lib/hostRenames'
import { logError } from '@/lib/errors'
import { brandFromHost } from '@/lib/brand'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COOKIE_NAME = 'vc_session'
const TTL_MS = 1000 * 60 * 60 * 4 // 4 hours

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || null
  return req.headers.get('x-real-ip')
}

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
    .select('id, slug, is_active, host_aliases')
    .eq('id', repId)
    .maybeSingle()

  if (!rep) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })
  // Deactivated tenants shouldn't be impersonated — the dashboard would
  // otherwise be reachable for accounts that have been cancelled, churned,
  // or paused for collections. Forces admin to reactivate first.
  if (!rep.is_active) {
    return NextResponse.json({ error: 'client_inactive' }, { status: 403 })
  }

  // The ACTIVE owner, never a deactivated ex-owner. Oldest first and limit 1
  // so a second active owner can't make this fail.
  const { data: member } = await supabase
    .from('members')
    .select('id, home_subdomain')
    .eq('rep_id', repId)
    .eq('role', 'owner')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'no_owner_member' }, { status: 404 })

  // Same cookie shape as a real login: valid on the owner's home host, the
  // org slug and its aliases, landing on the home host.
  const hosts = sessionHostsFor(
    { slug: rep.slug as string, host_aliases: (rep as { host_aliases?: string[] | null }).host_aliases ?? null },
    (member as { home_subdomain?: string | null }).home_subdomain ?? null,
  )
  const token = await signSession(rep.slug as string, {
    memberId: member.id as string,
    ttlMs: TTL_MS,
    hosts,
  })

  // Land the portal on the brand root we are ACTUALLY serving from (the admin
  // is on www.suitecxo.com, so the portal is <slug>.suitecxo.com). The old
  // hardcoded ROOT_DOMAIN sent CXO clients to <slug>.virtualcloser.com, a host
  // this deployment no longer serves (404 DEPLOYMENT_NOT_FOUND), and scoped the
  // cookie to .virtualcloser.com where the browser dropped it.
  const reqHost = (req.headers.get('x-tenant-host') || req.headers.get('host') || '')
    .split(':')[0]
    .toLowerCase()
  const ROOT = brandFromHost(reqHost).rootDomain
  const portalUrl = `https://${canonicalHost(hosts[0] || (rep.slug as string))}.${ROOT}/dashboard`

  // Audit log: every impersonation lands in app_errors with severity='warn'
  // and a stable source so /admin/errors can filter for them. This is the
  // single record of "an admin took over rep X at time Y" — required for
  // accountability since the admin password is shared.
  await logError({
    source: 'audit/admin-impersonate',
    errorType: 'admin_impersonation',
    severity: 'warn',
    message: `Admin impersonated rep ${rep.slug}`,
    repId: rep.id as string,
    memberId: member.id as string,
    context: {
      rep_slug: rep.slug,
      member_id: member.id,
      ttl_hours: 4,
      ip: clientIp(req),
      user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
    },
  })

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
