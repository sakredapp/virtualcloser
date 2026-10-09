import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { loadEmployees } from '@/lib/employees/data'
import { canViewComp } from '@/lib/employees/shared'
import { bookToday } from '@/lib/pinnacle/kpis'
import PageHeader from '@/app/components/PageHeader'
import EmployeesClient from './EmployeesClient'

export const dynamic = 'force-dynamic'

/**
 * Employees — the org chart, each person's KPIs, bonus plan and reviews, and
 * this period's bonus payouts for payroll. Salary and bonus show only to
 * members who may see comp (owners/admins, or settings.can_view_comp).
 */
export default async function EmployeesPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  const comp = canViewComp(ctx.member)
  const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
  const data = await loadEmployees(ctx.tenant.id, comp).catch((err) => {
    console.error('[employees] load', err instanceof Error ? err.message : err)
    return null
  })
  if (!data) {
    return (
      <main className="wrap">
        <PageHeader title="Employees" subtitle="Who reports to whom, how each is tracking, and their bonus." />
        <section className="cx-panel cx-panel-tint">
          <p className="cx-takeaway" style={{ margin: 0 }}>The team could not be read just now. Refresh in a minute; nothing is lost.</p>
        </section>
      </main>
    )
  }
  return <EmployeesClient data={data} today={today} comp={comp} />
}
