// POST /api/admin/pipeline/notes
// Body: { prospectId, notes }
//
// Save admin's free-form notes on a prospect.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const prospectId = body.prospectId as string | undefined
  const notes = (body.notes as string | undefined) ?? ''
  if (!prospectId) return NextResponse.json({ ok: false, reason: 'no_prospect_id' }, { status: 400 })
  const { error } = await supabase.from('prospects').update({ admin_notes: notes }).eq('id', prospectId)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
