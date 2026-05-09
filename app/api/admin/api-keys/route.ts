import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { generateApiKey } from '@/lib/apiKeyAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/api-keys?rep_id=xxx — list keys for a rep
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const repId = req.nextUrl.searchParams.get('rep_id')
  if (!repId) return NextResponse.json({ error: 'rep_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('rep_api_keys')
    .select('id, label, created_at, last_used_at, revoked_at')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, keys: data ?? [] })
}

// POST /api/admin/api-keys — generate a new key
// Body: { rep_id, label }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { rep_id?: string; label?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { rep_id, label } = body
  if (!rep_id || typeof rep_id !== 'string') {
    return NextResponse.json({ error: 'rep_id required' }, { status: 400 })
  }
  if (!label || typeof label !== 'string') {
    return NextResponse.json({ error: 'label required' }, { status: 400 })
  }

  const { raw, hash } = generateApiKey()

  const { data, error } = await supabase
    .from('rep_api_keys')
    .insert({ rep_id, key_hash: hash, label })
    .select('id, label, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return the raw key ONCE — not stored, cannot be retrieved again
  return NextResponse.json({ ok: true, key: raw, ...data })
}

// DELETE /api/admin/api-keys?id=xxx — revoke a key
export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('rep_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
