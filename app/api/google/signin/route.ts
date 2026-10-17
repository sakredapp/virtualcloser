import { NextRequest, NextResponse } from 'next/server'
import { buildAuthUrl, oauthClientFor } from '@/lib/google'
import { requireSessionSecret } from '@/lib/client-auth'
import { getTenantBySlug } from '@/lib/tenant'
import { getBrand, listBrands } from '@/lib/brand'
import { generateNonce } from '@/lib/random'
import { inboxAllowed } from '@/lib/cxoFeatures'
import {
  SIGNIN_COOKIE_PATH,
  SIGNIN_NONCE_COOKIE,
  SIGNIN_TTL_MS,
  safeLoginHost,
  safeNextUrl,
  signSignInState,
} from '@/lib/google/signin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sign in with Google, step 1 (lib/google/signin.ts). Public: the person is
 * not signed in yet. ?t=<company host> &from=<login page host> &next=<url>.
 *
 * Only for a company that saved its OWN Google client; anyone else is sent
 * back to the password form. Google returns to the one registered callback
 * (/api/google/oauth/callback), which finishes the sign-in.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const roots = listBrands().map((b) => b.rootDomain)
  const reqHost = (req.headers.get('host') ?? '').split(':')[0].toLowerCase()
  const loginHost = safeLoginHost(url.searchParams.get('from'), roots) ?? safeLoginHost(reqHost, roots) ?? reqHost
  const next = safeNextUrl(url.searchParams.get('next'), roots)

  const back = (error: string) => {
    const u = new URL(`https://${loginHost}/login`)
    u.searchParams.set('error', error)
    if (next) u.searchParams.set('next', next)
    return NextResponse.redirect(u.toString())
  }

  const slug = String(url.searchParams.get('t') ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]{1,63}$/.test(slug)) return back('google_unavailable')
  const tenant = await getTenantBySlug(slug).catch(() => null)
  if (!tenant) return back('google_unavailable')
  const client = await oauthClientFor(tenant.id)
  // Only a company's own client: the global one has no list of who may sign in.
  if (!client || client.source !== 'tenant') return back('google_unavailable')

  const nonce = generateNonce(16) // 32 hex chars
  const state = signSignInState({ repId: tenant.id, loginHost, next, nonce }, { secret: requireSessionSecret() })
  // Same scopes as Connect Google: one click signs in AND connects.
  const gmail = inboxAllowed(tenant as { id: string; brand?: string | null })
  const res = NextResponse.redirect(buildAuthUrl(state, { selectAccount: true, gmail }, client))

  // The nonce lives only in this browser, only for the callback, ten minutes.
  // Shared across the brand root so a start on a company host still reaches
  // the callback on the apex.
  const brandRoot = getBrand((tenant as { brand?: string | null }).brand).rootDomain
  const onRoot = reqHost === brandRoot || reqHost.endsWith(`.${brandRoot}`)
  res.cookies.set(SIGNIN_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: SIGNIN_COOKIE_PATH,
    maxAge: Math.floor(SIGNIN_TTL_MS / 1000),
    ...(onRoot ? { domain: `.${brandRoot}` } : {}),
  })
  res.headers.set('cache-control', 'no-store')
  return res
}
