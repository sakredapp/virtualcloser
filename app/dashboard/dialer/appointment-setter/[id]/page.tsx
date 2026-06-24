import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/app/components/PageHeader'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { getSalespersonForRep } from '@/lib/ai-salesperson'
import { resolveMemberDataScope } from '@/lib/permissions'
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

  // Enterprise reps can only access setters assigned to them.
  if (tenant.tier === 'enterprise' && viewerMember?.role === 'rep') {
    const scope = await resolveMemberDataScope(viewerMember)
    if (scope.memberIds && !scope.memberIds.includes(setter.assigned_member_id ?? '')) {
      redirect('/dashboard/dialer/appointment-setter')
    }
  }

  const navTabs = await buildDashboardTabs(tenant.id, viewerMember)

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="AI Dialer · AI SDR"
        title={setter.name}
        subtitle="Configure persona, scripts, schedule, calendar, and lead rules. Changes save instantly."
        actions={<Link href="/dashboard/dialer/appointment-setter">← All AI SDRs</Link>}
      />
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <SalespersonEditor initial={setter} />
    </main>
  )
}
