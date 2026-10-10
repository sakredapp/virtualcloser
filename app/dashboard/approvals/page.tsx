import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import PageHeader from '@/app/components/PageHeader'
import ApprovalsClient from './ApprovalsClient'
import '@/app/dashboard/cxo-alerts.css'

export const dynamic = 'force-dynamic'

/**
 * Approvals (employee ops, switch-gated): Mira actions that send outside
 * the company or change someone else's work, waiting for an executive's OK,
 * plus the audit log of what Mira did and for whom. Off (404-style note)
 * unless reps.settings.cxo_employee_ops is true.
 */
export default async function ApprovalsPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')
  if (isEmployeeOnlyMember(ctx.member, ctx.tenant)) redirect('/dashboard/me')

  if (!cxoEmployeeOps(ctx.tenant)) {
    return (
      <main className="wrap">
        <PageHeader title="Approvals" subtitle="What Mira is waiting on an executive for." />
        <section className="cx-panel" style={{ marginTop: 16 }}>
          <p className="cx-takeaway" style={{ marginTop: 0 }}>Approvals are not switched on for your company yet.</p>
        </section>
      </main>
    )
  }
  return (
    <main className="wrap">
      <PageHeader title="Approvals" subtitle="What Mira is waiting on an executive for, and what she has done." />
      <ApprovalsClient />
    </main>
  )
}
