import { redirect } from 'next/navigation'
import { getCurrentMember, requireTenant } from '@/lib/tenant'
import type { BrandKey } from '@/lib/brand'
import CxoHome from '../CxoHome'

export const dynamic = 'force-dynamic'

/** Revenue — the executive's KPI page (was the Overview home until 10-09). */
export default async function RevenuePage() {
  const tenant = await requireTenant()
  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  if ((brandKey as string) !== 'cxo') redirect('/dashboard')
  const viewerMember = await getCurrentMember()
  return (
    <CxoHome
      tenantId={tenant.id}
      firstName={(viewerMember?.display_name || tenant.display_name || '').split(' ')[0] || null}
      workspace={tenant.display_name || tenant.slug}
      timezone={tenant.timezone}
    />
  )
}
