import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { listSmsConversations } from '@/lib/crmLeads'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import SmsInboxClient from './SmsInboxClient'

export const dynamic = 'force-dynamic'

export default async function SmsInboxPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  if (isGatewayHost(host)) redirect('/login')

  let ctx: Awaited<ReturnType<typeof requireMember>>
  try {
    ctx = await requireMember()
  } catch {
    redirect('/login')
  }

  const { tenant, member } = ctx
  const [navTabs, conversations] = await Promise.all([
    buildDashboardTabs(tenant.id, member),
    listSmsConversations(member.rep_id),
  ])

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Messaging</p>
          <h1>SMS Inbox</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            All SMS conversations with your leads — inbound and outbound.
          </p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <SmsInboxClient conversations={conversations} />
    </main>
  )
}
