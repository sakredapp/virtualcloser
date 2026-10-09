import { redirect } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import ExecOverview from '@/app/components/cxo/ExecOverview'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { fmtRel } from '@/lib/pinnacle/load'
import { getPinnacleOverview } from '@/lib/pinnacle/cache'
import RefreshRollup from '@/app/components/cxo/RefreshRollup'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'

export const dynamic = 'force-dynamic'

/**
 * Performance — the full book-of-business view: submitted vs issued premium
 * waves, KPI row, status funnel, policies by month, every top list, agency
 * books stacked, recent-days detail and data sources.
 */
export default async function PerformancePage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  const data = await getPinnacleOverview(ctx.tenant.id, { view: 'performance', tz: ctx.tenant.timezone })
  const connected = data.configured && data.pinnacleRows.length > 0

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Performance"
        title="Book of business"
        subtitle={connected ? `Submitted and issued premium, placement, policies and who is driving it. Last synced ${fmtRel(data.lastRun?.finished_at ?? data.lastRun?.started_at ?? null)}.` : undefined}
        actions={connected ? <RefreshRollup computedAt={data.computedAt} building={data.building} /> : undefined}
      />

      {!connected ? (
        <ConnectState
          kind="book"
          sentence="Connect your book of business and every number on this page fills in automatically, every morning."
          button="Connect your book of business"
          href="/dashboard/integrations#book"
        />
      ) : (
        <ExecOverview
          variant="full"
          pinnacleRows={data.pinnacleRows}
          statusRows={data.statusRows}
          books={data.books}
          breakdowns={data.breakdowns}
          lastSynced={fmtRel(data.lastRun?.finished_at ?? data.lastRun?.started_at ?? null)}
          syncError={data.lastRun?.ok === false ? data.lastRun.error : null}
          tables={data.tables}
        />
      )}
    </main>
  )
}
