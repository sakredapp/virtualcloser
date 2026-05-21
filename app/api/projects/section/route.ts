import { NextRequest, NextResponse } from 'next/server'
import { createSection, renameSection, deleteSection } from '@/lib/projects'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Create a section.
export async function POST(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; title?: string }
  const title = (body.title ?? '').trim()
  if (!body.projectId || !title) {
    return NextResponse.json({ error: 'projectId and title required' }, { status: 400 })
  }
  const section = await createSection({ repId: tenant.id, projectId: body.projectId, title })
  return NextResponse.json({ ok: true, section })
}

// Rename a section.
export async function PATCH(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as { sectionId?: string; title?: string }
  const title = (body.title ?? '').trim()
  if (!body.sectionId || !title) {
    return NextResponse.json({ error: 'sectionId and title required' }, { status: 400 })
  }
  await renameSection(tenant.id, body.sectionId, title)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { tenant } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as { sectionId?: string }
  if (!body.sectionId) return NextResponse.json({ error: 'sectionId required' }, { status: 400 })
  await deleteSection(tenant.id, body.sectionId)
  return NextResponse.json({ ok: true })
}
