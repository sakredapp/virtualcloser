// POST /api/roleplay/start
//
// Body:    { persona: TrainerPersonaKey }
// 200:     { ok: true, sessionId, agentNumber, personaName }
// 401/402/501 with { ok: false, reason, message } otherwise.
//
// Auth is session-cookie based and host-independent (works on tenant
// subdomains AND on roleplay.virtualcloser.com — see lib/roleplay-engine.ts).

import { NextRequest, NextResponse } from 'next/server'
import { ROLEPLAY_ENABLED } from '@/lib/roleplay'
import {
  resolveRoleplayMember,
  canPractice,
  startBrowserSession,
} from '@/lib/roleplay-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!ROLEPLAY_ENABLED) {
    return NextResponse.json(
      { ok: false, reason: 'disabled', message: 'Roleplay is not enabled yet.' },
      { status: 501 },
    )
  }
  const auth = await resolveRoleplayMember()
  if (!auth) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized', message: 'Log in to your workspace first.' },
      { status: 401 },
    )
  }
  if (!(await canPractice(auth.tenant, auth.member))) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'not_entitled',
        message: 'The roleplay add-on is not active on this account yet. Ask your account owner to turn it on.',
      },
      { status: 402 },
    )
  }

  let body: { persona?: string }
  try {
    body = (await req.json()) as { persona?: string }
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  try {
    const { session, agentNumber, personaName } = await startBrowserSession(
      auth.tenant,
      auth.member,
      String(body.persona ?? ''),
    )
    return NextResponse.json({ ok: true, sessionId: session.id, agentNumber, personaName })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'start_failed'
    if (msg === 'roleplay_unknown_persona') {
      return NextResponse.json({ ok: false, reason: 'unknown_persona' }, { status: 400 })
    }
    if (msg === 'roleplay_wallet_empty') {
      return NextResponse.json(
        {
          ok: false,
          reason: 'wallet_empty',
          message: 'Your AI wallet is empty. Top it up to keep practicing — minutes are billed from the wallet as you use them.',
        },
        { status: 402 },
      )
    }
    if (msg === 'roleplay_agent_number_not_configured') {
      return NextResponse.json(
        { ok: false, reason: 'agent_not_wired', message: 'This persona is not wired to a live agent yet.' },
        { status: 501 },
      )
    }
    console.error('[roleplay/start]', msg)
    return NextResponse.json({ ok: false, reason: 'start_failed', message: msg }, { status: 500 })
  }
}
