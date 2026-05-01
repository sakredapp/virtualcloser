// Agent (per-member) billing helpers.
//
// Sits on top of Stripe + the agent_billing / agent_billing_period tables.
// Tenant-level billing (client_addons, billing_periods) is unchanged — that
// rep-account layer continues to exist alongside this per-agent layer.
//
// Canonical unit is SECONDS internally; UI converts to hours via the
// helpers in lib/billing/units.ts.

import { supabase } from '@/lib/supabase'
import { getStripe } from './stripe'
import { pricePerHourForReps } from '@/app/offer/AiSdrPricingCalculator'

export type PayerModel = 'self' | 'org'
export type AgentBillingStatus = 'pending_setup' | 'active' | 'past_due' | 'cancelled'

export type AgentBillingRow = {
  id: string
  member_id: string
  rep_id: string
  payer_model: PayerModel
  stripe_customer_id: string | null
  stripe_payment_method_id: string | null
  stripe_subscription_id: string | null
  card_brand: string | null
  card_last4: string | null
  card_exp_month: number | null
  card_exp_year: number | null
  plan_minutes_per_month: number | null
  plan_price_cents: number | null
  price_per_minute_cents: number | null
  status: AgentBillingStatus
  created_at: string
  updated_at: string
}

export type AgentBillingPeriodRow = {
  id: string
  member_id: string
  rep_id: string
  period_year_month: string
  period_start: string
  period_end: string
  planned_seconds: number
  consumed_seconds: number
  overage_seconds: number
  status: 'open' | 'closed'
  stripe_invoice_id: string | null
  invoice_paid_at: string | null
  closed_at: string | null
}

const WEEKS_PER_MONTH = 4.3
const SECONDS_PER_HOUR = 3600

// ── Read ────────────────────────────────────────────────────────────────

export async function getAgentBilling(memberId: string): Promise<AgentBillingRow | null> {
  const { data, error } = await supabase
    .from('agent_billing')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw error
  return (data as AgentBillingRow | null) ?? null
}

export async function getOpenPeriod(memberId: string): Promise<AgentBillingPeriodRow | null> {
  const { data, error } = await supabase
    .from('agent_billing_period')
    .select('*')
    .eq('member_id', memberId)
    .eq('status', 'open')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as AgentBillingPeriodRow | null) ?? null
}

export async function listPeriods(memberId: string, limit = 12): Promise<AgentBillingPeriodRow[]> {
  const { data, error } = await supabase
    .from('agent_billing_period')
    .select('*')
    .eq('member_id', memberId)
    .order('period_year_month', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as AgentBillingPeriodRow[]) ?? []
}

// ── Setup: create-or-fetch Stripe customer + agent_billing row ──────────

export async function ensureAgentBilling(args: {
  memberId: string
  repId: string
  email: string
  displayName: string
  payerModel?: PayerModel
}): Promise<AgentBillingRow> {
  const existing = await getAgentBilling(args.memberId)
  if (existing && existing.stripe_customer_id) return existing

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: args.email,
    name: args.displayName,
    metadata: {
      member_id: args.memberId,
      rep_id: args.repId,
      payer_model: args.payerModel ?? existing?.payer_model ?? 'self',
    },
  })

  if (existing) {
    const { data, error } = await supabase
      .from('agent_billing')
      .update({ stripe_customer_id: customer.id })
      .eq('member_id', args.memberId)
      .select('*')
      .single()
    if (error) throw error
    return data as AgentBillingRow
  }

  const { data, error } = await supabase
    .from('agent_billing')
    .insert({
      member_id: args.memberId,
      rep_id: args.repId,
      payer_model: args.payerModel ?? 'self',
      stripe_customer_id: customer.id,
      status: 'pending_setup',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as AgentBillingRow
}

// ── SetupIntent (for collecting card via Elements) ──────────────────────

export async function createSetupIntent(memberId: string): Promise<{ clientSecret: string }> {
  const billing = await getAgentBilling(memberId)
  if (!billing?.stripe_customer_id) {
    throw new Error('agent_billing.stripe_customer_id missing — call ensureAgentBilling first')
  }
  const stripe = getStripe()
  const intent = await stripe.setupIntents.create({
    customer: billing.stripe_customer_id,
    payment_method_types: ['card'],
    usage: 'off_session',
  })
  return { clientSecret: intent.client_secret ?? '' }
}

// ── Plan / subscription create or update ────────────────────────────────

/**
 * Create (or rotate) the Stripe subscription for this agent.
 *
 * We bill a flat monthly fee — `plan_price_cents` — which buys the agent
 * `plan_minutes_per_month` worth of dialer time. Overage is reported but
 * not auto-billed (yet); the dashboard surfaces it so the rep can choose
 * to top up or upgrade.
 *
 * Each call creates a fresh Stripe Price (one-off, ad-hoc) attached to a
 * shared "AI SDR — Monthly" Product. This avoids a price catalog SKU
 * explosion when reps slide to arbitrary plan sizes.
 */
export async function subscribeAgentToPlan(args: {
  memberId: string
  hoursPerWeek: number
  pricePerHour: number
}): Promise<{ subscriptionId: string; status: string }> {
  const billing = await getAgentBilling(args.memberId)
  if (!billing?.stripe_customer_id) throw new Error('no stripe customer for agent')
  if (!billing.stripe_payment_method_id) throw new Error('no card on file — collect via SetupIntent first')

  const planHoursPerMonth = Math.round(args.hoursPerWeek * WEEKS_PER_MONTH * 10) / 10
  const planMinutesPerMonth = Math.round(planHoursPerMonth * 60)
  const planPriceCents = Math.round(planHoursPerMonth * args.pricePerHour * 100)
  const pricePerMinuteCents = Number((args.pricePerHour / 60).toFixed(4))

  const stripe = getStripe()

  // Cancel any existing subscription before creating the new one.
  if (billing.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(billing.stripe_subscription_id)
    } catch (err) {
      // Already cancelled / doesn't exist on Stripe — proceed.
      console.warn('[agentBilling] prior sub cancel failed (continuing)', err)
    }
  }

  const productId = await ensureSdrProduct()
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: planPriceCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: `AI SDR · ${args.hoursPerWeek} hrs/wk`,
    metadata: {
      hours_per_week: String(args.hoursPerWeek),
      price_per_hour: String(args.pricePerHour),
      minutes_per_month: String(planMinutesPerMonth),
    },
  })

  const sub = await stripe.subscriptions.create({
    customer: billing.stripe_customer_id,
    items: [{ price: price.id }],
    default_payment_method: billing.stripe_payment_method_id,
    metadata: {
      member_id: args.memberId,
      rep_id: billing.rep_id,
      hours_per_week: String(args.hoursPerWeek),
    },
    expand: ['latest_invoice.payment_intent'],
  })

  await supabase
    .from('agent_billing')
    .update({
      stripe_subscription_id: sub.id,
      plan_minutes_per_month: planMinutesPerMonth,
      plan_price_cents: planPriceCents,
      price_per_minute_cents: pricePerMinuteCents,
      status: sub.status === 'active' ? 'active' : 'pending_setup',
    })
    .eq('member_id', args.memberId)

  return { subscriptionId: sub.id, status: sub.status }
}

let _cachedProductId: string | null = null
async function ensureSdrProduct(): Promise<string> {
  if (_cachedProductId) return _cachedProductId
  const stripe = getStripe()
  // Look for an existing product by metadata so we don't create duplicates
  // across cold-start workers.
  const found = await stripe.products.search({ query: "metadata['vc_product']:'ai_sdr_monthly'", limit: 1 })
  if (found.data[0]) {
    _cachedProductId = found.data[0].id
    return _cachedProductId
  }
  const created = await stripe.products.create({
    name: 'AI SDR — Monthly',
    description: "Per-agent AI SDR plan. Pay-as-you-go monthly subscription, billed to the agent's card on file.",
    metadata: { vc_product: 'ai_sdr_monthly' },
  })
  _cachedProductId = created.id
  return _cachedProductId
}

// ── Period management (called from cron + webhook) ──────────────────────

export function periodYearMonthForDate(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function periodBoundsForDate(d: Date = new Date()): { start: Date; end: Date; ym: string } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0))
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
  return { start, end, ym: periodYearMonthForDate(d) }
}

export async function ensureOpenPeriod(memberId: string): Promise<AgentBillingPeriodRow> {
  const billing = await getAgentBilling(memberId)
  if (!billing) throw new Error('agent_billing row missing')
  const { start, end, ym } = periodBoundsForDate()
  const planned = (billing.plan_minutes_per_month ?? 0) * 60
  const { data, error } = await supabase
    .from('agent_billing_period')
    .upsert(
      {
        member_id: memberId,
        rep_id: billing.rep_id,
        period_year_month: ym,
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        planned_seconds: planned,
        status: 'open',
      },
      { onConflict: 'member_id,period_year_month', ignoreDuplicates: false },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as AgentBillingPeriodRow
}

/**
 * Recompute consumed_seconds for an open period from voice_calls.
 * Idempotent. Called on every call-end webhook + on cron-driven recon.
 */
export async function reconcilePeriodUsage(memberId: string): Promise<AgentBillingPeriodRow | null> {
  const period = await getOpenPeriod(memberId)
  if (!period) return null
  const { data: calls } = await supabase
    .from('voice_calls')
    .select('duration_sec')
    .eq('owner_member_id', memberId)
    .eq('provider', 'revring')
    .gte('created_at', period.period_start)
    .lt('created_at', period.period_end)
  const consumed = (calls ?? []).reduce(
    (acc, r) => acc + Math.max(0, Number((r as { duration_sec: number | null }).duration_sec ?? 0)),
    0,
  )
  const overage = Math.max(0, consumed - period.planned_seconds)
  const { data, error } = await supabase
    .from('agent_billing_period')
    .update({ consumed_seconds: consumed, overage_seconds: overage })
    .eq('id', period.id)
    .select('*')
    .single()
  if (error) throw error
  return data as AgentBillingPeriodRow
}

// ── Plan helpers (UI math lives in app/offer/AiSdrPricingCalculator) ────

export function pricePerHourForAgent(repCount: number): number {
  return pricePerHourForReps(repCount)
}
