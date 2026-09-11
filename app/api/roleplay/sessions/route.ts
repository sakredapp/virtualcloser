// GET /api/roleplay/sessions — the signed-in member's recent practice
// sessions, newest first. Host-independent auth (tenant subdomains and
// roleplay.virtualcloser.com both work).

import { NextResponse } from 'next/server'
import { resolveRoleplayMember, listMySessions } from '@/lib/roleplay-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await resolveRoleplayMember()
  if (!auth) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  try {
    const sessions = await listMySessions(auth.tenant, auth.member)
    return NextResponse.json({
      ok: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        persona: s.scenario_key,
        status: s.status,
        startedAt: s.started_at,
        durationSeconds: s.duration_seconds,
        score: s.ai_score,
        summary: s.ai_summary,
      })),
    })
  } catch (err) {
    // Tables may not exist yet in a fresh env — an empty floor beats a 500.
    console.error('[roleplay/sessions]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, sessions: [] })
  }
}
