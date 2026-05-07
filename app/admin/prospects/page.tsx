import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { listProspects, type Prospect } from '@/lib/prospects'
import { supabase } from '@/lib/supabase'
import { STAGE_ORDER, type PipelineStage } from '@/lib/pipeline'
import PipelineBoard, { type ProspectCard } from '../pipeline/PipelineBoard'

export const dynamic = 'force-dynamic'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}

type RawRow = {
  id: string; name: string | null; email: string | null; phone: string | null
  company: string | null; source: string | null; status: string | null
  pipeline_stage: PipelineStage | null; pipeline_position: number | null
  stage_changed_at: string | null; meeting_at: string | null; kickoff_call_at: string | null
  build_summary: string | null; build_plan: string | null; build_brief: string | null
  build_cost_estimate: number | null; selected_features: unknown
  admin_notes: string | null; cart_id: string | null; rep_id: string | null
  created_at: string; updated_at: string
  reps: {
    id: string; display_name: string; slug: string; tier: string
    billing_status: string | null; stripe_customer_id: string | null
    weekly_hours_quota: number | null; build_fee_paid_cents: number | null
    build_fee_paid_at: string | null; subscription_activated_at: string | null
    stripe_subscription_id: string | null
  } | null
  carts: {
    id: string; weekly_hours: number | null; trainer_weekly_hours: number | null
    rep_count: number | null; addons: unknown; computed_total_cents: number | null
    tier: string | null
  } | null
}

type Props = { searchParams: Promise<{ view?: string }> }

export default async function ProspectsPage({ searchParams }: Props) {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { view } = await searchParams
  const isKanban = view === 'kanban'

  if (isKanban) {
    const { data: rows, error } = await supabase
      .from('prospects')
      .select(`
        id, name, email, phone, company, source, status,
        pipeline_stage, pipeline_position, stage_changed_at,
        meeting_at, kickoff_call_at,
        build_summary, build_plan, build_brief, build_cost_estimate, selected_features,
        admin_notes, cart_id, rep_id, created_at, updated_at,
        reps:rep_id (
          id, display_name, slug, tier, billing_status, stripe_customer_id,
          weekly_hours_quota, build_fee_paid_cents, build_fee_paid_at,
          subscription_activated_at, stripe_subscription_id
        ),
        carts:cart_id (
          id, weekly_hours, trainer_weekly_hours, rep_count, addons,
          computed_total_cents, tier
        )
      `)
      .order('pipeline_position', { ascending: true })
      .order('updated_at', { ascending: false })
      .limit(500)

    if (error) console.error('[prospects/kanban] load failed', error)

    const cards: ProspectCard[] = ((rows ?? []) as unknown as RawRow[]).map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, company: r.company,
      source: r.source, status: r.status,
      stage: (r.pipeline_stage ?? 'lead') as PipelineStage,
      position: r.pipeline_position ?? 0,
      stageChangedAt: r.stage_changed_at ?? r.updated_at ?? r.created_at,
      meetingAt: r.meeting_at, kickoffCallAt: r.kickoff_call_at,
      buildSummary: r.build_summary, buildPlan: r.build_plan, buildBrief: r.build_brief,
      buildCostEstimate: r.build_cost_estimate,
      selectedFeatures: Array.isArray(r.selected_features) ? r.selected_features : [],
      adminNotes: r.admin_notes, cartId: r.cart_id, repId: r.rep_id,
      rep: r.reps ? {
        id: r.reps.id, displayName: r.reps.display_name, slug: r.reps.slug,
        tier: r.reps.tier, billingStatus: r.reps.billing_status,
        stripeCustomerId: r.reps.stripe_customer_id,
        weeklyHoursQuota: r.reps.weekly_hours_quota,
        buildFeePaidCents: r.reps.build_fee_paid_cents,
        buildFeePaidAt: r.reps.build_fee_paid_at,
        subscriptionActivatedAt: r.reps.subscription_activated_at,
        stripeSubscriptionId: r.reps.stripe_subscription_id,
      } : null,
      cart: r.carts ? {
        id: r.carts.id, weeklyHours: r.carts.weekly_hours,
        trainerWeeklyHours: r.carts.trainer_weekly_hours,
        repCount: r.carts.rep_count,
        addons: Array.isArray(r.carts.addons) ? r.carts.addons : [],
        computedTotalCents: r.carts.computed_total_cents,
        tier: r.carts.tier,
      } : null,
    }))

    const counts: Record<PipelineStage, number> = {
      lead: 0, call_booked: 0, plan_generated: 0, quote_sent: 0,
      payment_made: 0, kickoff_scheduled: 0, building: 0, active: 0, lost: 0,
    }
    for (const c of cards) counts[c.stage] = (counts[c.stage] ?? 0) + 1
    const total = STAGE_ORDER.reduce((acc, s) => acc + (counts[s] ?? 0), 0)

    return (
      <main style={{ padding: '1rem 1.2rem 2rem', maxWidth: 'none' }}>
        <PageHeader isKanban total={total} />
        <PipelineBoard initialCards={cards} stageCounts={counts} />
      </main>
    )
  }

  const prospects = await listProspects(500)

  return (
    <main className="wrap">
      <PageHeader isKanban={false} total={prospects.length} />

      {prospects.length === 0 ? (
        <section className="card">
          <p className="empty">
            No bookings yet. Point Cal.com webhooks at <code>/api/cal/webhook</code>.
          </p>
        </section>
      ) : (
        <section className="card">
          <ul className="list">
            {prospects.map((p) => (
              <li key={p.id} className="row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="name">
                    <Link href={`/admin/prospects/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {p.name || p.email || 'Unnamed'}
                    </Link>
                    {p.tier_interest && (
                      <span className="status" style={{ marginLeft: 8, background: 'rgba(255,40,0,0.08)', borderColor: 'rgba(255,40,0,0.2)', color: '#cc2200' }}>
                        {p.tier_interest}
                      </span>
                    )}
                    {p.build_plan && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 999, background: 'rgba(16,185,129,0.1)', color: '#065f46', border: '1px solid rgba(16,185,129,0.25)' }}>
                        plan ready
                      </span>
                    )}
                  </p>
                  <p className="meta">
                    {p.email ?? 'no email'}
                    {p.company ? ` · ${p.company}` : ''}
                    {p.phone ? ` · ${p.phone}` : ''}
                  </p>
                  {(p.build_summary || p.notes) && (
                    <p className="meta" style={{ marginTop: 2, fontStyle: p.build_summary ? 'normal' : 'italic' }}>
                      {(p.build_summary ?? p.notes ?? '').slice(0, 120)}
                      {((p.build_summary ?? p.notes ?? '').length > 120) ? '…' : ''}
                    </p>
                  )}
                </div>
                <div className="right">
                  <StatusBadge status={p.status} />
                  {p.build_cost_estimate != null && (
                    <p className="meta" style={{ fontWeight: 700, marginTop: 2 }}>${p.build_cost_estimate.toLocaleString()} build</p>
                  )}
                  <p className="meta">Meeting: {fmtDate(p.meeting_at)}</p>
                  <p className="meta">Booked: {fmtDate(p.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function PageHeader({ isKanban, total }: { isKanban: boolean; total: number }) {
  return (
    <header style={{ marginBottom: '1.2rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff2800', margin: 0 }}>
            Admin · Prospects
          </p>
          <h1 style={{ margin: '4px 0 4px', fontSize: '1.6rem', color: 'var(--ink)' }}>
            {isKanban ? 'Deal pipeline' : 'All bookings'}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            {total} {total === 1 ? 'prospect' : 'prospects'}
            {isKanban ? ' · drag cards to advance stage' : ' · click to open detail'}
          </p>
        </div>
        <ViewToggle isKanban={isKanban} />
      </div>
    </header>
  )
}

function ViewToggle({ isKanban }: { isKanban: boolean }) {
  const pill: React.CSSProperties = {
    padding: '5px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
    textDecoration: 'none', transition: 'all 120ms ease',
  }
  return (
    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.05)', borderRadius: 8, padding: 3, gap: 2, alignSelf: 'flex-start' }}>
      <Link href="/admin/prospects" style={{
        ...pill,
        background: !isKanban ? '#fff' : 'transparent',
        color: !isKanban ? 'var(--ink)' : 'var(--muted)',
        boxShadow: !isKanban ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
      }}>
        List
      </Link>
      <Link href="/admin/prospects?view=kanban" style={{
        ...pill,
        background: isKanban ? '#fff' : 'transparent',
        color: isKanban ? 'var(--ink)' : 'var(--muted)',
        boxShadow: isKanban ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
      }}>
        Kanban
      </Link>
    </div>
  )
}

function StatusBadge({ status }: { status: Prospect['status'] }) {
  const tones: Record<string, { bg: string; bd: string; fg: string }> = {
    booked:    { bg: 'rgba(37,99,235,0.1)',  bd: 'rgba(37,99,235,0.25)',  fg: '#1e40af' },
    won:       { bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.35)', fg: '#065f46' },
    canceled:  { bg: 'rgba(239,68,68,0.1)',  bd: 'rgba(239,68,68,0.3)',  fg: '#991b1b' },
    lost:      { bg: 'rgba(239,68,68,0.1)',  bd: 'rgba(239,68,68,0.3)',  fg: '#991b1b' },
    contacted: { bg: 'rgba(245,158,11,0.1)', bd: 'rgba(245,158,11,0.25)', fg: '#92400e' },
    new:       { bg: '#f3f4f6', bd: '#d1d5db', fg: '#6b7280' },
  }
  const t = tones[status] ?? tones.new
  return (
    <span className="status" style={{ background: t.bg, borderColor: t.bd, color: t.fg }}>
      {status}
    </span>
  )
}
