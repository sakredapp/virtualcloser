/**
 * Sign-in for the Suite CXO phone app (Expo, no WebView, no cookies).
 *
 * Same rules as the web sign-in (app/login/page.tsx): member password first,
 * then the legacy owner password on the reps row; the session is signed with
 * the canonical tenant slug and is valid on the member's home host plus the
 * org's hosts. What differs: the signed token is handed back as JSON, and the
 * app sends it as `Authorization: Bearer <token>` on its /api calls
 * (lib/client-auth.ts bearerSessionToken + middleware).
 *
 * The app is for executives of a Suite CXO account (or Pinnacle's book). An
 * employee-only login, a Virtual Closer account, or a first sign-in that still
 * owes a new password are told plainly what to do, never let in half way.
 */
import { supabase } from '@/lib/supabase'
import { sessionHostsFor, signSession } from '@/lib/client-auth'
import { verifyPassword } from '@/lib/client-password'
import { findMemberByEmailGlobal, recordMemberLogin } from '@/lib/members'
import { memberHomeHost, type Tenant } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { canonicalHost } from '@/lib/hostRenames'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { pinnacleAllowed } from '@/lib/pinnacle/access'

export const NATIVE_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export type NativeSignInOk = {
  ok: true
  token: string
  /** Full host the app calls, e.g. "mike.suitecxo.com". */
  host: string
  expiresAt: string
  name: string
  email: string
  role: string | null
  company: string
  /** True when this account reads the Pinnacle book (Revenue + Team show the book). */
  pinnacle: boolean
}
export type NativeSignInFail = { ok: false; status: 400 | 401 | 403; error: string }

const INVALID: NativeSignInFail = { ok: false, status: 401, error: 'That email and password do not match.' }

type TenantRow = Tenant & { password_hash: string | null; brand?: BrandKey }

function isSuiteTenant(t: TenantRow): boolean {
  return getBrand(t.brand ?? 'virtualcloser').tabPreset === 'executive' || isPinnacleViewer(t.id)
}

export async function nativeSignIn(emailRaw: unknown, passwordRaw: unknown): Promise<NativeSignInOk | NativeSignInFail> {
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : ''
  const password = typeof passwordRaw === 'string' ? passwordRaw : ''
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return { ok: false, status: 400, error: 'Enter your email and password.' }
  }

  const member = await findMemberByEmailGlobal(email)
  let tenant: TenantRow | null = null

  if (member && member.password_hash) {
    if (!(await verifyPassword(password, member.password_hash))) return INVALID
    const { data, error } = await supabase.from('reps').select('*').eq('id', member.rep_id).eq('is_active', true).maybeSingle()
    if (error || !data) return INVALID
    tenant = data as TenantRow
  } else {
    const { data, error } = await supabase.from('reps').select('*').ilike('email', email).eq('is_active', true).maybeSingle()
    if (error || !data) return INVALID
    const row = data as TenantRow
    if (!(await verifyPassword(password, row.password_hash))) return INVALID
    tenant = row
  }

  if (!isSuiteTenant(tenant)) {
    return { ok: false, status: 403, error: 'This app is for Suite CXO accounts. Sign in on the web instead.' }
  }
  const memberId = member && member.password_hash ? member.id : null
  if (member && memberId && isEmployeeOnlyMember(member, tenant)) {
    return { ok: false, status: 403, error: 'Your login opens your own page on the web. Sign in at suitecxo.com.' }
  }
  // The web makes a first sign-in pick a new password before anything else.
  if (member && memberId && !member.last_login_at && member.role !== 'assistant') {
    return { ok: false, status: 403, error: 'Set your password first: open the link in your invite email, then sign in here.' }
  }

  const home = memberHomeHost(tenant, member && memberId ? member.home_subdomain : null)
  const token = await signSession(tenant.slug, {
    memberId,
    hosts: sessionHostsFor(tenant, home),
    ttlMs: NATIVE_SESSION_TTL_MS,
  })
  if (memberId) await recordMemberLogin(memberId).catch(() => {})
  await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)

  const root = getBrand(tenant.brand ?? 'cxo').rootDomain
  return {
    ok: true,
    token,
    host: `${canonicalHost(home)}.${root}`,
    expiresAt: new Date(Date.now() + NATIVE_SESSION_TTL_MS).toISOString(),
    name: member?.display_name || tenant.display_name || email,
    email,
    role: member?.role ?? 'owner',
    company: tenant.display_name,
    pinnacle: pinnacleAllowed(tenant.id),
  }
}
