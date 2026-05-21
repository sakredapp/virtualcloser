import DashboardShell from '@/app/components/DashboardShell'
import { buildDashboardTabs, type DashboardNavData } from './dashboardTabs'
import { getAgreement, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import type { BrandKey } from '@/lib/brand'
import LiabilityGate from './dialer/LiabilityGate'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let signed = true
  let workspaceLabel = 'your workspace'
  let defaultName = ''
  let brand: BrandKey | undefined
  let nav: DashboardNavData | null = null

  try {
    const { requireMember } = await import('@/lib/tenant')
    const ctx = await requireMember()
    workspaceLabel = ctx.tenant.display_name || ctx.tenant.slug
    defaultName = ctx.member.display_name || ''
    brand = ctx.tenant.brand
    signed = await hasMemberSignedCurrent(ctx.member.id, brand)
    nav = await buildDashboardTabs(ctx.tenant.id, ctx.member)
  } catch {
    // No member context — child page's own auth handles redirect.
  }

  const agreement = getAgreement(brand)
  const html = renderAgreementHtml({ workspaceLabel, brand })

  return (
    <>
      <div data-app-shell hidden aria-hidden />
      <DashboardShell tabs={nav?.tabs ?? []} lockedAddons={nav?.lockedAddons ?? []} brandKey={brand}>
        {children}
      </DashboardShell>
      {!signed && (
        <LiabilityGate
          agreementTitle={agreement.title}
          agreementVersion={agreement.version}
          agreementHtml={html}
          workspaceLabel={workspaceLabel}
          defaultName={defaultName}
        />
      )}
    </>
  )
}
