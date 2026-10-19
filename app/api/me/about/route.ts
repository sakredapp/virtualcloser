/**
 * About you (Suite CXO): the signed-in person's role and what they want to
 * keep an eye on (lib/onboarding/aboutYou). Read it, save it, or skip it.
 * Only their own members row, by the session's ids. An assistant working an
 * executive's seat never answers for them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getAboutView, saveAbout } from '@/lib/onboarding/aboutYou'
import type { AboutPatch } from '@/lib/onboarding/aboutYouShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ctxOr401() {
  try {
    return await requireMember()
  } catch {
    return null
  }
}

type Ctx = NonNullable<Awaited<ReturnType<typeof ctxOr401>>>
const tenantOf = (ctx: Ctx) => {
  const t = ctx.tenant as Ctx['tenant'] & { brand?: string | null }
  return { id: t.id, brand: t.brand ?? null }
}
const notTheirs = (ctx: Ctx) => !!ctx.member.acting_assistant || ctx.member.role === 'assistant'

export async function GET() {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  if (notTheirs(ctx) || tenantOf(ctx).brand !== 'cxo') return NextResponse.json({ about: null })
  try {
    return NextResponse.json({ about: await getAboutView(tenantOf(ctx), ctx.member) })
  } catch (err) {
    console.error('[about] get', err instanceof Error ? err.message : err)
    return NextResponse.json({ about: null })
  }
}

/** { skip: true } | { role, roleOther, focus } */
export async function POST(req: NextRequest) {
  const ctx = await ctxOr401()
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  if (notTheirs(ctx)) return NextResponse.json({ error: 'Only the person whose seat it is can answer this.' }, { status: 403 })
  if (tenantOf(ctx).brand !== 'cxo') return NextResponse.json({ error: 'Not available here.' }, { status: 404 })
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const patch: AboutPatch = b.skip === true
    ? { skip: true }
    : {
        ...(b.role !== undefined ? { role: typeof b.role === 'string' ? b.role : null } : {}),
        ...(typeof b.roleOther === 'string' ? { roleOther: b.roleOther } : {}),
        ...(Array.isArray(b.focus) ? { focus: b.focus.filter((x): x is string => typeof x === 'string') } : {}),
      }
  try {
    const r = await saveAbout(tenantOf(ctx), ctx.member, patch)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, about: r.view })
  } catch (err) {
    console.error('[about] save', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
