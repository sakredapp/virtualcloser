/**
 * Today, Mira's side (owner 10-09):
 *   - draftList: "Have Mira build today's list". 3-6 suggested to-dos drawn
 *     from today's and yesterday's meetings, open board cards, partners not
 *     contacted in 14+ days and team signals (agents slipping, new agents with
 *     no first policy). Nothing is saved until the exec taps Add.
 *   - writeEmail: Mira writes a short follow-up for a to-do or a meeting
 *     follow-up; the caller saves it as a draft (never sends).
 *   - pickers for the Create task modal (partners, agents, meetings, cards).
 */
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import { cardsAssignedTo, type AssignedCard } from '@/lib/boards'
import { asKind, asPriority, todaysMeetings, type TodoKind, type TodoPriority, type TodayMeeting } from '@/lib/today'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'

export type DraftTodo = {
  key: string
  body: string
  kind: TodoKind
  priority: TodoPriority
  source_label: string
  link_kind: 'partner' | 'agent' | 'meeting' | 'card' | null
  link_id: string | null
  link_label: string | null
  link_url: string | null
  link_phone: string | null
  link_email: string | null
  note_id: string | null
  partner_id: string | null
  partner_name: string | null
}

type Source = { id: string; text: string; label: string; link: Partial<DraftTodo> }

const clock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()
const day = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(iso))

export type TeamSignals = { slipping: Array<{ agent: string; team: string | null; now30: number; prev30: number }>; slipping_total: number; new_no_policy: number }

export async function teamSignals(): Promise<TeamSignals | null> {
  const { data, error } = await supabase.rpc('pinnacle_team_signals')
  if (error || !data) return null
  return data as TeamSignals
}

export async function stalePartners(repId: string, days = 14) {
  const { data: ps } = await supabase.from('cxo_partners').select('id, name, org, email, phone').eq('rep_id', repId).limit(300)
  const partners = (ps ?? []) as Array<{ id: string; name: string; org: string | null; email: string | null; phone: string | null }>
  if (!partners.length) return []
  const { data: acts } = await supabase
    .from('cxo_partner_actions')
    .select('partner_id, created_at, sent_at')
    .eq('rep_id', repId)
    .in('partner_id', partners.map((p) => p.id))
    .order('created_at', { ascending: false })
    .limit(2000)
  const last = new Map<string, string>()
  for (const a of (acts ?? []) as Array<{ partner_id: string; created_at: string; sent_at: string | null }>) {
    const at = a.sent_at ?? a.created_at
    if (!last.has(a.partner_id) || at > last.get(a.partner_id)!) last.set(a.partner_id, at)
  }
  const cutoff = Date.now() - days * 86_400_000
  return partners
    .map((p) => ({ ...p, last: last.get(p.id) ?? null }))
    .filter((p) => !p.last || Date.parse(p.last) < cutoff)
    .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''))
}

export async function draftList(repId: string, memberId: string, tz: string): Promise<{ drafts: DraftTodo[]; looked_at: string[] }> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const [notesR, meetings, cards, stale, signals, openR] = await Promise.all([
    supabase
      .from('plaud_notes')
      .select('id, title, summary, transcript, occurred_at, mira_digest')
      .eq('rep_id', repId)
      .gte('occurred_at', since)
      .or(`owner_member_id.is.null,owner_member_id.eq.${memberId}`)
      .order('occurred_at', { ascending: false })
      .limit(8),
    todaysMeetings(repId, memberId, tz).catch(() => null),
    cardsAssignedTo(repId, memberId).catch(() => [] as AssignedCard[]),
    stalePartners(repId).catch(() => []),
    teamSignals().catch(() => null),
    supabase.from('cxo_todos').select('body').eq('rep_id', repId).eq('member_id', memberId).is('deleted_at', null).is('done_at', null).limit(80),
  ])
  const sources: Source[] = []
  const add = (text: string, label: string, link: Partial<DraftTodo>) => sources.push({ id: `S${sources.length + 1}`, text, label, link })
  for (const n of (notesR.data ?? []) as Array<{ id: string; title: string | null; summary: string | null; transcript: string | null; occurred_at: string; mira_digest: { decisions?: string[]; followups?: Array<{ partner_name: string; about: string }> } | null }>) {
    const body = (n.summary || n.transcript || '').slice(0, 1500)
    const extra = [...(n.mira_digest?.decisions ?? []).map((d) => `Decided: ${d}`), ...(n.mira_digest?.followups ?? []).map((f) => `Owed to ${f.partner_name}: ${f.about}`)].join('\n')
    add(`Meeting "${n.title || 'Meeting'}" (${day(n.occurred_at, tz)}):\n${body}\n${extra}`, `${n.title || 'Meeting'}, ${clock(n.occurred_at, tz)}`, { note_id: n.id, link_kind: 'meeting', link_id: n.id, link_label: n.title || 'Meeting', link_url: `/dashboard/meetings?note=${n.id}#note-${n.id}` })
  }
  for (const m of (meetings ?? []).slice(0, 8)) {
    const who = m.attendees.map((a) => a.name || a.email).slice(0, 6).join(', ')
    add(`Meeting on the calendar today at ${m.allDay ? 'all day' : clock(m.start, tz)}: "${m.title}"${who ? ` with ${who}` : ''}`, `${m.title}, ${m.allDay ? 'today' : clock(m.start, tz)}`, { link_kind: 'meeting', link_id: m.id, link_label: m.title, link_url: m.htmlLink })
  }
  for (const c of cards.slice(0, 15)) {
    add(`Open board card "${c.title}" on ${c.board_name} (${c.list_title})${c.due_date ? `, due ${c.due_date}` : ''}`, `${c.board_name} board`, { link_kind: 'card', link_id: c.id, link_label: c.title, link_url: `/dashboard/boards?board=${c.board_id}` })
  }
  for (const p of stale.slice(0, 8)) {
    add(`Partner ${p.name}${p.org ? ` (${p.org})` : ''}: ${p.last ? `last contact ${day(p.last, tz)}` : 'never contacted from here'}`, `${p.name}, ${p.last ? `last contact ${day(p.last, tz)}` : 'no contact yet'}`, {
      link_kind: 'partner',
      link_id: p.id,
      link_label: p.name,
      link_phone: p.phone,
      link_email: p.email,
      partner_id: p.id,
      partner_name: p.name,
    })
  }
  if (signals) {
    for (const a of signals.slipping.slice(0, 4))
      add(`Agent ${a.agent}${a.team ? ` (${a.team})` : ''} wrote ${a.now30} policies in the last 30 days, down from ${a.prev30} the 30 days before`, `Team: ${a.agent} down to ${a.now30} from ${a.prev30}`, {
        link_kind: 'agent',
        link_id: a.agent,
        link_label: a.agent,
        link_url: '/dashboard/pinnacle',
      })
    if (signals.new_no_policy > 0)
      add(`${signals.new_no_policy} agents who joined in the last 2-3 months have not written a first policy`, `Team: ${signals.new_no_policy} new agents with no first policy`, { link_url: '/dashboard/pinnacle' })
  }
  const looked_at = [
    `${(notesR.data ?? []).length} meeting notes`,
    `${(meetings ?? []).length} meetings today`,
    `${cards.length} open cards`,
    `${stale.length} partners not contacted in 14+ days`,
    signals ? `${signals.slipping_total} agents slipping` : null,
  ].filter(Boolean) as string[]
  if (!sources.length || !process.env.ANTHROPIC_API_KEY) return { drafts: [], looked_at }

  const open = ((openR.data ?? []) as Array<{ body: string }>).map((t) => `- ${t.body}`).join('\n') || '(none)'
  const prompt = `You are Mira, building an executive's to-do list for today. Pick the 3 to 6 things most worth doing today from the sources below. Each one is a single concrete action, short, starting with a verb and naming the person, company or agent. Do not repeat anything already on their list. Do not invent facts that are not in a source.

Already on their list:
${open}

Sources:
${sources.map((s) => `${s.id}: ${s.text}`).join('\n\n')}

For each item give "source" (the S id it comes from), "type" (email, call, prep, team, personal or task) and "priority" (high only when time-critical or money is at stake; low when it can wait; else normal).
Return ONLY JSON: {"items":[{"text":"","source":"S1","type":"task","priority":"normal"}]}`
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
  let items: Array<Record<string, unknown>> = []
  try {
    items = ((JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { items?: unknown }).items as Array<Record<string, unknown>>) ?? []
  } catch {
    items = []
  }
  const drafts: DraftTodo[] = []
  for (const it of items.slice(0, 6)) {
    const body = typeof it.text === 'string' ? it.text.trim().slice(0, 500) : ''
    const src = sources.find((s) => s.id === String(it.source ?? '').trim())
    if (!body || !src) continue
    drafts.push({
      key: `${src.id}:${drafts.length}`,
      body,
      kind: asKind(it.type),
      priority: asPriority(it.priority),
      source_label: src.label,
      link_kind: null,
      link_id: null,
      link_label: null,
      link_url: null,
      link_phone: null,
      link_email: null,
      note_id: null,
      partner_id: null,
      partner_name: null,
      ...src.link,
    })
  }
  return { drafts, looked_at }
}

/** Mira writes a short email in the exec's voice. Never sent from here. */
export async function writeEmail(input: { to: string; about: string; context?: string | null; sender: string; company: string }): Promise<{ subject: string; body: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { subject: input.about.slice(0, 80), body: `Hi ${input.to.split(/\s+/)[0]},\n\n${input.about}\n\n${input.sender}` }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    messages: [
      {
        role: 'user',
        content: `Write a short, warm, plain email from ${input.sender} (${input.company}) to ${input.to}. Purpose: ${input.about}.${input.context ? `\nContext from their meeting notes:\n${input.context.slice(0, 3000)}` : ''}
Use only facts given here. No placeholders in brackets, no sign-off title. 3 to 6 sentences. Sign with ${input.sender.split(/\s+/)[0]}.
Return ONLY JSON: {"subject":"","body":""}`,
      },
    ],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { subject?: string; body?: string }
    if (j.subject && j.body) return { subject: j.subject.slice(0, 200), body: j.body.slice(0, 6000) }
  } catch {
    /* fall through */
  }
  return { subject: input.about.slice(0, 80), body: `Hi ${input.to.split(/\s+/)[0]},\n\n${input.about}\n\n${input.sender.split(/\s+/)[0]}` }
}

// ── Pickers for Create task ─────────────────────────────────────────────────

export type Pickers = {
  partners: Array<{ id: string; name: string; org: string | null; phone: string | null; email: string | null }>
  meetings: Array<{ id: string; title: string; start: string; allDay: boolean; url: string | null }>
  cards: Array<{ id: string; title: string; board: string; url: string }>
}

export async function pickers(repId: string, memberId: string, tz: string): Promise<Pickers> {
  const [ps, meetings, cards] = await Promise.all([
    supabase.from('cxo_partners').select('id, name, org, phone, email').eq('rep_id', repId).order('name').limit(300),
    todaysMeetings(repId, memberId, tz, 8).catch(() => null as TodayMeeting[] | null),
    cardsAssignedTo(repId, memberId).catch(() => [] as AssignedCard[]),
  ])
  return {
    partners: (ps.data ?? []) as Pickers['partners'],
    meetings: (meetings ?? []).map((m) => ({ id: m.id, title: m.title, start: m.start, allDay: m.allDay, url: m.htmlLink })),
    cards: cards.slice(0, 60).map((c) => ({ id: c.id, title: c.title, board: c.board_name, url: `/dashboard/boards?board=${c.board_id}` })),
  }
}

/** Agents by name from the Pinnacle book (dim rollup labels), with Directory contact when stored. */
export async function searchAgents(q: string): Promise<Array<{ name: string; team: string | null; phone: string | null; email: string | null }>> {
  const term = q.trim().replace(/[%_,()]/g, ' ').slice(0, 60)
  if (term.length < 2) return []
  const { data } = await supabase
    .from('pinnacle_dim_rollup')
    .select('label, team')
    .eq('dim', 'agent')
    .ilike('label', `%${term}%`)
    .gte('d', new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10))
    .limit(400)
  const seen = new Map<string, string | null>()
  for (const r of (data ?? []) as Array<{ label: string; team: string | null }>) if (!seen.has(r.label) || (!seen.get(r.label) && r.team)) seen.set(r.label, r.team || null)
  const names = [...seen.keys()].slice(0, 8)
  if (!names.length) return []
  const { data: dir } = await supabase.rpc('pinnacle_agent_contacts', { p_names: names })
  const contact = new Map<string, { phone: string | null; email: string | null }>()
  for (const r of (dir ?? []) as Array<{ name: string; phone: string | null; email: string | null }>) contact.set(r.name, { phone: r.phone, email: r.email })
  return names.map((n) => ({ name: n, team: seen.get(n) ?? null, phone: contact.get(n)?.phone ?? null, email: contact.get(n)?.email ?? null }))
}
