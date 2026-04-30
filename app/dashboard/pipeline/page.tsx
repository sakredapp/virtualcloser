import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import {
  getPipelinesForRep,
  getLeadsForPipeline,
  getUnassignedLeads,
  getItemsForPipeline,
} from '@/lib/pipelines'
import KanbanBoard from './KanbanBoard'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const isApex =
    host.startsWith('www.') ||
    host === 'virtualcloser.com' ||
    host === 'localhost:3000'
  if (isApex) redirect('/login')

  let tenant, member
  try {
    ;({ tenant, member } = await requireMember())
  } catch {
    redirect('/login')
  }
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const pipelines = await getPipelinesForRep(tenant.id).catch(() => [])

  // For sales pipelines, cards come from the leads table. For every other
  // kind, cards come from pipeline_items. Fetch both per pipeline so the
  // client component can render either source uniformly.
  const pipelineLeads: Record<string, Awaited<ReturnType<typeof getLeadsForPipeline>>> = {}
  const pipelineItems: Record<string, Awaited<ReturnType<typeof getItemsForPipeline>>> = {}
  await Promise.all(
    pipelines.map(async (p) => {
      if (p.kind === 'sales') {
        pipelineLeads[p.id] = await getLeadsForPipeline(p.id, tenant.id).catch(() => [])
      } else {
        pipelineItems[p.id] = await getItemsForPipeline(p.id, tenant.id).catch(() => [])
      }
    }),
  )

  const unassigned = await getUnassignedLeads(tenant.id).catch(() => [])

  void member // auth confirmed

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h1>Boards</h1>
          <p className="sub">
            Clean kanban workflow for sales, recruiting, team, and project boards. Managers can run boards too.
          </p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <KanbanBoard
        initialPipelines={pipelines}
        initialPipelineLeads={pipelineLeads}
        initialPipelineItems={pipelineItems}
        initialUnassigned={unassigned}
      />
    </main>
  )
}
