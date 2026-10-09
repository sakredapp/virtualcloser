import type { ReactNode } from 'react'
import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import ExecOverview from '@/app/components/cxo/ExecOverview'
import { fmtRel } from '@/lib/pinnacle/load'
import { getPinnacleOverview } from '@/lib/pinnacle/cache'
import RefreshRollup from '@/app/components/cxo/RefreshRollup'
import { syncedAtOf } from '@/lib/pinnacle/syncStamp'
import { getDashboardPrefs } from '@/lib/dashboardPrefs'

/**
 * Overview — the owner's home for the executive suite. KPIs only: the
 * month so far, submitted vs issued premium waves, placement, product mix,
 * pace, and who is driving it. No plans, drafts, goals or
 * agent cards. Mira (the dock) answers everything else. The layout honours
 * the saved dashboard prefs (tiles, timeframe, pinned KPIs, notes) that the
 * executive or their connected AI set through /api/mcp; the headline note
 * sits under the page title.
 */
export default async function CxoHome({ tenantId, firstName, workspace, timezone, children }: { tenantId: string; firstName?: string | null; workspace: string; timezone?: string | null; /** Extra exec sections under the book (e.g. From QuickBooks). */ children?: ReactNode }) {
  const [data, prefs] = await Promise.all([
    getPinnacleOverview(tenantId, { view: 'overview', tz: timezone }).catch((err) => {
      console.error('[overview] book', err instanceof Error ? err.message : err)
      return null
    }),
    getDashboardPrefs(tenantId).catch(() => null),
  ])
  // The server runs in UTC; greet by the exec's own clock.
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone || 'America/New_York' }).format(new Date())) % 24
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (!data) {
    return (
      <main className="wrap">
        <PageHeader eyebrow={firstName ? `${greeting}, ${firstName}` : workspace} title="Revenue" subtitle="Where the book stands today, and which way it is moving." />
        <section className="cx-panel cx-panel-tint">
          <p className="cx-takeaway" style={{ margin: 0 }}>The book of business could not be read just now. Refresh in a minute; nothing is lost.</p>
        </section>
        {children}
      </main>
    )
  }
  const connected = data.configured && data.pinnacleRows.length > 0

  return (
    <main className="wrap">
      <PageHeader
        eyebrow={firstName ? `${greeting}, ${firstName}` : workspace}
        title="Revenue"
        subtitle={prefs?.headline_note ? prefs.headline_note : 'Where the book stands today, and which way it is moving.'}
        actions={
          connected ? (
            <>
              <RefreshRollup computedAt={syncedAtOf(data)} building={data.building} />
              <span className="cx-ro-tag">Airtable book · read-only</span>
            </>
          ) : undefined
        }
      />
      {connected ? (
        <ExecOverview
          variant="home"
          pinnacleRows={data.pinnacleRows}
          statusRows={data.statusRows}
          books={data.books}
          breakdowns={data.breakdowns}
          lastSynced={fmtRel(syncedAtOf(data))}
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
      {children}
    </main>
  )
}
