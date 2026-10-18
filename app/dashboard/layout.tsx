import DashboardShell from '@/app/components/DashboardShell'
import { buildDashboardTabs, type DashboardNavData } from './dashboardTabs'
import { getAgreement, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import type { BrandKey } from '@/lib/brand'
import LiabilityGate from './LiabilityGate'
import ConnectGoogleBanner from '@/app/components/ConnectGoogleBanner'
import { getTokensForMember } from '@/lib/google'
import MiraBar from '@/app/components/cxo/MiraBar'
import UsageBeacon from '@/app/components/cxo/UsageBeacon'
import { canSeeAdoption } from '@/lib/cxoAdoption'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import AssistantBar, { type AssistantBarExec } from '@/app/components/cxo/AssistantBar'
import { headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import { assistantPathKind } from '@/lib/assistantsShared'
import { memberTitle } from '@/lib/memberTitle'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { phoneVersionKeyFor, type PhoneVersionKey } from '@/lib/phoneVersions'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { assistantNameFor } from '@/lib/assistantNameServer'
import { AssistantNameProvider } from '@/app/components/AssistantNameProvider'
import { inboxAllowed } from '@/lib/cxoFeatures'
import { agreementTitleNameFor, isPinnacleEdition, skipsAgreementWall } from '@/lib/storeDemo'
import type { Metadata } from 'next'
import { isNativeAppUA } from '@/lib/nativeApp'

const EMPLOYEE_STARTERS = ["What's on my calendar today?", 'What are my to-dos?', 'Any messages for me?']
// Email is in the list only on the Pinnacle edition (owner 2026-10-17: no inbox elsewhere).
const employeeMiraExplainer = (inbox: boolean, name: string) =>
  `${name} works on your own to-dos, meetings, calendar, ${inbox ? 'email ' : ''}and board cards, and can message coworkers. Company finances, pay and other people's data stay with the executive team. What you ask her to remember is yours only. Your questions count toward your company's shared ${name} allowance.`

/** The Pinnacle edition's tab title is the org's own name, never "Suite CXO". */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const { requireMember } = await import('@/lib/tenant')
    const { tenant } = await requireMember()
    if (isPinnacleEdition(tenant.id)) return { title: tenant.company || tenant.display_name || 'Pinnacle Life Group' }
  } catch (err) {
    unstable_rethrow(err)
  }
  return {}
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let signed = true
  let workspaceLabel = 'your workspace'
  let defaultName = ''
  let workspaceName: string | null = null
  let whoLabel: string | null = null
  let roleTitle: string | null = null
  let timezone: string | null = null
  let logoUrl: string | null = null
  let brand: BrandKey | undefined
  let nav: DashboardNavData | null = null
  let needsGoogle = false
  // Google refused this person's saved connection (lib/google/tokenHealth).
  let reconnectGoogle: { email: string | null; calendarOnly?: boolean } | null = null
  let inbox = false
  // An employee login gets its own page only: no tabs, no banners. Mira is
  // there for them (owner 10-10), limited to their own work on the server.
  let employeeOnly = false
  let queueStarter = false
  // Owner or admin: the settings rail lists Adoption.
  let adoption = false
  // Exec assistant signed in (as themself, or working as their exec).
  let assistant: { name: string; execs: AssistantBarExec[]; activeId: string | null } | null = null
  // Which phone version this company gets (Suite CXO, or Pinnacle for the tenants on that book).
  let phoneVersionKey: PhoneVersionKey | null = null
  let agreementTitleName: string | null = null
  // The assistant's name for this viewer (their pick → the company's → the default).
  let assistantName = ASSISTANT_NAME

  try {
    const { requireMember } = await import('@/lib/tenant')
    const ctx = await requireMember()
    workspaceLabel = ctx.tenant.display_name || ctx.tenant.slug
    assistantName = await assistantNameFor(ctx)
    defaultName = ctx.member.display_name || ''
    brand = ctx.tenant.brand
    inbox = inboxAllowed(ctx.tenant)
    phoneVersionKey = phoneVersionKeyFor({ brand, pinnacle: pinnacleAllowed(ctx.tenant.id) })
    // The executive rail is the client's: their company, their clock, their logo.
    workspaceName = ctx.tenant.company || ctx.tenant.display_name || ctx.tenant.slug
    whoLabel = ctx.member.display_name || ctx.member.email || null
    roleTitle = memberTitle(ctx.member)
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
    // Store review logins skip the e-sign wall (lib/storeDemo); nobody signs for them.
    signed = skipsAgreementWall(ctx.tenant.id) || (await hasMemberSignedCurrent(ctx.member.acting_assistant?.id ?? ctx.member.id, brand))
    agreementTitleName = agreementTitleNameFor(ctx.tenant)
    employeeOnly = isEmployeeOnlyMember(ctx.member, ctx.tenant)
    adoption = brand === 'cxo' && canSeeAdoption(ctx.member)
    nav = employeeOnly ? null : await buildDashboardTabs(ctx.tenant.id, ctx.member)
    // Prompt non-owner members (e.g. an exec's assistant) to connect their own
    // Google. The owner uses the shared/tenant account, so they're never nagged.
    // "Run daily queue" is offered as a suggestion chip in the bar until the person has run it today.
    if (brand === 'cxo' && !assistant) {
      const { ranToday } = await import('@/lib/mira/dailyQueue')
      queueStarter = !(await ranToday(ctx).catch(() => true))
    }
    if (brand === 'cxo' && ctx.member.role !== 'owner' && !employeeOnly && !assistant) {
      needsGoogle = !(await getTokensForMember(ctx.tenant.id, ctx.member.id))
    }
    // A connection Google stopped honouring: the owner too, since the
    // company's background work runs on the owner's account.
    if (brand === 'cxo' && !employeeOnly && !assistant) {
      const { brokenGoogleFor } = await import('@/lib/google/tokenHealth')
      reconnectGoogle = await brokenGoogleFor(ctx.tenant.id, ctx.member)
    }
  } catch (err) {
    // Redirects (an assistant on a page that is not theirs) must go through.
    unstable_rethrow(err)
    // No member context — child page's own auth handles redirect.
  }

  // Inside the store app's web view the app's tab bar is already on screen.
  const inApp = isNativeAppUA((await headers()).get('user-agent'))
  const agreement = getAgreement(brand, { titleName: agreementTitleName })
  const html = renderAgreementHtml({ workspaceLabel, brand, titleName: agreementTitleName })

  return (
    <AssistantNameProvider name={assistantName}>
      <div data-app-shell hidden aria-hidden />
      <DashboardShell
        tabs={nav?.tabs ?? []}
        lockedAddons={nav?.lockedAddons ?? []}
        brandKey={brand}
        workspaceName={workspaceName}
        whoLabel={whoLabel}
        roleTitle={roleTitle}
        timezone={timezone}
        logoUrl={logoUrl}
        dock={
          brand === 'cxo' && employeeOnly
            ? <MiraBar firstName={defaultName.split(' ')[0] || undefined} starters={EMPLOYEE_STARTERS} explainer={employeeMiraExplainer(inbox, assistantName)} queueStarter={queueStarter} />
            : brand === 'cxo' && !assistant ? <MiraBar firstName={defaultName.split(' ')[0] || undefined} queueStarter={queueStarter} /> : undefined
        }
        assistantMode={!!assistant}
        adoption={adoption}
        phoneVersionKey={phoneVersionKey}
        inApp={inApp}
        topBar={assistant ? <AssistantBar assistantName={assistant.name} execs={assistant.execs} activeId={assistant.activeId} /> : undefined}
      >
        {children}
      </DashboardShell>
      {brand === 'cxo' && !assistant && <UsageBeacon />}
      {brand === 'cxo' && reconnectGoogle && <ConnectGoogleBanner inbox={inbox} reconnect={reconnectGoogle} />}
      {brand === 'cxo' && needsGoogle && !reconnectGoogle && <ConnectGoogleBanner inbox={inbox} />}
      {!signed && (
        <LiabilityGate
          agreementTitle={agreement.title}
          agreementVersion={agreement.version}
          agreementHtml={html}
          workspaceLabel={workspaceLabel}
          defaultName={defaultName}
        />
      )}
    </AssistantNameProvider>
  )
}
