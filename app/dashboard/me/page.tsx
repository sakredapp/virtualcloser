import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { loadSelfView } from '@/lib/employees/data'
import { employeeSnapshot, ptoSummary } from '@/lib/employees/shared'
import { bookToday } from '@/lib/pinnacle/kpis'
import PageHeader from '@/app/components/PageHeader'
import { BonusBar, PtoBar, QuotaCard, Ring, StatusPill, TimeOffStrip, usd } from '@/app/components/cxo/EmployeeVisuals'
import '@/app/components/cxo/cxo-plan.css'
import '@/app/dashboard/cxo-alerts.css'
import { cxoEmployeeOps } from '@/lib/cxoFeatures'
import { listNotices } from '@/lib/followups/notices'
import MiraNotices from './MiraNotices'

export const dynamic = 'force-dynamic'

/**
 * An employee's own page (owner 10-09): their quotas with progress, bonus
 * earned and the next tier, and their time off. Only their own row is read
 * (loadSelfView filters by their employee id); pay and company numbers are
 * never loaded here. Execs who open it go to the Employees page.
 */
export default async function MyPage() {
  const ctx = await requireMember()
  if (!isEmployeeOnlyMember(ctx.member, ctx.tenant)) redirect('/dashboard/employees')
  const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
  const view = await loadSelfView(ctx.tenant.id, ctx.member.id, today).catch((err) => {
    console.error('[me] load', err instanceof Error ? err.message : err)
    return null
  })
  const first = (ctx.member.display_name || '').split(' ')[0]
  // Mira's follow-up notices (employee ops, switch-gated): only this member's own rows.
  const notices = cxoEmployeeOps(ctx.tenant) ? await listNotices(ctx.tenant.id, ctx.member.id).catch(() => []) : []

  if (!view) {
    return (
      <main className="wrap">
        <PageHeader title={first ? `Hi ${first}` : 'Your page'} subtitle="Your quotas, bonus and time off." />
        <section className="cx-panel">
          <p className="cx-takeaway" style={{ margin: 0 }}>Your page is not set up yet. Ask your manager to link your login to your employee record.</p>
        </section>
        <MiraNotices initial={notices} />
      </main>
    )
  }

  const e = view.employee
  const snap = employeeSnapshot(e, view, today)
  const year = today.slice(0, 4)
  const pto = ptoSummary(view.timeOff, year, e.pto_allowed_days, e.pto_balance_days)
  const showPto = pto.used > 0 || pto.allowed != null || pto.left != null
  const showBonus = snap.bonusPossible > 0

  return (
    <main className="wrap">
      <PageHeader title={`Hi ${e.name.split(' ')[0]}`} subtitle="Your quotas, bonus and time off." />
      <div className="cxp cxe-me">
        <MiraNotices initial={notices} />
        <section className="cx-panel">
          <div className="hero">
            <Ring value={snap.att} size={104} stroke={9} sub="to quota" />
            <div className="who" style={{ flex: 1, minWidth: 200 }}>
              <h2>{e.name}</h2>
              <p>{[e.title, e.department, view.manager ? `reports to ${view.manager}` : null].filter(Boolean).join(' · ') || ' '}</p>
              <div style={{ marginTop: 10, display: 'grid', gap: 8, maxWidth: 420 }}>
                <StatusPill status={snap.status} />
                {showBonus && (
                  <>
                    <BonusBar earned={snap.bonusEarned} possible={snap.bonusPossible} />
                    <span className="cxe-muted">{usd(snap.bonusEarned)} bonus earned so far</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="cx-panel">
          <div className="cxp-head"><h2>Your quotas</h2></div>
          {snap.quotas.length === 0 ? (
            <p className="cxp-note">No quota set yet.</p>
          ) : (
            <div className="cxe-quotas">
              {snap.quotas.map((q) => <QuotaCard key={q.kpi.id} line={q} showBonus={showBonus} />)}
            </div>
          )}
        </section>

        {(showPto || view.hoursThisMonth != null || e.hours_per_week != null) && (
          <section className="cx-panel">
            <div className="cxp-head"><h2>Time off and hours</h2></div>
            {showPto && <PtoBar used={pto.used} byKind={pto.byKind} allowed={pto.allowed} left={pto.left} />}
            {pto.entries.length > 0 && <TimeOffStrip entries={pto.entries} year={year} today={today} />}
            {(view.hoursThisMonth != null || e.hours_per_week != null) && (
              <div className="cxe-facts">
                {e.hours_per_week != null && <div className="cxe-fact"><p>Hours</p><b>{e.hours_per_week}</b><small>a week</small></div>}
                {view.hoursThisMonth != null && <div className="cxe-fact"><p>This month</p><b>{view.hoursThisMonth.toLocaleString('en-US', { maximumFractionDigits: 1 })}</b><small>hours logged</small></div>}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
