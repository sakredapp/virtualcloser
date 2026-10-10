/**
 * Recurring reports, server side. An exec (or an employee, about themselves)
 * asks Mira "every Monday send me open requests by person"; the job is
 * stored in cxo_report_jobs and the Hetzner worker runs it. Delivered as an
 * in-app notice plus an email to that member only. Empty reports are skipped.
 */
import { supabase } from '@/lib/supabase'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { emailNotices, insertNotices, loadFollowItems, loadMembers, loadOpsTenants, type OpsTenant } from '@/lib/followups/engine'
import { buildReport, nextRunAt, type Cadence, type ReportKind } from '@/lib/ops/reportsShared'

export type ReportJob = {
  id: string
  rep_id: string
  member_id: string
  kind: ReportKind
  cadence: Cadence
  weekday: number | null
  hour: number
  paused: boolean
  next_run_at: string
  last_run_at: string | null
  created_at: string
}

const COLS = 'id, rep_id, member_id, kind, cadence, weekday, hour, paused, next_run_at, last_run_at, created_at'
export const MAX_JOBS_PER_MEMBER = 10

export async function listReportJobs(repId: string, memberId: string): Promise<ReportJob[]> {
  const { data, error } = await supabase.from('cxo_report_jobs').select(COLS).eq('rep_id', repId).eq('member_id', memberId).order('created_at')
  if (error) throw error
  return (data ?? []) as ReportJob[]
}

export async function createReportJob(input: { repId: string; memberId: string; kind: ReportKind; cadence: Cadence; weekday: number | null; hour: number; tz: string; now?: Date }): Promise<ReportJob> {
  const existing = await listReportJobs(input.repId, input.memberId)
  if (existing.length >= MAX_JOBS_PER_MEMBER) throw new Error(`You already have ${existing.length} reports set up. Cancel one first.`)
  const weekday = input.cadence === 'weekly' ? input.weekday ?? 1 : null
  const next = nextRunAt({ cadence: input.cadence, weekday, hour: input.hour }, input.tz, input.now ?? new Date())
  const { data, error } = await supabase
    .from('cxo_report_jobs')
    .insert({ rep_id: input.repId, member_id: input.memberId, kind: input.kind, cadence: input.cadence, weekday, hour: input.hour, next_run_at: next.toISOString() })
    .select(COLS)
    .single()
  if (error) throw error
  return data as ReportJob
}

/** Cancel one of the member's own jobs (scoped by rep and member, never by id alone). */
export async function cancelReportJob(repId: string, memberId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from('cxo_report_jobs').delete().eq('rep_id', repId).eq('member_id', memberId).eq('id', id).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/** Run every due job on switched-on tenants. Each job is claimed (next_run_at moved) before it runs, so two workers never double-send. */
export async function runDueReportJobs(now = new Date()): Promise<{ ran: number; delivered: number; errors: number }> {
  const out = { ran: 0, delivered: 0, errors: 0 }
  const tenants = await loadOpsTenants()
  if (!tenants.length) return out
  const byId = new Map<string, OpsTenant>(tenants.map((t) => [t.id, t]))
  const { data, error } = await supabase
    .from('cxo_report_jobs')
    .select(COLS)
    .in('rep_id', [...byId.keys()])
    .eq('paused', false)
    .lte('next_run_at', now.toISOString())
    .limit(200)
  if (error) throw error
  const jobs = (data ?? []) as ReportJob[]
  const cache = new Map<string, { members: Awaited<ReturnType<typeof loadMembers>>; items: Awaited<ReturnType<typeof loadFollowItems>> }>()
  for (const job of jobs) {
    const tenant = byId.get(job.rep_id)
    if (!tenant || !cxoEmployeeOps(tenant)) continue
    try {
      if (!cache.has(job.rep_id)) {
        const [members, items] = await Promise.all([loadMembers(job.rep_id), loadFollowItems(job.rep_id, now)])
        cache.set(job.rep_id, { members, items })
      }
      const { members, items } = cache.get(job.rep_id)!
      const member = members.find((m) => m.id === job.member_id)
      const tz = member?.timezone || tenant.timezone || 'America/New_York'
      const next = nextRunAt({ cadence: job.cadence, weekday: job.weekday, hour: job.hour }, tz, now)
      const { data: claimed, error: cErr } = await supabase
        .from('cxo_report_jobs')
        .update({ next_run_at: next.toISOString(), last_run_at: now.toISOString() })
        .eq('id', job.id)
        .eq('next_run_at', job.next_run_at)
        .select('id')
      if (cErr) throw cErr
      if (!(claimed ?? []).length) continue
      out.ran++
      if (!member || !member.is_active || member.role === 'assistant') continue
      const report = buildReport({ kind: job.kind, items, members, memberId: member.id, companyWide: !isEmployeeOnlyMember(member, tenant), now, tz })
      if (!report) continue // nothing in it: no send
      const fresh = await insertNotices([
        {
          rep_id: job.rep_id,
          member_id: member.id,
          key: `report|${job.id}|${now.toISOString().slice(0, 13)}`,
          kind: 'report',
          item_kind: 'report',
          item_id: job.id,
          title: report.title,
          body: report.body,
          href: isEmployeeOnlyMember(member, tenant) ? '/dashboard/me' : '/dashboard',
          due_date: null,
        },
      ])
      out.delivered += fresh.length
      // Reports always go by email too (that is what the exec asked for), to that member only.
      await emailNotices(tenant, members.map((m) => (m.id === member.id ? { ...m, settings: { ...(m.settings as object), due_reminders_email: true } } : m)), fresh, report.title)
    } catch (err) {
      out.errors++
      console.error('[reports] job', job.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
