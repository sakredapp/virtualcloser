import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { loadPlanPage } from '@/lib/plan/data'
import { bookToday } from '@/lib/pinnacle/kpis'
import PageHeader from '@/app/components/PageHeader'
import PlanClient from './PlanClient'
import { canSeeFinancials } from '@/lib/qbo/access'
import { loadQboPanelData } from '@/lib/qbo/data'
import QboPanel from '@/app/components/cxo/QboPanel'

export const dynamic = 'force-dynamic'

/**
 * Sales Plan — the year's targets by month, product and carrier, set against
 * what the book shows; the unit economics behind each line; and each
 * carrier's marketing-allowance tiers with how far there is to go.
 */
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  const tz = ctx.tenant.timezone || 'America/New_York'
  const thisYear = Number(bookToday(new Date(), tz).slice(0, 4))
  const years = Array.from(new Set([thisYear, thisYear + 1, 2026, 2027])).filter((y) => y >= 2026).sort()
  const sp = await searchParams
  const asked = Number(sp?.year)
  const year = years.includes(asked) ? asked : years.includes(2027) ? 2027 : thisYear + 1

  const [data, qbo] = await Promise.all([
    loadPlanPage(ctx.tenant.id, year, tz).catch((err) => {
      console.error('[plan] load', err instanceof Error ? err.message : err)
      return null
    }),
    // Actual margin from QuickBooks, beside the unit economics. Exec only.
    canSeeFinancials(ctx.member) ? loadQboPanelData(ctx.tenant.id) : Promise.resolve(null),
  ])
  const qboSlot = qbo ? <QboPanel data={qbo} returnPath="/dashboard/plan" variant="plan" todayIso={bookToday(new Date(), tz)} /> : null
  if (!data) {
    return (
      <main className="wrap">
        <PageHeader title="Sales Plan" subtitle="The year's plan by month, product and carrier, against the book." />
        <section className="cx-panel cx-panel-tint">
          <p className="cx-takeaway" style={{ margin: 0 }}>The plan could not be read just now. Refresh in a minute; nothing is lost.</p>
        </section>
        {qboSlot}
      </main>
    )
  }
  return <PlanClient data={data} years={years} qboSlot={qboSlot} />
}
