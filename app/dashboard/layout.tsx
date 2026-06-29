import DashboardShell from '@/app/components/DashboardShell'
import { buildDashboardTabs, type DashboardNavData } from './dashboardTabs'
import { getAgreement, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import type { BrandKey } from '@/lib/brand'
import LiabilityGate from './dialer/LiabilityGate'
import FeedbackWidget from '@/app/components/FeedbackWidget'
import ConnectGoogleBanner from '@/app/components/ConnectGoogleBanner'
import { getTokensForMember } from '@/lib/google'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let signed = true
  let workspaceLabel = 'your workspace'
  let defaultName = ''
  let brand: BrandKey | undefined
  let nav: DashboardNavData | null = null
  let needsGoogle = false

  try {
    const { requireMember } = await import('@/lib/tenant')
    const ctx = await requireMember()
    workspaceLabel = ctx.tenant.display_name || ctx.tenant.slug
    defaultName = ctx.member.display_name || ''
    brand = ctx.tenant.brand
    signed = await hasMemberSignedCurrent(ctx.member.id, brand)
    nav = await buildDashboardTabs(ctx.tenant.id, ctx.member)
    // Prompt non-owner members (e.g. an exec's assistant) to connect their own
    // Google. The owner uses the shared/tenant account, so they're never nagged.
    if (brand === 'cxo' && ctx.member.role !== 'owner') {
      needsGoogle = !(await getTokensForMember(ctx.tenant.id, ctx.member.id))
    }
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
      {brand === 'cxo' && needsGoogle && <ConnectGoogleBanner />}
      {brand === 'cxo' && <FeedbackWidget />}
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
