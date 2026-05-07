// POST /api/admin/clients/[id]/onboarding-link
//
// Creates (or replaces) an onboarding token for this client and a matching
// Stripe Checkout Session for the build fee. Returns the public onboarding URL.
// Admin-only. The client never needs to log in — the token in the URL is the
// only credential they need to sign + pay.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getClient } from '@/lib/admin-db'
import { createOnboardingToken } from '@/lib/admin-onboarding'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const client = await getClient(id)
  if (!client) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const result = await createOnboardingToken(client)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: result.url, token: result.token })
}
