// Executive digest — the data behind the daily brief, proactive nudges, and
// the Command Center dashboard rollup. One composer, three consumers, so the
// "what needs you today" logic lives in exactly one place.

import { supabase } from '@/lib/supabase'
import { getDormantLeads, getLeadsByPriority } from '@/lib/supabase'
import { listUpcomingEvents } from '@/lib/google'
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

  const [
    draftsRes,
    quietRaw,
    priorityRaw,
    eventsRaw,
    changesRes,
    unansweredRes,
  ] = await Promise.all([
    supabase
      .from('email_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', tenant.id)
      .eq('status', 'pending'),
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
    supabase
      .from('email_threads')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', tenant.id)
      .eq('needs_reply', true)
      .neq('status', 'drafted'),
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

/** True if the digest has anything worth pinging the exec about. */
export function digestHasSignal(d: ExecDigest): boolean {
  return (
    d.pendingDrafts > 0 ||
    d.quietDeals.length > 0 ||
    d.unansweredThreads > 0 ||
    (d.todayEvents?.length ?? 0) > 0
  )
}

function money(v: number | null): string {
  if (!v) return ''
  if (v >= 1000) return ` ($${(v / 1000).toFixed(0)}k)`
  return ` ($${v})`
}

function fmtTime(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    })
  } catch {
    return ''
  }
}

/**
 * Render the digest as a Telegram-Markdown brief. `mode` tunes the framing:
 *   - 'morning' → full "here's your day" brief
 *   - 'nudge'   → terse "things waiting on you" ping (only signal items)
 */
export function renderExecBrief(
  d: ExecDigest,
  opts: { name: string; timezone?: string; mode?: 'morning' | 'nudge' } = { name: 'there' },
): string {
  const tz = opts.timezone || 'America/New_York'
  const mode = opts.mode ?? 'morning'
  const lines: string[] = []

  if (mode === 'morning') {
    const first = opts.name.split(' ')[0] || opts.name
    lines.push(`*Good morning, ${first}.* Here's your day.`)
    lines.push('')
  } else {
    lines.push('*A few things waiting on you:*')
    lines.push('')
  }

  // Calendar (morning only)
  if (mode === 'morning' && d.todayEvents) {
    if (d.todayEvents.length === 0) {
      lines.push('📅 *Calendar:* nothing scheduled today.')
    } else {
      lines.push(`📅 *Today (${d.todayEvents.length}):*`)
      for (const e of d.todayEvents.slice(0, 6)) {
        const t = fmtTime(e.start, tz)
        const join = e.conferenceLink ? ` — [join](${e.conferenceLink})` : ''
        lines.push(`  • ${t} ${e.summary}${join}`)
      }
    }
    lines.push('')
  }

  // Decisions / approvals
  if (d.pendingDrafts > 0) {
    lines.push(`✍️ *${d.pendingDrafts} email draft${d.pendingDrafts === 1 ? '' : 's'}* awaiting your approval.`)
  }
  if (d.unansweredThreads > 0) {
    lines.push(`📬 *${d.unansweredThreads} email${d.unansweredThreads === 1 ? '' : 's'}* still need a reply.`)
  }

  // Quiet deals
  if (d.quietDeals.length > 0) {
    lines.push('')
    lines.push(`🥶 *Gone quiet (${d.quietDeals.length}):*`)
    for (const q of d.quietDeals) {
      const co = q.company ? ` · ${q.company}` : ''
      lines.push(`  • ${q.name}${co}${money(q.value)} — ${q.days}d no contact`)
    }
  }

  // Top priorities (morning only)
  if (mode === 'morning' && d.topLeads.length > 0) {
    lines.push('')
    lines.push(`🔥 *Hot/warm (${d.topLeads.length}):*`)
    for (const l of d.topLeads) {
      const co = l.company ? ` · ${l.company}` : ''
      lines.push(`  • ${l.name}${co}${money(l.value)}`)
    }
  }

  if (mode === 'morning' && d.overnightChanges > 0) {
    lines.push('')
    lines.push(`_${d.overnightChanges} update${d.overnightChanges === 1 ? '' : 's'} across your team since last night._`)
  }

  lines.push('')
  lines.push('_Reply here to act on any of this — I\'m your assistant._')

  return lines.join('\n')
}
