/**
 * The two plan tiers' list prices, used by the client create (POST
 * /api/ops/onboarding/actions create_client) and the /welcome page.
 *
 * The old admin onboarding checklist (stored in reps.onboarding_steps and
 * shown on /admin/clients/[id]) was retired 2026-10-19: client onboarding
 * lives in Accounts now, derived from data (lib/opsOnboarding).
 */
export const TIER_INFO: Record<
  'individual' | 'enterprise',
  { label: string; monthly: number; build: [number, number]; description: string }
> = {
  individual: {
    label: 'Individual',
    monthly: 50,
    build: [2000, 2000],
    description:
      'A voice-first personal CRM for one closer. Talk to it like Jarvis — set targets, create tasks, mark no-shows, log calls, all through Mira. Your calendar, pipeline, and brain, in one place.',
  },
  enterprise: {
    label: 'Enterprise',
    monthly: 400,
    build: [10000, 10000],
    description:
      'A command center for running teams. Revenue + momentum rollups, per-team health, manager and rep scorecards, fulfillment-partner oversight, call-intelligence (Fathom / Gong) tied to deal velocity. Dedicated infra, BYOK, SLA.',
  },
}
