/**
 * Full KPI analytics page. Shows ALL non-archived cards (pinned + unpinned)
 * with a 30-day mini-chart per card, pin/unpin toggle, and archive button.
 *
 * The main /dashboard renders only pinned cards so it stays scannable; reps
 * who want the full picture come here. Both views share the same server
 * actions semantics (revalidate both paths so toggles stick).
 */
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  listKpiCards,
  archiveCard as archiveKpiCard,
  setCardPinned,
  getEntriesForCardsSince,
  isCurrencyMetric,
  type KpiCard,
} from '@/lib/kpi-cards'
import { getCurrentTenant, getCurrentMember, requireTenant } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'

export const dynamic = 'force-dynamic'

function fmt(value: number, card: KpiCard): string {
  if (card.unit === 'USD' || isCurrencyMetric(card.metric_key)) {
    return `$${Math.round(value).toLocaleString()}`
  }
  return value.toLocaleString()
}

function periodLabel(p: KpiCard['period']): string {
  return p === 'day' ? 'daily' : p === 'week' ? 'weekly' : 'monthly'
}

export default async function AnalyticsPage() {
  const tenant = await getCurrentTenant()
  if (!tenant) redirect('/login')
  const member = await getCurrentMember()
  if (!member) redirect('/login')

  const cards = await listKpiCards(tenant.id, member.id)
  const today = new Date()
  const thirtyAgo = new Date(today)
  thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 29)
  const sinceIso = thirtyAgo.toISOString().slice(0, 10)
  const entriesByCard = await getEntriesForCardsSince(
    cards.map((c) => c.id),
    sinceIso,
  )

  // ── Server actions ────────────────────────────────────────────────────
  async function onPin(formData: FormData) {
    'use server'
    const cardId = String(formData.get('cardId') ?? '')
    const pinned = String(formData.get('pinned') ?? '') === '1'
    if (!cardId) return
    const t = await requireTenant()
    await setCardPinned(t.id, cardId, pinned)
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/analytics')
  }

  async function onArchive(formData: FormData) {
    'use server'
    const cardId = String(formData.get('cardId') ?? '')
    if (!cardId) return
    const t = await requireTenant()
    await archiveKpiCard(t.id, cardId)
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/analytics')
  }

  // ── Render ────────────────────────────────────────────────────────────
  const navTabs = await buildDashboardTabs(tenant.id, member)
  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>KPI Analytics</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Every metric you&rsquo;re tracking, with the last 30 days of activity. Pin the ones you
            want on your main dashboard.
          </p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {cards.length === 0 ? (
        <div
          style={{
            padding: '2rem 1.2rem',
            border: '1px dashed var(--line, #e5e0d8)',
            borderRadius: 12,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0 }}>
            No KPIs yet. Text the bot something like <em>&ldquo;100 dials, 25 convos, 5 sets
            today&rdquo;</em> and it&rsquo;ll offer to start tracking.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {cards.map((card) => {
            const entries = entriesByCard[card.id] ?? []
            const max = entries.reduce((acc, e) => Math.max(acc, e.value), 0)
            const total = entries.reduce((acc, e) => acc + e.value, 0)
            const avg = entries.length ? total / entries.length : 0
            const last = entries[entries.length - 1]
            // Build a 30-day axis so missing days show as zero bars.
            const days: Array<{ day: string; value: number }> = []
            for (let i = 29; i >= 0; i--) {
              const d = new Date(today)
              d.setUTCDate(d.getUTCDate() - i)
              const iso = d.toISOString().slice(0, 10)
              const hit = entries.find((e) => e.day === iso)
              days.push({ day: iso, value: hit?.value ?? 0 })
            }
            const chartW = 260
            const chartH = 60
            const barW = chartW / days.length
            return (
              <article
                key={card.id}
                style={{
                  background: '#fff',
                  border: '1px solid var(--line, #e5e0d8)',
                  borderRadius: 12,
                  padding: '0.9rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                <header
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p
                      className="meta"
                      style={{ margin: 0, fontSize: '0.72rem', textTransform: 'uppercase' }}
                    >
                      {periodLabel(card.period)}
                      {card.goal_value ? ` · goal ${fmt(card.goal_value, card)}` : ''}
                    </p>
                    <strong style={{ fontSize: '1rem', display: 'block' }}>{card.label}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <form action={onPin}>
                      <input type="hidden" name="cardId" value={card.id} />
                      <input
                        type="hidden"
                        name="pinned"
                        value={card.pinned_to_dashboard ? '0' : '1'}
                      />
                      <button
                        type="submit"
                        title={
                          card.pinned_to_dashboard
                            ? 'Unpin from main dashboard'
                            : 'Pin to main dashboard'
                        }
                        style={{
                          background: 'transparent',
                          border: 0,
                          cursor: 'pointer',
                          fontSize: '1rem',
                          padding: 0,
                          opacity: card.pinned_to_dashboard ? 1 : 0.4,
                        }}
                      >
                        📌
                      </button>
                    </form>
                    <form action={onArchive}>
                      <input type="hidden" name="cardId" value={card.id} />
                      <button
                        type="submit"
                        title="Delete this KPI"
                        style={{
                          background: 'transparent',
                          border: 0,
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </form>
                  </div>
                </header>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.78rem',
                  }}
                >
                  <span>
                    <span className="meta">Latest:</span>{' '}
                    <strong>{last ? fmt(last.value, card) : '—'}</strong>
                  </span>
                  <span>
                    <span className="meta">Avg:</span> <strong>{fmt(avg, card)}</strong>
                  </span>
                  <span>
                    <span className="meta">Total:</span> <strong>{fmt(total, card)}</strong>
                  </span>
                </div>

                <svg
                  width="100%"
                  height={chartH}
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  preserveAspectRatio="none"
                  style={{ display: 'block' }}
                >
                  {days.map((d, i) => {
                    const h = max > 0 ? (d.value / max) * (chartH - 4) : 0
                    return (
                      <rect
                        key={d.day}
                        x={i * barW}
                        y={chartH - h}
                        width={Math.max(1, barW - 1)}
                        height={h}
                        fill={d.value > 0 ? 'var(--accent, #c21a00)' : 'rgba(0,0,0,0.06)'}
                        rx={1}
                      />
                    )
                  })}
                </svg>

                <p
                  className="meta"
                  style={{ margin: 0, fontSize: '0.7rem', textAlign: 'right' }}
                >
                  Last 30 days
                </p>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
