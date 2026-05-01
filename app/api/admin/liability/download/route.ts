// GET /api/admin/liability/download?id={liability_agreement_id}
// Returns 302 to a short-lived signed URL for the stored agreement
// snapshot. Admin-only — authorized via the same isAdminAuthed cookie
// the rest of /admin uses.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { getSignedAgreementUrl } from '@/lib/liabilityAgreement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('liability_agreements')
    .select('pdf_storage_path')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const path = (data as { pdf_storage_path: string | null }).pdf_storage_path
  if (!path) {
    return NextResponse.json({ error: 'no_snapshot_uploaded' }, { status: 404 })
  }

  const url = await getSignedAgreementUrl(path, 300)
  if (!url) {
    return NextResponse.json({ error: 'signed_url_failed' }, { status: 500 })
  }

  return NextResponse.redirect(url, 302)
}
