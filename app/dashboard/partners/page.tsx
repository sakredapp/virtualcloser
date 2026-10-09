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
 * Partners — the executive's carrier reps, agency principals, board members,
 * vendors and key producers, with one red button to send them something.
 */
export default async function PartnersPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  if (!(await partnersReady())) {
    return (
      <main className="wrap">
        <PageHeader eyebrow="Partners" title="Partners" subtitle="Carrier reps, agency principals, board members and vendors, with one button to send them something." />
        <section className="cx-panel" style={{ marginTop: 16 }}>
          <p className="cx-takeaway" style={{ marginTop: 0 }}>{PARTNERS_NOT_READY}</p>
        </section>
      </main>
    )
  }
  const initial = await listPartners(ctx.tenant.id).catch(() => [])
  return <PartnersClient initial={initial} />
}
