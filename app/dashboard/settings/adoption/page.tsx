import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import PageHeader from '@/app/components/PageHeader'
import AdoptionView from '@/app/components/cxo/AdoptionView'
import { canSeeAdoption, orgAdoption } from '@/lib/cxoAdoption'
import { buildAdoption, type AdoptionData } from '@/lib/cxoAdoptionShared'
import { dayInZone } from '@/lib/dueRemindersShared'

export const dynamic = 'force-dynamic'

/** Settings › Adoption: who is using the suite. The org's owner and admins only, checked here on the server. */
export default async function AdoptionPage() {
  const { tenant, member } = await requireMember()
  if (tenant.brand !== 'cxo' || !canSeeAdoption(member)) redirect('/dashboard')
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  let data: AdoptionData
  let failed = false
  try {
    data = await orgAdoption(tenant.id, tz)
  } catch (err) {
    console.error('[adoption] page', err)
    failed = true
    data = buildAdoption([], [], [], dayInZone(new Date(), tz))
  }
  return (
    <main className="wrap">
      <PageHeader title="Adoption" subtitle="Who is using the suite, and who needs a nudge." />
      {failed ? (
        <section className="cx-panel">
          <p className="cx-takeaway" style={{ margin: 0 }}>Adoption could not load. Try again in a minute.</p>
        </section>
      ) : (
        <AdoptionView data={data} tz={tz} />
      )}
    </main>
  )
}
