import { orgUsage } from '@/lib/cxoUsage'
import type { UsageRow } from '@/lib/cxoUsageShared'
import '../cxo-alerts.css'

function ago(iso: string | null, tz: string): string {
  if (!iso) return 'Never'
  const ms = Date.now() - Date.parse(iso)
  if (ms < 60 * 60_000) return 'Within the hour'
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase()
  if (day(d) === day(new Date())) return `Today ${time}`
  if (day(d) === day(new Date(Date.now() - 86_400_000))) return `Yesterday ${time}`
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(d)
}

/** Settings › Usage: who signs in and what they use. Owners and admins only (the page gates it). */
export default async function UsageSection({ repId, timezone }: { repId: string; timezone: string }) {
  let rows: UsageRow[] = []
  let failed = false
  try {
    rows = await orgUsage(repId, timezone)
  } catch (err) {
    console.error('[settings] usage', err)
    failed = true
  }
  return (
    <section className="card cx-alerts-card" id="usage" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>Usage</h2>
        <p>last 30 days</p>
      </div>
      <p className="meta" style={{ margin: '0 0 0.7rem' }}>
        Who signs in and which pages they use. Counted since Oct 9, 2026.
      </p>
      {failed ? (
        <p className="cx-pref-err">Usage could not load. Try again in a minute.</p>
      ) : rows.length === 0 ? (
        <p className="meta">No one has signed in yet.</p>
      ) : (
        <div className="cx-usage-scroll">
          <table className="cx-table cx-usage">
            <thead>
              <tr>
                <th>Person</th>
                <th>Last login</th>
                <th className="num">Logins 7d</th>
                <th className="num">Logins 30d</th>
                <th className="num">Days active</th>
                <th>Most used</th>
                <th className="num">Mira questions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.member_id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.email && r.email !== r.name && <small>{r.email}</small>}
                  </td>
                  <td>{ago(r.last_login_at, timezone)}</td>
                  <td className="num">{r.logins7}</td>
                  <td className="num">{r.logins30}</td>
                  <td className="num">{r.days_active30}</td>
                  <td>{r.top_pages.length ? r.top_pages.map((p) => p.name).join(', ') : <span className="cx-usage-none">Nothing yet</span>}</td>
                  <td className="num">{r.mira30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
