// Mark a Plaud action as dismissed (won't be executed, hidden from default
// queue views). Soft action — the row stays for audit history.

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data: row } = await supabase
    .from('plaud_actions')
    .select('rep_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const r = row as { rep_id: string; status: string }
  if (r.rep_id !== tenant.id) {
    return NextResponse.json({ ok: false, error: 'wrong tenant' }, { status: 403 })
  }
  if (r.status === 'executed') {
    return NextResponse.json({ ok: false, error: 'already executed' }, { status: 409 })
  }

  const { error } = await supabase
    .from('plaud_actions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
