import { NextRequest, NextResponse } from 'next/server'
import { setBrainItemStatus } from '@/lib/supabase'
import { requireTenant } from '@/lib/tenant'
import type { BrainItemStatus } from '@/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { id?: string; status?: string }
  const id = body.id
  const status = body.status as BrainItemStatus | undefined

  if (!id || !status || !['open', 'done', 'dismissed'].includes(status)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const tenant = await requireTenant()
  await setBrainItemStatus(id, status, tenant.id)
  return NextResponse.json({ ok: true })
}
