import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, saveTokens } from '@/lib/google'
import { getSessionSlug } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  const err = url.searchParams.get('error')

  const slug = await getSessionSlug()
  if (!slug) return NextResponse.redirect(new URL('/login', req.url))

  const dashHost = `https://${slug}.${ROOT_DOMAIN}/dashboard`

  if (err || !code) {
    return NextResponse.redirect(`${dashHost}?gcal=error`)
  }

  const [repIdFromState] = state.split(':')
  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!rep || (repIdFromState && repIdFromState !== rep.id)) {
    return NextResponse.redirect(`${dashHost}?gcal=error`)
  }

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
