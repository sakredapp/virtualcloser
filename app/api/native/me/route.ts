/**
 * Who the phone app is signed in as, and what this account can open. Read on
 * every launch: a 401 here sends the app back to sign-in.
 */
import { NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { canSeeFinancials } from '@/lib/qbo/access'
import { assistantNameFor } from '@/lib/assistantNameServer'
import { inboxAllowed } from '@/lib/cxoFeatures'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (e) {
    if (e instanceof NotExec) return NextResponse.json({ error: 'This app is for the executive team.' }, { status: 403 })
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  }
  const { tenant, member } = ctx
  const role = member.role ?? null
  return NextResponse.json(
    {
      name: member.display_name,
      email: member.email,
      role,
      company: tenant.display_name,
      timezone: member.timezone || tenant.timezone || 'America/New_York',
      // Their own pick, else the company's, else 'Ciao' (lib/assistantNameServer).
      assistantName: await assistantNameFor(ctx),
      pinnacle: pinnacleAllowed(tenant.id),
      canSeeFinancials: canSeeFinancials(member),
      // The email inbox / Gmail: Pinnacle edition only (owner 2026-10-17). The app hides its inbox without it.
      features: { inbox: inboxAllowed(tenant) },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
