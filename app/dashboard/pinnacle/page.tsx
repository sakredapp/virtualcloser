import { redirect } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import ExecOverview from '@/app/components/cxo/ExecOverview'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { syncedAtOf } from '@/lib/pinnacle/syncStamp'
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
  // People stats are Pinnacle's book: only for tenants mapped to it.
  const people = isPinnacleViewer(ctx.tenant.id) ? await loadPeopleStats().catch(() => null) : null
  if (!data) {
    return (
      <main className="wrap">
        <PageHeader eyebrow="Team" title="People and agencies" subtitle="Headcount, onboarding, retention, and who is writing the book." />
        <section className="cx-panel cx-panel-tint">
          <p className="cx-takeaway" style={{ margin: 0 }}>The book of business could not be read just now. Refresh in a minute; nothing is lost.</p>
        </section>
      </main>
    )
  }
  const connected = data.configured && data.pinnacleRows.length > 0
  // One timestamp on this page: the header stamp (last Airtable sync).
  const syncedAt = syncedAtOf(data)

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Team"
        title="People and agencies"
        subtitle="Headcount, onboarding, retention, and who is writing the book."
        actions={connected ? <RefreshRollup computedAt={syncedAt} building={data.building} /> : undefined}
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
          syncError={data.lastRun?.ok === false ? data.lastRun.error : null}
          tables={data.tables}
          people={people}
        />
      )}
    </main>
  )
}
