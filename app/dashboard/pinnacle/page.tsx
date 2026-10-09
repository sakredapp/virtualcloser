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
import { loadPeopleStats } from '@/lib/pinnacle/people'

export const dynamic = 'force-dynamic'

/**
 * Team — named agencies and their agents, ranked (submitted, issued,
 * placement, policies, trend), plus where policies stand, policies by month
 * and product mix. The Overview's KPI cards live only on the Overview
 * (owner 10-09). Replaces Performance and Reports.
 */
export default async function TeamPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')

  const data = await getPinnacleOverview(ctx.tenant.id, { view: 'performance', tz: ctx.tenant.timezone }).catch((err) => {
    console.error('[team] overview', err instanceof Error ? err.message : err)
    return null
  })
  const people = await loadPeopleStats().catch(() => null)
  if (!data) {
    return (
      <main className="wrap">
        <PageHeader eyebrow="Team" title="Agencies and agents" />
        <section className="cx-panel cx-panel-tint">
          <p className="cx-takeaway" style={{ margin: 0 }}>The book of business could not be read just now. Refresh in a minute; nothing is lost.</p>
        </section>
      </main>
    )
  }
  const connected = data.configured && data.pinnacleRows.length > 0

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Team"
        title="People and agencies"
        subtitle={connected ? `The people behind the book: headcount, onboarding, retention, then who is writing it. Last synced ${fmtRel(data.lastRun?.finished_at ?? data.lastRun?.started_at ?? null)}.` : undefined}
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
          people={people}
        />
      )}
    </main>
  )
}
