import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { listInbox, type DeferredItem } from '@/lib/deferred'
import { listMembers } from '@/lib/members'
import type { Member } from '@/types'
import EmailTab from './EmailTab'
import ActiveInbox from './ActiveInbox'
import AccountSwitcher from './AccountSwitcher'
import { listConnectedGoogleAccounts } from '@/lib/google'

export const dynamic = 'force-dynamic'

type TabKey = 'reminders' | 'email' | 'active'
type SearchParams = { tab?: string; account?: string }

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

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)
  const params = await searchParams
  const activeTab: TabKey =
    params.tab === 'email'
      ? 'email'
      : params.tab === 'active' || params.tab === 'inbox'
        ? 'active'
        : 'reminders'

  // Account switcher (Gmail tabs only): list every connected Google account in
  // the workspace so an exec + assistant can flip between their inboxes.
  const account = params.account || 'all'
  const accountOptions =
    activeTab === 'reminders'
      ? []
      : (await listConnectedGoogleAccounts(tenant.id)).map((a) => ({
          key: a.isShared ? 'shared' : (a.memberId as string),
          label: a.label,
        }))

  const heading =
    activeTab === 'email'
      ? 'AI drafts'
      : activeTab === 'active'
        ? 'Active inbox'
        : 'Things parked for later'
  const subhead =
    activeTab === 'email'
      ? 'Inbound Gmail threads the AI flagged for a reply. Approve, edit, regenerate, snooze, or dismiss.'
      : activeTab === 'active'
        ? 'Every synced Gmail thread, live. Use this like your inbox — Gemini search at the top, click any thread to read, approve AI drafts inline when they exist.'
        : 'Anything you said “remind me about this later” on, plus stuff that came in from your team that you parked instead of answering immediately.'

  function tabStyle(key: TabKey) {
    return {
      background: activeTab === key ? 'var(--royal-soft)' : 'transparent',
      color: activeTab === key ? 'var(--royal)' : 'inherit',
      textDecoration: 'none',
    }
  }

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>{heading}</h1>
          <p className="sub" style={{ marginTop: 0 }}>{subhead}</p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <nav
        className="card"
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.5rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <Link href="/dashboard/inbox?tab=active" className="btn" style={tabStyle('active')}>
          Active inbox
        </Link>
        <Link href="/dashboard/inbox?tab=email" className="btn" style={tabStyle('email')}>
          AI drafts
        </Link>
        <Link href="/dashboard/inbox" className="btn" style={tabStyle('reminders')}>
          Reminders &amp; parked items
        </Link>
      </nav>

      {accountOptions.length > 1 && activeTab !== 'reminders' && (
        <div style={{ marginBottom: '1rem' }}>
          <AccountSwitcher options={accountOptions} value={account} label="Inbox" />
        </div>
      )}

      {activeTab === 'active' ? (
        <ActiveInbox account={account} />
      ) : activeTab === 'email' ? (
        <EmailTab account={account} />
      ) : (
        <RemindersView tenantId={tenant.id} memberId={member.id} />
      )}
    </main>
  )
}

async function RemindersView({ tenantId, memberId }: { tenantId: string; memberId: string }) {
  const [items, members] = await Promise.all([
    listInbox(tenantId, memberId, { limit: 200 }),
    listMembers(tenantId),
  ])
  const memberById = new Map<string, Member>(members.map((m) => [m.id, m]))

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
    <>
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
    </>
  )
}
