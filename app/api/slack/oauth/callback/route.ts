import { NextRequest, NextResponse } from 'next/server'
import { getSessionPayload, requireSessionSecret, sessionHomeHost } from '@/lib/client-auth'
import { getBrand } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { getMemberById } from '@/lib/members'
import { canManageSlack, slackConfig, verifySlackState } from '@/lib/slack/shared'
import { exchangeSlackCode, saveInstall, SlackInstallError } from '@/lib/slack/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Slack sends the installer back here (https://www.suitecxo.com/api/slack/oauth/callback)
 * with a code and our signed state. The state must verify, be unexpired and
 * match the signed-in session's company and member, who must still be an
 * owner or admin. The bot token is stored encrypted, then they land back on
 * their own Integrations page. Not set up (no SLACK_* env): 503.
 */
export async function GET(req: NextRequest) {
  const cfg = slackConfig()
  if (!cfg) return new NextResponse(null, { status: 503 })
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
  const back = (flag: string) => NextResponse.redirect(`https://${sessionHomeHost(session)}.${brandRoot}/dashboard/integrations?slack=${flag}`, 303)

  if (url.searchParams.get('error')) return back('cancelled')
  const code = url.searchParams.get('code')
  const state = verifySlackState(requireSessionSecret(), url.searchParams.get('state') ?? '')
  if (!code || !rep || !state || state.repId !== rep.id || (rep as { brand?: string }).brand !== 'cxo') return back('error')
  if (session.memberId && state.memberId !== session.memberId) return back('error')

  const member = await getMemberById(state.memberId)
  if (!member || !member.is_active || member.rep_id !== rep.id || !canManageSlack(member)) return back('not_allowed')

  try {
    const got = await exchangeSlackCode(cfg, code)
    if (!got) return back('error')
    await saveInstall({ repId: rep.id, teamId: got.teamId, teamName: got.teamName, botUserId: got.botUserId, botToken: got.botToken, installedBy: member.id })
  } catch (e) {
    if (e instanceof SlackInstallError && e.message === 'taken') return back('taken')
    console.error('[slack callback] install failed', e instanceof Error ? e.message : e)
    return back('error')
  }
  return back('connected')
}
