import { NextRequest, NextResponse } from 'next/server'
import { extractBrainDump } from '@/lib/claude'
import { createBrainDump, createBrainItems } from '@/lib/supabase'
import { requireMember } from '@/lib/tenant'

export async function POST(req: NextRequest) {
  let body: { text?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if (text.length > 20000) {
    return NextResponse.json({ error: 'text too long' }, { status: 413 })
  }

  const { tenant, member } = await requireMember()
  const ownerMemberId = member?.id ?? null

  const analysis = await extractBrainDump(text, tenant.display_name)

  const dump = await createBrainDump({
    repId: tenant.id,
    rawText: text,
    summary: analysis.summary,
    source: 'mic',
    ownerMemberId,
  })

  const items = await createBrainItems(tenant.id, dump.id, analysis.items, ownerMemberId)

  return NextResponse.json({ ok: true, dump, items })
}
