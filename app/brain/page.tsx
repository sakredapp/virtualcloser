import { getOpenBrainItems } from '@/lib/supabase'
import { requireTenant, getCurrentMember } from '@/lib/tenant'
import { resolveMemberDataScope } from '@/lib/permissions'
import BrainClient from './BrainClient'

export const dynamic = 'force-dynamic'

export default async function BrainPage() {
  const tenant = await requireTenant()
  // Per-member scoping: a rep only sees their own brain items; managers see
  // their teams; admins/owners see the whole account.
  const viewer = await getCurrentMember()
  const scope = viewer ? await resolveMemberDataScope(viewer) : null
  const items = await getOpenBrainItems(tenant.id, scope)

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
