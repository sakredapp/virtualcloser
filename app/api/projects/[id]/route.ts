import { NextRequest, NextResponse } from 'next/server'
import {
  getProjectDetail,
  setProjectStatus,
  deleteProject,
  renameProject,
  type ProjectStatus,
} from '@/lib/projects'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenant } = await requireMember()
  const detail = await getProjectDetail(tenant.id, id)
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, ...detail })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as {
    status?: string
    name?: string
    description?: string | null
  }

  if ('name' in body || 'description' in body) {
    await renameProject(tenant.id, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: 'description' in body ? body.description : undefined,
    })
  }

  if (body.status) {
    if (!['active', 'paused', 'completed', 'archived'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    await setProjectStatus(tenant.id, id, body.status as ProjectStatus)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tenant } = await requireMember()
  await deleteProject(tenant.id, id)
  return NextResponse.json({ ok: true })
}
