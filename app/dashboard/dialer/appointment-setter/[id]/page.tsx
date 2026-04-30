import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { getSalespersonForRep } from '@/lib/ai-salesperson'
import SalespersonEditor from './SalespersonEditor'

export const dynamic = 'force-dynamic'

export default async function SalespersonDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenant
  let viewerMember: Awaited<ReturnType<typeof requireMember>>['member'] | null = null
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
    viewerMember = ctx.member
  } catch {
    redirect('/login')
  }

  const { id } = await params
  const setter = await getSalespersonForRep(tenant.id, id)
  if (!setter) notFound()

  const navTabs = await buildDashboardTabs(tenant.id, viewerMember)

  return (
    <main className="wrap">
      <header className="hero" style={{ paddingBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Link
            href="/dashboard/dialer/appointment-setter"
            style={{ color: 'var(--red)', fontSize: 13, textDecoration: 'none' }}
          >
            ← All AI Salespeople
          </Link>
        </div>
        <h1 style={{ margin: 0 }}>{setter.name}</h1>
        <p className="sub" style={{ margin: '2px 0 0' }}>
          Configure persona, scripts, schedule, calendar, and lead rules. Changes save instantly.
        </p>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <SalespersonEditor initial={setter} />
    </main>
  )
}
