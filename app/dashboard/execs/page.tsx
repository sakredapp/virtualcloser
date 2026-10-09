import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { listPartners, partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import PageHeader from '@/app/components/PageHeader'
import PartnersClient from '../partners/PartnersClient'

export const dynamic = 'force-dynamic'

/**
 * Execs — the exec team: messaging, the board cards they hold and their
 * contact details. Same directory, same org-scoped API as Partners, filtered
 * to kind = executive.
 */
export default async function ExecsPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  if (!(await partnersReady())) {
    return (
      <main className="wrap">
        <PageHeader title="Execs" subtitle="Pinnacle Life Group’s exec team. Message, call or email in one tap." />
        <section className="cx-panel" style={{ marginTop: 16 }}>
          <p className="cx-takeaway" style={{ marginTop: 0 }}>{PARTNERS_NOT_READY}</p>
        </section>
      </main>
    )
  }
  const initial = await listPartners(ctx.tenant.id, { scope: 'execs' }).catch(() => [])
  return <PartnersClient initial={initial} scope="execs" />
}
