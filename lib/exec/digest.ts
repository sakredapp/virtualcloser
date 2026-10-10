// Executive digest — the data behind the daily brief, proactive nudges, and
// the Command Center dashboard rollup. One composer, three consumers, so the
// "what needs you today" logic lives in exactly one place.

import { supabase } from '@/lib/supabase'
import { getDormantLeads, getLeadsByPriority } from '@/lib/supabase'
import { listUpcomingEvents } from '@/lib/google'
import { getMailboxScopeById, scopeThreadQuery } from '@/lib/email/mailboxAccess'
import type { Tenant } from '@/lib/tenant'
import type { Lead } from '@/types'

export type ExecDigest = {
  /** Pending email drafts awaiting the exec's approval (Gmail triage). */
  pendingDrafts: number
  /** Deals that have gone quiet (no contact in N days) AND carry a value. */
  quietDeals: Array<{ name: string; company: string | null; value: number | null; days: number }>
  /** Today's calendar events (member's Google Calendar). null = not connected. */
  todayEvents: Array<{ summary: string; start: string; conferenceLink?: string }> | null
  /** Top-priority leads (hot/warm first). */
  topLeads: Array<{ name: string; company: string | null; status: string; value: number | null }>
  /** Count of changes in the account since `sinceIso` (overnight activity). */
  overnightChanges: number
  /** Threads still awaiting a reply (inbound, needs_reply, not yet drafted/sent). */
  unansweredThreads: number
}

const QUIET_DAYS = 10

function daysSince(iso: string | null): number {
  if (!iso) return 999
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

/**
 * Build the executive digest for a tenant's owner/exec member. Every source is
 * best-effort: a failure in one section (e.g. calendar not connected) degrades
 * to a safe empty value rather than failing the whole digest.
 */
export async function buildExecDigest(
  tenant: Tenant,
  opts: { memberId?: string | null; timezone?: string; sinceIso?: string } = {},
): Promise<ExecDigest> {
  const tz = opts.timezone || tenant.timezone || 'America/New_York'
  const sinceIso = opts.sinceIso ?? new Date(Date.now() - 16 * 3600_000).toISOString()

  // Day window in the member's timezone for "today's calendar".
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
  const fromIso = new Date(`${todayStr}T00:00:00`).toISOString()
  const toIso = new Date(`${todayStr}T23:59:59`).toISOString()

  // Email counts cover ONLY the member's own mailbox (owner 10-09): never
  // the workspace's other inboxes or a former member's shared mailbox.
  const mailboxScope = await getMailboxScopeById(tenant.id, opts.memberId ?? null).catch(() => null)
  const box = mailboxScope && mailboxScope.mailboxes.length > 0 ? mailboxScope.mailboxes[0] : null
  const zeroCount = Promise.resolve({ count: 0 })

  const [
    draftsRes,
    quietRaw,
    priorityRaw,
    eventsRaw,
    changesRes,
    unansweredRes,
  ] = await Promise.all([
    box
      ? scopeThreadQuery(
          supabase.from('email_drafts').select('id', { count: 'exact', head: true }).eq('rep_id', tenant.id),
          box,
        ).eq('status', 'pending')
      : zeroCount,
    getDormantLeads(tenant.id, QUIET_DAYS).catch(() => [] as Lead[]),
    getLeadsByPriority(tenant.id).catch(() => [] as Lead[]),
    listUpcomingEvents(tenant.id, {
      fromIso,
      toIso,
      timeZone: tz,
      memberId: opts.memberId ?? null,
      maxResults: 20,
    }).catch(() => null),
    supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', tenant.id)
      .gte('created_at', sinceIso),
    box
      ? scopeThreadQuery(
          supabase.from('email_threads').select('id', { count: 'exact', head: true }).eq('rep_id', tenant.id),
          box,
        )
          .eq('needs_reply', true)
          .neq('status', 'drafted')
      : zeroCount,
  ])

  const quietDeals = (quietRaw as Lead[])
    .filter((l) => (l.deal_value ?? 0) > 0)
    .sort((a, b) => (b.deal_value ?? 0) - (a.deal_value ?? 0))
    .slice(0, 5)
    .map((l) => ({
      name: l.name,
      company: l.company,
      value: l.deal_value ?? null,
      days: daysSince(l.last_contact),
    }))

  const topLeads = (priorityRaw as Lead[])
    .filter((l) => l.status === 'hot' || l.status === 'warm')
    .slice(0, 5)
    .map((l) => ({ name: l.name, company: l.company, status: l.status, value: l.deal_value ?? null }))

  const todayEvents = eventsRaw
    ? eventsRaw.map((e) => ({ summary: e.summary, start: e.start, conferenceLink: e.conferenceLink }))
    : null

  return {
    pendingDrafts: draftsRes.count ?? 0,
    quietDeals,
    todayEvents,
    topLeads,
    overnightChanges: changesRes.count ?? 0,
    unansweredThreads: unansweredRes.count ?? 0,
  }
}
