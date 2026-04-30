import { NextRequest, NextResponse } from 'next/server'
import { buildAuthUrl, googleOauthConfigured } from '@/lib/google'
import { getSessionPayload } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'
import { generateNonce } from '@/lib/random'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Redirects the logged-in client to Google's consent screen.
// State = rep_id : memberId-or-empty : crypto nonce.
// memberId is non-empty for enterprise members (each connects their own
// calendar); empty for individual-tier accounts that connect at tenant level.
export async function GET(req: NextRequest) {
  if (!googleOauthConfigured()) {
    return NextResponse.json(
      { error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.' },
      { status: 500 },
    )
  }

  const session = await getSessionPayload()
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug')
    .eq('slug', session.slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!rep) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const nonce = generateNonce()
  const memberPart = session.memberId ?? ''
  const state = `${rep.id}:${memberPart}:${nonce}`
  return NextResponse.redirect(buildAuthUrl(state))
}
