import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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
    <div style={{ minHeight: '100vh', background: 'var(--red)' }}>
      {/* header bar */}
      <div
        style={{
          padding: '20px 24px 6px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <h1
          style={{
            color: '#fff',
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.3px',
          }}
        >
          Pipeline
        </h1>
      </div>
      <div style={{ padding: '0 24px 12px' }}>
        <DashboardNav tabs={navTabs} />
      </div>

      <KanbanBoard
        initialPipelines={pipelines}
        initialPipelineLeads={pipelineLeads}
        initialPipelineItems={pipelineItems}
        initialUnassigned={unassigned}
      />
    </div>
  )
}
