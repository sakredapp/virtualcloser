import { NextRequest, NextResponse } from 'next/server'
import { generateProjectPlan } from '@/lib/claude'
import { createProjectFromPlan } from '@/lib/projects'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Turn a Plaud note (meeting transcript / voice memo) into a project.
export async function POST(req: NextRequest) {
  const { tenant, member } = await requireMember()
  const body = (await req.json().catch(() => ({}))) as { noteId?: string }
  if (!body.noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 })

  const { data: note, error } = await supabase
    .from('plaud_notes')
    .select('id, title, summary, transcript, action_items')
    .eq('rep_id', tenant.id)
    .eq('id', body.noteId)
    .maybeSingle()
  if (error) throw error
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  const n = note as { title?: string; summary?: string | null; transcript?: string | null; action_items?: string[] | null }
  const actionItems = Array.isArray(n.action_items) && n.action_items.length > 0
    ? `\n\nAction items:\n${n.action_items.map((a) => `- ${a}`).join('\n')}`
    : ''
  const source = [
    n.title ? `Title: ${n.title}` : '',
    n.summary ? `Summary: ${n.summary}` : '',
    n.transcript ? `Transcript:\n${n.transcript}` : '',
    actionItems,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()

  if (!source) return NextResponse.json({ error: 'This note has no usable content.' }, { status: 422 })

  const plan = await generateProjectPlan(source, {
    repName: tenant.display_name,
    titleHint: n.title || undefined,
  })
  if (plan.sections.length === 0) {
    return NextResponse.json({ error: 'Could not turn this note into a plan.' }, { status: 422 })
  }

  const projectId = await createProjectFromPlan({
    repId: tenant.id,
    ownerMemberId: member?.id ?? null,
    plan,
    sourceKind: 'manual',
    sourceText: source.slice(0, 50_000),
  })

  return NextResponse.json({ ok: true, projectId })
}
