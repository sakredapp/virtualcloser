import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { getBases } from '@/lib/pinnacle/airtable'

export const dynamic = 'force-dynamic'

// Beta gate (mirrors EMAIL_TRIAGE_REP_IDS): comma-separated list of rep IDs
// allowed to see Pinnacle. Set in Vercel env to Spencer's rep id.
function allowedRepIds(): Set<string> {
  const raw = process.env.PINNACLE_VIEWER_REP_IDS?.trim()
  if (!raw) return new Set()
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

type Snapshot = {
  base_id: string
  snapshot_date: string
  revenue_total: number | null
  apps_submitted: number | null
  apps_approved: number | null
  apps_funded: number | null
  metrics: Record<string, unknown>
  updated_at: string
}

type RecordRow = { base_id: string; table_name: string }

type SyncRun = {
  started_at: string
  finished_at: string | null
  ok: boolean | null
  tables: unknown
  error: string | null
}

function fmtMoney(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtNum(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString('en-US')
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}
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
function delta(
  today: number | null | undefined,
  prior: number | null | undefined,
  fmt: (n: number | null) => string,
): string | null {
  if (today == null || prior == null) return null
  const diff = today - prior
  if (diff === 0) return 'flat vs yesterday'
  const sign = diff > 0 ? '+' : ''
  return `${sign}${fmt(diff)} vs yesterday`
}

export default async function PinnaclePage() {
  const ctx = await requireMember()
  const allowed = allowedRepIds()
  if (allowed.size > 0 && !allowed.has(ctx.tenant.id)) {
    redirect('/dashboard')
  }

  const bases = getBases()
  const configured = bases.length > 0 && Boolean(process.env.PINNACLE_AIRTABLE_TOKEN)

  const [{ data: snapshots }, { data: runs }, { data: recordRows }] = await Promise.all([
    supabase
      .from('pinnacle_airtable_snapshots')
      .select('*')
      .order('snapshot_date', { ascending: false })
      .limit(90), // 90 = 30 days × up to 3 bases
    supabase
      .from('pinnacle_airtable_sync_runs')
      .select('started_at, finished_at, ok, tables, error')
      .order('started_at', { ascending: false })
      .limit(1),
    supabase.from('pinnacle_airtable_records').select('base_id, table_name'),
  ])

  const history = (snapshots ?? []) as Snapshot[]
  const lastRun = (runs ?? [])[0] as SyncRun | undefined

  // Group snapshots and counts by base.
  const byBase = new Map<string, Snapshot[]>()
  for (const s of history) {
    const arr = byBase.get(s.base_id) ?? []
    arr.push(s)
    byBase.set(s.base_id, arr)
  }
  const tableCountsByBase = new Map<string, Map<string, number>>()
  for (const r of (recordRows ?? []) as RecordRow[]) {
    if (!tableCountsByBase.has(r.base_id)) tableCountsByBase.set(r.base_id, new Map())
    const m = tableCountsByBase.get(r.base_id)!
    m.set(r.table_name, (m.get(r.table_name) ?? 0) + 1)
  }

  const navTabs = await buildDashboardTabs(ctx.tenant.id, ctx.member)

  // Sum across all bases for the headline KPIs (Spencer wants a single
  // top-of-page number — base-level detail is in the cards below).
  function sumToday(field: keyof Snapshot): number | null {
    let total = 0
    let seen = false
    for (const arr of byBase.values()) {
      const today = arr[0]
      if (!today) continue
      const v = today[field]
      if (typeof v === 'number') {
        total += v
        seen = true
      }
    }
    return seen ? total : null
  }
  function sumPrior(field: keyof Snapshot): number | null {
    let total = 0
    let seen = false
    for (const arr of byBase.values()) {
      const prior = arr[1]
      if (!prior) continue
      const v = prior[field]
      if (typeof v === 'number') {
        total += v
        seen = true
      }
    }
    return seen ? total : null
  }

  const totalRevenueToday = sumToday('revenue_total')
  const totalRevenueYesterday = sumPrior('revenue_total')
  const totalAppsSubmittedToday = sumToday('apps_submitted')
  const totalAppsSubmittedYesterday = sumPrior('apps_submitted')

  return (
    <main className="dashboard-main">
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Pinnacle Wellness</h1>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Daily pull from Brad Plummer&apos;s Airtable — {bases.length || 0} base{bases.length === 1 ? '' : 's'}.{' '}
            {lastRun
              ? <>Last synced <strong>{fmtRel(lastRun.finished_at ?? lastRun.started_at)}</strong>{lastRun.ok === false ? ' (failed)' : ''}.</>
              : 'Not yet synced.'}
          </p>
        </div>
        <form action="/api/admin/pinnacle/discover" target="_blank">
          <button type="submit" className="btn btn-secondary">Probe Airtable schema</button>
        </form>
      </header>

      {!configured && (
        <section className="card" style={{ marginTop: 16, borderColor: '#f59e0b' }}>
          <strong>Not configured yet.</strong>
          <p style={{ marginTop: 8 }}>
            Set <code>PINNACLE_AIRTABLE_TOKEN</code> and <code>PINNACLE_AIRTABLE_BASES</code> in
            Vercel env, then trigger <code>/api/cron/pinnacle-sync</code> once with the cron secret.
            <code>PINNACLE_AIRTABLE_BASES</code> format:{' '}
            <code>baseId:table1,table2|baseId2:t1,t2</code>.
          </p>
        </section>
      )}

      {configured && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 16 }}>
          <Kpi label="Total revenue (all bases)" value={fmtMoney(totalRevenueToday)} delta={delta(totalRevenueToday, totalRevenueYesterday, fmtMoney)} />
          <Kpi label="Apps submitted (all bases)" value={fmtNum(totalAppsSubmittedToday)} delta={delta(totalAppsSubmittedToday, totalAppsSubmittedYesterday, fmtNum)} />
        </section>
      )}

      {/* One card per base */}
      {bases.map((base) => {
        const baseHistory = byBase.get(base.baseId) ?? []
        const today = baseHistory[0] ?? null
        const yesterday = baseHistory[1] ?? null
        const tableCounts = tableCountsByBase.get(base.baseId) ?? new Map()
        return (
          <section key={base.baseId} className="card" style={{ marginTop: 24 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ marginTop: 0 }}>{base.baseId}</h2>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                {base.tables.length} table{base.tables.length === 1 ? '' : 's'} configured
              </span>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 8 }}>
              <Kpi label="Revenue" value={fmtMoney(today?.revenue_total ?? null)} delta={delta(today?.revenue_total, yesterday?.revenue_total, fmtMoney)} />
              <Kpi label="Submitted" value={fmtNum(today?.apps_submitted ?? null)} delta={delta(today?.apps_submitted, yesterday?.apps_submitted, fmtNum)} />
              <Kpi label="Approved" value={fmtNum(today?.apps_approved ?? null)} delta={delta(today?.apps_approved, yesterday?.apps_approved, fmtNum)} />
              <Kpi label="Funded" value={fmtNum(today?.apps_funded ?? null)} delta={delta(today?.apps_funded, yesterday?.apps_funded, fmtNum)} />
            </div>

            {baseHistory.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                  Last {baseHistory.length} snapshot{baseHistory.length === 1 ? '' : 's'}
                </summary>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '6px 10px' }}>Date</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Revenue</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Submitted</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Approved</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Funded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baseHistory.map((s) => (
                        <tr key={`${s.base_id}-${s.snapshot_date}`} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px' }}>{fmtDate(s.snapshot_date)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtMoney(s.revenue_total)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtNum(s.apps_submitted)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtNum(s.apps_approved)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtNum(s.apps_funded)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 13, color: 'var(--muted)' }}>Tables synced:</strong>
              {tableCounts.size === 0 ? (
                <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
                  Nothing pulled yet for this base. Configured tables: {base.tables.join(', ') || '—'}
                </p>
              ) : (
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {Array.from(tableCounts.entries()).sort().map(([name, count]) => (
                    <li key={`${base.baseId}-${name}`}>
                      <strong>{name}</strong> — {count.toLocaleString()} rows
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )
      })}

      {lastRun?.error && (
        <section className="card" style={{ marginTop: 16, borderColor: 'var(--red-deep, #dc2626)' }}>
          <strong style={{ color: 'var(--red-deep, #dc2626)' }}>Last sync error:</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 12 }}>{lastRun.error}</pre>
        </section>
      )}

      <p style={{ marginTop: 24, color: 'var(--muted)', fontSize: 13 }}>
        Cron runs daily at 13:00 UTC (~6am PT, 8am CT). Trigger manually with{' '}
        <code>POST /api/cron/pinnacle-sync</code> + cron secret. To browse raw fields,{' '}
        <Link href="/api/admin/pinnacle/discover">probe the schema</Link>.
      </p>
    </main>
  )
}

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string | null }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {delta && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{delta}</div>}
    </div>
  )
}
