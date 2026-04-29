import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { listMembers, getManagedTeamIds } from '@/lib/members'
import { visibilityScope } from '@/lib/permissions'
import { getMemberKpis, isoDaysAgo, type MemberKpiRow } from '@/lib/leaderboard'
import { supabase } from '@/lib/supabase'
import type { Member } from '@/types'

export const dynamic = 'force-dynamic'

type WindowKey = '1d' | '7d' | '30d'
const WINDOW_DAYS: Record<WindowKey, number> = { '1d': 1, '7d': 7, '30d': 30 }
const WINDOW_LABEL: Record<WindowKey, string> = { '1d': 'Today', '7d': '7 days', '30d': '30 days' }

export default async function TeamLeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ window?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()
  const scope = visibilityScope(member.role)
  if (scope === 'self') {
    // Reps don't see the leaderboard.
    redirect('/dashboard')
  }
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const sp = (await searchParams) ?? {}
  const windowKey: WindowKey =
    sp.window === '1d' || sp.window === '7d' || sp.window === '30d' ? sp.window : '7d'
  const sinceIso = isoDaysAgo(WINDOW_DAYS[windowKey])

  // Resolve the set of member ids the viewer can see.
  let allowedMemberIds: string[] | null = null
  if (scope === 'team') {
    const teamIds = await getManagedTeamIds(member.id)
    if (teamIds.length === 0) {
      // Manager not yet attached to a team — show only themselves.
      allowedMemberIds = [member.id]
    } else {
      const { data: rows, error } = await supabase
        .from('team_members')
        .select('member_id')
        .in('team_id', teamIds)
      if (error) throw error
      const ids = new Set<string>([member.id])
      for (const r of (rows ?? []) as Array<{ member_id: string }>) ids.add(r.member_id)
      allowedMemberIds = Array.from(ids)
    }
  }

  const allMembers = await listMembers(tenant.id)
  const memberIndex = new Map<string, Member>()
  for (const m of allMembers) memberIndex.set(m.id, m)

  const kpis = await getMemberKpis(tenant.id, sinceIso, allowedMemberIds)

  // Make sure every visible member is represented even if they have zero KPIs.
  const visibleMembers = allowedMemberIds
    ? allMembers.filter((m) => allowedMemberIds!.includes(m.id))
    : allMembers
  const haveKpiFor = new Set(kpis.map((k) => k.memberId))
  for (const m of visibleMembers) {
    if (!haveKpiFor.has(m.id)) {
      kpis.push({
        memberId: m.id,
        callsTotal: 0,
        conversations: 0,
        meetingsBooked: 0,
        closedWon: 0,
        closedLost: 0,
        leadsAdded: 0,
        brainItemsDone: 0,
      })
    }
  }
  // Re-sort after backfill.
  kpis.sort(
    (a, b) =>
      b.closedWon - a.closedWon ||
      b.meetingsBooked - a.meetingsBooked ||
      b.conversations - a.conversations,
  )

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">{tenant.display_name}</p>
          <h1>Team leaderboard</h1>
          <p className="sub">
            Live attribution across {visibleMembers.length}{' '}
            {visibleMembers.length === 1 ? 'rep' : 'reps'}. Sorted by closed wins, then
            meetings booked, then conversations.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignSelf: 'flex-start' }}>
          {(['1d', '7d', '30d'] as WindowKey[]).map((k) => (
            <Link
              key={k}
              href={`/dashboard/team?window=${k}`}
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

      <DashboardNav tabs={navTabs} />

      <section className="card" style={{ marginTop: '0.8rem', padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
          <thead>
            <tr style={{ background: 'var(--panel-2, #f7f4ef)', textAlign: 'left' }}>
              <th style={th}>#</th>
              <th style={th}>Rep</th>
              <th style={th}>Role</th>
              <th style={thNum}>Calls</th>
              <th style={thNum}>Convos</th>
              <th style={thNum}>Booked</th>
              <th style={thNum}>Won</th>
              <th style={thNum}>Lost</th>
              <th style={thNum}>Leads added</th>
              <th style={thNum}>Tasks done</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((row, i) => {
              const m = row.memberId ? memberIndex.get(row.memberId) : null
              const name = m?.display_name ?? m?.email ?? 'Unattributed'
              const role = m?.role ?? '—'
              const slug = m?.slug ?? null
              return (
                <tr key={row.memberId ?? `unattrib-${i}`} style={{ borderTop: '1px solid var(--panel-border, #e8e2d4)' }}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>
                    {slug && m ? (
                      <Link href={`/u/${slug}`} style={{ fontWeight: 600 }}>
                        {name}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{name}</span>
                    )}
                  </td>
                  <td style={td}>{role}</td>
                  <td style={tdNum}>{row.callsTotal}</td>
                  <td style={tdNum}>{row.conversations}</td>
                  <td style={tdNum}>{row.meetingsBooked}</td>
                  <td style={tdNum}>{row.closedWon}</td>
                  <td style={tdNum}>{row.closedLost}</td>
                  <td style={tdNum}>{row.leadsAdded}</td>
                  <td style={tdNum}>{row.brainItemsDone}</td>
                </tr>
              )
            })}
            {kpis.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...td, textAlign: 'center', padding: '1.5rem', color: 'var(--muted, #5a5a5a)' }}>
                  No activity in this window yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {scope === 'account' && (
        <p className="hint" style={{ marginTop: '0.8rem' }}>
          You&apos;re viewing the entire account. Managers see only their team(s).
        </p>
      )}
    </main>
  )
}

const th: React.CSSProperties = { padding: '0.7rem 0.9rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }
const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '0.65rem 0.9rem', verticalAlign: 'middle' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
