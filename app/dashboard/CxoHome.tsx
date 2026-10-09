import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import ExecOverview from '@/app/components/cxo/ExecOverview'
import { fmtRel, loadPinnacleOverview } from '@/lib/pinnacle/load'

/**
 * Overview — the owner's home for the executive suite. KPIs only: issued
 * premium with trend waves, policies written and issued, product mix, pace
 * vs last year, who is driving it, agency books. No plans, drafts, goals or
 * agent cards. Mira (the dock) answers everything else.
 */
export default async function CxoHome({ tenantId, firstName, workspace }: { tenantId: string; firstName?: string | null; workspace: string }) {
  const data = await loadPinnacleOverview(tenantId)
  const connected = data.configured && data.pinnacleRows.length > 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <main className="wrap">
      <PageHeader
        eyebrow={workspace}
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        subtitle={connected ? 'Where the book stands today, and which way it is moving.' : undefined}
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
