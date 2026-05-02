// POST /api/admin/pipeline/move
// Body: { prospectId, stage, position? }
//
// Drag-and-drop endpoint. Updates pipeline_stage and (optionally)
// pipeline_position for the target prospect.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { STAGE_ORDER } from '@/lib/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_STAGES = new Set([...STAGE_ORDER, 'lost'])

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const prospectId = body.prospectId as string | undefined
  const stage = body.stage as string | undefined
  const position = typeof body.position === 'number' ? body.position : null
  if (!prospectId || !stage || !VALID_STAGES.has(stage)) {
    return NextResponse.json({ ok: false, reason: 'bad_input' }, { status: 400 })
  }
  const update: Record<string, unknown> = { pipeline_stage: stage }
  if (position != null) update.pipeline_position = position

  const { error } = await supabase.from('prospects').update(update).eq('id', prospectId)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
