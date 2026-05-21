import { NextRequest, NextResponse } from 'next/server'
import { generateProjectPlan } from '@/lib/claude'
import { createProjectFromPlan, listProjects } from '@/lib/projects'
import { parseProjectRequest } from '@/lib/projectIntake'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
// Plan generation on a long doc can take a while — give it room.
export const maxDuration = 300

export async function GET() {
  const { tenant } = await requireMember()
  const projects = await listProjects(tenant.id)
  return NextResponse.json({ ok: true, projects })
}

export async function POST(req: NextRequest) {
  const { tenant, member } = await requireMember()
  const ownerMemberId = member?.id ?? null

  const parsed = await parseProjectRequest(req)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  const { source, sourceKind, titleHint } = parsed

  const plan = await generateProjectPlan(source, { repName: tenant.display_name, titleHint })
  if (plan.sections.length === 0) {
    return NextResponse.json({ error: 'The AI could not turn that into a plan. Try adding more detail.' }, { status: 422 })
  }

  const projectId = await createProjectFromPlan({
    repId: tenant.id,
    ownerMemberId,
    plan,
    sourceKind,
    sourceText: source.slice(0, 50_000),
  })

  return NextResponse.json({ ok: true, projectId })
}
