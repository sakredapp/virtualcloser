// Mirror Stripe invoices into the local `invoices` table so admin/billing
// pages don't pay for a Stripe API call on every render.

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'

export async function upsertInvoiceFromStripe(inv: Stripe.Invoice): Promise<void> {
  const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
  if (!customerId) return

  // Resolve scope + ownership: member-scope if the customer matches an
  // agent_billing row; org-scope if it matches a reps row.
  let scope: 'member' | 'org' = 'member'
  let memberId: string | null = null
  let repId: string | null = null

  const { data: ab } = await supabase
    .from('agent_billing')
    .select('member_id, rep_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (ab) {
    memberId = (ab.member_id as string) ?? null
    repId = (ab.rep_id as string) ?? null
    scope = 'member'
  } else {
    const { data: rep } = await supabase
      .from('reps')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (rep) {
      repId = (rep.id as string) ?? null
      scope = 'org'
    }
  }

  const periodStart = inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null
  const periodEnd = inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null

  await supabase.from('invoices').upsert({
    id: inv.id,
    stripe_customer_id: customerId,
    rep_id: repId,
    member_id: memberId,
    scope,
    status: inv.status ?? 'draft',
    amount_due_cents: inv.amount_due ?? 0,
    amount_paid_cents: inv.amount_paid ?? 0,
    amount_remaining_cents: inv.amount_remaining ?? 0,
    currency: inv.currency ?? 'usd',
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf_url: inv.invoice_pdf ?? null,
    number: inv.number ?? null,
    period_start: periodStart,
    period_end: periodEnd,
    collection_method: inv.collection_method ?? null,
    attempt_count: inv.attempt_count ?? 0,
    next_payment_attempt: inv.next_payment_attempt
      ? new Date(inv.next_payment_attempt * 1000).toISOString()
      : null,
    finalized_at: inv.status_transitions?.finalized_at
      ? new Date(inv.status_transitions.finalized_at * 1000).toISOString()
      : null,
    paid_at: inv.status_transitions?.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
      : null,
    voided_at: inv.status_transitions?.voided_at
      ? new Date(inv.status_transitions.voided_at * 1000).toISOString()
      : null,
  }, { onConflict: 'id' })
}
