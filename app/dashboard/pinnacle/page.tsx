import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'

export const dynamic = 'force-dynamic'

// Beta gate (mirrors EMAIL_TRIAGE_REP_IDS): comma-separated list of rep IDs
// allowed to see Pinnacle. Set in Vercel env to Spencer's rep id.
function allowedRepIds(): Set<string> {
  const raw = process.env.PINNACLE_VIEWER_REP_IDS?.trim()
  if (!raw) return new Set()
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

type Snapshot = {
  snapshot_date: string
  revenue_total: number | null
  apps_submitted: number | null
  apps_approved: number | null
  apps_funded: number | null
  metrics: Record<string, unknown>
  updated_at: string
}

type SyncRun = {
  started_at: string
  finished_at: string | null
  ok: boolean | null
  tables: Record<string, { fetched: number; upserted: number; error?: string }>
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

export default async function PinnaclePage() {
  const ctx = await requireMember()
  const allowed = allowedRepIds()
  if (allowed.size > 0 && !allowed.has(ctx.tenant.id)) {
    redirect('/dashboard')
  }

  const [{ data: snapshots }, { data: runs }, { data: recordCounts }] = await Promise.all([
    supabase
      .from('pinnacle_airtable_snapshots')
      .select('*')
      .order('snapshot_date', { ascending: false })
      .limit(30),
    supabase
      .from('pinnacle_airtable_sync_runs')
      .select('started_at, finished_at, ok, tables, error')
      .order('started_at', { ascending: false })
      .limit(1),
    supabase
      .from('pinnacle_airtable_records')
      .select('table_name', { count: 'exact', head: false }),
  ])

  const history = (snapshots ?? []) as Snapshot[]
  const today = history[0] ?? null
  const yesterday = history[1] ?? null
  const lastRun = (runs ?? [])[0] as SyncRun | undefined

  // Per-table row counts derived from the records table.
  const tableCounts: Record<string, number> = {}
  for (const r of recordCounts ?? []) {
    const name = (r as { table_name: string }).table_name
    tableCounts[name] = (tableCounts[name] ?? 0) + 1
  }

  const navTabs = await buildDashboardTabs(ctx.tenant.id, ctx.member)
  const configured = Boolean(process.env.PINNACLE_AIRTABLE_BASE_ID)

  return (
    <main className="dashboard-main">
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Pinnacle Wellness</h1>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Daily pull from Brad Plummer&apos;s Airtable.{' '}
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
            Set <code>PINNACLE_AIRTABLE_TOKEN</code> and <code>PINNACLE_AIRTABLE_BASE_ID</code> in
            Vercel env, then trigger <code>/api/cron/pinnacle-sync</code> once with the cron secret.
            Optionally also set <code>PINNACLE_AIRTABLE_TABLES</code> (comma-separated table names)
            and <code>PINNACLE_FIELD_MAP</code> (JSON) to lock in exact field names.
          </p>
        </section>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
        <Kpi label="Revenue (total)" value={fmtMoney(today?.revenue_total ?? null)} delta={delta(today?.revenue_total, yesterday?.revenue_total, fmtMoney)} />
        <Kpi label="Apps submitted" value={fmtNum(today?.apps_submitted ?? null)} delta={delta(today?.apps_submitted, yesterday?.apps_submitted, fmtNum)} />
        <Kpi label="Apps approved" value={fmtNum(today?.apps_approved ?? null)} delta={delta(today?.apps_approved, yesterday?.apps_approved, fmtNum)} />
        <Kpi label="Apps funded" value={fmtNum(today?.apps_funded ?? null)} delta={delta(today?.apps_funded, yesterday?.apps_funded, fmtNum)} />
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Last 30 days</h2>
        {history.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No snapshots yet — the first cron run will populate this.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 12px' }}>Date</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Revenue</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Submitted</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Approved</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Funded</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.snapshot_date} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px' }}>{fmtDate(s.snapshot_date)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtMoney(s.revenue_total)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtNum(s.apps_submitted)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtNum(s.apps_approved)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtNum(s.apps_funded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Tables synced</h2>
        {Object.keys(tableCounts).length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>Nothing pulled yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {Object.entries(tableCounts).sort().map(([name, count]) => (
              <li key={name}>
                <strong>{name}</strong> — {count.toLocaleString()} rows
              </li>
            ))}
          </ul>
        )}
        {lastRun?.error && (
          <p style={{ marginTop: 12, color: '#dc2626' }}>
            <strong>Last sync error:</strong> {lastRun.error}
          </p>
        )}
      </section>

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
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {delta && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{delta}</div>}
    </div>
  )
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
