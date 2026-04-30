import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, saveTokens } from '@/lib/google'
import { getSessionPayload } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  const err = url.searchParams.get('error')

  const session = await getSessionPayload()
  if (!session) return NextResponse.redirect(new URL('/login', req.url))

  const dashHost = `https://${session.slug}.${ROOT_DOMAIN}/dashboard`

  if (err || !code) {
    return NextResponse.redirect(`${dashHost}?gcal=error`)
  }

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
    .select('id, slug, tier')
    .eq('slug', session.slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!rep || (repIdFromState && repIdFromState !== rep.id)) {
    return NextResponse.redirect(`${dashHost}?gcal=error`)
  }
  // Cross-check the member ID in state against the session — if they don't
  // match, someone replayed an OAuth start link from a different login.
  if (memberIdFromState && session.memberId && memberIdFromState !== session.memberId) {
    return NextResponse.redirect(`${dashHost}?gcal=error`)
  }

  // Tier-aware storage. Individual-tier accounts have a single owner member
  // and many backend paths (cron hydrator, AI dialer reschedule, Sheets CRM
  // mirror) look up tokens with no member context. We store individual-tier
  // connections at tenant level (member_id=null) so those paths keep working.
  // Enterprise stores per-member so each rep's calendar stays scoped.
  const memberIdForSave =
    rep.tier === 'enterprise'
      ? memberIdFromState ?? session.memberId ?? null
      : null

  try {
    const tokens = await exchangeCode(code)
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
    })
    return NextResponse.redirect(`${dashHost}?gcal=connected`)
  } catch (e) {
    console.error('[google oauth callback] failed', e)
    return NextResponse.redirect(`${dashHost}?gcal=error`)
  }
}
