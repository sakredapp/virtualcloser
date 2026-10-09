import { redirect } from 'next/navigation'
import { getCurrentMember, requireTenant } from '@/lib/tenant'
import type { BrandKey } from '@/lib/brand'
import { bookToday } from '@/lib/pinnacle/kpis'
import { canSeeFinancials } from '@/lib/qbo/access'
import { loadQboPanelData } from '@/lib/qbo/data'
import QboPanel from '@/app/components/cxo/QboPanel'
import CxoHome from '../CxoHome'

export const dynamic = 'force-dynamic'

/** Revenue — the executive's KPI page (was the Overview home until 10-09). */
export default async function RevenuePage() {
  const tenant = await requireTenant()
  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  if ((brandKey as string) !== 'cxo') redirect('/dashboard')
  const viewerMember = await getCurrentMember()
  // From QuickBooks: financials are for the exec team only; nobody else gets
  // the section (or the query) at all.
  const qbo = canSeeFinancials(viewerMember) ? await loadQboPanelData(tenant.id) : null
  return (
    <CxoHome
      tenantId={tenant.id}
      firstName={(viewerMember?.display_name || tenant.display_name || '').split(' ')[0] || null}
      workspace={tenant.display_name || tenant.slug}
      timezone={tenant.timezone}
    >
      {qbo && <QboPanel data={qbo} returnPath="/dashboard/revenue" todayIso={bookToday(new Date(), tenant.timezone || 'America/New_York')} />}
    </CxoHome>
  )
}
