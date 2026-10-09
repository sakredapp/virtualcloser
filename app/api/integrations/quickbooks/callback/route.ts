import { NextRequest, NextResponse } from 'next/server'
import { getSessionPayload, requireSessionSecret, sessionHomeHost } from '@/lib/client-auth'
import { getBrand } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { getMemberById } from '@/lib/members'
import { exchangeQboCode, qboConfig, verifyQboState } from '@/lib/qbo/shared'
import { canSeeFinancials, safeQboReturn } from '@/lib/qbo/access'
import { saveQboConnection, syncQbo } from '@/lib/qbo/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Intuit redirects here (https://suitecxo.com/api/integrations/quickbooks/callback,
 * the apex, like the Google callback) with code, realmId and our signed
 * state. The state must verify, be unexpired and match the signed-in
 * session's org and member; the member must still be an exec. Then the
 * tokens are stored encrypted and the first sync runs before we land them
 * back on their own subdomain.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const session = await getSessionPayload()
  if (!session) return NextResponse.redirect(new URL('/login', req.url))

  const { data: rep } = await supabase
    .from('reps')
    .select('id, brand')
    .or(`slug.eq.${session.slug},host_aliases.cs.{${session.slug}}`)
    .eq('is_active', true)
    .maybeSingle()
  const brandRoot = getBrand((rep as { brand?: string } | null)?.brand).rootDomain
  const state = verifyQboState(requireSessionSecret(), url.searchParams.get('state') ?? '')
  const ret = safeQboReturn(state?.ret)
  const back = (flag: string) => NextResponse.redirect(`https://${sessionHomeHost(session)}.${brandRoot}${ret}?qbo=${flag}`, 303)

  const cfg = qboConfig()
  if (!cfg) return back('not_set_up')
  if (url.searchParams.get('error')) return back('cancelled')
  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId')
  if (!code || !realmId || !/^\d{1,32}$/.test(realmId)) return back('error')
  if (!rep || !state || state.repId !== rep.id) return back('error')
  if (session.memberId && state.memberId !== session.memberId) return back('error')

  const member = await getMemberById(state.memberId)
  if (!member || !member.is_active || member.rep_id !== rep.id || !canSeeFinancials(member)) return back('not_allowed')

  try {
    const tokens = await exchangeQboCode(cfg, code)
    await saveQboConnection({
      repId: rep.id,
      realmId,
      environment: cfg.environment,
      tokens,
      memberId: member.id,
      memberName: member.display_name ?? null,
    })
  } catch (e) {
    console.error('[qbo callback] connect failed', e instanceof Error ? e.message : e)
    return back('error')
  }
  const sync = await syncQbo(rep.id)
  return back(sync.ok ? 'connected' : 'connected_sync_pending')
}
