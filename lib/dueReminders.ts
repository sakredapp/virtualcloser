/**
 * Board due-date reminders — server side (service role). The daily cron
 * (11:00 UTC, /api/cron/due-reminders) runs both halves:
 *   1. runDueReminders: write the in-app reminders that are due (7/3/1 days,
 *      the day, overdue once). Stored keyed card + member + kind; a key that
 *      exists is never written again.
 *   2. sendDueDigests: the "Due soon" morning email, for members who turned
 *      it on in Settings (off by default), once per member per day.
 * Partners on a card get nothing automatic: emailing outside people needs
 * the owner's OK first.
 */
import { supabase } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { getBrand } from '@/lib/brand'
import { memberHomeHost } from '@/lib/tenant'
import { renderDueDigest, type DigestItem } from '@/lib/dueDigestEmail'
import {
  OVERDUE_WINDOW_DAYS,
  cardHref,
  dayInZone,
  daysBetween,
  inDigest,
  planReminders,
  reminderKey,
  reminderPrefs,
  type PlanAssignee,
  type PlanCard,
  type PlanMember,
  type ReminderKind,
  type ReminderView,
} from '@/lib/dueRemindersShared'

export function remindersMissing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

type MemberRow = PlanMember & { email: string | null; display_name: string | null; settings: unknown; home_subdomain: string | null }

/** Open cards with a due date near enough to matter, their member assignees, and those members. */
async function loadWindow(now: Date, opts: { memberId?: string | null }) {
  const todayUtc = now.toISOString().slice(0, 10)
  // ±1 day of slack for time zones; planReminders does the exact per-member day.
  const { data: cards, error } = await supabase
    .from('cxo_board_cards')
    .select('id, rep_id, board_id, title, due_date, done_at')
    .not('due_date', 'is', null)
    .is('done_at', null)
    .gte('due_date', addDaysIso(todayUtc, -OVERDUE_WINDOW_DAYS - 1))
    .lte('due_date', addDaysIso(todayUtc, 8))
    .limit(5000)
  if (error) throw error
  const cardRows = (cards ?? []) as Array<PlanCard & { board_id: string; title: string }>
  if (!cardRows.length) return { cards: cardRows, assignees: [] as PlanAssignee[], members: [] as MemberRow[] }
  const assignees: PlanAssignee[] = []
  for (let i = 0; i < cardRows.length; i += 200) {
    let q = supabase
      .from('cxo_board_card_assignees')
      .select('card_id, member_id, partner_id')
      .in('card_id', cardRows.slice(i, i + 200).map((c) => c.id))
      .not('member_id', 'is', null)
    if (opts.memberId) q = q.eq('member_id', opts.memberId)
    const { data, error: aErr } = await q
    if (aErr) throw aErr
    assignees.push(...((data ?? []) as PlanAssignee[]))
  }
  const ids = [...new Set(assignees.map((a) => a.member_id).filter((x): x is string => !!x))]
  const members: MemberRow[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: mErr } = await supabase
      .from('members')
      .select('id, rep_id, timezone, is_active, email, display_name, settings, home_subdomain')
      .in('id', ids.slice(i, i + 200))
    if (mErr) throw mErr
    members.push(...((data ?? []) as MemberRow[]))
  }
  return { cards: cardRows, assignees, members }
}

/** Step 1: write the in-app reminders that are due now. Returns how many were written. */
export async function runDueReminders(opts: { now?: Date; memberId?: string | null } = {}): Promise<{ planned: number; written: number }> {
  const now = opts.now ?? new Date()
  const { cards, assignees, members } = await loadWindow(now, opts)
  if (!assignees.length) return { planned: 0, written: 0 }
  const cardIds = [...new Set(assignees.map((a) => a.card_id))]
  const sent = new Set<string>()
  for (let i = 0; i < cardIds.length; i += 200) {
    const { data, error } = await supabase.from('cxo_due_reminders').select('card_id, member_id, kind').in('card_id', cardIds.slice(i, i + 200))
    if (error) throw error
    for (const r of (data ?? []) as Array<{ card_id: string; member_id: string; kind: string }>) sent.add(reminderKey(r.card_id, r.member_id, r.kind))
  }
  const plan = planReminders({ cards, assignees, members, sent, now })
  if (!plan.length) return { planned: 0, written: 0 }
  const prefs = new Map(members.map((m) => [m.id, reminderPrefs(m.settings)]))
  // A member who turned in-app reminders off still gets the row (in_app=false)
  // so the step counts as done and never fires later.
  const rows = plan.map((p) => ({ ...p, in_app: prefs.get(p.member_id)?.inApp !== false }))
  const { data, error } = await supabase
    .from('cxo_due_reminders')
    .upsert(rows, { onConflict: 'card_id,member_id,kind', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return { planned: plan.length, written: (data ?? []).length }
}

type RepRow = { id: string; slug: string; host_aliases: string[] | null; brand: string | null }

function baseUrl(rep: RepRow | undefined, home: string | null): string {
  const brand = getBrand(rep?.brand || 'cxo')
  if (!rep) return `https://www.${brand.rootDomain}`
  return `https://${memberHomeHost(rep, home)}.${brand.rootDomain}`
}

export type DigestOutcome = { member_id: string; email: string | null; cards: number; status: 'sent' | 'rendered' | 'failed' | 'skipped'; error?: string; html?: string; subject?: string }

/**
 * Step 2: the "Due soon" email. Only members with email turned on, only when
 * something is due within 7 days (or overdue), once per member per day.
 * `render` returns the email instead of sending it (tests, previews) and
 * records nothing.
 */
export async function sendDueDigests(opts: { now?: Date; memberId?: string | null; render?: boolean } = {}): Promise<DigestOutcome[]> {
  const now = opts.now ?? new Date()
  const { cards, assignees, members } = await loadWindow(now, opts)
  const want = members.filter((m) => m.is_active && m.email && (opts.render || reminderPrefs(m.settings).email))
  if (!want.length) return []
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const boardIds = [...new Set(cards.map((c) => c.board_id))]
  const repIds = [...new Set(want.map((m) => m.rep_id))]
  const [boardsQ, repsQ] = await Promise.all([
    supabase.from('cxo_boards').select('id, name').in('id', boardIds.length ? boardIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('reps').select('id, slug, host_aliases, brand').in('id', repIds),
  ])
  if (boardsQ.error) throw boardsQ.error
  if (repsQ.error) throw repsQ.error
  const boardName = new Map(((boardsQ.data ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]))
  const reps = new Map(((repsQ.data ?? []) as RepRow[]).map((r) => [r.id, r]))

  const out: DigestOutcome[] = []
  for (const m of want) {
    const today = dayInZone(now, m.timezone || 'America/New_York')
    const base = baseUrl(reps.get(m.rep_id), m.home_subdomain)
    const items: DigestItem[] = []
    const seen = new Set<string>()
    for (const a of assignees) {
      if (a.member_id !== m.id || seen.has(a.card_id)) continue
      const c = cardById.get(a.card_id)
      if (!c || !c.due_date || c.done_at || c.rep_id !== m.rep_id) continue
      const left = daysBetween(today, c.due_date.slice(0, 10))
      if (!inDigest(left)) continue
      seen.add(c.id)
      items.push({ title: c.title, board: boardName.get(c.board_id) ?? 'Board', due_date: c.due_date.slice(0, 10), days_left: left, url: base + cardHref(c.board_id, c.id) })
    }
    if (!items.length) {
      out.push({ member_id: m.id, email: m.email, cards: 0, status: 'skipped' })
      continue
    }
    const first = (m.display_name || '').trim().split(/\s+/)[0] || null
    const mail = renderDueDigest({ firstName: first, items, boardsUrl: `${base}/dashboard/boards`, settingsUrl: `${base}/dashboard/settings#due-reminders` })
    if (opts.render) {
      out.push({ member_id: m.id, email: m.email, cards: items.length, status: 'rendered', html: mail.html, subject: mail.subject })
      continue
    }
    // Claim the day first so two runs can never both send.
    const { data: claimed, error: cErr } = await supabase
      .from('cxo_due_digests')
      .upsert({ member_id: m.id, day: today, rep_id: m.rep_id, cards: items.length, status: 'sending' }, { onConflict: 'member_id,day', ignoreDuplicates: true })
      .select('member_id')
    if (cErr) throw cErr
    if (!(claimed ?? []).length) continue // already sent today
    const res = await sendEmail({ to: m.email!, subject: mail.subject, html: mail.html, text: mail.text, brand: 'cxo' })
    await supabase.from('cxo_due_digests').update({ status: res.ok ? 'sent' : 'failed' }).eq('member_id', m.id).eq('day', today)
    out.push({ member_id: m.id, email: m.email, cards: items.length, status: res.ok ? 'sent' : 'failed', error: res.error })
  }
  return out
}

// ── The Messages card ───────────────────────────────────────────────────────

/** Unread in-app reminders for me, with the card, its board and days left today. */
export async function listReminders(repId: string, memberId: string, tz: string): Promise<ReminderView[]> {
  const { data, error } = await supabase
    .from('cxo_due_reminders')
    .select('id, card_id, kind, due_date, created_at')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('in_app', true)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; card_id: string; kind: ReminderKind; due_date: string; created_at: string }>
  if (!rows.length) return []
  const { data: cards, error: cErr } = await supabase
    .from('cxo_board_cards')
    .select('id, board_id, title, due_date, done_at')
    .eq('rep_id', repId)
    .in('id', [...new Set(rows.map((r) => r.card_id))])
  if (cErr) throw cErr
  const cardById = new Map(((cards ?? []) as Array<{ id: string; board_id: string; title: string; due_date: string | null; done_at: string | null }>).map((c) => [c.id, c]))
  const { data: boards } = await supabase.from('cxo_boards').select('id, name').in('id', [...new Set([...cardById.values()].map((c) => c.board_id))].concat('00000000-0000-0000-0000-000000000000'))
  const boardName = new Map(((boards ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]))
  const today = dayInZone(new Date(), tz)
  // Newest reminder per card only; a card finished since drops off.
  const out: ReminderView[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const c = cardById.get(r.card_id)
    if (!c || c.done_at || seen.has(c.id)) continue
    seen.add(c.id)
    const due = (c.due_date ?? r.due_date).slice(0, 10)
    out.push({
      id: r.id,
      card_id: c.id,
      board_id: c.board_id,
      board_name: boardName.get(c.board_id) ?? 'Board',
      title: c.title,
      kind: r.kind,
      due_date: due,
      days_left: daysBetween(today, due),
      href: cardHref(c.board_id, c.id),
      created_at: r.created_at,
    })
  }
  return out.sort((a, b) => a.days_left - b.days_left)
}

export async function unreadReminderCount(repId: string, memberId: string): Promise<number> {
  const { count, error } = await supabase
    .from('cxo_due_reminders')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('in_app', true)
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

/** "Got it": marks this reminder and any older unread ones for the same card read. */
export async function markReminderRead(repId: string, memberId: string, id: string): Promise<void> {
  const { data } = await supabase.from('cxo_due_reminders').select('card_id').eq('rep_id', repId).eq('member_id', memberId).eq('id', id).maybeSingle()
  const cardId = (data as { card_id?: string } | null)?.card_id
  if (!cardId) return
  const { error } = await supabase
    .from('cxo_due_reminders')
    .update({ read_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('card_id', cardId)
    .is('read_at', null)
  if (error) throw error
}

/** Settings toggles live on members.settings (merged, never replaced). */
export async function setReminderPrefs(memberId: string, patch: { inApp?: boolean; email?: boolean }): Promise<{ inApp: boolean; email: boolean }> {
  const { data, error } = await supabase.from('members').select('settings').eq('id', memberId).single()
  if (error) throw error
  const settings = { ...(((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>) }
  if (typeof patch.inApp === 'boolean') settings.due_reminders_in_app = patch.inApp
  if (typeof patch.email === 'boolean') settings.due_reminders_email = patch.email
  const { error: uErr } = await supabase.from('members').update({ settings }).eq('id', memberId)
  if (uErr) throw uErr
  return reminderPrefs(settings)
}
