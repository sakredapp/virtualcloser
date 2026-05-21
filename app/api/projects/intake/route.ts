import { NextRequest, NextResponse } from 'next/server'
import { proposeProjectQuestions } from '@/lib/claude'
import { parseProjectRequest } from '@/lib/projectIntake'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Guided build, step 1: read the prompt/file and ask clarifying questions
// before generating the plan. The client sends the answers back to
// /api/projects (folded into the prompt) to build.
export async function POST(req: NextRequest) {
  const { tenant } = await requireMember()

  const parsed = await parseProjectRequest(req)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  const questions = await proposeProjectQuestions(parsed.source, { repName: tenant.display_name })
  return NextResponse.json({ ok: true, questions })
}
