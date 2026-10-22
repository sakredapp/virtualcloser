'use client'

import { useMemo, useRef } from 'react'
import PartnersBoard, { type ComposeResult, type PartnerDetail, type PartnersApi, type PartnersWords, type SendResult } from '@/app/components/cxo/PartnersBoard'
import { REPORT_LINES, directorySort, kindsForType, scopeOfKind, type Partner, type PartnerAction, type PartnerInput, type PartnersToday, type ReportLine } from '@/lib/partnersShared'
import { DAY_MS, DEMO_DAY, DEMO_NOW, fullDate, monthsBack, shortDate } from './demoClock'

/**
 * The Partners page on the public demo: six invented executive partners held in
 * memory, every Actions item working (drafts, sends, tasks) without a server.
 * Figures in the demo report are fixed and clearly from the demo company, and
 * every date counts from today (./demoClock).
 */

const REP = 'demo'
const T0 = DEMO_DAY + 15 * 3600_000
const iso = (daysFromNow: number, hour = 14) => new Date(T0 + daysFromNow * 86400_000 + (hour - 15) * 3600_000).toISOString()

function mk(i: number, p: Omit<PartnerInput, 'tags'> & { kind: Partner['kind'] }): Partner {
  return { ...p, id: `p${i}`, rep_id: REP, name: p.name, org: p.org ?? null, role: p.role ?? null, kind: p.kind, email: p.email ?? null, phone: p.phone ?? null, notes: p.notes ?? null, tags: (p as PartnerInput).tags ?? [], owner_member_id: null, created_at: iso(-200), updated_at: iso(-3) } as Partner
}

const SEED: Partner[] = [
  mk(1, { name: 'Dana Whitfield', org: 'Ridgeline Partners', role: 'Managing Director', kind: 'other', email: 'dana.whitfield@example.com', phone: '(402) 555-0141', notes: 'Sends us most of our referral work in the Southeast. Wants a quarterly look at what came of it.' }),
  mk(2, { name: 'Marcus Bell', org: 'Harbor Advisory', role: 'Principal', kind: 'other', email: 'marcus@example.com', phone: '(813) 555-0192', notes: 'Best month this year. Wants his own line in the board pack.' }),
  mk(3, { name: 'Priya Natarajan', org: 'Northgate Group', role: 'Board member', kind: 'board', email: 'priya.n@example.com', notes: 'Asks for margin by office every quarter.' }),
  mk(4, { name: 'Tom Reyes', org: 'Halvorsen Logistics', role: 'VP Operations', kind: 'carrier', email: 'treyes@example.com', phone: '(416) 555-0107', notes: 'Second warehouse rollout next quarter is the open item.' }),
  mk(5, { name: 'Lena Okafor', org: 'Summit Consulting', role: 'Managing Partner', kind: 'other', email: 'lena@example.com', notes: 'Bringing on 12 new consultants this quarter.' }),
  mk(6, { name: 'Chris Delgado', org: 'Larkfield Software', role: 'Account Director', kind: 'vendor', email: 'cdelgado@example.com', notes: 'Licence renewal and new pricing due this month.' }),
]

const SEED_ACTIONS: PartnerAction[] = [
  { id: 'a1', partner_id: 'p1', rep_id: REP, kind: 'report', subject: 'Northgate Group numbers — Advisory trailing 3 months', body: '', status: 'sent', sent_to: 'dana.whitfield@example.com', channel: 'ses', provider_id: 'demo', draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-9), sent_at: iso(-9), due_at: null },
  { id: 'a2', partner_id: 'p2', rep_id: REP, kind: 'meeting', subject: 'Call booked: Northgate × Harbor Advisory', body: '', status: 'done', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-2), sent_at: null, due_at: null },
  { id: 'a3', partner_id: 'p3', rep_id: REP, kind: 'task', subject: null, body: 'Add margin by office to the board pack', status: 'draft', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-1), sent_at: null, due_at: iso(6) },
  { id: 'a4', partner_id: 'p4', rep_id: REP, kind: 'email', subject: 'Second warehouse rollout — first thoughts', body: '', status: 'sent', sent_to: 'treyes@example.com', channel: 'ses', provider_id: 'demo', draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-4), sent_at: iso(-4), due_at: null },
  { id: 'a5', partner_id: 'p5', rep_id: REP, kind: 'note', subject: null, body: 'Lena wants a consultant-level split of this quarter\'s collected revenue before her new starters begin.', status: 'done', sent_to: null, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: iso(-1), sent_at: null, due_at: null },
]

/** Times today in the viewer's clock, so the demo Today view is always "today". */
const DEMO_TZ = 'America/Chicago'
/** A time today, Central (UTC-5), on the same clock as the rail. */
function todayAt(h: number, m = 0): string {
  return new Date(DEMO_DAY + (h + 5) * 3600_000 + m * 60_000).toISOString()
}

function demoToday(store: { partners: Partner[]; actions: PartnerAction[] }): PartnersToday {
  const name = (id: string) => store.partners.find((p) => p.id === id)?.name
  const meetings: PartnersToday['meetings'] = [
    { partner_id: 'p2', partner_name: 'Marcus Bell', org: 'Harbor Advisory', id: 't1', summary: 'Harbor Advisory · quarterly review', start: todayAt(10), end: todayAt(10, 30), htmlLink: '#calendar', conferenceLink: undefined },
    { partner_id: 'p1', partner_name: 'Dana Whitfield', org: 'Ridgeline Partners', id: 't2', summary: 'Ridgeline Partners · referral review', start: todayAt(14), end: todayAt(15), htmlLink: '#calendar', conferenceLink: undefined },
  ].filter((m) => name(m.partner_id))
  const notes = store.actions
    .filter((a) => a.kind === 'note' || (a.kind === 'task' && a.status !== 'done'))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8)
    .map((a) => ({ partner_id: a.partner_id, partner_name: name(a.partner_id) ?? 'Partner', action: a }))
  // No inbox in the demo (owner 2026-10-17): "what they sent" is hidden.
  return { meetings, inbound: null, notes, calendar_connected: true, timezone: DEMO_TZ, email_on: false, now: DEMO_NOW.toISOString() }
}

const MEETINGS: Record<string, PartnerDetail['meetings']> = {
  p1: [{ id: 'm1', summary: 'Ridgeline Partners · referral review', start: iso(1, 15), end: iso(1, 16), htmlLink: '#calendar', matched_by: 'email' }],
  p2: [{ id: 'm2', summary: 'Harbor Advisory · next quarter plan', start: iso(5, 14), end: iso(5, 14.5), htmlLink: '#calendar', matched_by: 'email' }],
  p3: [{ id: 'm3', summary: 'Board prep', start: iso(6, 16), end: iso(6, 17), htmlLink: '#calendar', matched_by: 'name' }],
  p6: [{ id: 'm4', summary: 'Larkfield licence renewal', start: iso(8, 13), end: iso(8, 13.5), htmlLink: '#calendar', matched_by: 'org' }],
}

// Suite CXO mail, replies to the exec: the demo has no inbox (owner 2026-10-17).
const SENDER = { ready: true, via: 'ses' as const, from: '"Andrew via Suite CXO" <noreply@mail.suitecxo.example>', accounts: [] as Array<{ email: string | null; label: string }>, inbox: false }

// The demo company's three service lines stand in for the report lines.
const LINE_NAMES = ['Advisory', 'Projects', 'Retainers'] as const
const LINE_LABEL = Object.fromEntries(REPORT_LINES.map((l, i) => [l, LINE_NAMES[i]])) as Record<ReportLine, string>
const lineName = (l: string) => (LINE_LABEL as Record<string, string>)[l] ?? l
const WORDS: Partial<PartnersWords> = {
  partnersSubtitle: 'Clients, vendors and outside partners.',
  typeLabel: { executive: 'Exec', carrier: 'Client', vendor: 'Vendor', other: 'Partner' },
  typePlural: { executive: 'Execs', carrier: 'Clients', vendor: 'Vendors', other: 'Partners' },
  lineLabel: LINE_LABEL,
  askExample: (name) => `Send ${name} the advisory revenue for the last 3 months and projects for the last 6 months.`,
}

const FIG: Record<string, Record<string, { revenue: string; count: string; delta: string }>> = {
  Advisory: { '3m': { revenue: '$6.1M', count: '312', delta: 'up 9% vs the 3 months before' }, '6m': { revenue: '$11.8M', count: '604', delta: 'up 6% vs the 6 months before' }, '12m': { revenue: '$22.9M', count: '1,190', delta: 'up 11% vs the 12 months before' }, ytd: { revenue: '$18.4M', count: '950', delta: 'up 12% vs last year to date' } },
  Projects: { '3m': { revenue: '$7.3M', count: '146', delta: 'up 14% vs the 3 months before' }, '6m': { revenue: '$13.9M', count: '288', delta: 'up 10% vs the 6 months before' }, '12m': { revenue: '$26.1M', count: '540', delta: 'up 8% vs the 12 months before' }, ytd: { revenue: '$20.7M', count: '431', delta: 'up 9% vs last year to date' } },
  Retainers: { '3m': { revenue: '$3.4M', count: '480', delta: 'down 4% vs the 3 months before' }, '6m': { revenue: '$6.9M', count: '955', delta: 'flat vs the 6 months before' }, '12m': { revenue: '$13.6M', count: '1,880', delta: 'up 3% vs the 12 months before' }, ytd: { revenue: '$10.8M', count: '1,500', delta: 'up 2% vs last year to date' } },
}
const since = (t: number) => `${shortDate(t + DAY_MS)} – ${shortDate(DEMO_DAY)}`
const WINDOW_TEXT: Record<string, string> = {
  '3m': `the last 3 months (${since(monthsBack(3))})`,
  '6m': `the last 6 months (${since(monthsBack(6))})`,
  '12m': `the last 12 months (${since(monthsBack(12))})`,
  ytd: `year to date (${shortDate(Date.UTC(new Date(DEMO_DAY).getUTCFullYear(), 0, 1))} – ${shortDate(DEMO_DAY)})`,
}
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
    list: async (q, type, scope) => {
      const needle = q.trim().toLowerCase()
      const kinds = type ? kindsForType(type) : null
      return store.partners.filter((p) => (!kinds || kinds.includes(p.kind)) && (!scope || scopeOfKind(p.kind) === scope) && (!needle || [p.name, p.org, p.role, p.email, p.phone].some((s) => (s ?? '').toLowerCase().includes(needle)))).sort(directorySort)
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
          const name = lineName(it.line)
          const f = FIG[name]?.[it.window]
          if (!f) { missing.push(`${name} revenue for ${WINDOW_TEXT[it.window] ?? it.window}`); return `${name} collected revenue, ${WINDOW_TEXT[it.window] ?? it.window}: no data synced for this period yet. I will follow up once it is in.` }
          return `${name} collected revenue, ${WINDOW_TEXT[it.window]}: ${f.revenue} across ${f.count} engagements (${f.delta}).`
        })
        subject = `Northgate Group numbers — ${req.items.map((it) => `${lineName(it.line)} ${WINDOW_SHORT[it.window] ?? it.window}`).join(', ')}`
        body = [`Hi ${first},`, '', req.intro?.trim() || 'Here are the Northgate Group revenue figures you asked for.', '', ...lines, '', `Data through ${fullDate(DEMO_DAY)}.`, '', req.closing?.trim() || 'Happy to walk through any of it on a call.', '', 'Andrew Halloran', 'Northgate Group'].join('\n')
      } else {
        subject = req.subject.trim() || (req.kind === 'note' ? 'Note from Andrew Halloran' : 'From Andrew Halloran, Northgate Group')
        body = req.body.trim()
      }
      const draft: PartnerAction = { id: id(), partner_id: pid, rep_id: REP, kind: req.kind, subject, body, status: 'draft', sent_to: partner.email, channel: null, provider_id: null, draft_id: null, from_account: null, thread_id: null, created_by: null, created_at: new Date().toISOString(), sent_at: null, due_at: null }
      store.actions = [draft, ...store.actions]
      await new Promise((r) => window.setTimeout(r, 600))
      return { draft, subject, body, missing, data_through: fullDate(DEMO_DAY), sender: SENDER }
    },
    send: async (pid, draftId): Promise<SendResult> => {
      const draft = store.actions.find((a) => a.id === draftId)
      if (!draft) return { sent: false, reason: 'Draft not found.' }
      const sent: PartnerAction = { ...draft, status: 'sent', channel: 'ses', provider_id: 'demo', sent_at: new Date().toISOString() }
      store.actions = store.actions.map((a) => (a.id === draftId ? sent : a))
      await new Promise((r) => window.setTimeout(r, 500))
      return { sent: true, via: 'ses', from: SENDER.from, action: sent }
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
  return <PartnersBoard api={api} initial={SEED} orgName="Northgate Group" words={WORDS} hint="Demo: six invented partners. Drafts, sends and tasks work in memory and reset on reload." />
}
