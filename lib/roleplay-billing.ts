// ============================================================================
// Roleplay AI-wallet billing.
//
// Practice is a micro-purchase, not a subscription: live minutes are drawn
// from the account's AI wallet (ai_wallets / ai_wallet_ledger, see
// supabase/roleplay_wallet_migration.sql) at ROLEPLAY_CENTS_PER_MIN — the one
// retail rate in lib/minutePricing.ts.
//
// The gate sits at session START (needs at least one minute of balance) and
// the charge lands at FINALIZE, priced on the provider's measured call
// duration. The charge is idempotent per session — the ledger's partial
// unique index makes a retried finalize a no-op — and it may drive a balance
// negative: the minutes were consumed, so the debt is real; the start gate is
// what stops the next session.
//
// ROLEPLAY_BILLING_ENABLED=true flips it on. Default OFF so the currently
// open floor (ROLEPLAY_OPEN_ACCESS) keeps working until wallets are funded.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { ROLEPLAY_CENTS_PER_MIN } from '@/lib/minutePricing'

export function roleplayBillingEnabled(): boolean {
  return (process.env.ROLEPLAY_BILLING_ENABLED ?? '').toLowerCase() === 'true'
}

export function practiceCentsFor(durationSeconds: number | null): number {
  const minutes = Math.max(1, Math.ceil((durationSeconds ?? 60) / 60))
  return minutes * ROLEPLAY_CENTS_PER_MIN
}

export async function walletBalanceCents(repId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_wallets')
    .select('balance_cents')
    .eq('rep_id', repId)
    .maybeSingle()
  if (error) throw error
  return data?.balance_cents ?? 0
}

/** Throws 'roleplay_wallet_empty' when billing is on and the wallet can't cover a minute. */
export async function assertWalletCanStart(repId: string): Promise<void> {
  if (!roleplayBillingEnabled()) return
  const balance = await walletBalanceCents(repId)
  if (balance < ROLEPLAY_CENTS_PER_MIN) throw new Error('roleplay_wallet_empty')
}

/**
 * Charge a finished session's minutes from the wallet. Idempotent per
 * session. Best-effort by design at the CALL SITE: a grade must never be
 * lost over a billing hiccup, so callers log-and-continue — the ledger
 * gap is visible, a swallowed grade is not.
 */
export async function chargeRoleplaySession(args: {
  repId: string
  memberId: string
  sessionId: string
  durationSeconds: number | null
}): Promise<{ charged_cents: number; balance_cents: number } | null> {
  if (!roleplayBillingEnabled()) return null
  const cents = practiceCentsFor(args.durationSeconds)
  const { data, error } = await supabase.rpc('roleplay_wallet_charge', {
    p_rep_id: args.repId,
    p_member_id: args.memberId,
    p_session_id: args.sessionId,
    p_amount_cents: cents,
    p_note: `roleplay practice ${Math.max(1, Math.ceil((args.durationSeconds ?? 60) / 60))} min @ ${ROLEPLAY_CENTS_PER_MIN}¢/min`,
  })
  if (error) throw error
  return { charged_cents: cents, balance_cents: Number(data ?? 0) }
}
