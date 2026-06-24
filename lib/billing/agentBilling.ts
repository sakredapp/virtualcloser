// Agent (per-member) billing helpers.
//
// Stripe customer + agent_billing row management. Weekly usage/charging lives
// in org_billing_week / agent_billing_week, driven by the Stripe webhook + the
// billing-week-rollover cron — not here. Tenant-level billing (client_addons,
// billing_periods) is unchanged.

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
  // Legacy monthly plan fields (superseded by the weekly columns below).
  plan_minutes_per_month: number | null
  plan_price_cents: number | null
  price_per_minute_cents: number | null
  // Weekly model (current).
  weekly_hours_quota: number | null
  overflow_enabled: boolean | null
  volume_tier: string | null
  cancel_at_week_end: boolean | null
  current_week_start: string | null
  current_week_end: string | null
  status: AgentBillingStatus
  created_at: string
  updated_at: string
}

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

// ── Pricing helper ───────────────────────────────────────────────────────

export function pricePerHourForAgent(repCount: number): number {
  return pricePerHourForReps(repCount)
}
