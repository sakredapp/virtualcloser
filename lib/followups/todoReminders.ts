/**
 * Timed to-do reminders, the delivery side (QA gap 9, 2026-10-18). Runs on
 * the Hetzner worker's Suite CXO ops tick (about every 15 minutes, see
 * hetzner-worker CXO_OPS_EVERY_N_TICKS).
 *
 * A to-do with remind_at <= now and reminded_at null gets one in-app notice
 * for its owner (cxo_followup_notices, the same path every Ciao nudge uses,
 * plus email when they turned app email on). A one-off is then marked
 * reminded_at; a repeating one (remind_rule) moves remind_at to its next time
 * and puts the to-do back on their list if they had ticked it. Deleting the
 * to-do, or complete_my_todo with stop_repeating, ends a repeat.
 *
 * Personal to the owner, so it runs for every Suite CXO company, employee-ops
 * switch or not (the key prefix is on the always-shown list).
 */

import { supabase } from '@/lib/supabase'
import { emailNotices, insertNotices, noticesMissing, type NoticeRow, type OpsTenant } from '@/lib/followups/engine'
import type { FollowMember } from '@/lib/followups/shared'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { asRemindRule, nextRemindAt, remindKey } from '@/lib/todoReminderShared'

type DueRow = { id: string; rep_id: string; member_id: string; body: string; remind_at: string; remind_rule: string | null; done_at: string | null; due_date: string | null }

export type TodoReminderResult = { due: number; delivered: number; emailed: number; errors: number }

/** Columns not there yet (migration supabase/cxo_todo_reminders.sql not applied): stay quiet. */
function columnsMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return !!e && (e.code === '42703' || e.code === 'PGRST204' || /remind_at|remind_rule|reminded_at/.test(e.message ?? ''))
}

export async function runTodoReminderTick(now = new Date()): Promise<TodoReminderResult> {
  const out: TodoReminderResult = { due: 0, delivered: 0, emailed: 0, errors: 0 }
  const { data, error } = await supabase
    .from('cxo_todos')
    .select('id, rep_id, member_id, body, remind_at, remind_rule, done_at, due_date')
    .lte('remind_at', now.toISOString())
    .is('reminded_at', null)
    .is('deleted_at', null)
    .order('remind_at', { ascending: true })
    .limit(500)
  if (error) {
    if (columnsMissing(error) || noticesMissing(error)) return out
    console.error('[todo-reminders] read', error.message)
    out.errors++
    return out
  }
  // A ticked one-off needs no ping; a ticked repeat comes back next time.
  const rows = ((data ?? []) as DueRow[]).filter((r) => !r.done_at || asRemindRule(r.remind_rule))
  const skipped = ((data ?? []) as DueRow[]).filter((r) => r.done_at && !asRemindRule(r.remind_rule))
  if (skipped.length) await supabase.from('cxo_todos').update({ reminded_at: now.toISOString() }).in('id', skipped.map((r) => r.id))
  out.due = rows.length
  if (!rows.length) return out

  const byRep = new Map<string, DueRow[]>()
  for (const r of rows) byRep.set(r.rep_id, [...(byRep.get(r.rep_id) ?? []), r])

  for (const [repId, list] of byRep) {
    try {
      const [{ data: t }, { data: ms }] = await Promise.all([
        supabase.from('reps').select('id, slug, brand, settings, host_aliases, timezone').eq('id', repId).maybeSingle(),
        supabase.from('members').select('id, rep_id, role, is_active, timezone, display_name, email, settings, home_subdomain').eq('rep_id', repId).in('id', [...new Set(list.map((r) => r.member_id))]),
      ])
      const tenant = t as OpsTenant | null
      if (!tenant || (tenant.brand ?? '') !== 'cxo') continue
      const members = (ms ?? []) as FollowMember[]
      const byId = new Map(members.map((m) => [m.id, m]))
      const notices: NoticeRow[] = []
      for (const r of list) {
        const m = byId.get(r.member_id)
        if (!m?.is_active) continue
        notices.push({
          rep_id: repId,
          member_id: r.member_id,
          key: remindKey(r.id, r.remind_at),
          kind: 'report',
          item_kind: null,
          item_id: r.id,
          title: `Reminder: ${r.body}`.slice(0, 300),
          body: asRemindRule(r.remind_rule) ? `Repeats ${r.remind_rule === 'weekdays' ? 'every weekday' : r.remind_rule === 'daily' ? 'every day' : 'every week'}. Tick it on your list when it is done.` : null,
          href: isEmployeeOnlyMember(m, tenant) ? '/dashboard/me' : '/dashboard',
          due_date: r.due_date,
        })
      }
      const fresh = await insertNotices(notices)
      out.delivered += fresh.length
      if (fresh.length) out.emailed += await emailNotices(tenant, members, fresh).catch(() => 0)

      for (const r of list) {
        const rule = asRemindRule(r.remind_rule)
        const tz = byId.get(r.member_id)?.timezone || tenant.timezone || 'America/New_York'
        const patch: Record<string, unknown> = rule
          ? { remind_at: nextRemindAt(r.remind_at, rule, tz, now.getTime()), ...(r.done_at ? { done_at: null } : {}) }
          : { reminded_at: now.toISOString() }
        const { error: uErr } = await supabase.from('cxo_todos').update(patch).eq('rep_id', repId).eq('id', r.id)
        if (uErr) throw uErr
      }
    } catch (err) {
      out.errors++
      console.error('[todo-reminders]', repId, err instanceof Error ? err.message : err)
    }
  }
  return out
}
