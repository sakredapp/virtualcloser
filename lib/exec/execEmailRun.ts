import { logError } from '@/lib/errors'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { sendEmail } from '@/lib/email'
import { buildExecDigest } from '@/lib/exec/digest'
import { buildPinnacleBriefData, generateExecSummary } from '@/lib/exec/summary'
import { renderExecEmail, cxoEmailBrand, BRIEF_NOTICE_LIMIT, type BriefNotice, type DigestMode, type EmailBrand } from '@/lib/exec/emailDigest'
import { listUndeliveredNotices, noticeKindsFor } from '@/lib/followups/notices'
import { homeUrl } from '@/lib/followups/engine'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { assistantNameFromSettings } from '@/lib/assistantNameFromRows'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { getBrand, type BrandKey } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { recordJobRun } from '@/lib/health'
import type { Member } from '@/types'

/**
 * Formal executive email digest — Suite CXO only. Shared by the cron route
 * (manual/forced runs) and the Hetzner worker, which runs it on its tick
 * (recurring work lives on the worker, not on a Vercel cron).
 *
 * Sends at 7am tenant-local, Monday to Friday. Monday = a fuller "weekly"
 * framing, other weekdays = compact "daily". Recipients are owner/admin members
 * who opted in (settings.exec_email_digest === true); Pinnacle-viewer tenants
 * are opted in by default and get the revenue block. Non-Pinnacle tenants
 * never see revenue.
 *
 * Once per member per local day: each send is recorded in job_runs
 * (job = EXEC_EMAIL_JOB, meta = {rep_id, member_id, day}), and a member with
 * an ok row for that day is skipped, so a tick that lands twice in the 7am
 * hour never sends twice.
 *
 * Ciao's notices ride in the brief ("From Ciao"): unread, never-emailed notices
 * from the last 7 days, the same kinds the Today Messages card shows. A failed
 * notices read never blocks the brief (it goes without the section), and
 * emailed_at is stamped on exactly the notices shown, only after the send
 * worked, so a failed send retries them the next day.
 */

const SEND_LOCAL_HOUR = 7

export const EXEC_EMAIL_JOB = 'exec_email_digest'
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

function localParts(tz: string, ref: Date = new Date()): { hour: number; weekday: string } {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(ref),
    )
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(ref)
    return { hour, weekday }
  } catch {
    return { hour: ref.getUTCHours(), weekday: 'Mon' }
  }
}

async function sentToday(repId: string, day: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('job_runs')
    .select('meta')
    .eq('job', EXEC_EMAIL_JOB)
    .eq('ok', true)
    .eq('meta->>rep_id', repId)
    .eq('meta->>day', day)
    .limit(1000)
  // A failed read must not become "nobody was emailed": refuse to send.
  if (error) throw new Error(`exec email sent-today read failed: ${error.message}`)
  return new Set(((data ?? []) as Array<{ meta: { member_id?: string } | null }>).map((r) => String(r.meta?.member_id ?? '')))
}

/** Stamp emailed_at on the notices a brief carried. Never throws: the email already went. */
async function stampNoticesEmailed(repId: string, memberId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('cxo_followup_notices')
    .update({ emailed_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .in('id', ids)
  if (error) console.error('[exec-email] notices emailed_at stamp failed', memberId, error.message)
}

async function emailTenant(tenant: Tenant, force: boolean, now: Date): Promise<number> {
  const tz = tenant.timezone || 'America/New_York'
  const { hour, weekday } = localParts(tz, now)
  if (!force && (hour !== SEND_LOCAL_HOUR || !WEEKDAYS.has(weekday))) return 0
  const mode: DigestMode = weekday === 'Mon' ? 'weekly' : 'daily'

  const pinnacleViewer = isPinnacleViewer(tenant.id)
  const members = await listMembers(tenant.id)
  const recipients = members.filter((m: Member) => {
    if (!m.is_active || !m.email) return false
    if (m.role !== 'owner' && m.role !== 'admin') return false
    const optedIn = (m.settings as Record<string, unknown> | undefined)?.exec_email_digest === true
    return optedIn || pinnacleViewer
  })
  if (recipients.length === 0) return 0

  const todayIso = now.toLocaleDateString('en-CA', { timeZone: tz })
  const already = force ? new Set<string>() : await sentToday(tenant.id, todayIso)
  const pinnacle = pinnacleViewer ? await buildPinnacleBriefData(tenant.id, todayIso).catch(() => null) : null

  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const bc = getBrand(brandKey)
  // Suite CXO: the real logo image only (owner 2026-10-20), black/silver/white
  // chrome. VC keeps its own 2:1 wordmark image on the same calm layout.
  const emailBrand: EmailBrand =
    brandKey === 'cxo'
      ? cxoEmailBrand()
      : { name: bc.name, logoSrc: bc.logo.wordmarkSrc, logoWidth: 140, accent: bc.theme.accent }

  const noticeKinds = noticeKindsFor(cxoEmployeeOps(tenant))

  let sent = 0
  for (const m of recipients) {
    if (already.has(m.id)) continue
    // Notices first. A failed read is logged and the brief goes without them.
    let noticeRows: Awaited<ReturnType<typeof listUndeliveredNotices>> = []
    try {
      noticeRows = await listUndeliveredNotices(tenant.id, m.id, { sinceDays: 7, limit: BRIEF_NOTICE_LIMIT, kinds: noticeKinds })
    } catch (err) {
      console.error('[exec-email] notices read failed for member', m.id, err)
      await logError({
        source: 'cron/exec-email',
        errorType: 'notices_read_failed',
        message: err instanceof Error ? err.message : String(err),
        repId: tenant.id,
        memberId: m.id,
        context: { tenant: tenant.slug, memberId: m.id },
      }).catch(() => {})
      noticeRows = []
    }
    const base = homeUrl(tenant, m)
    const notices: BriefNotice[] = noticeRows.map((n) => ({ title: n.title, body: n.body, href: `${base}${safeNoticePath(n.href)}` }))
    const noticeIds = noticeRows.map((n) => n.id)
    try {
      const digest = await buildExecDigest(tenant, { memberId: m.id, timezone: m.timezone || tz })
      const aiSummary = await generateExecSummary({
        digest,
        pinnacle,
        name: m.display_name || 'there',
      }).catch(() => '')
      const { subject, html, text } = renderExecEmail({
        digest,
        pinnacle,
        aiSummary,
        name: m.display_name || 'there',
        timezone: m.timezone || tz,
        mode,
        brand: emailBrand,
        notices,
        assistantName: assistantNameFromSettings(tenant.settings, m.settings),
      })
      await recordJobRun(
        EXEC_EMAIL_JOB,
        async () => {
          const res = await sendEmail({ to: m.email!, subject, html, text, brand: brandKey })
          if (!res.ok) throw new Error(res.error ?? 'send failed')
          await stampNoticesEmailed(tenant.id, m.id, noticeIds)
        },
        { rep_id: tenant.id, member_id: m.id, day: todayIso },
      )
      sent++
    } catch (err) {
      console.error('[exec-email] failed for member', m.id, err)
      await logError({
        source: 'cron/exec-email',
        errorType: 'member_email_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        memberId: m.id,
        context: { tenant: tenant.slug, memberId: m.id },
      })
    }
  }
  return sent
}

export type ExecEmailRun = { cxoTenants: number; totalSent: number; results: Array<{ slug: string; sent: number }> }

export async function runExecEmail(opts: { force?: boolean; now?: Date } = {}): Promise<ExecEmailRun> {
  const force = opts.force === true
  const now = opts.now ?? new Date()
  const tenants = await getAllActiveTenants()
  const cxoTenants = tenants.filter((t) => ((t as { brand?: BrandKey }).brand ?? 'virtualcloser') === 'cxo')

  let totalSent = 0
  const results: Array<{ slug: string; sent: number }> = []
  for (const tenant of cxoTenants) {
    try {
      const sent = await emailTenant(tenant, force, now)
      if (sent > 0) results.push({ slug: tenant.slug, sent })
      totalSent += sent
    } catch (err) {
      console.error('[exec-email] tenant failed', tenant.slug, err)
      await logError({
        source: 'cron/exec-email',
        errorType: 'tenant_email_failed',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        repId: tenant.id,
        context: { tenant: tenant.slug },
      })
    }
  }
  return { cxoTenants: cxoTenants.length, totalSent, results }
}

// A notice link is only ever an app path ("/..."); anything else (a full URL, "//host", empty) opens the dashboard instead.
export function safeNoticePath(href: string | null | undefined): string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? href : '/dashboard'
}
