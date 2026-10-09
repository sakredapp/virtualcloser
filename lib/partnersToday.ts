import { supabase } from '@/lib/supabase'
import { getGmailThreadMetadata, listGmailThreads } from '@/lib/google'
import { listPartners, loadPartnerCalendar, meetingsForPartner, pickSenderAccount } from '@/lib/partners'
import type { Partner, PartnerAction, PartnersToday } from '@/lib/partnersShared'

/** YYYY-MM-DD of an instant in a timezone. */
function dayIn(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Everything for the Partners "Today" view in one call. Each source fails
 * soft: no calendar = no meetings, no Gmail = inbound null, no tables = empty.
 */
export async function loadPartnersToday(repId: string, memberId: string | null, tz: string): Promise<PartnersToday> {
  const partners = await listPartners(repId).catch(() => [] as Partner[])
  const byId = new Map(partners.map((p) => [p.id, p]))
  const empty: PartnersToday = { meetings: [], inbound: null, notes: [], calendar_connected: false, timezone: tz }
  if (partners.length === 0) return empty

  const today = dayIn(new Date().toISOString(), tz)

  const meetingsP = loadPartnerCalendar(repId, memberId, { days: 2, timeZone: tz }).then((events) => {
    const out: PartnersToday['meetings'] = []
    const seen = new Set<string>()
    for (const p of partners) {
      for (const m of meetingsForPartner(p, events, 10)) {
        if (seen.has(m.id) || dayIn(m.start, tz) !== today) continue
        seen.add(m.id)
        out.push({ partner_id: p.id, partner_name: p.name, org: p.org, id: m.id, summary: m.summary, start: m.start, end: m.end, htmlLink: m.htmlLink, conferenceLink: m.conferenceLink })
      }
    }
    out.sort((a, b) => a.start.localeCompare(b.start))
    return { meetings: out, connected: events !== null }
  })

  const withEmail = partners.filter((p) => p.email)
  const inboundP = (async (): Promise<PartnersToday['inbound']> => {
    if (withEmail.length === 0) return []
    const { account } = await pickSenderAccount(repId, memberId, null)
    if (!account) return null
    const byEmail = new Map(withEmail.map((p) => [p.email!.toLowerCase(), p]))
    const q = `newer_than:7d from:(${withEmail.slice(0, 40).map((p) => p.email).join(' OR ')})`
    const list = await listGmailThreads(repId, account.memberId, { q, maxResults: 8, accountId: account.accountId })
    if (!list.ok) return null
    const rows = await Promise.all(
      (list.threads ?? []).map(async (t) => {
        const m = await getGmailThreadMetadata(repId, account.memberId, t.id, { accountId: account.accountId }).catch(() => ({ ok: false as const }))
        const meta = m.ok && 'meta' in m ? m.meta : undefined
        const p = meta?.fromAddress ? byEmail.get(meta.fromAddress.toLowerCase()) : undefined
        if (!p) return null
        return { partner_id: p.id, partner_name: p.name, thread_id: t.id, subject: meta?.subject ?? null, snippet: (meta?.snippet ?? t.snippet ?? '').slice(0, 180), at: meta?.lastMessageAt ?? null }
      }),
    )
    return rows.filter((r): r is NonNullable<typeof r> => r !== null)
  })().catch(() => null)

  const notesP = (async () => {
    const { data, error } = await supabase
      .from('cxo_partner_actions')
      .select('*')
      .eq('rep_id', repId)
      .in('kind', ['note', 'task'])
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return []
    return ((data ?? []) as PartnerAction[])
      .filter((a) => a.kind === 'note' || a.status !== 'done')
      .slice(0, 8)
      .map((a) => ({ partner_id: a.partner_id, partner_name: byId.get(a.partner_id)?.name ?? 'Partner', action: a }))
  })().catch(() => [])

  const [m, inbound, notes] = await Promise.all([meetingsP.catch(() => ({ meetings: [], connected: false })), inboundP, notesP])
  return { meetings: m.meetings, inbound, notes, calendar_connected: m.connected, timezone: tz }
}
