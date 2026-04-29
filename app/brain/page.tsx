import { getOpenBrainItems } from '@/lib/supabase'
import { requireTenant, getCurrentMember } from '@/lib/tenant'
import { resolveMemberDataScope } from '@/lib/permissions'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import BrainClient from './BrainClient'

export const dynamic = 'force-dynamic'

export default async function BrainPage() {
  const tenant = await requireTenant()
  const viewer = await getCurrentMember()
  const scope = viewer ? await resolveMemberDataScope(viewer) : null
  const [items, navTabs] = await Promise.all([
    getOpenBrainItems(tenant.id, scope),
    buildDashboardTabs(tenant.id, viewer),
  ])

  return (
    <BrainClient
      repName={tenant.display_name}
      navTabs={navTabs}
      initialItems={items.map((i) => ({
        id: i.id,
        item_type: i.item_type,
        content: i.content,
        priority: i.priority,
        horizon: i.horizon,
        due_date: i.due_date,
        status: i.status,
        created_at: i.created_at,
      }))}
    />
  )
}
