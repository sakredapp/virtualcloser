import { NextRequest, NextResponse } from 'next/server'
import { GoogleAccountLimitError, exchangeCode, oauthClientFor, saveTokens } from '@/lib/google'
import {
  SESSION_COOKIE_NAME,
  getSessionPayload,
  requireSessionSecret,
  sessionHomeHost,
  sessionHostsFor,
  signSession,
  type SessionPayload,
} from '@/lib/client-auth'
import { getBrand, listBrands } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { appReturnLink, ticketFromState, verifyNativeTicket } from '@/lib/nativeTicket'
import { memberHomeHost, type Tenant } from '@/lib/tenant'
import { recordMemberLogin } from '@/lib/members'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import {
  SIGNIN_COOKIE_PATH,
  SIGNIN_NONCE_COOKIE,
  SIGNIN_STATE_PREFIX,
  checkIdToken,
  googleTokenSlot,
  pickSignInMember,
  readIdTokenClaims,
  safeLoginHost,
  safeNextUrl,
  verifySignInState,
} from '@/lib/google/signin'
import type { Member } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  const err = url.searchParams.get('error')

  // "Sign in with Google" (lib/google/signin.ts) shares this one registered
  // redirect. It has no session yet, so it is handled before the session check.
  if (state.startsWith(SIGNIN_STATE_PREFIX)) return finishGoogleSignIn(req, { code, state, err })

  // Started from the Suite CXO store app: the phone's browser has no session
  // cookie, and the member comes from the pass the app put in `state`
  // (lib/nativeTicket.ts). The result is handed back to the app, not shown here.
  const ticket = verifyNativeTicket(ticketFromState(state))
  const cookieSession = ticket ? null : await getSessionPayload()
  const session: SessionPayload | null = ticket
    ? { slug: ticket.slug, memberId: ticket.memberId, exp: ticket.exp, hosts: [ticket.home], scope: null }
    : cookieSession
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  const finish = (target: string) => {
    if (!ticket) return NextResponse.redirect(target)
    const u = new URL(target)
    return backToApp(appReturnLink(ticket.home, `${u.pathname}${u.search}`), u.searchParams.get('gcal') === 'connected')
  }

  // State format: repId:memberId-or-empty:nonce[:flags]; flags = add|ret=<path>
  const flagPart = state.split(':')[3] ?? ''
  const addAccount = flagPart.split('|').includes('add')
  const retRaw = flagPart.split('|').find((f) => f.startsWith('ret='))?.slice(4) ?? ''
  const retPath = (() => {
    try {
      const p = decodeURIComponent(retRaw)
      return /^\/dashboard(\/[a-z0-9\-\/]*)?$/i.test(p) ? p : '/dashboard'
    } catch {
      return '/dashboard'
    }
  })()

  // State format: repId:memberId-or-empty:nonce
  const stateParts = state.split(':')
  const repIdFromState = stateParts[0] ?? ''
  // Tolerate the legacy 2-part state (repId:nonce) — second segment is the
  // nonce in that case (32 chars), not a member uuid (36 chars with dashes).
  const memberIdFromState =
    stateParts.length >= 3 && stateParts[1] && stateParts[1].includes('-')
      ? stateParts[1]
      : null

  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug, tier, brand')
    // Signed slug may be the org's slug or one of its host aliases.
    .or(`slug.eq.${session.slug},host_aliases.cs.{${session.slug}}`)
    .eq('is_active', true)
    .maybeSingle()
  // Land back on the member's own host under the tenant's brand root (a CXO
  // member goes to <home>.suitecxo.com, not virtualcloser.com).
  const brandRoot = getBrand((rep as { brand?: string } | null)?.brand).rootDomain
  const dashHost = `https://${sessionHomeHost(session)}.${brandRoot}${retPath}`

  if (err || !code) {
    return finish(`${dashHost}?gcal=error`)
  }
  if (!rep || (repIdFromState && repIdFromState !== rep.id)) {
    return finish(`${dashHost}?gcal=error`)
  }
  // Cross-check the member ID in state against the session — if they don't
  // match, someone replayed an OAuth start link from a different login.
  if (memberIdFromState && session.memberId && memberIdFromState !== session.memberId) {
    return finish(`${dashHost}?gcal=error`)
  }

  // Per-account storage.
  //   • The OWNER's connection is stored at tenant level (member_id=null).
  //     Backend paths (cron hydrator, AI dialer reschedule, Sheets CRM mirror)
  //     look up tokens with NO member context, so the owner's account must live
  //     there for those to keep working.
  //   • Every NON-owner member (e.g. an exec's assistant) stores their OWN
  //     account under their member_id, so each person gets a separate
  //     inbox/calendar/sheets that the UI can switch between.
  //   • Enterprise keeps its existing per-member behavior unchanged.
  const connectingMemberId = memberIdFromState ?? session.memberId ?? null
  let memberIdForSave: string | null
  if (rep.tier === 'enterprise') {
    memberIdForSave = connectingMemberId
  } else {
    let isOwner = true // no member context → treat as tenant/owner-level
    if (connectingMemberId) {
      const { data: m } = await supabase
        .from('members')
        .select('role')
        .eq('id', connectingMemberId)
        .maybeSingle()
      isOwner = (m as { role?: string } | null)?.role === 'owner'
    }
    memberIdForSave = isOwner ? null : connectingMemberId
  }

  try {
    // Same client that built the consent URL (tenant's own, else global).
    const tokens = await exchangeCode(code, await oauthClientFor(rep.id))
    let email: string | null = null
    if (tokens.id_token) {
      try {
        const [, payload] = tokens.id_token.split('.')
        const json = JSON.parse(
          Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
        ) as { email?: string }
        email = json.email ?? null
      } catch {}
    }
    await saveTokens({
      repId: rep.id,
      memberId: memberIdForSave,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresInSec: tokens.expires_in,
      email,
      scope: tokens.scope ?? null,
      newAccount: addAccount,
      consent: true,
    })
    return finish(`${dashHost}?gcal=connected`)
  } catch (e) {
    if (e instanceof GoogleAccountLimitError) {
      return finish(`${dashHost}?gcal=limit`)
    }
    console.error('[google oauth callback] failed', e)
    return finish(`${dashHost}?gcal=error`)
  }
}

/**
 * Sign in with Google, step 2. Never creates an account: the verified Google
 * email must be an active member of the company the sign-in started for.
 */
async function finishGoogleSignIn(
  req: NextRequest,
  input: { code: string | null; state: string; err: string | null },
): Promise<NextResponse> {
  const roots = listBrands().map((b) => b.rootDomain)
  const reqHost = (req.headers.get('host') ?? '').split(':')[0].toLowerCase()
  const nonceCookie = req.cookies.get(SIGNIN_NONCE_COOKIE)?.value ?? null
  const clearNonce = (res: NextResponse) => {
    const onRoot = roots.find((r) => reqHost === r || reqHost.endsWith(`.${r}`))
    res.cookies.set(SIGNIN_NONCE_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: SIGNIN_COOKIE_PATH,
      maxAge: 0,
      ...(onRoot ? { domain: `.${onRoot}` } : {}),
    })
    res.headers.set('cache-control', 'no-store')
    return res
  }

  const check = verifySignInState(input.state, { secret: requireSessionSecret(), cookieNonce: nonceCookie })
  if (!check.ok) {
    console.warn('[google signin] state rejected', check.reason)
    const host = safeLoginHost(reqHost, roots) ?? reqHost
    return clearNonce(NextResponse.redirect(`https://${host}/login?error=google_expired`))
  }
  const st = check.state
  const loginHost = safeLoginHost(st.loginHost, roots) ?? reqHost
  const next = safeNextUrl(st.next, roots)
  const back = (error: string) => {
    const u = new URL(`https://${loginHost}/login`)
    u.searchParams.set('error', error)
    if (next) u.searchParams.set('next', next)
    return clearNonce(NextResponse.redirect(u.toString()))
  }

  if (input.err || !input.code) return back(input.err === 'access_denied' ? 'google_cancelled' : 'google_failed')

  const { data: repRow } = await supabase.from('reps').select('*').eq('id', st.repId).eq('is_active', true).maybeSingle()
  const tenant = repRow as (Tenant & { brand?: string | null; tier?: string | null }) | null
  if (!tenant) return back('google_unavailable')
  const client = await oauthClientFor(tenant.id)
  if (!client || client.source !== 'tenant') return back('google_unavailable')

  let tokens: Awaited<ReturnType<typeof exchangeCode>>
  try {
    tokens = await exchangeCode(input.code, client)
  } catch (e) {
    console.error('[google signin] code exchange failed', e instanceof Error ? e.message.slice(0, 200) : e)
    return back('google_failed')
  }
  const id = checkIdToken(readIdTokenClaims(tokens.id_token), { clientId: client.clientId })
  if (!id.ok) {
    console.warn('[google signin] id_token rejected', id.reason)
    return back(id.reason === 'unverified' ? 'google_unverified' : 'google_failed')
  }

  // ilike narrows; pickSignInMember makes it exact (ilike treats _ and % as wildcards).
  const { data: memberRows } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', tenant.id)
    .eq('is_active', true)
    .ilike('email', id.email)
  const member = pickSignInMember((memberRows ?? []) as Member[], tenant.id, id.email)
  if (!member) return back('google_not_member')

  // Same first-sign-in gate as the password login: a member who was emailed a
  // starting password replaces it first. Someone with no password at all (a
  // Google-only person) has nothing to replace and goes straight in.
  const mustSetPassword = !member.last_login_at && Boolean(member.password_hash) && member.role !== 'assistant'
  await recordMemberLogin(member.id)
  await supabase.from('reps').update({ last_login_at: new Date().toISOString() }).eq('id', tenant.id)

  // Connect Google in the same click, stored exactly as Connect Google stores it.
  let gcal = 'connected'
  try {
    await saveTokens({
      repId: tenant.id,
      memberId: googleTokenSlot(tenant.tier, member),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresInSec: tokens.expires_in,
      email: id.email,
      scope: tokens.scope ?? null,
      consent: true,
    })
  } catch (e) {
    // Signed in all the same; the dashboard says Google did not connect.
    gcal = e instanceof GoogleAccountLimitError ? 'limit' : 'error'
    if (gcal === 'error') console.error('[google signin] token save failed', e)
  }

  // The same session the password login makes.
  const home = memberHomeHost(tenant, member.home_subdomain)
  const token = await signSession(tenant.slug, {
    memberId: member.id,
    hosts: sessionHostsFor(tenant, home),
    scope: isEmployeeOnlyMember(member, tenant) ? 'employee' : null,
  })
  const brandRoot = getBrand(tenant.brand).rootDomain
  const dest = mustSetPassword
    ? `https://${home}.${brandRoot}/set-password`
    : next || `https://${home}.${brandRoot}/dashboard?gcal=${gcal}`
  const res = NextResponse.redirect(dest)
  const onRoot = reqHost === brandRoot || reqHost.endsWith(`.${brandRoot}`)
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    ...(onRoot ? { domain: `.${brandRoot}` } : {}),
  })
  return clearNonce(res)
}

/**
 * The page the phone's browser shows when a connection started in the store
 * app is done. It opens the app by its own link and leaves a button in case
 * the browser wants a tap first. Nothing about the account is on it.
 */
function backToApp(appLink: string, ok: boolean): NextResponse {
  const href = appLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="robots" content="noindex">
<title>Suite CXO</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0F11;color:#F2F3F5;font:16px/1.45 -apple-system,system-ui,sans-serif;text-align:center}
main{padding:24px;max-width:340px}h1{font:500 24px/1.2 Georgia,serif;margin:0 0 10px}p{margin:0 0 22px;color:#A9AEB5}
a{display:inline-block;padding:14px 32px;border-radius:14px;background:#CACDD1;color:#0F1012;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${ok ? 'Google is connected' : 'Google was not connected'}</h1>
<p>${ok ? 'Go back to the app to carry on.' : 'Go back to the app and try again.'}</p>
<a id="back" href="${href}">Back to Suite CXO</a></main>
<script>setTimeout(function(){location.href=document.getElementById('back').href},150)</script></body></html>`
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
