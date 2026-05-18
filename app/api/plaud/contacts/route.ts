// rep_contacts CRUD — directory the Plaud agent uses to resolve names.
//
// GET   /api/plaud/contacts          list tenant's contacts
// POST  /api/plaud/contacts          create or update (upsert by email if provided)
// DELETE /api/plaud/contacts?id=...  remove a contact

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ContactInput = {
  id?: string
  display_name?: string
  aliases?: string[]
  email?: string | null
  phone?: string | null
  role?: string | null
  notes?: string | null
  member_id?: string | null
}

export async function GET() {
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('rep_contacts')
    .select('id, display_name, aliases, email, phone, role, member_id, notes, source, created_at')
    .eq('rep_id', tenant.id)
    .order('display_name', { ascending: true })
    .limit(1000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, contacts: data ?? [] })
}

export async function POST(req: NextRequest) {
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as ContactInput

  const displayName = (body.display_name ?? '').trim()
  if (!body.id && !displayName) {
    return NextResponse.json({ ok: false, error: 'display_name required' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase() || null
  // Basic email sanity. We don't try to validate deliverability — Gmail
  // sends will surface a 400 downstream if the address is bogus — but
  // catching obvious typos here keeps the directory clean.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid email format' }, { status: 400 })
  }

  if (body.id) {
    // Update existing.
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (displayName) update.display_name = displayName
    if (body.aliases !== undefined) update.aliases = body.aliases
    if (body.email !== undefined) update.email = email
    if (body.phone !== undefined) update.phone = body.phone
    if (body.role !== undefined) update.role = body.role
    if (body.notes !== undefined) update.notes = body.notes
    if (body.member_id !== undefined) update.member_id = body.member_id
    const { error } = await supabase
      .from('rep_contacts')
      .update(update)
      .eq('id', body.id)
      .eq('rep_id', tenant.id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: body.id })
  }

  // Insert. If email collides with an existing row (rep_id, lower(email)),
  // surface 409 so the UI can offer to edit instead.
  const { data, error } = await supabase
    .from('rep_contacts')
    .insert({
      rep_id: tenant.id,
      display_name: displayName,
      aliases: body.aliases ?? [],
      email,
      phone: body.phone ?? null,
      role: body.role ?? null,
      notes: body.notes ?? null,
      member_id: body.member_id ?? null,
      source: 'manual',
    })
    .select('id')
    .single()
  if (error) {
    if (error.message.includes('duplicate')) {
      return NextResponse.json({ ok: false, error: 'contact with that email already exists' }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}

export async function DELETE(req: NextRequest) {
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const { error } = await supabase
    .from('rep_contacts')
    .delete()
    .eq('id', id)
    .eq('rep_id', tenant.id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
