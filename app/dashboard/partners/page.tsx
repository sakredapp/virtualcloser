import type { Metadata } from 'next'
import PageHeader from '@/app/components/PageHeader'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Partners' }

/**
 * Partners — placeholder until the real page lands (feat/cxo-partners).
 * Same shell, same header, one calm sentence; nothing invented.
 */
export default async function PartnersPage() {
  await requireMember()
  return (
    <main className="wrap">
      <PageHeader eyebrow="Partners" title="Partners is on its way" subtitle="Carriers, IMOs and the people you work with, in one place. Mira will keep it current." />
      <section className="cx-panel" style={{ marginTop: 16 }}>
        <p className="cx-takeaway" style={{ marginTop: 0 }}>
          Nothing to set up yet. When Partners opens, it appears here and in the rail without a change on your side.
        </p>
      </section>
    </main>
  )
}
