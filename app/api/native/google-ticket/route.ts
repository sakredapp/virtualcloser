/**
 * The store app calls this (signed in, from its WebView) just before it opens
 * the phone's browser for "Connect Google". It answers with the same connect
 * link plus a ten-minute pass (lib/nativeTicket.ts), so the browser, which has
 * no session cookie, can start the connection for this member.
 *
 * Browsers never call this; the website's Connect Google links are unchanged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSessionPayload, sessionHomeHost } from '@/lib/client-auth'
import { brandFromHost, isAnyGatewayHost } from '@/lib/brand'
import { signNativeTicket } from '@/lib/nativeTicket'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const START = '/api/google/oauth/start'

export async function POST(req: NextRequest) {
  const session = await getSessionPayload()
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  // An employee login never connects company Google; an admin viewing as a member must not either.
  if (session.scope) return NextResponse.json({ error: 'Not available on this login.' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as { href?: unknown } | null
  const href = typeof body?.href === 'string' ? body.href : START
  let asked: URL
  try {
    asked = new URL(href, 'https://x.invalid')
  } catch {
    return NextResponse.json({ error: 'Bad link.' }, { status: 400 })
  }
  if (asked.pathname !== START) return NextResponse.json({ error: 'Bad link.' }, { status: 400 })

  // The pass is used on the apex: a company host would send a browser with no
  // session cookie to the login page before the route ever ran.
  const host = req.headers.get('host') ?? ''
  const brand = brandFromHost(host)
  const origin = isAnyGatewayHost(host) ? req.nextUrl.origin : `https://${brand.rootDomain}`

  const out = new URL(START, origin)
  if (asked.searchParams.get('add') === '1') out.searchParams.set('add', '1')
  const ret = asked.searchParams.get('return')
  if (ret) out.searchParams.set('return', ret)
  out.searchParams.set('ticket', signNativeTicket({ slug: session.slug, memberId: session.memberId, home: sessionHomeHost(session) }))
  return NextResponse.json({ url: out.toString() }, { headers: { 'cache-control': 'no-store' } })
}
