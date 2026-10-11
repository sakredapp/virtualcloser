/**
 * Praise, 1:1s and goals (owner 10-11). One route for execs and employee
 * logins alike: who may see or change what is decided on the server by
 * lib/people (assembleHub for reads, assertMay for writes), scoped to the
 * signed-in member's org. Fails soft while the tables are missing: GET
 * answers an empty hub with ready:false, writes answer 409.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isExecTenant } from '@/lib/employees/access'
import { loadPeopleHub, runPeopleAction, todayIn, viewerFor } from '@/lib/people/data'
import { PeopleRefused, type PeopleAction } from '@/lib/people/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = ['praise', 'oo_save', 'oo_done', 'item_add', 'item_toggle', 'item_remove', 'goal_save', 'goal_progress', 'goal_remove']

async function who() {
  const ctx = await requireMember().catch(() => null)
  if (!ctx) return { error: NextResponse.json({ error: 'Sign in again.' }, { status: 401 }) }
  if (!isExecTenant(ctx.tenant as { id: string; brand?: string | null })) return { error: NextResponse.json({ error: 'Not available here.' }, { status: 403 }) }
  return { ctx }
}

export async function GET() {
  const w = await who()
  if (w.error) return w.error
  const { tenant, member } = w.ctx
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  try {
    return NextResponse.json(await loadPeopleHub(tenant, member, todayIn(tz)))
  } catch (err) {
    console.error('[people] get', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load that just now.' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const w = await who()
  if (w.error) return w.error
  const { tenant, member } = w.ctx
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action)) return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
  try {
    const viewer = await viewerFor(tenant, member)
    const out = await runPeopleAction({ viewer, name: (member.display_name || '').trim() || member.email, tz: member.timezone || tenant.timezone || 'America/New_York' }, body as unknown as PeopleAction)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof PeopleRefused) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[people] post', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that. Nothing was changed.' }, { status: 503 })
  }
}
