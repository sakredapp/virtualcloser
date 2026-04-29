import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { listInbox, type DeferredItem } from '@/lib/deferred'
import { listMembers } from '@/lib/members'
import type { Member } from '@/types'

export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<DeferredItem['source'], string> = {
  walkie: 'Walkie',
  voice_memo: 'Voice memo',
  room: 'Room',
  lead: 'Lead',
  roleplay: 'Roleplay',
  self: 'You',
}

function formatRemindAt(iso: string | null): string {
  if (!iso) return 'no reminder'
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default async function InboxPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)
  const [items, members] = await Promise.all([
    listInbox(tenant.id, member.id, { limit: 200 }),
    listMembers(tenant.id),
  ])
  const memberById = new Map<string, Member>(members.map((m) => [m.id, m]))

  // Group by source so manager-relayed asks stay distinct from
  // self-set reminders. Order: walkies > memos > rooms > leads > roleplay > self.
  const order: DeferredItem['source'][] = [
    'walkie',
    'voice_memo',
    'room',
    'lead',
    'roleplay',
    'self',
  ]
  const grouped = new Map<DeferredItem['source'], DeferredItem[]>()
  for (const s of order) grouped.set(s, [])
  for (const item of items) {
    grouped.get(item.source)?.push(item)
  }

  const totalOpen = items.length
  const dueSoon = items.filter((i) => {
    if (!i.remind_at) return false
    const t = new Date(i.remind_at).getTime()
    return t < Date.now() + 24 * 3600_000
  }).length

  return (
    <main className="wrap" style={{ padding: '1.4rem 1rem 3rem', maxWidth: 1080, margin: '0 auto' }}>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <header style={{ marginBottom: '1rem' }}>
        <p
          className="meta"
          style={{
            margin: 0,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--brand-red)',
          }}
        >
          Remind-me-later inbox
        </p>
        <h1 style={{ margin: '0.2rem 0 0.5rem', fontSize: 28, fontWeight: 700 }}>
          Things parked for later
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 720 }}>
          Anything you said &ldquo;remind me about this later&rdquo; on, plus stuff that came in from
          your team that you parked instead of answering immediately. Separate from your goals
          and tasks on purpose so leadership work doesn&rsquo;t crowd out your own.
        </p>
      </header>

      <section className="grid-4" style={{ marginBottom: '1rem' }}>
        <article className="card stat">
          <p className="label">Open in inbox</p>
          <p className="value small">{totalOpen}</p>
        </article>
        <article className="card stat">
          <p className="label">Due in next 24h</p>
          <p className="value small">{dueSoon}</p>
        </article>
        <article className="card stat">
          <p className="label">From teammates</p>
          <p className="value small">
            {items.filter((i) => i.source !== 'self').length}
          </p>
        </article>
        <article className="card stat">
          <p className="label">Self-reminders</p>
          <p className="value small">
            {items.filter((i) => i.source === 'self').length}
          </p>
        </article>
      </section>

      {totalOpen === 0 && (
        <section className="card" style={{ padding: '1.2rem 1.2rem' }}>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Inbox is empty. Tell the bot &ldquo;remind me about Dana tomorrow at 9&rdquo; or park
            an incoming walkie to fill it.
          </p>
        </section>
      )}

      {order.map((source) => {
        const list = grouped.get(source) ?? []
        if (list.length === 0) return null
        return (
          <section key={source} className="card" style={{ marginBottom: '0.8rem' }}>
            <div className="section-head">
              <h2>{SOURCE_LABEL[source]}</h2>
              <p>
                {list.length} item{list.length === 1 ? '' : 's'}
              </p>
            </div>
            <ul className="list" style={{ maxHeight: 'none' }}>
              {list.map((item) => {
                const fromMember = item.source_member_id ? memberById.get(item.source_member_id) : null
                return (
                  <li key={item.id} className="row">
                    <div>
                      <p className="name">{item.title}</p>
                      {item.body && <p className="meta">{item.body}</p>}
                      <p className="meta">
                        {fromMember ? `from ${fromMember.display_name} · ` : ''}
                        {formatRemindAt(item.remind_at)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <section className="card" style={{ padding: '1rem 1.2rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          Tip: in Telegram say &ldquo;park this for Friday&rdquo; on a walkie reply to file it
          here without losing the source thread.
        </p>
      </section>
    </main>
  )
}
