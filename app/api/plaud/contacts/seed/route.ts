// One-shot contact directory seed.
//
// Pulls from email_threads (addresses Spencer has interacted with), recent
// calendar attendees, and leads. Idempotent — re-running only inserts new
// emails. Returns counts per source so the UI can show what landed.

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { seedRepContacts } from '@/lib/plaud/directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const tenant = await requireTenant().catch(() => null)
  if (!tenant) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const result = await seedRepContacts(tenant.id)
  return NextResponse.json({ ok: true, ...result })
}
