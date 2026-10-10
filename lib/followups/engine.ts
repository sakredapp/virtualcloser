/**
 * Follow-up engine, server side (service role). Run by the Hetzner worker
 * every 15 minutes (hetzner-worker/index.ts), never by a Vercel cron.
 *
 * Per Suite CXO tenant with reps.settings.cxo_employee_ops = true:
 *   1. load open commitments (request to-dos, board cards with a due date,
 *      meeting action items) plus anything closed in the last two days;
 *   2. plan nudges / escalations / close notes (lib/followups/shared);
 *   3. write each as an in-app notice from Mira. The notice row IS the
 *      idempotency key: insert ... on conflict do nothing, and only rows
 *      that were actually inserted are delivered, so a nudge never goes twice;
 *   4. email only members who already get app email (Settings: due-date
 *      email on), one email per member per sweep.
 * Tenants with the switch off get nothing.
 */
import { supabase } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { getBrand } from '@/lib/brand'
import { cardHref, reminderPrefs } from '@/lib/dueRemindersShared'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { planFollowups, type FollowItem, type FollowMember, type PlannedNotice } from '@/lib/followups/shared'

export const CLOSE_LOOKBACK_MS = 48 * 3600_000
const OPEN_LOOKBACK_DAYS = 60

export type OpsTenant = { id: string; slug: string; brand?: string | null; settings?: unknown; host_aliases?: string[] | null; timezone?: string | null }

export function noticesMissing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** CXO tenants with the employee-ops switch on (optionally limited by CXO_FOLLOWUP_REP_IDS). */
export async function loadOpsTenants(env: Record<string, string | undefined> = process.env): Promise<OpsTenant[]> {
  const { data, error } = await supabase.from('reps').select('id, slug, brand, settings, host_aliases, timezone, is_active').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) throw error
  const only = (env.CXO_FOLLOWUP_REP_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return ((data ?? []) as OpsTenant[]).filter((t) => cxoEmployeeOps(t) && (!only.length || only.includes(t.id)))
}

export async function loadMembers(repId: string): Promise<FollowMember[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, rep_id, role, is_active, timezone, display_name, email, settings, home_subdomain')
    .eq('rep_id', repId)
    .limit(1000)
  if (error) throw error
  return (data ?? []) as FollowMember[]
}

type TodoRow = { id: string; member_id: string; body: string; source: string; due_date: string | null; done_at: string | null; created_at: string; link_kind: string | null; link_id: string | null; acted_by_member_id: string | null }
type CardRow = { id: string; board_id: string; title: string; due_date: string | null; done_at: string | null; created_at: string; created_by: string | null }

/** Every commitment the engine tracks for one tenant: open ones, plus ones closed recently. */
export async function loadFollowItems(repId: string, now: Date): Promise<FollowItem[]> {
  const since = new Date(now.getTime() - OPEN_LOOKBACK_DAYS * 86_400_000).toISOString()
  const closedSince = new Date(now.getTime() - CLOSE_LOOKBACK_MS).toISOString()
  const items: FollowItem[] = []

  // Requests and meeting action items (both live on cxo_todos).
  const { data: todos, error: tErr } = await supabase
    .from('cxo_todos')
    .select('id, member_id, body, source, due_date, done_at, created_at, link_kind, link_id, acted_by_member_id')
    .eq('rep_id', repId)
    .in('source', ['message', 'meeting'])
    .is('deleted_at', null)
    .gte('created_at', since)
    .or(`done_at.is.null,done_at.gte.${closedSince}`)
    .limit(5000)
  if (tErr) throw tErr
  const todoRows = (todos ?? []) as TodoRow[]
  const msgIds = todoRows.filter((t) => t.source === 'message' && t.link_kind === 'message' && t.link_id).map((t) => t.link_id!)
  const senders = new Map<string, string>()
  for (let i = 0; i < msgIds.length; i += 200) {
    const { data, error } = await supabase.from('member_messages').select('id, from_member_id').eq('rep_id', repId).in('id', msgIds.slice(i, i + 200))
    if (error) throw error
    for (const m of (data ?? []) as Array<{ id: string; from_member_id: string }>) senders.set(m.id, m.from_member_id)
  }
  for (const t of todoRows) {
    const isRequest = t.source === 'message'
    items.push({
      kind: isRequest ? 'request' : 'meeting',
      id: t.id,
      rep_id: repId,
      title: t.body.slice(0, 200),
      responsible: [t.member_id],
      asker: isRequest ? (t.link_id ? senders.get(t.link_id) ?? null : null) : t.acted_by_member_id ?? null,
      due_date: t.due_date,
      created_at: t.created_at,
      done_at: t.done_at,
      href: '/dashboard',
    })
  }

  // Board cards with a due date and at least one member assignee.
  const { data: cards, error: cErr } = await supabase
    .from('cxo_board_cards')
    .select('id, board_id, title, due_date, done_at, created_at, created_by')
    .eq('rep_id', repId)
    .not('due_date', 'is', null)
    .gte('created_at', new Date(now.getTime() - 365 * 86_400_000).toISOString())
    .or(`done_at.is.null,done_at.gte.${closedSince}`)
    .limit(5000)
  if (cErr) throw cErr
  const cardRows = (cards ?? []) as CardRow[]
  const assignees = new Map<string, string[]>()
  for (let i = 0; i < cardRows.length; i += 200) {
    const { data, error } = await supabase
      .from('cxo_board_card_assignees')
      .select('card_id, member_id')
      .in('card_id', cardRows.slice(i, i + 200).map((c) => c.id))
      .not('member_id', 'is', null)
    if (error) throw error
    for (const a of (data ?? []) as Array<{ card_id: string; member_id: string }>) assignees.set(a.card_id, [...(assignees.get(a.card_id) ?? []), a.member_id])
  }
  for (const c of cardRows) {
    const who = assignees.get(c.id)
    if (!who?.length) continue
    items.push({ kind: 'card', id: c.id, rep_id: repId, title: c.title.slice(0, 200), responsible: who, asker: c.created_by, due_date: c.due_date, created_at: c.created_at, done_at: c.done_at, href: cardHref(c.board_id, c.id) })
  }
  return items
}

/** Keys already delivered for these items. */
async function sentKeys(repId: string, itemIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data, error } = await supabase.from('cxo_followup_notices').select('key').eq('rep_id', repId).in('item_id', itemIds.slice(i, i + 200))
    if (error) throw error
    for (const r of (data ?? []) as Array<{ key: string }>) out.add(r.key)
  }
  return out
}

export type NoticeRow = {
  rep_id: string
  member_id: string
  key: string
  kind: string
  item_kind: string | null
  item_id: string | null
  title: string
  body: string | null
  href: string | null
  due_date: string | null
}

/**
 * Write notices. on conflict (rep_id, key) do nothing; returns only the rows
 * that were new, which are the only ones anyone hears about.
 */
export async function insertNotices(rows: NoticeRow[]): Promise<Array<NoticeRow & { id: string }>> {
  if (!rows.length) return []
  const { data, error } = await supabase
    .from('cxo_followup_notices')
    .upsert(rows, { onConflict: 'rep_id,key', ignoreDuplicates: true })
    .select('id, rep_id, member_id, key, kind, item_kind, item_id, title, body, href, due_date')
  if (error) throw error
  return (data ?? []) as Array<NoticeRow & { id: string }>
}

/** Employees can only open /dashboard/me; executives go to the item. */
export function hrefFor(member: FollowMember | undefined, tenant: OpsTenant, href: string): string {
  return member && isEmployeeOnlyMember(member, tenant) ? '/dashboard/me' : href
}

function homeUrl(tenant: OpsTenant, member: FollowMember & { home_subdomain?: string | null }): string {
  const brand = getBrand('cxo')
  const h = (member.home_subdomain ?? '').trim().toLowerCase()
  const host = h && (h === tenant.slug || (tenant.host_aliases ?? []).includes(h)) ? h : tenant.slug
  return `https://${host}.${brand.rootDomain}`
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** One plain email per member with their new notices, only for members who turned app email on. */
export async function emailNotices(tenant: OpsTenant, members: FollowMember[], fresh: Array<NoticeRow & { id: string }>, subject?: string): Promise<number> {
  const byMember = new Map<string, Array<NoticeRow & { id: string }>>()
  for (const n of fresh) byMember.set(n.member_id, [...(byMember.get(n.member_id) ?? []), n])
  const byId = new Map(members.map((m) => [m.id, m]))
  let sent = 0
  for (const [memberId, rows] of byMember) {
    const m = byId.get(memberId)
    if (!m?.email || !reminderPrefs(m.settings).email) continue
    const base = homeUrl(tenant, m)
    const lines = rows.map((r) => `<li style="margin:0 0 10px"><a href="${esc(base + (r.href || '/dashboard'))}" style="color:#1C1B1A;font-weight:600">${esc(r.title)}</a>${r.body ? `<br><span style="color:#55524e">${esc(r.body)}</span>` : ''}</li>`)
    const text = rows.map((r) => `- ${r.title}${r.body ? `\n  ${r.body}` : ''}\n  ${base}${r.href || '/dashboard'}`).join('\n')
    const subj = subject ?? (rows.length === 1 ? rows[0].title : `Mira: ${rows.length} things need you`)
    const res = await sendEmail({
      to: m.email,
      subject: subj.slice(0, 160),
      html: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#1C1B1A"><p>From Mira:</p><ul style="padding-left:18px">${lines.join('')}</ul></div>`,
      text: `From Mira:\n\n${text}`,
      brand: 'cxo',
    }).catch((e) => ({ ok: false, error: String(e) }))
    if (res.ok) {
      sent++
      await supabase.from('cxo_followup_notices').update({ emailed_at: new Date().toISOString() }).in('id', rows.map((r) => r.id))
    }
  }
  return sent
}

/** Audit rows for what the engine sent (fire-and-forget; never blocks a send). */
async function auditNotices(rows: Array<NoticeRow & { id: string }>, tool: string) {
  if (!rows.length) return
  const { error } = await supabase.from('cxo_mira_audit').insert(
    rows.map((r) => ({ rep_id: r.rep_id, member_id: r.member_id, tool, args_summary: { kind: r.kind, item_kind: r.item_kind, item_id: r.item_id }, result: 'ok', approved: null })),
  )
  if (error) console.error('[followups] audit', error.message)
}

export type SweepResult = { tenants: number; planned: number; delivered: number; emailed: number; errors: number }

/** One tenant's sweep. */
export async function sweepTenant(tenant: OpsTenant, now = new Date()): Promise<{ planned: number; delivered: number; emailed: number }> {
  if (!cxoEmployeeOps(tenant)) return { planned: 0, delivered: 0, emailed: 0 }
  const [members, items] = await Promise.all([loadMembers(tenant.id), loadFollowItems(tenant.id, now)])
  if (!items.length) return { planned: 0, delivered: 0, emailed: 0 }
  const sent = await sentKeys(tenant.id, [...new Set(items.map((i) => i.id))])
  const planned: PlannedNotice[] = planFollowups({ items, members, sent, now })
  if (!planned.length) return { planned: 0, delivered: 0, emailed: 0 }
  const byId = new Map(members.map((m) => [m.id, m]))
  const fresh = await insertNotices(planned.map((p) => ({ ...p, href: hrefFor(byId.get(p.member_id), tenant, p.href) })))
  await auditNotices(fresh, 'followup_engine')
  const emailed = await emailNotices(tenant, members, fresh)
  return { planned: planned.length, delivered: fresh.length, emailed }
}

/** The 15-minute sweep across every CXO tenant with the switch on. */
export async function runFollowupSweep(now = new Date()): Promise<SweepResult> {
  const out: SweepResult = { tenants: 0, planned: 0, delivered: 0, emailed: 0, errors: 0 }
  let tenants: OpsTenant[]
  try {
    tenants = await loadOpsTenants()
  } catch (err) {
    console.error('[followups] tenants', err)
    out.errors++
    return out
  }
  for (const t of tenants) {
    try {
      const r = await sweepTenant(t, now)
      out.tenants++
      out.planned += r.planned
      out.delivered += r.delivered
      out.emailed += r.emailed
    } catch (err) {
      if (noticesMissing(err)) return out // migration not applied yet: quiet
      out.errors++
      console.error('[followups] sweep', t.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
