import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { findMemberBySlug, getManagedTeamIds, getMemberTeamIds } from '@/lib/members'
import { visibilityScope, isAtLeast } from '@/lib/permissions'
import { getMemberKpis, isoDaysAgo } from '@/lib/leaderboard'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type WindowKey = '1d' | '7d' | '30d'
const WINDOW_DAYS: Record<WindowKey, number> = { '1d': 1, '7d': 7, '30d': 30 }
const WINDOW_LABEL: Record<WindowKey, string> = { '1d': 'Today', '7d': '7 days', '30d': '30 days' }

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ memberSlug: string }>
  searchParams?: Promise<{ window?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { memberSlug } = await params
  const { tenant, member: viewer } = await requireMember()
  const target = await findMemberBySlug(tenant.id, memberSlug)
  if (!target) notFound()

  // Permission check: viewers see themselves, managers see their team, admins see all.
  const scope = visibilityScope(viewer.role)
  let canView = false
  if (scope === 'account') canView = true
  else if (scope === 'self') canView = viewer.id === target.id
  else if (scope === 'team') {
    if (viewer.id === target.id) {
      canView = true
    } else {
      const [mgrTeams, targetTeams] = await Promise.all([
        getManagedTeamIds(viewer.id),
        getMemberTeamIds(target.id),
      ])
      canView = mgrTeams.some((t) => targetTeams.includes(t))
    }
  }
  if (!canView) {
    redirect('/dashboard')
  }

  const sp = (await searchParams) ?? {}
  const windowKey: WindowKey =
    sp.window === '1d' || sp.window === '7d' || sp.window === '30d' ? sp.window : '7d'
  const sinceIso = isoDaysAgo(WINDOW_DAYS[windowKey])

  const allKpis = await getMemberKpis(tenant.id, sinceIso, [target.id])
  const kpis = allKpis[0] ?? {
    memberId: target.id,
    callsTotal: 0,
    conversations: 0,
    meetingsBooked: 0,
    closedWon: 0,
    closedLost: 0,
    leadsAdded: 0,
    brainItemsDone: 0,
  }

  // Recent activity: latest 10 calls + latest 10 leads attributed to this member.
  const [{ data: recentCalls }, { data: recentLeads }] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id, contact_name, outcome, summary, occurred_at')
      .eq('rep_id', tenant.id)
      .eq('owner_member_id', target.id)
      .gte('occurred_at', sinceIso)
      .order('occurred_at', { ascending: false })
      .limit(10),
    supabase
      .from('leads')
      .select('id, name, company, status, created_at')
      .eq('rep_id', tenant.id)
      .eq('owner_member_id', target.id)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const showAdminLink = isAtLeast(viewer.role, 'admin')

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">{tenant.display_name}</p>
          <h1>{target.display_name || target.email}</h1>
          <p className="sub">
            {target.role}
            {target.is_active ? '' : ' · inactive'}
            {' · '}
            <code style={{ fontSize: '0.8rem' }}>/u/{target.slug ?? '—'}</code>
          </p>
          <p className="nav">
            <Link href="/dashboard">Dashboard</Link>
            <span>·</span>
            <Link href="/dashboard/team">Team</Link>
            {showAdminLink && (
              <>
                <span>·</span>
                <Link href={`/admin/clients/${tenant.id}/members`}>Members & teams</Link>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignSelf: 'flex-start' }}>
          {(['1d', '7d', '30d'] as WindowKey[]).map((k) => (
            <Link
              key={k}
              href={`/u/${target.slug}?window=${k}`}
              className="card"
              style={{
                padding: '0.35rem 0.7rem',
                fontWeight: 600,
                background: k === windowKey ? 'var(--ink, #0f0f0f)' : 'var(--panel, #fff)',
                color: k === windowKey ? '#fff' : 'var(--text, #0f0f0f)',
                borderRadius: 999,
                textDecoration: 'none',
                fontSize: '0.85rem',
              }}
            >
              {WINDOW_LABEL[k]}
            </Link>
          ))}
        </div>
      </header>

      <section className="summary grid-4" style={{ marginTop: '0.8rem' }}>
        <Stat label="Calls" value={kpis.callsTotal} />
        <Stat label="Conversations" value={kpis.conversations} />
        <Stat label="Meetings booked" value={kpis.meetingsBooked} />
        <Stat label="Closed won" value={kpis.closedWon} />
      </section>
      <section className="summary grid-4" style={{ marginTop: '0.6rem' }}>
        <Stat label="Closed lost" value={kpis.closedLost} />
        <Stat label="Leads added" value={kpis.leadsAdded} />
        <Stat label="Tasks done" value={kpis.brainItemsDone} />
        <Stat label="Win rate" value={
          kpis.closedWon + kpis.closedLost === 0
            ? '—'
            : `${Math.round((kpis.closedWon / (kpis.closedWon + kpis.closedLost)) * 100)}%`
        } />
      </section>

      <section className="card" style={{ marginTop: '1rem' }}>
        <div className="section-head">
          <h2>Recent calls</h2>
          <p>{recentCalls?.length ?? 0}</p>
        </div>
        {(!recentCalls || recentCalls.length === 0) ? (
          <p className="meta">No calls in this window.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {(recentCalls as Array<{ id: string; contact_name: string | null; outcome: string | null; summary: string | null; occurred_at: string }>).map((c) => (
              <li key={c.id} style={{ padding: '0.6rem 0.8rem', border: '1px solid var(--panel-border, #e8e2d4)', borderRadius: 8 }}>
                <strong>{c.contact_name ?? 'Unknown contact'}</strong>
                {c.outcome && <span className="meta"> · {c.outcome.replace('_', ' ')}</span>}
                <p className="hint" style={{ margin: '0.2rem 0 0' }}>
                  {new Date(c.occurred_at).toLocaleString()}
                </p>
                {c.summary && <p style={{ margin: '0.3rem 0 0', fontSize: '0.92rem' }}>{c.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Leads added</h2>
          <p>{recentLeads?.length ?? 0}</p>
        </div>
        {(!recentLeads || recentLeads.length === 0) ? (
          <p className="meta">No new leads in this window.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
            {(recentLeads as Array<{ id: string; name: string; company: string | null; status: string; created_at: string }>).map((l) => (
              <li key={l.id} style={{ padding: '0.5rem 0.8rem', border: '1px solid var(--panel-border, #e8e2d4)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
                <span>
                  <strong>{l.name}</strong>
                  {l.company && <span className="meta"> · {l.company}</span>}
                </span>
                <span className={`status ${l.status}`}>{l.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="card stat">
      <p className="label">{label}</p>
      <p className="value">{value}</p>
    </article>
  )
}
