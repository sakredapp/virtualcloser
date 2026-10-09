import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import ExecOverview from '@/app/components/cxo/ExecOverview'
import { fmtRel, loadPinnacleOverview } from '@/lib/pinnacle/load'
import { getDashboardPrefs } from '@/lib/dashboardPrefs'

/**
 * Overview — the owner's home for the executive suite. KPIs only: issued
 * premium with trend waves, policies written and issued, product mix, pace
 * vs last year, who is driving it, agency books. No plans, drafts, goals or
 * agent cards. Mira (the dock) answers everything else. The layout honours
 * the saved dashboard prefs (tiles, timeframe, pinned KPIs, notes) that the
 * executive or their connected AI set through /api/mcp; the headline note
 * sits under the page title.
 */
export default async function CxoHome({ tenantId, firstName, workspace }: { tenantId: string; firstName?: string | null; workspace: string }) {
  const [data, prefs] = await Promise.all([loadPinnacleOverview(tenantId), getDashboardPrefs(tenantId).catch(() => null)])
  const connected = data.configured && data.pinnacleRows.length > 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <main className="wrap">
      <PageHeader
        eyebrow={workspace}
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        subtitle={prefs?.headline_note ? prefs.headline_note : connected ? 'Where the book stands today, and which way it is moving.' : undefined}
      />
      {connected ? (
        <ExecOverview
          variant="home"
          pinnacleRows={data.pinnacleRows}
          statusRows={data.statusRows}
          books={data.books}
          breakdowns={data.breakdowns}
          lastSynced={fmtRel(data.lastRun?.finished_at ?? data.lastRun?.started_at ?? null)}
          syncError={data.lastRun?.ok === false ? data.lastRun.error : null}
          prefs={prefs ? { ...prefs, headline_note: null } : null}
        />
      ) : (
        <ConnectState
          kind="book"
          sentence="Connect your book of business and this page becomes your numbers: premium, policies, pace and who is driving it."
          button="Connect your book of business"
          href="/dashboard/integrations#book"
        />
      )}
    </main>
  )
}
