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

  // ?add=1 → "Add another calendar": force the account chooser and store the
  // result as an additional row. ?return=/dashboard/calendar → where to land
  // afterwards (same-app paths only).
  const url = new URL(req.url)
  const add = url.searchParams.get('add') === '1'
  const ret = url.searchParams.get('return') ?? ''
  const safeReturn = /^\/dashboard(\/[a-z0-9\-\/]*)?$/i.test(ret) ? ret : ''
  const flags = [add ? 'add' : '', safeReturn ? `ret=${encodeURIComponent(safeReturn)}` : ''].filter(Boolean).join('|')

  const nonce = generateNonce()
  const memberPart = session.memberId ?? ''
  // State = repId : memberId-or-empty : nonce [: flags]
  const state = flags ? `${rep.id}:${memberPart}:${nonce}:${flags}` : `${rep.id}:${memberPart}:${nonce}`
  return NextResponse.redirect(buildAuthUrl(state, { selectAccount: add }))
}
