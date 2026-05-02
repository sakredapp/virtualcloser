// /admin/pipeline
//
// Kanban board for the entire deal flow. Server-renders the columns +
// cards, hands off to PipelineBoard client component for drag-and-drop +
// detail panel + inline editing.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { STAGE_ORDER, type PipelineStage } from '@/lib/pipeline'
import PipelineBoard, { type ProspectCard } from './PipelineBoard'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  // Pull every prospect with the deal-relevant fields. Joined with reps
  // to surface payment + sub status. carts joined for quote totals.
  const { data: rows, error } = await supabase
    .from('prospects')
    .select(`
      id, name, email, phone, company, source, status,
      pipeline_stage, pipeline_position, stage_changed_at,
      meeting_at, kickoff_call_at,
      build_summary, build_plan, build_brief, build_cost_estimate, selected_features,
      admin_notes, cart_id, rep_id,
      created_at, updated_at,
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

  if (error) {
    console.error('[pipeline] load failed', error)
  }

  const cards: ProspectCard[] = ((rows ?? []) as unknown as RawRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    source: r.source,
    status: r.status,
    stage: (r.pipeline_stage ?? 'lead') as PipelineStage,
    position: r.pipeline_position ?? 0,
    stageChangedAt: r.stage_changed_at ?? r.updated_at ?? r.created_at,
    meetingAt: r.meeting_at,
    kickoffCallAt: r.kickoff_call_at,
    buildSummary: r.build_summary,
    buildPlan: r.build_plan,
    buildBrief: r.build_brief,
    buildCostEstimate: r.build_cost_estimate,
    selectedFeatures: Array.isArray(r.selected_features) ? r.selected_features : [],
    adminNotes: r.admin_notes,
    cartId: r.cart_id,
    repId: r.rep_id,
    rep: r.reps ? {
      id: r.reps.id,
      displayName: r.reps.display_name,
      slug: r.reps.slug,
      tier: r.reps.tier,
      billingStatus: r.reps.billing_status,
      stripeCustomerId: r.reps.stripe_customer_id,
      weeklyHoursQuota: r.reps.weekly_hours_quota,
      buildFeePaidCents: r.reps.build_fee_paid_cents,
      buildFeePaidAt: r.reps.build_fee_paid_at,
      subscriptionActivatedAt: r.reps.subscription_activated_at,
      stripeSubscriptionId: r.reps.stripe_subscription_id,
    } : null,
    cart: r.carts ? {
      id: r.carts.id,
      weeklyHours: r.carts.weekly_hours,
      trainerWeeklyHours: r.carts.trainer_weekly_hours,
      repCount: r.carts.rep_count,
      addons: Array.isArray(r.carts.addons) ? r.carts.addons : [],
      computedTotalCents: r.carts.computed_total_cents,
      tier: r.carts.tier,
    } : null,
  }))

  // Stage counts for the header strip.
  const counts: Record<PipelineStage, number> = {
    lead: 0, call_booked: 0, plan_generated: 0, quote_sent: 0,
    payment_made: 0, kickoff_scheduled: 0, building: 0, active: 0, lost: 0,
  }
  for (const c of cards) counts[c.stage] = (counts[c.stage] ?? 0) + 1
  const totalActive = STAGE_ORDER.reduce((acc, s) => acc + (counts[s as PipelineStage] ?? 0), 0)

  return (
    <main style={{ padding: '1rem 1.2rem 2rem', maxWidth: 'none' }}>
      <header style={{ marginBottom: '1rem' }}>
        <p style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--brand-red, #ff2800)',
          margin: 0,
        }}>
          Admin · Pipeline
        </p>
        <h1 style={{ margin: '4px 0 6px', fontSize: '1.6rem', color: 'var(--ink)' }}>
          Deal flow
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          {totalActive} {totalActive === 1 ? 'deal' : 'deals'} in flight · {counts.lost} lost · drag cards between columns to advance
        </p>
        <p style={{ marginTop: 8, fontSize: 12 }}>
          <Link href="/admin/clients" style={{ color: 'var(--muted)' }}>Old clients view</Link>
          <span style={{ color: 'var(--muted)' }}> · </span>
          <Link href="/admin/billing/customers" style={{ color: 'var(--muted)' }}>Customers (Stripe)</Link>
          <span style={{ color: 'var(--muted)' }}> · </span>
          <Link href="/admin/prospects" style={{ color: 'var(--muted)' }}>Raw prospects</Link>
          <span style={{ color: 'var(--muted)' }}> · </span>
          <Link href="/admin/billing/audit" style={{ color: 'var(--muted)' }}>Audit log</Link>
        </p>
      </header>

      <PipelineBoard initialCards={cards} stageCounts={counts} />
    </main>
  )
}

// ── Raw row shape (Supabase returns nested arrays for foreign refs depending
// on the relationship cardinality — we declare it explicitly here). ───────
type RawRow = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  source: string | null
  status: string | null
  pipeline_stage: PipelineStage | null
  pipeline_position: number | null
  stage_changed_at: string | null
  meeting_at: string | null
  kickoff_call_at: string | null
  build_summary: string | null
  build_plan: string | null
  build_brief: string | null
  build_cost_estimate: number | null
  selected_features: unknown
  admin_notes: string | null
  cart_id: string | null
  rep_id: string | null
  created_at: string
  updated_at: string
  reps: {
    id: string
    display_name: string
    slug: string
    tier: string
    billing_status: string | null
    stripe_customer_id: string | null
    weekly_hours_quota: number | null
    build_fee_paid_cents: number | null
    build_fee_paid_at: string | null
    subscription_activated_at: string | null
    stripe_subscription_id: string | null
  } | null
  carts: {
    id: string
    weekly_hours: number | null
    trainer_weekly_hours: number | null
    rep_count: number | null
    addons: unknown
    computed_total_cents: number | null
    tier: string | null
  } | null
}
