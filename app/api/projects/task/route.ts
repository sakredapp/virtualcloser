import { NextRequest, NextResponse } from 'next/server'
import {
  setTaskStatus,
  assignTask,
  createTask,
  updateTaskFields,
  deleteTask,
  type ProjectTaskStatus,
} from '@/lib/projects'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Create a task.
export async function POST(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string
    sectionId?: string | null
    title?: string
  }
  const title = (body.title ?? '').trim()
  if (!body.projectId || !title) {
    return NextResponse.json({ error: 'projectId and title required' }, { status: 400 })
  }
  const task = await createTask({
    repId: tenant.id,
    projectId: body.projectId,
    sectionId: body.sectionId ?? null,
    title,
  })
  return NextResponse.json({ ok: true, task })
}

// Update a task: status, assignment, and/or free-text fields.
export async function PATCH(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as {
    taskId?: string
    status?: string
    assignedTo?: string | null
    title?: string
    description?: string | null
    timeEstimate?: string | null
  }
  if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  if ('assignedTo' in body) {
    await assignTask(tenant.id, body.taskId, body.assignedTo ?? null)
  }
  if (body.status) {
    if (!['todo', 'in_progress', 'done', 'blocked'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    await setTaskStatus(tenant.id, body.taskId, body.status as ProjectTaskStatus)
  }
  if ('title' in body || 'description' in body || 'timeEstimate' in body) {
    await updateTaskFields(tenant.id, body.taskId, {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      description: 'description' in body ? body.description : undefined,
      time_estimate: 'timeEstimate' in body ? body.timeEstimate : undefined,
    })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as { taskId?: string }
  if (!body.taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  await deleteTask(tenant.id, body.taskId)
  return NextResponse.json({ ok: true })
}
