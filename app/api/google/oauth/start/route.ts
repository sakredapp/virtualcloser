import { NextRequest, NextResponse } from 'next/server'
import { buildAuthUrl, oauthClientFor, outsideCalendarClient } from '@/lib/google'
import { getSessionPayload } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'
import { generateNonce } from '@/lib/random'
import { verifyNativeTicket } from '@/lib/nativeTicket'
import { inboxAllowed } from '@/lib/cxoFeatures'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Redirects the logged-in client to Google's consent screen.
// State = rep_id : memberId-or-empty : crypto nonce.
// memberId is non-empty for enterprise members (each connects their own
// calendar); empty for individual-tier accounts that connect at tenant level.
export async function GET(req: NextRequest) {
  // The Suite CXO store app opens this in the phone's own browser (Google does
  // not allow its sign-in inside an app's WebView). That browser has no session
  // cookie, so the app sends a ten-minute pass for this member instead
  // (lib/nativeTicket.ts). With no pass this route is exactly as before.
  const ticketRaw = new URL(req.url).searchParams.get('ticket')
  const ticket = ticketRaw ? verifyNativeTicket(ticketRaw) : null
  if (ticketRaw && !ticket) {
    return new NextResponse('This link has expired. Go back to the Suite CXO app and tap Connect Google again.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const session = ticket ? { slug: ticket.slug, memberId: ticket.memberId } : await getSessionPayload()
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, slug, brand')
    // Signed slug may be the org's slug or one of its host aliases.
    .or(`slug.eq.${session.slug},host_aliases.cs.{${session.slug}}`)
    .eq('is_active', true)
    .maybeSingle()
  if (!rep) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // The tenant's own Google OAuth client when it has one (Settings > admin
  // client page), else the Suite CXO app (Suite CXO companies, when set),
  // else the global (Virtual Closer) env client.
  const tenantClient = await oauthClientFor(rep.id)

  // ?outside=1 → "A calendar outside <company>" (owner 2026-10-17): a company
  // with its own Internal client cannot sign in a personal Gmail or another
  // company's account, so that calendar goes through the Suite CXO app (else
  // the global client) with calendar scopes only. Only offered (and only honoured) when the company
  // has its own client; everywhere else the one client already takes any account.
  const url = new URL(req.url)
  const outside = url.searchParams.get('outside') === '1' && tenantClient?.source === 'tenant'
  const client = outside ? outsideCalendarClient((rep as { brand?: string | null }).brand) : tenantClient
  if (!client) {
    return NextResponse.json(
      { error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI, or this workspace\'s own Google client.' },
      { status: 500 },
    )
  }

  // ?add=1 → "Add another calendar": force the account chooser and store the
  // result as an additional row. ?return=/dashboard/calendar → where to land
  // afterwards (same-app paths only).
  const add = url.searchParams.get('add') === '1' || outside
  const ret = url.searchParams.get('return') ?? ''
  const safeReturn = /^\/dashboard(\/[a-z0-9\-\/]*)?$/i.test(ret) ? ret : ''
  const flags = [add ? 'add' : '', outside ? 'out' : '', safeReturn ? `ret=${encodeURIComponent(safeReturn)}` : '', ticket ? `app=${ticketRaw}` : ''].filter(Boolean).join('|')

  const nonce = generateNonce()
  const memberPart = session.memberId ?? ''
  // State = repId : memberId-or-empty : nonce [: flags]
  const state = flags ? `${rep.id}:${memberPart}:${nonce}:${flags}` : `${rep.id}:${memberPart}:${nonce}`
  // Suite CXO outside the Pinnacle edition: calendar only, never Gmail scopes.
  // The Suite CXO app never gets Gmail either (buildAuthUrl drops it).
  const gmail = inboxAllowed(rep as { id: string; brand?: string | null })
  return NextResponse.redirect(buildAuthUrl(state, { selectAccount: add, gmail, calendarOnly: outside }, client))
}
