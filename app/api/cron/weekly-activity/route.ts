import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { supabase } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import type { Member } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Weekly Enterprise activity report.
 *
 * Once a week (Mondays 9am UTC by default — see vercel.json), emails the
 * leadership of every multi-seat account a leaderboard of what each rep
 * actually did the previous 7 days: calls logged, meetings booked, drafts
 * sent, tasks completed.
 *
 * Solo tenants (members.length <= 1) are skipped — they get the daily
 * morning brief on Telegram instead.
 */

type RowStats = {
  member: Member
  calls: number
  meetingsBooked: number
  draftsSent: number
  tasksDone: number
}

const LEADERSHIP_ROLES = new Set(['owner', 'admin', 'manager'])

async function countMemberStats(
  repId: string,
  memberId: string,
  sinceIso: string,
): Promise<Omit<RowStats, 'member'>> {
  const [calls, booked, drafts, tasks] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', repId)
      .eq('owner_member_id', memberId)
      .gte('occurred_at', sinceIso),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', repId)
      .eq('owner_member_id', memberId)
      .eq('outcome', 'booked')
      .gte('occurred_at', sinceIso),
    supabase
      .from('agent_actions')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', repId)
      .eq('owner_member_id', memberId)
      .eq('action_type', 'email_draft')
      .eq('status', 'sent')
      .gte('created_at', sinceIso),
    supabase
      .from('brain_items')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', repId)
      .eq('owner_member_id', memberId)
      .eq('item_type', 'task')
      .eq('status', 'done')
      .gte('updated_at', sinceIso),
  ])
  return {
    calls: calls.count ?? 0,
    meetingsBooked: booked.count ?? 0,
    draftsSent: drafts.count ?? 0,
    tasksDone: tasks.count ?? 0,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildEmail(tenant: Tenant, rows: RowStats[]): { html: string; text: string } {
  // Sort by calls desc, then meetings booked desc.
  const sorted = [...rows].sort((a, b) => {
    if (b.calls !== a.calls) return b.calls - a.calls
    return b.meetingsBooked - a.meetingsBooked
  })

  const totalCalls = rows.reduce((n, r) => n + r.calls, 0)
  const totalBooked = rows.reduce((n, r) => n + r.meetingsBooked, 0)
  const totalDrafts = rows.reduce((n, r) => n + r.draftsSent, 0)
  const totalTasks = rows.reduce((n, r) => n + r.tasksDone, 0)
  const quiet = sorted.filter(
    (r) => r.calls === 0 && r.meetingsBooked === 0 && r.draftsSent === 0,
  )

  const headerCell =
    'padding:8px 10px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#5a5a5a;border-bottom:1px solid rgba(15,15,15,0.12);text-align:left;'
  const dataCell =
    'padding:10px;font-size:14px;color:#0f0f0f;border-bottom:1px solid rgba(15,15,15,0.06);'
  const numCell = `${dataCell}text-align:right;font-variant-numeric:tabular-nums;`

  const tableRows = sorted
    .map((r, i) => {
      const name = escapeHtml(r.member.display_name || r.member.email)
      const role = escapeHtml(r.member.role)
      const rank = i + 1
      return `<tr>
        <td style="${dataCell}"><span style="color:#5a5a5a;font-size:12px;">#${rank}</span> ${name} <span style="color:#5a5a5a;font-size:12px;">· ${role}</span></td>
        <td style="${numCell}">${r.calls}</td>
        <td style="${numCell}">${r.meetingsBooked}</td>
        <td style="${numCell}">${r.draftsSent}</td>
        <td style="${numCell}">${r.tasksDone}</td>
      </tr>`
    })
    .join('')

  const quietBlock =
    quiet.length > 0
      ? `<p style="margin:20px 0 0;font-size:14px;color:#0f0f0f;">
        <strong>Quiet this week:</strong> ${quiet
          .map((q) => escapeHtml(q.member.display_name || q.member.email))
          .join(', ')}.
      </p>`
      : ''

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ff2800;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f0f0f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ff2800;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #0f0f0f;border-radius:14px;padding:28px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#ff2800;font-weight:700;">Weekly activity report</p>
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;">${escapeHtml(tenant.display_name)}</h1>
          <p style="margin:0 0 18px;font-size:14px;color:#5a5a5a;">Last 7 days · ${totalCalls} calls · ${totalBooked} meetings booked · ${totalDrafts} follow-ups sent · ${totalTasks} tasks closed</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <th style="${headerCell}">Member</th>
              <th style="${headerCell}text-align:right;">Calls</th>
              <th style="${headerCell}text-align:right;">Booked</th>
              <th style="${headerCell}text-align:right;">Sent</th>
              <th style="${headerCell}text-align:right;">Tasks</th>
            </tr>
            ${tableRows}
          </table>
          ${quietBlock}
          <p style="margin:24px 0 0;padding-top:18px;border-top:1px solid rgba(15,15,15,0.12);font-size:12px;color:#5a5a5a;">
            Sent every Monday by Virtual Closer. You're receiving this as leadership on the ${escapeHtml(tenant.display_name)} account.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`

  const textLines: string[] = []
  textLines.push(`Weekly activity — ${tenant.display_name}`)
  textLines.push(
    `Last 7 days: ${totalCalls} calls · ${totalBooked} meetings booked · ${totalDrafts} follow-ups · ${totalTasks} tasks done`,
  )
  textLines.push('')
  textLines.push('Member · Calls / Booked / Sent / Tasks')
  for (const r of sorted) {
    textLines.push(
      `- ${r.member.display_name || r.member.email} (${r.member.role}): ${r.calls} / ${r.meetingsBooked} / ${r.draftsSent} / ${r.tasksDone}`,
    )
  }
  if (quiet.length > 0) {
    textLines.push('')
    textLines.push(
      `Quiet this week: ${quiet.map((q) => q.member.display_name || q.member.email).join(', ')}`,
    )
  }
  return { html, text: textLines.join('\n') }
}

async function runForTenant(
  tenant: Tenant,
  sinceIso: string,
): Promise<{ skipped: boolean; sent: number; reason?: string }> {
  const members = (await listMembers(tenant.id)).filter((m) => m.is_active)
  if (members.length <= 1) return { skipped: true, sent: 0, reason: 'solo' }

  const rows: RowStats[] = []
  for (const m of members) {
    const stats = await countMemberStats(tenant.id, m.id, sinceIso)
    rows.push({ member: m, ...stats })
  }

  const recipients = members
    .filter((m) => LEADERSHIP_ROLES.has(m.role) && !!m.email)
    .map((m) => m.email)
  const uniqueRecipients = Array.from(new Set(recipients.map((e) => e.toLowerCase())))
  if (uniqueRecipients.length === 0) return { skipped: true, sent: 0, reason: 'no recipients' }

  const { html, text } = buildEmail(tenant, rows)
  const subject = `Weekly activity — ${tenant.display_name}`

  let sent = 0
  for (const to of uniqueRecipients) {
    const res = await sendEmail({ to, subject, html, text })
    if (res.ok) sent++
  }
  return { skipped: false, sent }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const sinceIso = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const tenants = await getAllActiveTenants()

  const results: Array<{
    tenant: string
    skipped: boolean
    sent: number
    reason?: string
    error?: string
  }> = []

  for (const t of tenants) {
    try {
      const r = await runForTenant(t, sinceIso)
      results.push({ tenant: t.slug, ...r })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      results.push({ tenant: t.slug, skipped: true, sent: 0, error: message })
    }
  }

  return NextResponse.json({ ok: true, since: sinceIso, results })
}
