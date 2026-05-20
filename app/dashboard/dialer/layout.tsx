// Layout wrapper for every /dashboard/dialer/* route.
//
// Single job: render the LiabilityGate modal on top of the dialer surface
// when the viewer member hasn't signed the current agreement version. The
// modal is fixed-positioned so children render normally underneath but
// can't be interacted with until the member signs.
//
// Putting this in a layout (instead of repeating the check in each
// subroute) means deep links to /dashboard/dialer/hours,
// /dashboard/dialer/appointment-setter, etc. can't slip past the gate.

import { requireMember } from '@/lib/tenant'
import { getAgreement, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import type { BrandKey } from '@/lib/brand'
import LiabilityGate from './LiabilityGate'

export default async function DialerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let signed = true // fail-open if no member context — page-level auth handles redirects
  let workspaceLabel = 'your workspace'
  let defaultName = ''
  let brand: BrandKey | undefined
  try {
    const ctx = await requireMember()
    workspaceLabel = ctx.tenant.display_name || ctx.tenant.slug
    defaultName = ctx.member.display_name || ''
    brand = ctx.tenant.brand
    signed = await hasMemberSignedCurrent(ctx.member.id, brand)
  } catch {
    // No member context — let the child page's own auth handle the redirect.
    return <>{children}</>
  }

  if (signed) return <>{children}</>

  const agreement = getAgreement(brand)
  const html = renderAgreementHtml({ workspaceLabel, brand })
  return (
    <>
      {children}
      <LiabilityGate
        agreementTitle={agreement.title}
        agreementVersion={agreement.version}
        agreementHtml={html}
        workspaceLabel={workspaceLabel}
        defaultName={defaultName}
      />
    </>
  )
}
