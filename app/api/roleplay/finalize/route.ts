// POST /api/roleplay/finalize
//
// Body: { sessionId }. Binds the session to its provider call, pulls the
// transcript, grades it with Claude, and returns the scorecard. Idempotent —
// a completed session returns its stored grade. Returns { state: 'pending' }
// while the provider is still writing the call; the client polls.

import { NextRequest, NextResponse } from 'next/server'
import { resolveRoleplayMember, finalizeSession } from '@/lib/roleplay-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await resolveRoleplayMember()
  if (!auth) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  let body: { sessionId?: string }
  try {
    body = (await req.json()) as { sessionId?: string }
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }
  if (!body.sessionId) return NextResponse.json({ ok: false, reason: 'missing_session' }, { status: 400 })

  try {
    const outcome = await finalizeSession(auth.tenant, auth.member, body.sessionId)
    if (outcome.state === 'pending') {
      return NextResponse.json({ ok: true, state: 'pending', note: outcome.note })
    }
    if (outcome.state === 'failed') {
      return NextResponse.json({ ok: false, state: 'failed', note: outcome.note }, { status: 409 })
    }
    const s = outcome.session
    return NextResponse.json({
      ok: true,
      state: 'graded',
      session: {
        id: s.id,
        status: s.status,
        durationSeconds: s.duration_seconds,
        score: s.ai_score,
        summary: s.ai_summary,
        strengths: s.ai_strengths,
        weaknesses: s.ai_weaknesses,
        transcript: s.transcript_full,
        startedAt: s.started_at,
      },
    })
  } catch (err) {
    console.error('[roleplay/finalize]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, reason: 'finalize_failed' }, { status: 500 })
  }
}
