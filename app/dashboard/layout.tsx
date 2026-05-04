import AppTopbar from '@/app/components/AppTopbar'
import {
  AGREEMENT_TITLE,
  CURRENT_VERSION,
  renderAgreementHtml,
} from '@/lib/liabilityAgreementCopy'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import LiabilityGate from './dialer/LiabilityGate'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let signed = true
  let workspaceLabel = 'your workspace'
  let defaultName = ''

  try {
    const { requireMember } = await import('@/lib/tenant')
    const ctx = await requireMember()
    workspaceLabel = ctx.tenant.display_name || ctx.tenant.slug
    defaultName = ctx.member.display_name || ''
    signed = await hasMemberSignedCurrent(ctx.member.id)
  } catch {
    // No member context — child page's own auth handles redirect.
  }

  const html = renderAgreementHtml({ workspaceLabel })

  return (
    <>
      <div data-app-shell hidden aria-hidden />
      <AppTopbar />
      {children}
      {!signed && (
        <LiabilityGate
          agreementTitle={AGREEMENT_TITLE}
          agreementVersion={CURRENT_VERSION}
          agreementHtml={html}
          workspaceLabel={workspaceLabel}
          defaultName={defaultName}
        />
      )}
    </>
  )
}
