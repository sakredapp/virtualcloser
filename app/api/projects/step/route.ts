import { NextRequest, NextResponse } from 'next/server'
import { setStepDone, createStep, updateStepContent, deleteStep } from '@/lib/projects'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Create a step under a task.
export async function POST(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string
    taskId?: string
    content?: string
  }
  const content = (body.content ?? '').trim()
  if (!body.projectId || !body.taskId || !content) {
    return NextResponse.json({ error: 'projectId, taskId and content required' }, { status: 400 })
  }
  const step = await createStep({
    repId: tenant.id,
    projectId: body.projectId,
    taskId: body.taskId,
    content,
  })
  return NextResponse.json({ ok: true, step })
}

// Update a step: toggle done and/or edit content.
export async function PATCH(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as {
    stepId?: string
    done?: boolean
    content?: string
  }
  if (!body.stepId) return NextResponse.json({ error: 'stepId required' }, { status: 400 })
  if (typeof body.done === 'boolean') {
    await setStepDone(tenant.id, body.stepId, body.done)
  }
  if (typeof body.content === 'string' && body.content.trim()) {
    await updateStepContent(tenant.id, body.stepId, body.content.trim())
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as { stepId?: string }
  if (!body.stepId) return NextResponse.json({ error: 'stepId required' }, { status: 400 })
  await deleteStep(tenant.id, body.stepId)
  return NextResponse.json({ ok: true })
}
