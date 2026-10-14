/**
 * The Suite CXO phone app signs in here (lib/nativeSession.ts).
 *
 *   POST { email, password } → 200 { token, host, expiresAt, name, email, role, company, pinnacle }
 *                              400 / 401 / 403 / 429 { error } in plain words
 *   DELETE                    → 204 (sessions are signed tokens; the app forgets its copy)
 *
 * Public in middleware so it answers on suitecxo.com and on a company host.
 */
import { NextRequest, NextResponse } from 'next/server'
import { nativeSignIn } from '@/lib/nativeSession'
import { enforceRateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const [byEmail, byIp] = await Promise.all([
    enforceRateLimit(`native-login:email:${email || 'none'}`, 10, 900),
    enforceRateLimit(`native-login:ip:${ip}`, 30, 900),
  ])
  if (!byEmail.allowed || !byIp.allowed) {
    return NextResponse.json({ error: 'Too many tries. Wait a few minutes, then try again.' }, { status: 429, headers: { 'Retry-After': '900' } })
  }
  const r = await nativeSignIn(body?.email, body?.password)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  const { ok: _ok, ...out } = r
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 })
}
