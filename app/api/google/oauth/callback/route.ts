import { NextRequest, NextResponse } from 'next/server'
import { GoogleAccountLimitError, exchangeCode, oauthClientFor, saveTokens } from '@/lib/google'
import { getSessionPayload, sessionHomeHost, type SessionPayload } from '@/lib/client-auth'
import { getBrand } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { appReturnLink, ticketFromState, verifyNativeTicket } from '@/lib/nativeTicket'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  const err = url.searchParams.get('error')

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
