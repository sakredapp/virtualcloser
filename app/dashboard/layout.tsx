import DashboardShell from '@/app/components/DashboardShell'
import { buildDashboardTabs, type DashboardNavData } from './dashboardTabs'
import { embeddableAgreementHtml, getAgreement, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'
import { checkAgreement } from '@/lib/agreementWall'
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
import { agreementTitleNameFor, isPinnacleEdition } from '@/lib/storeDemo'
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
  // The agreement wall fails CLOSED (lib/agreementWall.ts): a signed-in member
  // counts as signed only once the lookup says so. 'none' = no member on this
  // request, so the child page's own auth sends them to sign-in.
  let wallState: 'none' | 'signed' | 'unsigned' | 'check_failed' = 'none'
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
    // Checked first, so nothing later can leave it unknown. Store review logins
    // skip the wall (lib/storeDemo); an assistant signs as themself, never as the exec.
    wallState = 'check_failed'
    const wall = await checkAgreement(ctx)
    wallState = wall.ok ? 'signed' : wall.reason
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
  // The inside of the document only: a server-rendered <body style> would be
  // merged onto the page's own <body> (sideways scroll, white in dark mode).
  const html = embeddableAgreementHtml(renderAgreementHtml({ workspaceLabel, brand, titleName: agreementTitleName }))

  // Not signed (or the check failed): the sign screen and nothing else. The
  // dashboard is never rendered underneath, so removing the overlay shows nothing.
  if (wallState === 'unsigned') {
    return (
      <AssistantNameProvider name={assistantName}>
        <LiabilityGate
          agreementTitle={agreement.title}
          agreementVersion={agreement.version}
          agreementHtml={html}
          workspaceLabel={workspaceLabel}
          defaultName={defaultName}
        />
      </AssistantNameProvider>
    )
  }
  if (wallState === 'check_failed') {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div role="alert" style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>We could not load your account just now</h1>
          <p style={{ margin: '0 0 16px', opacity: 0.75 }}>We check your signed agreement before opening the dashboard, and that check did not go through. Try again in a moment.</p>
          {/* An empty href reloads this page, no script needed. */}
          <a href="" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 999, border: '1px solid currentColor', color: 'inherit', fontWeight: 600, textDecoration: 'none' }}>
            Try again
          </a>
        </div>
      </main>
    )
  }

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
    </AssistantNameProvider>
  )
}
