// POST /api/admin/pipeline/kickoff
// Body: { prospectId, kickoffAt | null }
//
// Save the kickoff call datetime on a prospect. When set + the deal is in
// payment_made, auto-advance to kickoff_scheduled.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const prospectId = body.prospectId as string | undefined
  const kickoffAt = (body.kickoffAt as string | null | undefined) ?? null
  if (!prospectId) return NextResponse.json({ ok: false, reason: 'no_prospect_id' }, { status: 400 })

  const { data: cur } = await supabase
    .from('prospects')
    .select('pipeline_stage')
    .eq('id', prospectId)
    .maybeSingle()

  const update: Record<string, unknown> = { kickoff_call_at: kickoffAt }
  if (kickoffAt && (cur?.pipeline_stage === 'payment_made' || cur?.pipeline_stage === 'plan_generated' || cur?.pipeline_stage === 'quote_sent')) {
    update.pipeline_stage = 'kickoff_scheduled'
  }

  const { error } = await supabase.from('prospects').update(update).eq('id', prospectId)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
