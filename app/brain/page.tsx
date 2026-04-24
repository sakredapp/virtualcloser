import { getOpenBrainItems } from '@/lib/supabase'
import { requireTenant } from '@/lib/tenant'
import BrainClient from './BrainClient'

export const dynamic = 'force-dynamic'

export default async function BrainPage() {
  const tenant = await requireTenant()
  const items = await getOpenBrainItems(tenant.id)

  return (
    <BrainClient
      repName={tenant.display_name}
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
