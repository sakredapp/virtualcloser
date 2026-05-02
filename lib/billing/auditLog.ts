// Append-only billing audit log. Every admin write action goes through this
// before / after the Stripe call so the local DB has a record of who did
// what — even if the Stripe call succeeded and the webhook hasn't landed.

import { supabase } from '@/lib/supabase'

export type AuditEntry = {
  actorKind: 'admin' | 'system' | 'customer' | 'webhook'
  actorId?: string
  action: string                              // 'subscription.cancel' | 'invoice.refund' | ...
  repId?: string | null
  memberId?: string | null
  stripeObjectId?: string | null
  amountCents?: number | null
  before?: unknown
  after?: unknown
  notes?: string | null
}

export async function audit(entry: AuditEntry): Promise<void> {
  await supabase.from('billing_audit').insert({
    actor_kind: entry.actorKind,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    rep_id: entry.repId ?? null,
    member_id: entry.memberId ?? null,
    stripe_object_id: entry.stripeObjectId ?? null,
    amount_cents: entry.amountCents ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    notes: entry.notes ?? null,
  })
}
