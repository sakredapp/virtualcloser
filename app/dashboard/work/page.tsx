import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { listApprovals, listPlaudPending } from '@/lib/ops/approvals'
import { isWorkPage, orderWork, phoneVersion, phoneVersionKeyFor } from '@/lib/phoneVersions'
import PageHeader from '@/app/components/PageHeader'
import RailIcon, { railIconFor } from '@/app/components/cxo/RailIcon'
import PhoneApprovalsCard from '@/app/components/cxo/phone/PhoneApprovalsCard'
import { buildDashboardTabs } from '../dashboardTabs'

export const dynamic = 'force-dynamic'

/** One line under each page's name. A page with no line here still lists, by name. */
const ABOUT: Record<string, string> = {
  '/dashboard/approvals': 'What is waiting for your OK',
  '/dashboard/boards': 'Cards, lists and who has what',
  '/dashboard/calendar': 'Your week and your calendar accounts',
  '/dashboard/meetings': 'Notes, recordings and follow-ups',
  '/dashboard/plan': 'Targets and where the month stands',
  '/dashboard/revenue': 'The numbers, month to date',
  '/dashboard/pinnacle': 'Team performance and reports',
  '/dashboard/execs': 'The executive team',
  '/dashboard/partners': 'Partners and what is open with each',
  '/dashboard/employees': 'People, seats and praise',
}

/**
 * Work: the phone's second tab. Every page the person can open that is not
 * Home, Inbox or Me, in the order their company's version sets
 * (lib/phoneVersions). It is the same list the sidebar shows on a wide
 * screen, so nothing the sidebar reaches is lost on a phone. On a phone,
 * Approvals leads as its own card with how many are waiting (when the company
 * has it switched on) and the rest stays one list; on a wider screen it is a
 * row in the list, as before.
 */
export default async function WorkPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  if (getBrand(brandKey).tabPreset !== 'executive') redirect('/dashboard')
  if (isEmployeeOnlyMember(ctx.member, ctx.tenant)) redirect('/dashboard/me')

  const version = phoneVersion(phoneVersionKeyFor({ brand: brandKey, pinnacle: pinnacleAllowed(ctx.tenant.id) }))
  const nav = await buildDashboardTabs(ctx.tenant.id, ctx.member)
  const pages = nav.tabs.filter((t) => isWorkPage(t.href))
  const ordered = version ? orderWork(pages, version) : pages
  const approvalsOn = cxoEmployeeOps(ctx.tenant) && pages.some((t) => t.href.split('?')[0] === '/dashboard/approvals')
  const waiting = approvalsOn
    ? await Promise.all([listApprovals(ctx.tenant.id, 'pending').catch(() => []), listPlaudPending(ctx.tenant.id).catch(() => [])]).then(([a, b]) => a.length + b.length)
    : null
  const approvalsHref = approvalsOn ? pages.find((t) => t.href.split('?')[0] === '/dashboard/approvals')?.href ?? null : null

  return (
    <main className="wrap cxph-page">
      <PageHeader title="Work" subtitle="Every page you can open, in one list." />
      <div className="cxph cxph-work">
        <div className="cxph-title cxph-only">
          <h2>Work</h2>
          <p>{waiting ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} your OK.` : 'Everything you run, in one list.'}</p>
        </div>
        {approvalsHref && version && (
          <div className="cxph-only">
            <PhoneApprovalsCard href={approvalsHref} waiting={waiting ?? 0} assistantName={version.assistantName} />
          </div>
        )}
        <nav className="cxph-card cxph-set" aria-label="Work pages" style={{ marginTop: 4 }}>
          {ordered.map((t) => {
            const path = t.href.split('?')[0]
            const icon = railIconFor(path)
            return (
              // On a phone the card above is Approvals; its row is kept for wider screens only.
              <Link key={t.href} href={t.href} className={approvalsHref && version && path === '/dashboard/approvals' ? 'row cxph-hide' : 'row'}>
                <span className="ic" aria-hidden>
                  {icon ? <RailIcon name={icon} /> : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></svg>
                  )}
                </span>
                <span className="t">
                  <b>{t.label}</b>
                  {ABOUT[path] && <small>{ABOUT[path]}</small>}
                </span>
                {path === '/dashboard/approvals' && waiting ? <span className="cxph-tag solid">{waiting} waiting</span> : null}
                <svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9.5 6 6 6-6 6" /></svg>
              </Link>
            )
          })}
        </nav>
      </div>
    </main>
  )
}
