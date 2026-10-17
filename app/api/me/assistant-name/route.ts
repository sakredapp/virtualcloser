/**
 * The assistant's name (owner 2026-10-17). lib/assistantNameServer.
 *   GET → { company, personal, resolved, canEditCompany }
 *   PUT { scope: 'company' | 'personal', name } → save; empty name clears it.
 * Company: owner or admin only. Personal: anyone signed in to an executive
 * org (employee logins included), always their own row.
 */
import { NextResponse } from 'next/server'
import { requireOrgMember, NotExec } from '@/lib/cxoAccess'
import { resolveAssistantName } from '@/lib/assistantName'
import {
  canEditCompanyAssistantName,
  companyAssistantName,
  personalAssistantName,
  saveCompanyAssistantName,
  savePersonalAssistantName,
} from '@/lib/assistantNameServer'

export const dynamic = 'force-dynamic'

type Gate = { ctx: Awaited<ReturnType<typeof requireOrgMember>> } | { err: NextResponse }

async function gate(): Promise<Gate> {
  try {
    return { ctx: await requireOrgMember() }
  } catch (e) {
    if (e instanceof NotExec) return { err: NextResponse.json({ error: 'Executive suite only.' }, { status: 403 }) }
    return { err: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  }
}

export async function GET() {
  const g = await gate()
  if ('err' in g) return g.err
  const company = companyAssistantName(g.ctx.tenant)
  const personal = await personalAssistantName(g.ctx.member)
  return NextResponse.json({ company, personal, resolved: resolveAssistantName({ personal, company }), canEditCompany: canEditCompanyAssistantName(g.ctx.member) })
}

export async function PUT(req: Request) {
  const g = await gate()
  if ('err' in g) return g.err
  const { tenant, member } = g.ctx
  const body = (await req.json().catch(() => ({}))) as { scope?: unknown; name?: unknown }
  if (body.scope !== 'company' && body.scope !== 'personal') return NextResponse.json({ error: 'Say which name: company or personal.' }, { status: 400 })

  let company = companyAssistantName(tenant)
  let personal = await personalAssistantName(member)
  if (body.scope === 'company') {
    if (!canEditCompanyAssistantName(member)) return NextResponse.json({ error: 'Only the owner or an admin can change this.' }, { status: 403 })
    const r = await saveCompanyAssistantName(tenant.id, body.name)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    company = r.name
  } else {
    // An exec assistant working as their exec saves to their OWN row.
    const r = await savePersonalAssistantName(member.acting_assistant?.id ?? member.id, body.name)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    personal = r.name
  }
  console.log(`[assistant-name] ${body.scope} saved rep=${tenant.id} member=${member.acting_assistant?.id ?? member.id}`)
  return NextResponse.json({ company, personal, resolved: resolveAssistantName({ personal, company }), canEditCompany: canEditCompanyAssistantName(member) })
}
