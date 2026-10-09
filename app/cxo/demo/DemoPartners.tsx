'use client'

import { useMemo, useRef } from 'react'
import PartnersBoard, { type ComposeResult, type PartnerDetail, type PartnersApi, type SendResult } from '@/app/components/cxo/PartnersBoard'
import { directorySort, kindsForType, type Partner, type PartnerAction, type PartnerInput, type PartnersToday } from '@/lib/partnersShared'

/**
 * The Partners page on the public demo: six invented executive partners held in
 * memory, every Actions item working (drafts, sends, tasks) without a server.
 * Figures in the demo report are fixed and clearly from the demo book.
 */

const REP = 'demo'
const T0 = Date.parse('2026-10-08T15:00:00Z')
const iso = (daysFromNow: number, hour = 14) => new Date(T0 + daysFromNow * 86400_000 + (hour - 15) * 3600_000).toISOString()

function mk(i: number, p: Omit<PartnerInput, 'tags'> & { kind: Partner['kind'] }): Partner {
  return { ...p, id: `p${i}`, rep_id: REP, name: p.name, org: p.org ?? null, role: p.role ?? null, kind: p.kind, email: p.email ?? null, phone: p.phone ?? null, notes: p.notes ?? null, tags: (p as PartnerInput).tags ?? [], owner_member_id: null, created_at: iso(-200), updated_at: iso(-3) } as Partner
}

const SEED: Partner[] = [
  mk(1, { name: 'Dana Whitfield', org: 'Mutual of Omaha', role: 'Regional VP, Brokerage', kind: 'carrier', email: 'dana.whitfield@example.com', phone: '(402) 555-0141', notes: 'Simplified-issue pilot opens in November; Southeast team first.' }),
  mk(2, { name: 'Marcus Bell', org: 'Harbor Financial', role: 'Principal', kind: 'agency', email: 'marcus@example.com', phone: '(813) 555-0192', notes: 'Best September on record. Wants his own line on the board deck.' }),
  mk(3, { name: 'Priya Natarajan', org: 'Pinnacle Life Group', role: 'Board member', kind: 'board', email: 'priya.n@example.com', notes: 'Asks for cost per issued policy by team every quarter.' }),
  mk(4, { name: 'Tom Reyes', org: 'Foresters Financial', role: 'National Accounts', kind: 'carrier', email: 'treyes@example.com', phone: '(416) 555-0107', notes: 'Decline rate in the Southeast is the open item.' }),
  mk(5, { name: 'Lena Okafor', org: 'Summit Agency Partners', role: 'Managing Partner', kind: 'agency', email: 'lena@example.com', notes: 'Onboarding 12 new producers in Q4.' }),
  mk(6, { name: 'Chris Delgado', org: 'Athene', role: 'Annuity Wholesaler', kind: 'carrier', email: 'cdelgado@example.com', notes: 'Rate update expected mid-October.' }),
]

const SEED_ACTIONS: PartnerAction[] = [
  { id: 'a1', partner_id: 'p1', rep_id: REP, kind: 'report', subject: 'Pinnacle Life Group production — Health trailing 3 months', body: '', status: 'sent', sent_to: 'dana.whitfield@example.com', channel: 'gmail', provider_id: 'demo', draft_id: null, from_account: 'michael@pinnaclelifegroup.com', thread_id: null, created_by: null, created_at: iso(-9), sent_at: iso(-9), due_at: null },
  { id: 'a2', partner_id: 'p2', rep_id: REP, kind: 'meeting', subject: 'Call booked: Pinnacle × Harbor Financial', body: '', status: 'done', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-2), sent_at: null, due_at: null },
  { id: 'a3', partner_id: 'p3', rep_id: REP, kind: 'task', subject: null, body: 'Add cost per issued policy by team to the board deck', status: 'draft', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-1), sent_at: null, due_at: iso(6) },
  { id: 'a4', partner_id: 'p4', rep_id: REP, kind: 'email', subject: 'Southeast declines — what we are seeing', body: '', status: 'sent', sent_to: 'treyes@example.com', channel: 'gmail', provider_id: 'demo', draft_id: null, from_account: 'michael@pinnaclelifegroup.com', thread_id: null, created_by: null, created_at: iso(-4), sent_at: iso(-4), due_at: null },
  { id: 'a5', partner_id: 'p5', rep_id: REP, kind: 'note', subject: null, body: 'Lena wants a producer-level split of Q4 issued premium before her onboarding class starts.', status: 'done', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-1), sent_at: null, due_at: null },
]

/** Times today in the viewer's clock, so the demo Today view is always "today". */
const DEMO_TZ = 'America/Chicago'
/** The demo's "today" is pinned with the rail clock: Thursday Oct 8, 2026, Central (UTC-5). */
function todayAt(h: number, m = 0): string {
  return new Date(Date.UTC(2026, 9, 8, h + 5, m)).toISOString()
}

function demoToday(store: { partners: Partner[]; actions: PartnerAction[] }): PartnersToday {
  const name = (id: string) => store.partners.find((p) => p.id === id)?.name
  const meetings: PartnersToday['meetings'] = [
    { partner_id: 'p2', partner_name: 'Marcus Bell', org: 'Harbor Financial', id: 't1', summary: 'Harbor Financial · Q4 production review', start: todayAt(10), end: todayAt(10, 30), htmlLink: '#calendar', conferenceLink: undefined },
    { partner_id: 'p1', partner_name: 'Dana Whitfield', org: 'Mutual of Omaha', id: 't2', summary: 'Mutual of Omaha · simplified-issue pilot', start: todayAt(14), end: todayAt(15), htmlLink: '#calendar', conferenceLink: undefined },
  ].filter((m) => name(m.partner_id))
  const ago = (h: number) => new Date(Date.parse('2026-10-08T14:14:00Z') - h * 3600_000).toISOString()
  const inbound: NonNullable<PartnersToday['inbound']> = [
    { partner_id: 'p4', partner_name: 'Tom Reyes', thread_id: 'g1', subject: 'Re: Southeast declines', snippet: 'Underwriting pulled the Q3 declines by state. Florida and Georgia account for most of it; sending the file Monday.', at: ago(5) },
    { partner_id: 'p6', partner_name: 'Chris Delgado', thread_id: 'g2', subject: 'Rate update effective Oct 20', snippet: 'New fixed-index caps attached. Happy to walk your agency principals through it next week.', at: ago(26) },
    { partner_id: 'p3', partner_name: 'Priya Natarajan', thread_id: 'g3', subject: 'Board pack for Thursday', snippet: 'Could we add cost per issued policy by team and the placement trend? Same format as last quarter is fine.', at: ago(49) },
  ].filter((m) => name(m.partner_id))
  const notes = store.actions
    .filter((a) => a.kind === 'note' || (a.kind === 'task' && a.status !== 'done'))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8)
    .map((a) => ({ partner_id: a.partner_id, partner_name: name(a.partner_id) ?? 'Partner', action: a }))
  return { meetings, inbound, notes, calendar_connected: true, timezone: DEMO_TZ, now: '2026-10-08T14:14:00Z' }
}

const MEETINGS: Record<string, PartnerDetail['meetings']> = {
  p1: [{ id: 'm1', summary: 'Mutual of Omaha · simplified-issue pilot', start: iso(1, 15), end: iso(1, 16), htmlLink: '#calendar', matched_by: 'email' }],
  p2: [{ id: 'm2', summary: 'Harbor Financial · Q4 plan', start: iso(5, 14), end: iso(5, 14.5), htmlLink: '#calendar', matched_by: 'email' }],
  p3: [{ id: 'm3', summary: 'Board prep', start: iso(6, 16), end: iso(6, 17), htmlLink: '#calendar', matched_by: 'name' }],
  p6: [{ id: 'm4', summary: 'Athene rate update', start: iso(8, 13), end: iso(8, 13.5), htmlLink: '#calendar', matched_by: 'org' }],
}

const SENDER = { ready: true, via: 'gmail' as const, from: 'michael@pinnaclelifegroup.com', accounts: [{ email: 'michael@pinnaclelifegroup.com', label: 'Michael' }] }

const FIG: Record<string, Record<string, { premium: string; policies: string; delta: string }>> = {
  Health: { '3m': { premium: '$2.41M', policies: '1,884', delta: 'up 9% vs the 3 months before' }, '6m': { premium: '$4.63M', policies: '3,590', delta: 'up 6% vs the 6 months before' }, '12m': { premium: '$8.97M', policies: '7,012', delta: 'up 11% vs the 12 months before' }, ytd: { premium: '$7.12M', policies: '5,540', delta: 'up 12% vs last year to date' } },
  Life: { '3m': { premium: '$1.08M', policies: '612', delta: 'up 14% vs the 3 months before' }, '6m': { premium: '$2.02M', policies: '1,170', delta: 'up 10% vs the 6 months before' }, '12m': { premium: '$3.71M', policies: '2,205', delta: 'up 8% vs the 12 months before' }, ytd: { premium: '$2.95M', policies: '1,744', delta: 'up 9% vs last year to date' } },
  Annuity: { '3m': { premium: '$640K', policies: '41', delta: 'down 4% vs the 3 months before' }, '6m': { premium: '$1.33M', policies: '86', delta: 'flat vs the 6 months before' }, '12m': { premium: '$2.48M', policies: '160', delta: 'up 3% vs the 12 months before' }, ytd: { premium: '$1.96M', policies: '127', delta: 'up 2% vs last year to date' } },
}
const WINDOW_TEXT: Record<string, string> = { '3m': 'the last 3 months (Jul 9, 2026 – Oct 8, 2026)', '6m': 'the last 6 months (Apr 9, 2026 – Oct 8, 2026)', '12m': 'the last 12 months (Oct 9, 2025 – Oct 8, 2026)', ytd: 'year to date (Jan 1, 2026 – Oct 8, 2026)' }
const WINDOW_SHORT: Record<string, string> = { '3m': 'trailing 3 months', '6m': 'trailing 6 months', '12m': 'trailing 12 months', ytd: 'year to date' }

function demoApi(store: { partners: Partner[]; actions: PartnerAction[] }): PartnersApi {
  let n = 100
  const id = () => `d${n++}`
  const detail = async (pid: string): Promise<PartnerDetail> => {
    const partner = store.partners.find((p) => p.id === pid)
    if (!partner) throw new Error('Not found')
    return {
      partner,
      meetings: MEETINGS[pid] ?? [],
      actions: store.actions.filter((a) => a.partner_id === pid).sort((a, b) => (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at)),
      sender: SENDER,
      calendar: { connected: true, canWrite: true },
      timezone: 'America/Chicago',
    }
  }
  return {
    list: async (q, type) => {
      const needle = q.trim().toLowerCase()
      const kinds = type ? kindsForType(type) : null
      return store.partners.filter((p) => (!kinds || kinds.includes(p.kind)) && (!needle || [p.name, p.org, p.role, p.email, p.phone].some((s) => (s ?? '').toLowerCase().includes(needle)))).sort(directorySort)
    },
    detail,
    create: async (input) => {
      const p = mk(0, { ...input, kind: input.kind ?? 'other' })
      const row = { ...p, id: id() }
      store.partners = [...store.partners, row].sort((a, b) => a.name.localeCompare(b.name))
      return row
    },
    update: async (pid, input) => {
      const cur = store.partners.find((p) => p.id === pid)!
      const next = { ...cur, ...input, kind: input.kind ?? cur.kind, updated_at: new Date().toISOString() } as Partner
      store.partners = store.partners.map((p) => (p.id === pid ? next : p))
      return next
    },
    remove: async (pid) => { store.partners = store.partners.filter((p) => p.id !== pid) },
    importRows: async (rows) => {
      // In memory only, like everything else on the demo: same dedupe order as the real import.
      let added = 0, updated = 0, skipped = 0
      for (const r of rows) {
        const name = r.name?.trim()
        const email = r.email?.trim().toLowerCase()
        const hit = store.partners.find((p) => (email && p.email?.toLowerCase() === email) || (name && p.name.toLowerCase() === name.toLowerCase() && (p.org ?? '').toLowerCase() === (r.org ?? '').toLowerCase()))
        if (hit) { store.partners = store.partners.map((p) => (p === hit ? { ...p, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== '')) } as Partner : p)); updated++; continue }
        if (!name) { skipped++; continue }
        store.partners = [...store.partners, { ...mk(0, { ...r, name, kind: r.kind ?? 'other' }), id: id() }]
        added++
      }
      return { added, updated, skipped }
    },
    compose: async (pid, req): Promise<ComposeResult> => {
      const partner = store.partners.find((p) => p.id === pid)!
      const first = partner.name.split(' ')[0]
      let subject: string
      let body: string
      const missing: string[] = []
      if (req.kind === 'report') {
        const lines = req.items.map((it) => {
          const f = FIG[it.line]?.[it.window]
          if (!f) { missing.push(`${it.line} premium for ${WINDOW_TEXT[it.window] ?? it.window}`); return `${it.line} issued premium, ${WINDOW_TEXT[it.window] ?? it.window}: no data synced for this period yet. I will follow up once it is in.` }
          return `${it.line} issued premium, ${WINDOW_TEXT[it.window]}: ${f.premium} across ${f.policies} policies (${f.delta}).`
        })
        subject = `Pinnacle Life Group production — ${req.items.map((it) => `${it.line} ${WINDOW_SHORT[it.window] ?? it.window}`).join(', ')}`
        body = [`Hi ${first},`, '', req.intro?.trim() || 'Here are the Pinnacle Life Group production figures you asked for.', '', ...lines, '', 'Data through October 8, 2026.', '', req.closing?.trim() || 'Happy to walk through any of it on a call.', '', 'Michael Cavaleri', 'Pinnacle Life Group'].join('\n')
      } else {
        subject = req.subject.trim() || (req.kind === 'note' ? 'Note from Michael Cavaleri' : 'From Michael Cavaleri, Pinnacle Life Group')
        body = req.body.trim()
      }
      const draft: PartnerAction = { id: id(), partner_id: pid, rep_id: REP, kind: req.kind, subject, body, status: 'draft', sent_to: partner.email, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: new Date().toISOString(), sent_at: null, due_at: null }
      store.actions = [draft, ...store.actions]
      await new Promise((r) => window.setTimeout(r, 600))
      return { draft, subject, body, missing, data_through: 'October 8, 2026', sender: SENDER }
    },
    send: async (pid, draftId): Promise<SendResult> => {
      const draft = store.actions.find((a) => a.id === draftId)
      if (!draft) return { sent: false, reason: 'Draft not found.' }
      const sent: PartnerAction = { ...draft, status: 'sent', channel: 'gmail', provider_id: 'demo', sent_at: new Date().toISOString() }
      store.actions = store.actions.map((a) => (a.id === draftId ? sent : a))
      await new Promise((r) => window.setTimeout(r, 500))
      return { sent: true, via: 'gmail', from: SENDER.from, action: sent }
    },
    record: async (pid, input) => {
      const a: PartnerAction = { id: id(), partner_id: pid, rep_id: REP, kind: input.kind, subject: input.subject ?? null, body: input.body, status: input.kind === 'task' ? 'draft' : 'done', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: new Date().toISOString(), sent_at: null, due_at: input.due_at ? new Date(input.due_at).toISOString() : null }
      store.actions = [a, ...store.actions]
      return a
    },
    done: async (_pid, actionId) => { store.actions = store.actions.map((a) => (a.id === actionId ? { ...a, status: 'done' } : a)) },
    askMira: (text) => window.dispatchEvent(new CustomEvent('mira:ask', { detail: { text } })),
    today: async () => demoToday(store),
  }
}

export default function DemoPartners() {
  const store = useRef({ partners: SEED, actions: SEED_ACTIONS })
  const api = useMemo(() => demoApi(store.current), [])
  return <PartnersBoard api={api} initial={SEED} hint="Demo: six invented partners. Drafts, sends and tasks work in memory and reset on reload." />
}
