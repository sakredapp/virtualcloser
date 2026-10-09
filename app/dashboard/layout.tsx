import DashboardShell from '@/app/components/DashboardShell'
import { buildDashboardTabs, type DashboardNavData } from './dashboardTabs'
import { getAgreement, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import type { BrandKey } from '@/lib/brand'
import LiabilityGate from './dialer/LiabilityGate'
import ConnectGoogleBanner from '@/app/components/ConnectGoogleBanner'
import { getTokensForMember } from '@/lib/google'
import MiraBar from '@/app/components/cxo/MiraBar'
import UsageBeacon from '@/app/components/cxo/UsageBeacon'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import AssistantBar, { type AssistantBarExec } from '@/app/components/cxo/AssistantBar'
import { headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import { assistantPathKind } from '@/lib/assistantsShared'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let signed = true
  let workspaceLabel = 'your workspace'
  let defaultName = ''
  let workspaceName: string | null = null
  let whoLabel: string | null = null
  let timezone: string | null = null
  let logoUrl: string | null = null
  let brand: BrandKey | undefined
  let nav: DashboardNavData | null = null
  let needsGoogle = false
  // An employee login gets its own page only: no tabs, no Mira, no banners.
  let employeeOnly = false
  // Exec assistant signed in (as themself, or working as their exec).
  let assistant: { name: string; execs: AssistantBarExec[]; activeId: string | null } | null = null

  try {
    const { requireMember } = await import('@/lib/tenant')
    const ctx = await requireMember()
    workspaceLabel = ctx.tenant.display_name || ctx.tenant.slug
    defaultName = ctx.member.display_name || ''
    brand = ctx.tenant.brand
    // The executive rail is the client's: their company, their clock, their logo.
    workspaceName = ctx.tenant.company || ctx.tenant.display_name || ctx.tenant.slug
    whoLabel = ctx.member.display_name || ctx.member.email || null
    const acting = ctx.member.acting_assistant ?? null
    if (acting || ctx.member.role === 'assistant') {
      // Belt and braces: the tenant gate already stopped blocked paths.
      const path = (await headers()).get('x-cx-path')
      if (assistantPathKind(path) === 'blocked') redirect(`/dashboard/assistant?blocked=${encodeURIComponent(path ?? '')}`)
      const { activeExecFor } = await import('@/lib/assistants')
      const me = acting ?? { id: ctx.member.id, display_name: ctx.member.display_name, email: ctx.member.email }
      const { active, links } = await activeExecFor(ctx.tenant.id, me.id)
      const name = me.display_name || me.email.split('@')[0]
      assistant = { name, execs: links.map((l) => ({ id: l.exec_member_id, name: l.exec_name })), activeId: active?.exec_member_id ?? null }
      whoLabel = active ? `${name.split(' ')[0]} for ${active.exec_name.split(' ')[0]}` : name
      // Their own agreement, their own name, never the exec's.
      defaultName = me.display_name || ''
      timezone = ctx.member.timezone || ctx.tenant.timezone || null
    }
    timezone = ctx.member.timezone || ctx.tenant.timezone || null
    const cxoSettings = (ctx.tenant.settings?.cxo ?? null) as { logo_url?: unknown } | null
    logoUrl = typeof cxoSettings?.logo_url === 'string' && /^https?:\/\//.test(cxoSettings.logo_url) ? cxoSettings.logo_url : null
    signed = await hasMemberSignedCurrent(ctx.member.acting_assistant?.id ?? ctx.member.id, brand)
    employeeOnly = isEmployeeOnlyMember(ctx.member, ctx.tenant)
    nav = employeeOnly ? null : await buildDashboardTabs(ctx.tenant.id, ctx.member)
    // Prompt non-owner members (e.g. an exec's assistant) to connect their own
    // Google. The owner uses the shared/tenant account, so they're never nagged.
    if (brand === 'cxo' && ctx.member.role !== 'owner' && !employeeOnly && !assistant) {
      needsGoogle = !(await getTokensForMember(ctx.tenant.id, ctx.member.id))
    }
  } catch (err) {
    // Redirects (an assistant on a page that is not theirs) must go through.
    unstable_rethrow(err)
    // No member context — child page's own auth handles redirect.
  }

  const agreement = getAgreement(brand)
  const html = renderAgreementHtml({ workspaceLabel, brand })

  return (
    <>
      <div data-app-shell hidden aria-hidden />
      <DashboardShell
        tabs={nav?.tabs ?? []}
        lockedAddons={nav?.lockedAddons ?? []}
        brandKey={brand}
        workspaceName={workspaceName}
        whoLabel={whoLabel}
        timezone={timezone}
        logoUrl={logoUrl}
        dock={brand === 'cxo' && !employeeOnly && !assistant ? <MiraBar firstName={defaultName.split(' ')[0] || undefined} /> : undefined}
        assistantMode={!!assistant}
        topBar={assistant ? <AssistantBar assistantName={assistant.name} execs={assistant.execs} activeId={assistant.activeId} /> : undefined}
      >
        {children}
      </DashboardShell>
      {brand === 'cxo' && !employeeOnly && !assistant && <UsageBeacon />}
      {brand === 'cxo' && needsGoogle && <ConnectGoogleBanner />}
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
