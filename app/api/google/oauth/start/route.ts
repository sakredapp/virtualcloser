import { NextRequest, NextResponse } from 'next/server'
import { buildAuthUrl, googleOauthConfigured } from '@/lib/google'
import { getSessionSlug } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'
import { generateNonce } from '@/lib/random'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Redirects the logged-in client to Google's consent screen.
// We pass the rep_id (resolved from session) as signed state.
export async function GET(req: NextRequest) {
  if (!googleOauthConfigured()) {
    return NextResponse.json(
      { error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.' },
      { status: 500 },
    )
  }

  const slug = await getSessionSlug()
  if (!slug) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (!rep) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // State = rep_id + crypto nonce. CSRF on callback is also re-verified via session.
  const nonce = generateNonce()
  const state = `${rep.id}:${nonce}`
  return NextResponse.redirect(buildAuthUrl(state))
}
