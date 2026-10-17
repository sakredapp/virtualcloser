/**
 * The signed-in member's own day-one checklist (lib/onboarding/dayOne): read
 * it, say "Got it" to what Ciao can do, or add their first to-do. Only their
 * own rows, by rep_id and member id from the session. Lives under
 * /api/employees/me so an employee login can reach it; execs use it too.
 * An assistant working someone else's seat never sees or changes theirs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { capabilitiesFor } from '@/lib/agent/cxoCatalog'
import { addFirstTodo, getMyDayOne, markAbilitiesSeen } from '@/lib/onboarding/dayOne'
import { cleanTodo } from '@/lib/onboarding/dayOneShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ctxOr401() {
  try {
    return await requireMember()
  } catch {
    return null
  }
}

/** What Ciao can do for exactly this person: the same list "what can you do" gives, from their own tools. */
async function abilitiesFor(tenant: Tenant, member: Member): Promise<string[]> {
  try {
    const { toolDefsFor } = await import('@/lib/agent/tools')
    return capabilitiesFor(toolDefsFor(tenant, member)).slice(0, 14)
  } catch (err) {
    console.error('[onboarding] abilities', err instanceof Error ? err.message : err)
    return []
  }
}

async function view(tenant: Tenant, member: Member) {
  if (member.acting_assistant || member.role === 'assistant') return null
  const t = tenant as Tenant & { brand?: string | null; settings?: unknown }
  return getMyDayOne({ id: t.id, brand: t.brand ?? null, settings: t.settings }, member, await abilitiesFor(tenant, member))
}

export async function GET() {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  const dayOne = await view(ctx.tenant, ctx.member).catch((err) => {
    console.error('[onboarding] get', err instanceof Error ? err.message : err)
    return null
  })
  return NextResponse.json({ dayOne })
}

/** op: abilities_seen | add_todo (body) */
export async function POST(req: NextRequest) {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  if (ctx.member.acting_assistant || ctx.member.role === 'assistant') return NextResponse.json({ error: 'This list is for the person whose seat it is.' }, { status: 403 })
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { op?: unknown; body?: unknown }
  const t = ctx.tenant as Tenant & { brand?: string | null; settings?: unknown }
  const tenant = { id: t.id, brand: t.brand ?? null, settings: t.settings }
  try {
    if (b.op === 'abilities_seen') await markAbilitiesSeen(tenant, ctx.member)
    else if (b.op === 'add_todo') {
      const text = cleanTodo(b.body)
      if (!text) return NextResponse.json({ error: 'Write the to-do first.' }, { status: 400 })
      await addFirstTodo(tenant, ctx.member, text)
    } else return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
    return NextResponse.json({ ok: true, dayOne: await view(ctx.tenant, ctx.member) })
  } catch (err) {
    console.error('[onboarding] save', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
