import { notFound } from 'next/navigation'
import { requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import { getProjectDetail } from '@/lib/projects'
import { listMembers } from '@/lib/members'
import ProjectDetailClient from './ProjectDetailClient'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tenant = await requireTenant()
  const viewer = await getCurrentMember()

  const [detail, navTabs, members] = await Promise.all([
    getProjectDetail(tenant.id, id),
    buildDashboardTabs(tenant.id, viewer),
    listMembers(tenant.id),
  ])

  if (!detail) notFound()

  return (
    <ProjectDetailClient
      navTabs={navTabs}
      detail={detail}
      members={members.map((m) => ({ id: m.id, name: m.display_name || m.email }))}
    />
  )
}
