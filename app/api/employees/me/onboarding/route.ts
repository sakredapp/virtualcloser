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
import { capabilityItemsFor } from '@/lib/agent/cxoCatalog'
import { addFirstTodo, getMyDayOne, markAbilitiesSeen } from '@/lib/onboarding/dayOne'
import { cleanTodo } from '@/lib/onboarding/dayOneShared'
import { audienceFor, flavorFor } from '@/lib/onboarding/aboutYou'
import { aboutView, pickAbilities, readAbout, roleLabel, type AboutView } from '@/lib/onboarding/aboutYouShared'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ctxOr401() {
  try {
    return await requireMember()
  } catch {
    return null
  }
}

/** Their own settings, fresh (the card may have just saved an answer). */
async function freshSettings(member: Member): Promise<Record<string, unknown>> {
  const { data } = await supabase.from('members').select('settings').eq('id', member.id).maybeSingle()
  return { ...(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? member.settings ?? {}) }
}

/**
 * What Ciao can do for exactly this person: the same list "what can you do"
 * gives, from their own tools, with what fits their role and the things they
 * keep an eye on first (lib/onboarding/aboutYouShared.pickAbilities).
 */
async function abilitiesFor(tenant: Tenant, member: Member, about: ReturnType<typeof readAbout>, who: AboutView['who'], flavor: Awaited<ReturnType<typeof flavorFor>>): Promise<string[]> {
  try {
    const { toolDefsFor } = await import('@/lib/agent/tools')
    return pickAbilities(capabilityItemsFor(toolDefsFor(tenant, member)), about, who, flavor)
      .slice(0, 14)
      .map((c) => c.label)
  } catch (err) {
    console.error('[onboarding] abilities', err instanceof Error ? err.message : err)
    return []
  }
}

async function view(tenant: Tenant, member: Member) {
  if (member.acting_assistant || member.role === 'assistant') return { dayOne: null, about: null }
  const t = tenant as Tenant & { brand?: string | null; settings?: unknown }
  if (t.brand !== 'cxo') return { dayOne: null, about: null }
  const tl = { id: t.id, brand: t.brand ?? null }
  const [flavor, settings] = await Promise.all([flavorFor(t.id), freshSettings(member)])
  const about = readAbout(settings)
  const who = audienceFor(member, tl)
  const dayOne = await getMyDayOne({ ...tl, settings: t.settings }, member, await abilitiesFor(tenant, member, about, who, flavor), new Date(), { roleLabel: roleLabel(about) })
  const av = aboutView(about, who, flavor)
  // The questions show inside the first-day card, or on their own (once) for anyone who has not answered or skipped.
  return { dayOne, about: dayOne || av.ask ? av : null }
}

export async function GET() {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  const v = await view(ctx.tenant, ctx.member).catch((err) => {
    console.error('[onboarding] get', err instanceof Error ? err.message : err)
    return { dayOne: null, about: null }
  })
  return NextResponse.json(v)
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
    return NextResponse.json({ ok: true, ...(await view(ctx.tenant, ctx.member)) })
  } catch (err) {
    console.error('[onboarding] save', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
