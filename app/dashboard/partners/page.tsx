import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { listPartners, partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import PageHeader from '@/app/components/PageHeader'
import PartnersClient from './PartnersClient'

export const dynamic = 'force-dynamic'

/**
 * Partners — carrier partners, carrier reps, vendors and everyone else the exec
 * team deals with. Execs live on /dashboard/execs.
 */
export default async function PartnersPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  if (!(await partnersReady())) {
    return (
      <main className="wrap">
        <PageHeader title="Partners" subtitle="Carrier reps, vendors and outside partners." />
        <section className="cx-panel" style={{ marginTop: 16 }}>
          <p className="cx-takeaway" style={{ marginTop: 0 }}>{PARTNERS_NOT_READY}</p>
        </section>
      </main>
    )
  }
  const initial = await listPartners(ctx.tenant.id, { scope: 'partners' }).catch(() => [])
  return <PartnersClient initial={initial} scope="partners" />
}
