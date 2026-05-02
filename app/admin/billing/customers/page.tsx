// /admin/billing/customers
//
// Stripe-backed customer index. Lists every rep account with billing
// activity (org tier or any active member subscription), with status, MRR,
// next charge, and current week usage at a glance.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { weekBoundsForDate } from '@/lib/billing/weekly'

export const dynamic = 'force-dynamic'

type RepRow = {
  id: string
  display_name: string
  company: string | null
  email: string | null
  tier: string
  billing_status: string | null
  weekly_hours_quota: number | null
  overflow_enabled: boolean
  volume_tier: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_week_end: string | null
  cancel_at_week_end: boolean
}

type AgentRow = {
  member_id: string
  rep_id: string
  status: string
  weekly_hours_quota: number | null
  overflow_enabled: boolean
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

type WeekRow = {
  rep_id: string
  member_id: string | null
  iso_week: string
  consumed_seconds: number
  planned_hours: number
  overage_hours: number
}

export default async function AdminBillingCustomers() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { isoWeek } = weekBoundsForDate()

  const [{ data: reps }, { data: agents }, { data: orgWeeks }, { data: agentWeeks }] = await Promise.all([
    supabase
      .from('reps')
      .select('id, display_name, company, email, tier, billing_status, weekly_hours_quota, overflow_enabled, volume_tier, stripe_customer_id, stripe_subscription_id, current_week_end, cancel_at_week_end')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabase
      .from('agent_billing')
      .select('member_id, rep_id, status, weekly_hours_quota, overflow_enabled, stripe_customer_id, stripe_subscription_id')
      .neq('status', 'cancelled'),
    supabase
      .from('org_billing_week')
      .select('rep_id, iso_week, consumed_seconds, planned_hours, overage_hours')
      .eq('iso_week', isoWeek),
    supabase
      .from('agent_billing_week')
      .select('rep_id, member_id, iso_week, consumed_seconds, planned_hours, overage_hours')
      .eq('iso_week', isoWeek),
  ])

  const repList = (reps ?? []) as RepRow[]
  const agentList = (agents ?? []) as AgentRow[]
  const orgWeekByRep = new Map<string, WeekRow>()
  for (const w of (orgWeeks ?? []) as WeekRow[]) orgWeekByRep.set(w.rep_id, w)
  const agentWeekByMember = new Map<string, WeekRow>()
  for (const w of (agentWeeks ?? []) as WeekRow[]) {
    if (w.member_id) agentWeekByMember.set(w.member_id, w)
  }

  // For each rep, summarize.
  const rows = repList.map((r) => {
    const orgWeek = orgWeekByRep.get(r.id)
    const repAgents = agentList.filter((a) => a.rep_id === r.id)
    const totalConsumedSec = repAgents.reduce((acc, a) => {
      const w = agentWeekByMember.get(a.member_id)
      return acc + (w?.consumed_seconds ?? 0)
    }, 0) + (orgWeek?.consumed_seconds ?? 0)
    const totalQuota =
      Number(r.weekly_hours_quota ?? 0) +
      repAgents.reduce((acc, a) => acc + Number(a.weekly_hours_quota ?? 0), 0)
    const status = r.billing_status ?? (repAgents.find((a) => a.status === 'active') ? 'active' : 'none')
    return {
      ...r,
      consumedHours: totalConsumedSec / 3600,
      totalQuota,
      memberCount: repAgents.length,
      status,
    }
  })

  // Filter: skip reps with no billing at all unless they have agents in pending_setup.
  const visible = rows.filter((r) =>
    r.stripe_customer_id || r.stripe_subscription_id || r.memberCount > 0
  )

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Billing</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>Customers</h1>
        <p className="sub" style={{ margin: 0 }}>
          {visible.length} customer{visible.length === 1 ? '' : 's'} · week {isoWeek}
        </p>
        <p className="nav" style={{ marginTop: '0.5rem' }}>
          <Link href="/admin/billing">← Cost & margin</Link>
          <span>·</span>
          <Link href="/admin/billing/audit">Audit log</Link>
          <span>·</span>
          <Link href="/admin/clients">Clients</Link>
        </p>
      </header>

      <section className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <th style={th}>Customer</th>
              <th style={th}>Tier</th>
              <th style={th}>Status</th>
              <th style={th}>Quota</th>
              <th style={th}>This week</th>
              <th style={th}>Cancel?</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ink-soft)' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.email ?? '—'} · {r.id}</div>
                </td>
                <td style={td}>{r.tier}</td>
                <td style={{ ...td, color: statusColor(r.status) }}>{r.status}</td>
                <td style={td}>{r.totalQuota}h{r.overflow_enabled && <span title="overflow on" style={{ color: '#d97706' }}> +ovf</span>}</td>
                <td style={td}>{r.consumedHours.toFixed(1)}h</td>
                <td style={td}>{r.cancel_at_week_end ? 'eow' : '—'}</td>
                <td style={td}>
                  <Link href={`/admin/billing/customers/${r.id}`} style={{ color: 'var(--red)', fontWeight: 600 }}>
                    open →
                  </Link>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 14, color: 'var(--muted)' }}>No billing customers yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

const th: React.CSSProperties = { padding: '8px 6px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '8px 6px', verticalAlign: 'top' }

function statusColor(s: string): string {
  switch (s) {
    case 'active': return '#065f46'
    case 'past_due': case 'unpaid': return 'var(--red)'
    case 'paused': return '#d97706'
    case 'canceled': case 'cancelled': return 'var(--muted)'
    default: return 'var(--ink)'
  }
}
