import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { centsToDollars } from '@/lib/billing/units'

export const dynamic = 'force-dynamic'

type RepRow = {
  id: string
  display_name: string | null
  company: string | null
  revring_cost_per_minute_cents: number | null
  client_display_rate_per_minute_cents: number | null
}

type CallRow = {
  id: string
  rep_id: string
  outcome: string | null
  duration_sec: number | null
  cost_cents: number | null
  dialer_mode: string | null
  created_at: string
}

const SECONDS_PER_HOUR = 3600

function rangeStart(range: '7d' | '30d' | '90d' | 'mtd'): Date {
  const now = new Date()
  if (range === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1)
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  return new Date(now.getTime() - days * 86_400_000)
}

function rangeLabel(range: '7d' | '30d' | '90d' | 'mtd'): string {
  return range === 'mtd' ? 'Month to date'
    : range === '7d' ? 'Last 7 days'
    : range === '30d' ? 'Last 30 days'
    : 'Last 90 days'
}

export default async function ClientCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ range?: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { id } = await params
  const sp = await searchParams
  const range = (['7d', '30d', '90d', 'mtd'] as const).includes(sp.range as never)
    ? (sp.range as '7d' | '30d' | '90d' | 'mtd')
    : '30d'

  const [{ data: repData }, { data: callsData }, { data: meetingsData }] = await Promise.all([
    supabase
      .from('reps')
      .select('id, display_name, company, revring_cost_per_minute_cents, client_display_rate_per_minute_cents')
      .eq('id', id)
      .maybeSingle<RepRow>(),
    supabase
      .from('voice_calls')
      .select('id, rep_id, outcome, duration_sec, cost_cents, dialer_mode, created_at')
      .eq('rep_id', id)
      .gte('created_at', rangeStart(range).toISOString())
      .order('created_at', { ascending: false })
      .limit(20_000),
    supabase
      .from('meetings')
      .select('id, status, created_at')
      .eq('rep_id', id)
      .gte('created_at', rangeStart(range).toISOString()),
  ])

  if (!repData) notFound()

  const rep = repData
  const calls = (callsData ?? []) as CallRow[]
  const meetings = meetingsData ?? []

  // ── Aggregates ──────────────────────────────────────────────────────────
  const totalCalls = calls.length
  const totalSec = calls.reduce((s, c) => s + (c.duration_sec ?? 0), 0)
  const totalCostCents = calls.reduce((s, c) => s + (c.cost_cents ?? 0), 0)
  const dialedCalls = calls.filter((c) => (c.duration_sec ?? 0) > 0).length
  const bookings = calls.filter((c) => c.outcome === 'confirmed').length
  const meetingsConfirmed = meetings.filter((m) => m.status !== 'cancelled').length
  const costPerBookingCents = bookings > 0 ? Math.round(totalCostCents / bookings) : 0
  const costPerCallCents = dialedCalls > 0 ? Math.round(totalCostCents / dialedCalls) : 0
  const avgCallSec = dialedCalls > 0 ? Math.round(totalSec / dialedCalls) : 0
  const totalHours = totalSec / SECONDS_PER_HOUR

  // ── Daily breakdown ─────────────────────────────────────────────────────
  const byDay = new Map<string, { calls: number; sec: number; cost: number; bookings: number }>()
  for (const c of calls) {
    const day = c.created_at.slice(0, 10)
    const cur = byDay.get(day) ?? { calls: 0, sec: 0, cost: 0, bookings: 0 }
    cur.calls += 1
    cur.sec += c.duration_sec ?? 0
    cur.cost += c.cost_cents ?? 0
    if (c.outcome === 'confirmed') cur.bookings += 1
    byDay.set(day, cur)
  }
  const dailyRows = Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 31)

  // ── Outcome breakdown ───────────────────────────────────────────────────
  const byOutcome = new Map<string, { calls: number; sec: number; cost: number }>()
  for (const c of calls) {
    const key = c.outcome ?? 'unknown'
    const cur = byOutcome.get(key) ?? { calls: 0, sec: 0, cost: 0 }
    cur.calls += 1
    cur.sec += c.duration_sec ?? 0
    cur.cost += c.cost_cents ?? 0
    byOutcome.set(key, cur)
  }
  const outcomeRows = Array.from(byOutcome.entries()).sort((a, b) => b[1].cost - a[1].cost)

  async function saveRates(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const parseRate = (raw: string): number | null => {
      const trimmed = raw.trim()
      if (!trimmed) return null
      const dollars = Number.parseFloat(trimmed)
      return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null
    }
    await supabase
      .from('reps')
      .update({
        revring_cost_per_minute_cents: parseRate(String(formData.get('actual') ?? '')),
        client_display_rate_per_minute_cents: parseRate(String(formData.get('display') ?? '')),
      })
      .eq('id', id)
    revalidatePath(`/admin/clients/${id}/cost`)
  }

  // Margin math for the rate panel
  const actualRate = rep.revring_cost_per_minute_cents
  const displayRate = rep.client_display_rate_per_minute_cents
  const marginPct = (typeof actualRate === 'number' && typeof displayRate === 'number' && displayRate > 0)
    ? Math.round(((displayRate - actualRate) / displayRate) * 100)
    : null

  // Client-facing display total (what the rep sees on /dashboard/dialer)
  const displayCostCents = (typeof displayRate === 'number' && displayRate > 0)
    ? Math.ceil(totalSec / 60) * displayRate
    : 0

  return (
    <main style={{ maxWidth: 1100, margin: '40px auto', padding: '0 24px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <Link href={`/admin/clients/${id}`} style={{ color: '#6b7280', fontSize: 13 }}>← back to {rep.display_name ?? rep.company ?? id}</Link>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
            Cost analytics — {rep.display_name ?? rep.company ?? id}
          </h1>
          <p style={{ color: '#6b7280', marginTop: 4 }}>{rangeLabel(range)} · actual RevRing cost from <code>voice_calls.cost_cents</code></p>
        </div>
        <nav style={{ display: 'flex', gap: 8, fontSize: 13 }}>
          {(['7d', '30d', '90d', 'mtd'] as const).map((r) => (
            <Link
              key={r}
              href={`/admin/clients/${id}/cost?range=${r}`}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: r === range ? '#111' : '#f3f4f6',
                color: r === range ? '#fff' : '#111',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              {r === 'mtd' ? 'MTD' : r}
            </Link>
          ))}
        </nav>
      </div>

      {/* Rate config */}
      <section style={{ marginTop: 24, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Rates</h2>
        <form action={saveRates} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Actual cost (admin only)</label>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>RevRing provider cost. Used for margin math on this page. Never shown to the client.</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#6b7280' }}>$</span>
              <input
                name="actual"
                type="number"
                step="0.001"
                min="0"
                defaultValue={actualRate != null ? (actualRate / 100).toString() : ''}
                placeholder="0.05"
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, width: 100 }}
              />
              <span style={{ color: '#6b7280' }}>/ min</span>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Client display rate</label>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>What the client sees on their dashboard "Cost" KPI. Leave blank to hide the KPI entirely.</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#6b7280' }}>$</span>
              <input
                name="display"
                type="number"
                step="0.001"
                min="0"
                defaultValue={displayRate != null ? (displayRate / 100).toString() : ''}
                placeholder="(hidden)"
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, width: 100 }}
              />
              <span style={{ color: '#6b7280' }}>/ min</span>
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'center' }}>
            <button type="submit" style={{ padding: '6px 14px', background: '#111', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Save rates</button>
            {marginPct != null && (
              <span style={{ fontSize: 13, color: marginPct >= 0 ? '#15803d' : '#b91c1c' }}>
                Margin: <strong>{marginPct}%</strong> ({centsToDollars((displayRate ?? 0) - (actualRate ?? 0))}/min)
              </span>
            )}
            {actualRate != null && displayRate == null && (
              <span style={{ fontSize: 13, color: '#92400e' }}>Internal/at-cost rep — client sees no Cost KPI.</span>
            )}
          </div>
        </form>
      </section>

      {/* KPI grid */}
      <section style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Kpi label="Total actual cost" value={centsToDollars(totalCostCents)} sub={`${totalHours.toFixed(1)} hrs dialed`} />
        <Kpi
          label="Client-billed (display)"
          value={displayRate != null ? centsToDollars(displayCostCents) : '—'}
          sub={
            displayRate != null
              ? `margin ${centsToDollars(displayCostCents - totalCostCents)} (${marginPct ?? 0}%)`
              : 'no display rate set — client sees no Cost KPI'
          }
        />
        <Kpi label="Cost per call" value={centsToDollars(costPerCallCents)} sub={`avg ${avgCallSec}s/call`} />
        <Kpi label="Cost per booking" value={bookings > 0 ? centsToDollars(costPerBookingCents) : '—'} sub={`${bookings} bookings · ${meetingsConfirmed} meetings`} />
      </section>

      {/* Daily breakdown */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Daily breakdown</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              <Th>Date</Th><Th align="right">Calls</Th><Th align="right">Minutes</Th><Th align="right">Bookings</Th><Th align="right">Cost</Th><Th align="right">$/booking</Th>
            </tr>
          </thead>
          <tbody>
            {dailyRows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 16, color: '#6b7280', textAlign: 'center' }}>No calls in this range.</td></tr>
            ) : dailyRows.map(([day, d]) => (
              <tr key={day} style={{ borderTop: '1px solid #f3f4f6' }}>
                <Td>{day}</Td>
                <Td align="right">{d.calls}</Td>
                <Td align="right">{(d.sec / 60).toFixed(1)}</Td>
                <Td align="right">{d.bookings}</Td>
                <Td align="right">{centsToDollars(d.cost)}</Td>
                <Td align="right">{d.bookings > 0 ? centsToDollars(Math.round(d.cost / d.bookings)) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Outcome breakdown */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>By outcome</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              <Th>Outcome</Th><Th align="right">Calls</Th><Th align="right">Minutes</Th><Th align="right">Cost</Th><Th align="right">% of cost</Th>
            </tr>
          </thead>
          <tbody>
            {outcomeRows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 16, color: '#6b7280', textAlign: 'center' }}>No calls in this range.</td></tr>
            ) : outcomeRows.map(([oc, d]) => (
              <tr key={oc} style={{ borderTop: '1px solid #f3f4f6' }}>
                <Td>{oc}</Td>
                <Td align="right">{d.calls}</Td>
                <Td align="right">{(d.sec / 60).toFixed(1)}</Td>
                <Td align="right">{centsToDollars(d.cost)}</Td>
                <Td align="right">{totalCostCents > 0 ? `${Math.round((d.cost / totalCostCents) * 100)}%` : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {rep.revring_cost_per_minute_cents == null && (
        <p style={{ marginTop: 32, padding: 12, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13 }}>
          No RevRing rate set for this rep. Past calls will show $0 cost. New calls will start writing <code>cost_cents</code> once a rate is saved above.
        </p>
      )}
    </main>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return <th style={{ padding: '8px 10px', fontWeight: 600, color: '#374151', textAlign: align ?? 'left' }}>{children}</th>
}
function Td({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return <td style={{ padding: '8px 10px', textAlign: align ?? 'left' }}>{children}</td>
}
