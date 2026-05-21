import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { getBases } from '@/lib/pinnacle/airtable'
import {
  fetchPremiumSeries,
  groupByBook,
  bookLabel,
  PINNACLE_BASE_ID,
  type DailyRow,
} from '@/lib/pinnacle/rollup'
import PinnacleDashboard from './PinnacleDashboard'

export const dynamic = 'force-dynamic'

// Beta gate (mirrors EMAIL_TRIAGE_REP_IDS): comma-separated rep ids allowed
// to see Pinnacle. Set in Vercel env to Spencer's rep id.
function allowedRepIds(): Set<string> {
  const raw = process.env.PINNACLE_VIEWER_REP_IDS?.trim()
  if (!raw) return new Set()
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

type SyncRun = {
  started_at: string
  finished_at: string | null
  ok: boolean | null
  error: string | null
}
type RecordRow = { base_id: string; table_name: string }

function fmtRel(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export default async function PinnaclePage() {
  const ctx = await requireMember()
  const allowed = allowedRepIds()
  if (allowed.size > 0 && !allowed.has(ctx.tenant.id)) {
    redirect('/dashboard')
  }

  const bases = getBases()
  const configured = bases.length > 0 && Boolean(process.env.PINNACLE_AIRTABLE_TOKEN)

  const [series, { data: runs }, { data: recordRows }] = await Promise.all([
    configured ? fetchPremiumSeries().catch(() => [] as DailyRow[]) : Promise.resolve([] as DailyRow[]),
    supabase
      .from('pinnacle_airtable_sync_runs')
      .select('started_at, finished_at, ok, error')
      .order('started_at', { ascending: false })
      .limit(1),
    supabase.from('pinnacle_airtable_records').select('base_id, table_name'),
  ])

  const lastRun = (runs ?? [])[0] as SyncRun | undefined
  const books = groupByBook(series)
  const pinnacleRows = series.filter((r) => r.base_id === PINNACLE_BASE_ID)
  const agencyBooks = books.filter((b) => !b.isPinnacle)

  // Real table names per base (replaces the raw appXXXX base id on the page).
  const tablesByBase = new Map<string, Set<string>>()
  for (const r of (recordRows ?? []) as RecordRow[]) {
    if (!tablesByBase.has(r.base_id)) tablesByBase.set(r.base_id, new Set())
    tablesByBase.get(r.base_id)!.add(r.table_name)
  }

  const navTabs = await buildDashboardTabs(ctx.tenant.id, ctx.member)

  return (
    <main className="wrap">
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <header className="hero">
        <p className="eyebrow">Pinnacle Wellness</p>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ margin: 0 }}>Issued-Premium Performance</h1>
          <form action="/api/admin/pinnacle/discover" target="_blank">
            <button type="submit" className="btn btn-secondary">Probe Airtable schema</button>
          </form>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Daily pull from Brad Plummer&apos;s Airtable.{' '}
          {lastRun ? (
            <>Last synced <strong>{fmtRel(lastRun.finished_at ?? lastRun.started_at)}</strong>{lastRun.ok === false ? ' (failed)' : ''}.</>
          ) : (
            'Not yet synced.'
          )}
        </p>
      </header>

      {!configured && (
        <section className="card" style={{ borderColor: 'var(--signal-warn)' }}>
          <strong>Not configured yet.</strong>
          <p style={{ marginTop: 8 }}>
            Set <code>PINNACLE_AIRTABLE_TOKEN</code> and <code>PINNACLE_AIRTABLE_BASES</code> in Vercel env,
            then trigger <code>/api/cron/pinnacle-sync</code> once with the cron secret.
          </p>
        </section>
      )}

      {configured && pinnacleRows.length > 0 && (
        <PinnacleDashboard pinnacleRows={pinnacleRows} />
      )}

      {configured && pinnacleRows.length === 0 && (
        <section className="card">
          <strong>No Pinnacle-base premium yet.</strong>
          <p style={{ marginTop: 8, color: 'var(--muted)' }}>
            The sync hasn&apos;t populated <code>{PINNACLE_BASE_ID}</code> Health/Life policies, or the
            rows have no valid Effective Date. Run a sync, then refresh.
          </p>
        </section>
      )}

      {/* Agency books of business — secondary, summarised */}
      {agencyBooks.length > 0 && (
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 17 }}>Agency books of business</h2>
          <p style={{ margin: '4px 0 14px', fontSize: 12, color: 'var(--muted)' }}>
            Separate gross-IP books. Rolling-BOB views are excluded to avoid double-counting against the
            per-year Gross IP tables.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {agencyBooks.map((b) => {
              const premium = b.rows.reduce((s, r) => s + r.premium, 0)
              const policies = b.rows.reduce((s, r) => s + r.policies, 0)
              return (
                <div key={b.baseId} className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 700 }}>{b.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{fmtMoney(premium)}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    {policies.toLocaleString('en-US')} policies
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Synced tables — by friendly book name, not raw base id */}
      {configured && tablesByBase.size > 0 && (
        <section className="card">
          <h2 style={{ margin: 0, fontSize: 17 }}>Synced tables</h2>
          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            {Array.from(tablesByBase.entries()).map(([baseId, names]) => (
              <div key={baseId}>
                <strong style={{ fontSize: 14 }}>{bookLabel(baseId)}</strong>{' '}
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>({baseId})</span>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {Array.from(names).sort().map((n) => (
                    <li key={n} style={{ fontSize: 13 }}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {lastRun?.error && (
        <section className="card" style={{ borderColor: 'var(--red-deep, #dc2626)' }}>
          <strong style={{ color: 'var(--red-deep, #dc2626)' }}>Last sync error:</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 12 }}>{lastRun.error}</pre>
        </section>
      )}

      <p style={{ marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>
        Cron runs daily at 13:00 UTC (~6am PT, 8am CT). Trigger manually with{' '}
        <code>POST /api/cron/pinnacle-sync</code> + cron secret. To browse raw fields,{' '}
        <Link href="/api/admin/pinnacle/discover">probe the schema</Link>.
      </p>
    </main>
  )
}
