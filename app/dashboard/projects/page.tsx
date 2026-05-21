import { requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import { listProjects } from '@/lib/projects'
import ProjectsClient from './ProjectsClient'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const tenant = await requireTenant()
  const viewer = await getCurrentMember()
  const [projects, navTabs] = await Promise.all([
    listProjects(tenant.id),
    buildDashboardTabs(tenant.id, viewer),
  ])

  return <ProjectsClient repName={tenant.display_name} navTabs={navTabs} initialProjects={projects} />
}
