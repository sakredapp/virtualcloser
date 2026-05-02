// One-time build fee pricing.
//
// Individual: flat $2,000.
// Enterprise: per-rep, tiered by org size.
//
//   < 25 reps     → $400/rep
//   25–49         → $350/rep
//   50–99         → $300/rep
//   100+          → $200/rep
//
// Charged once at checkout as a Stripe invoice item attached to the first
// invoice (so it shows on the customer's first weekly bill alongside
// recurring items).

export type BuildFeeScope = 'individual' | 'enterprise'

export type BuildFeeTier = {
  minReps: number
  perRepCents: number
  label: string
}

export const INDIVIDUAL_BUILD_FEE_CENTS = 200_000  // $2,000

export const ENTERPRISE_BUILD_FEE_TIERS: BuildFeeTier[] = [
  { minReps: 1,   perRepCents: 40_000, label: '$400/rep · under 25 reps' },
  { minReps: 25,  perRepCents: 35_000, label: '$350/rep · 25–49 reps' },
  { minReps: 50,  perRepCents: 30_000, label: '$300/rep · 50–99 reps' },
  { minReps: 100, perRepCents: 20_000, label: '$200/rep · 100+ reps' },
]

export function enterpriseBuildFeePerRepCents(reps: number): number {
  let chosen = ENTERPRISE_BUILD_FEE_TIERS[0]
  for (const t of ENTERPRISE_BUILD_FEE_TIERS) {
    if (reps >= t.minReps) chosen = t
  }
  return chosen.perRepCents
}

export function enterpriseBuildFeeTier(reps: number): BuildFeeTier {
  let chosen = ENTERPRISE_BUILD_FEE_TIERS[0]
  for (const t of ENTERPRISE_BUILD_FEE_TIERS) {
    if (reps >= t.minReps) chosen = t
  }
  return chosen
}

export function buildFeeCents(scope: BuildFeeScope, reps: number): number {
  if (scope === 'individual') return INDIVIDUAL_BUILD_FEE_CENTS
  if (reps <= 0) return 0
  return enterpriseBuildFeePerRepCents(reps) * reps
}

/** Human-readable line item for the cart / quote summary. */
export function buildFeeLineItem(scope: BuildFeeScope, reps: number): {
  label: string
  cents: number
  sub: string
} | null {
  const cents = buildFeeCents(scope, reps)
  if (cents <= 0) return null
  if (scope === 'individual') {
    return {
      label: 'One-time build fee',
      cents,
      sub: 'Onboarding, build, and integrations · charged on first invoice',
    }
  }
  const tier = enterpriseBuildFeeTier(reps)
  return {
    label: 'One-time build fee',
    cents,
    sub: `${tier.label} · ${reps} reps · charged on first invoice`,
  }
}
