import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { logError } from '@/lib/errors'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { sendTelegramMessage } from '@/lib/telegram'
import { buildExecDigest, renderExecBrief } from '@/lib/exec/digest'
import { buildPinnacleBriefData, generateExecSummary, renderRevenueLine } from '@/lib/exec/summary'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { recommendationsFromDigest } from '@/lib/recommendations/engine'
import { loadAgingFollowups } from '@/lib/recommendations/callFollowups'
import { analyzeConversations } from '@/lib/agent/conversationLearnings'
import { supabase } from '@/lib/supabase'
import type { BrandKey } from '@/lib/brand'
import type { Member } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Executive morning brief — CXO Suite tenants only.
 *
 * Cron fires hourly Mon-Fri; we send only to tenants whose local hour is 7am,
 * so each exec gets one consolidated brief at the right time regardless of
 * timezone. The brief rolls up today's calendar, drafts awaiting approval,
 * emails needing replies, quiet deals, and hot/warm priorities — composed in
 * lib/exec/digest. Goes to every owner/admin member who has linked the CXO
 * bot. Sent via the CXO bot (brand: 'cxo').
 *
 * No Claude calls — the digest is pure data + formatting — so this never
 * touches anyone's AI budget.
 */

const SEND_LOCAL_HOUR = 7

function localHour(tz: string | null | undefined, ref: Date = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hour: 'numeric', hour12: false }).format(ref),
    )
  } catch {
    return ref.getUTCHours()
  }
}

async function briefTenant(tenant: Tenant, force: boolean): Promise<number> {
  const tz = tenant.timezone || 'America/New_York'
  if (!force && localHour(tz) !== SEND_LOCAL_HOUR) return 0

  const members = await listMembers(tenant.id)
  // Execs + their assistants: owner/admin members who linked the CXO bot.
  const recipients = members.filter(
    (m: Member) =>
      m.is_active &&
      m.telegram_chat_id &&
      (m.role === 'owner' || m.role === 'admin') &&
      Boolean((m.settings as Record<string, unknown> | undefined)?.cxo_bot_connected),
  )
  if (recipients.length === 0) return 0

  // Pinnacle viewers (Spencer) get a revenue line + an AI-written opener.
  const showRevenue = isPinnacleViewer(tenant.id)
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const pinnacle = showRevenue ? await buildPinnacleBriefData(todayIso).catch(() => null) : null

  // Tenant-level signals for the "what needs you" push (cheap counts, once per
  // tenant): prepared actions awaiting approval + overdue commitments.
  const { count: pendingApprovals } = await supabase
    .from('plaud_actions')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', tenant.id)
    .eq('status', 'pending')
  const { count: overdueCount } = await supabase
    .from('brain_items')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', tenant.id)
    .eq('status', 'open')
    .eq('item_type', 'task')
    .lt('due_date', todayIso)
  const agingFollowups = await loadAgingFollowups(tenant.id).catch(() => undefined)

  let sent = 0
  for (const m of recipients) {
    try {
      const digest = await buildExecDigest(tenant, {
        memberId: m.id,
        timezone: m.timezone || tz,
      })
      const brief = renderExecBrief(digest, {
        name: m.display_name || 'there',
        timezone: m.timezone || tz,
        mode: 'morning',
      })
      // AI opener (best-effort) + revenue line, prepended to the data brief.
      const aiSummary = await generateExecSummary({
        digest,
        pinnacle,
        name: m.display_name || 'there',
        claudeKey: tenant.claude_api_key,
      }).catch(() => '')

      // "What needs you" — the top proactive recommendations, pushed so the exec
      // is told rather than having to open the dashboard. Same engine as the UI.
      const events = digest.todayEvents ?? []
      const nextEvent = events.find((e) => e.start.length === 10 || Date.parse(e.start) >= Date.now()) ?? null
      const recs = recommendationsFromDigest(digest, {
        pendingApprovals: pendingApprovals ?? 0,
        overdue: { count: overdueCount ?? 0, topTitle: null },
        agingFollowups,
        calendar: {
          count: events.length,
          nextSummary: nextEvent?.summary ?? null,
          nextTime:
            nextEvent && nextEvent.start.length > 10
              ? new Date(nextEvent.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: m.timezone || tz })
              : null,
        },
      })
      const topRecs = [...recs]
        .sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1))
        .slice(0, 3)
      const sanitize = (s: string) => s.replace(/[*_`]/g, '')
      const recLine = topRecs.length
        ? `*What needs you*\n${topRecs.map((r) => `• ${sanitize(r.title)}`).join('\n')}`
        : ''

      const parts = [
        aiSummary ? `_${aiSummary}_` : '',
        pinnacle ? renderRevenueLine(pinnacle) : '',
        recLine,
        brief,
      ].filter(Boolean)
      const text = parts.join('\n\n')
      const res = await sendTelegramMessage(m.telegram_chat_id as string, text, { brand: 'cxo' })
      if (res.ok) sent++

      // Once a week (Mon, rep-local), mine the member's chat history for durable
      // learnings + capability gaps. Best-effort; never blocks the brief.
      const weekday = new Date().toLocaleDateString('en-US', { timeZone: m.timezone || tz, weekday: 'short' })
      if (weekday === 'Mon') {
        await analyzeConversations({
          repId: tenant.id,
          claudeKey: tenant.claude_api_key,
          memberId: m.id,
          createdBy: m.display_name,
          history: ((m.settings as Record<string, unknown>)?.agent_history as Array<{ role: string; content: string }>) ?? [],
        }).catch(() => {})
      }
    } catch (err) {
      console.error('[exec-brief] failed for member', m.id, err)
      await logError({
        source: 'cron/exec-brief',
        errorType: 'member_brief_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        memberId: m.id,
        context: { tenant: tenant.slug, memberId: m.id },
      })
    }
  }
  return sent
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ?force=1 lets us trigger a brief on demand for testing, ignoring the hour gate.
  const force = req.nextUrl.searchParams.get('force') === '1'

  const tenants = await getAllActiveTenants()
  const cxoTenants = tenants.filter(
    (t) => ((t as { brand?: BrandKey }).brand ?? 'virtualcloser') === 'cxo',
  )

  let totalSent = 0
  const results: Array<{ slug: string; sent: number }> = []
  for (const tenant of cxoTenants) {
    try {
      const sent = await briefTenant(tenant, force)
      if (sent > 0) results.push({ slug: tenant.slug, sent })
      totalSent += sent
    } catch (err) {
      console.error('[exec-brief] tenant failed', tenant.slug, err)
      await logError({
        source: 'cron/exec-brief',
        errorType: 'tenant_brief_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        context: { tenant: tenant.slug },
      })
    }
  }

  return NextResponse.json({ ok: true, cxoTenants: cxoTenants.length, totalSent, results })
}
