// ============================================================================
// Add-on catalog — single source of truth for offer page, admin cart,
// runtime entitlements, cap enforcement, and billing rollups.
//
// Every price, every cap, every backend cost estimate lives here. The offer
// page reads from this. The admin cart reads from this. The cap enforcement
// guards read from this. The billing dashboard reads from this. If you tune
// pricing, tune it ONCE in this file.
//
// At module load we run `assertMarginFloor()` which throws if any add-on
// would put us under the 30% gross-margin floor at full cap. This catches
// vendor-cost drift before it bleeds the books.
// ============================================================================

export type AddonKey =
  | 'base_build'
  | 'addon_ghl_crm'
  | 'addon_hubspot_crm'
  | 'addon_pipedrive_crm'
  | 'addon_salesforce_crm'
  | 'addon_dialer_lite'
  | 'addon_dialer_pro'
  | 'addon_roleplay_lite'
  | 'addon_roleplay_pro'
  | 'addon_wavv_kpi'
  | 'addon_team_leaderboard'
  | 'addon_white_label'
  | 'addon_bluebubbles'
  | 'addon_fathom'

export type AddonCategory = 'base' | 'crm' | 'dialer' | 'voice_training' | 'analytics' | 'team' | 'branding' | 'messaging'

export type CapUnit = 'unlimited' | 'appts_confirmed' | 'roleplay_minutes' | 'wavv_dials'

export type AddonDef = {
  key: AddonKey
  label: string
  category: AddonCategory
  // Customer-facing copy
  description: string
  sales_blurb: string
  whats_included: string[]
  // Pricing (in cents — avoid float math)
  monthly_price_cents: number
  // Caps (per calendar month, hard-stop at 100%)
  cap_unit: CapUnit
  cap_value: number | null
  // Our backend cost estimate AT FULL CAP utilization (in cents).
  // This is the ceiling — most months we'll spend less. Used for margin-floor assertion.
  our_cost_at_cap_cents: number
  // Optional per-unit cost for ad-hoc admin reporting (cents per unit)
  our_cost_per_unit_cents?: number
  // Add-ons this depends on (e.g. dialer_pro implies a CRM)
  requires?: AddonKey[]
  // Mutually-exclusive sibling (e.g. you pick lite OR pro, not both)
  excludes?: AddonKey[]
  // Whether this add-on is selectable on the public offer page
  // (some are admin-only e.g. white-label custom builds)
  public: boolean
  // Build-fee category hint (purely for sales-call estimation, not shown to customer)
  build_fee_tier: 'none' | 'small' | 'medium' | 'large'
}

// ─────────────────────────────────────────────────────────────────────────
// CATALOG
// ─────────────────────────────────────────────────────────────────────────

export const ADDON_CATALOG: Record<AddonKey, AddonDef> = {
  // ── BASE BUILD ───────────────────────────────────────────────────────
  base_build: {
    key: 'base_build',
    label: 'Virtual Closer base build',
    category: 'base',
    description:
      'Your AI employee, fully wired into your day. Voice-first, Telegram-driven, and tuned to how you actually sell.',
    sales_blurb: 'The full Virtual Closer brain. Required.',
    whats_included: [
      'Telegram-native AI assistant — text or voice from anywhere',
      'Google Calendar sync + meeting hydration',
      'Brain dump + voice memos with action-item extraction',
      'Personal dashboard with pipeline, leads, and daily prep brief',
      'Drafts every follow-up, every reschedule, every note',
      'Your own sub-domain (yourname.virtualcloser.com)',
    ],
    monthly_price_cents: 9900,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 1500, // Anthropic + Supabase + Vercel amortized
    public: true,
    build_fee_tier: 'medium',
  },

  // ── CRM INTEGRATIONS ─────────────────────────────────────────────────
  addon_ghl_crm: {
    key: 'addon_ghl_crm',
    label: 'GoHighLevel CRM build',
    category: 'crm',
    description:
      'Two-way GHL integration. Pipeline stage moves trigger your GHL workflows (SMS, email, etc). Tag-based dialer outcomes flow back automatically.',
    sales_blurb: 'GHL becomes your AI employee\'s native CRM.',
    whats_included: [
      'Bi-directional contact + opportunity sync',
      'Pipeline stage moves push to GHL in real time — your existing workflows fire automatically',
      '"Move Dana to Proposal" from Telegram updates GHL instantly',
      'Auto-enroll contacts in GHL workflows on stage change (configure per-stage)',
      '"Text Dana" via Telegram sends through GHL conversation inbox (tracked, workflow-eligible)',
      'Inbound GHL webhook syncs tag/contact/appointment events back to your dashboard',
      'AI dialer stamps GHL tags: vc-confirmed, vc-reschedule-requested, vc-no-answer',
      'Notes added to GHL contact on every stage move with rep context',
      'Works with white-labeled GHL instances (custom domain support)',
    ],
    monthly_price_cents: 4000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 200, // pass-through API
    public: true,
    build_fee_tier: 'small',
  },

  addon_hubspot_crm: {
    key: 'addon_hubspot_crm',
    label: 'HubSpot CRM build',
    category: 'crm',
    description: 'Two-way HubSpot integration. Deals, contacts, and stages stay in sync.',
    sales_blurb: 'HubSpot stays your source of truth.',
    whats_included: [
      'Bi-directional deal + contact sync',
      'Pipeline stage moves reflected in HubSpot',
      'Note + activity logging',
    ],
    monthly_price_cents: 4000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 200,
    public: true,
    build_fee_tier: 'small',
  },

  addon_pipedrive_crm: {
    key: 'addon_pipedrive_crm',
    label: 'Pipedrive CRM build',
    category: 'crm',
    description: 'Two-way Pipedrive integration.',
    sales_blurb: 'Pipedrive stays your source of truth.',
    whats_included: [
      'Bi-directional deal + contact sync',
      'Pipeline stage moves reflected in Pipedrive',
      'Note + activity logging',
    ],
    monthly_price_cents: 4000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 200,
    public: true,
    build_fee_tier: 'small',
  },

  addon_salesforce_crm: {
    key: 'addon_salesforce_crm',
    label: 'Salesforce CRM build',
    category: 'crm',
    description: 'Two-way Salesforce integration. Custom-mapped to your org\'s objects.',
    sales_blurb: 'Salesforce-grade integration, custom-mapped.',
    whats_included: [
      'Bi-directional opportunity + contact sync',
      'Custom field mapping to your org\'s schema',
      'Stage transition automations',
    ],
    monthly_price_cents: 8000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 400,
    public: true,
    build_fee_tier: 'large',
  },

  // ── AI DIALER (Vapi) ─────────────────────────────────────────────────
  addon_dialer_lite: {
    key: 'addon_dialer_lite',
    label: 'AI dialer',
    category: 'dialer',
    description:
      'Your AI employee calls every appointment 30–60 min before it\'s due. Press 1 to confirm, 2 to reschedule. No more no-shows.',
    sales_blurb: 'Up to 100 confirmed appointments / month.',
    whats_included: [
      'Outbound confirmation calls 30–60 min before each meeting',
      'Real-time rescheduling on the call (DTMF + voice)',
      'CRM tag stamping on every outcome',
      'Recording + transcript on every call',
      'Telegram ping when an outcome lands',
      'Cap: 100 confirmed appointments / month',
    ],
    monthly_price_cents: 5000,
    cap_unit: 'appts_confirmed',
    cap_value: 100,
    // 100 appts × ~$0.20 blended (45s confirms @ $0.15/min, ~10% reschedule
    // legs @ $0.45, ~20% voicemail @ $0.05) + $200 Vapi number rental
    our_cost_at_cap_cents: 2200,
    our_cost_per_unit_cents: 20,
    excludes: ['addon_dialer_pro'],
    public: true,
    build_fee_tier: 'medium',
  },

  addon_dialer_pro: {
    key: 'addon_dialer_pro',
    label: 'AI dialer · Pro',
    category: 'dialer',
    description: 'Same dialer, higher cap. For teams running real volume.',
    sales_blurb: 'Up to 300 confirmed appointments / month.',
    whats_included: [
      'Everything in AI dialer Lite',
      'Cap: 300 confirmed appointments / month',
      'Priority support on dialer issues',
    ],
    monthly_price_cents: 9000,
    cap_unit: 'appts_confirmed',
    cap_value: 300,
    // 300 × $0.20 + $200 number = $6200
    our_cost_at_cap_cents: 6200,
    our_cost_per_unit_cents: 20,
    excludes: ['addon_dialer_lite'],
    public: true,
    build_fee_tier: 'medium',
  },

  // ── ROLEPLAY (Vapi, ORG-WIDE pool) ───────────────────────────────────
  addon_roleplay_lite: {
    key: 'addon_roleplay_lite',
    label: 'Roleplay suite',
    category: 'voice_training',
    description:
      'Live voice practice. Custom personas, scored objection handling, recordings to review. Your whole org shares one minutes pool.',
    sales_blurb: 'Up to 300 minutes / month, shared org-wide.',
    whats_included: [
      'Custom roleplay scenarios (you write the brief, we tune the persona)',
      'Live voice sessions with AI-scored playback',
      'Manager review tools for team accounts',
      'Cap: 300 minutes / month — pooled across the entire org',
    ],
    monthly_price_cents: 9900,
    cap_unit: 'roleplay_minutes',
    cap_value: 300,
    // 300 min × ~$0.18/min Vapi blended = $54 (cheap models, short turns)
    our_cost_at_cap_cents: 5400,
    our_cost_per_unit_cents: 18,
    excludes: ['addon_roleplay_pro'],
    public: true,
    build_fee_tier: 'medium',
  },

  addon_roleplay_pro: {
    key: 'addon_roleplay_pro',
    label: 'Roleplay suite · Pro',
    category: 'voice_training',
    description: 'Same suite, larger pool. For teams running daily reps.',
    sales_blurb: 'Up to 1,000 minutes / month, shared org-wide.',
    whats_included: [
      'Everything in Roleplay Lite',
      'Cap: 1,000 minutes / month, pooled org-wide',
      'Priority scenario authoring',
    ],
    monthly_price_cents: 27900,
    cap_unit: 'roleplay_minutes',
    cap_value: 1000,
    // 1000 × ~$0.18 = $180. Margin floor satisfied at 35.5%.
    our_cost_at_cap_cents: 18000,
    our_cost_per_unit_cents: 18,
    excludes: ['addon_roleplay_lite'],
    public: true,
    build_fee_tier: 'medium',
  },

  // ── WAVV KPI INGEST ──────────────────────────────────────────────────
  addon_wavv_kpi: {
    key: 'addon_wavv_kpi',
    label: 'WAVV dialer KPI ingest',
    category: 'analytics',
    description:
      'Your WAVV dispositions land on your dashboard the second they happen. Daily KPI rollups, recordings, and disposition trends.',
    sales_blurb: 'Already on WAVV? Plug it into Virtual Closer.',
    whats_included: [
      'Inbound webhook receives every WAVV disposition',
      'Daily dials/connects/conversations/appts-set rollup',
      'Per-rep leaderboard',
      'Recording playback inside Virtual Closer',
    ],
    monthly_price_cents: 2000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 100,
    public: true,
    build_fee_tier: 'small',
  },

  // ── TEAM + LEADERBOARD ───────────────────────────────────────────────
  addon_team_leaderboard: {
    key: 'addon_team_leaderboard',
    label: 'Team + leaderboard',
    category: 'team',
    description: 'Multi-rep account, manager rollups, leaderboards, shared goals, role-based visibility.',
    sales_blurb: 'For managers running 2+ reps.',
    whats_included: [
      'Multi-member account (owner / manager / rep roles)',
      'Per-rep dashboards + private rooms',
      'Account-wide goals + leaderboards',
      'Manager rollup view of every rep\'s pipeline',
    ],
    monthly_price_cents: 4000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 300,
    public: true,
    build_fee_tier: 'medium',
  },

  // ── WHITE LABEL ──────────────────────────────────────────────────────
  addon_white_label: {
    key: 'addon_white_label',
    label: 'White label',
    category: 'branding',
    description: 'Your domain, your branding, your team never sees ours.',
    sales_blurb: 'Run it on your URL with your logo.',
    whats_included: [
      'Custom domain (yourcompany.com)',
      'Your logo + brand colors throughout',
      'Branded email senders',
      'Removed VirtualCloser footer attribution',
    ],
    monthly_price_cents: 15000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 800, // domain SSL + email warmup amortized
    public: true,
    build_fee_tier: 'large',
  },

  // ── BLUEBUBBLES (iMessage relay) ─────────────────────────────────────
  addon_bluebubbles: {
    key: 'addon_bluebubbles',
    label: 'iMessage relay (BlueBubbles)',
    category: 'messaging',
    description: 'Send/receive iMessage from inside Virtual Closer. Drafts in your voice, you approve, it sends from your number.',
    sales_blurb: 'Close on iMessage without losing the thread.',
    whats_included: [
      'iMessage send + receive on your Mac\'s number',
      'AI-drafted replies, you approve before send',
      'Inbound messages routed to the right lead',
    ],
    monthly_price_cents: 8000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 200,
    public: true,
    build_fee_tier: 'small',
  },

  // ── FATHOM call intelligence ─────────────────────────────────────────
  addon_fathom: {
    key: 'addon_fathom',
    label: 'Fathom call intelligence',
    category: 'analytics',
    description: 'Your Fathom recordings + transcripts auto-imported, action items extracted, deals updated.',
    sales_blurb: 'Already using Fathom? Pipe it in.',
    whats_included: [
      'Inbound webhook for every recorded call',
      'Action items extracted to brain dump',
      'Deal stage suggestions based on call content',
    ],
    monthly_price_cents: 3000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 200,
    public: true,
    build_fee_tier: 'small',
  },
}

// ─────────────────────────────────────────────────────────────────────────
// Cart pricing
// ─────────────────────────────────────────────────────────────────────────

export type CartLineItem = {
  key: AddonKey
  label: string
  monthly_price_cents: number
  cap_value: number | null
  cap_unit: CapUnit
  our_cost_at_cap_cents: number
  margin_pct: number
}

export type CartPricing = {
  monthly_cents: number
  our_cost_at_full_cap_cents: number
  blended_margin_pct: number
  line_items: CartLineItem[]
  warnings: string[]
}

export function priceCart(keys: AddonKey[]): CartPricing {
  // Always include base_build
  const set = new Set<AddonKey>(keys)
  set.add('base_build')

  const warnings: string[] = []

  // Validate exclusions
  for (const k of set) {
    const def = ADDON_CATALOG[k]
    if (!def) continue
    for (const ex of def.excludes ?? []) {
      if (set.has(ex)) {
        warnings.push(`${def.label} can't be combined with ${ADDON_CATALOG[ex].label} — pick one.`)
      }
    }
    for (const req of def.requires ?? []) {
      if (!set.has(req)) {
        warnings.push(`${def.label} requires ${ADDON_CATALOG[req].label}.`)
      }
    }
  }

  const line_items: CartLineItem[] = []
  let monthly_cents = 0
  let our_cost_at_cap_cents = 0

  for (const k of set) {
    const def = ADDON_CATALOG[k]
    if (!def) continue
    const margin =
      def.monthly_price_cents > 0
        ? (def.monthly_price_cents - def.our_cost_at_cap_cents) / def.monthly_price_cents
        : 0
    line_items.push({
      key: def.key,
      label: def.label,
      monthly_price_cents: def.monthly_price_cents,
      cap_value: def.cap_value,
      cap_unit: def.cap_unit,
      our_cost_at_cap_cents: def.our_cost_at_cap_cents,
      margin_pct: margin,
    })
    monthly_cents += def.monthly_price_cents
    our_cost_at_cap_cents += def.our_cost_at_cap_cents
  }

  const blended_margin_pct =
    monthly_cents > 0 ? (monthly_cents - our_cost_at_cap_cents) / monthly_cents : 0

  return {
    monthly_cents,
    our_cost_at_full_cap_cents: our_cost_at_cap_cents,
    blended_margin_pct,
    line_items,
    warnings,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Margin floor — runs at module load. Throws if any usage-priced add-on
// would deliver less than 30% gross margin at full cap utilization.
// Unlimited / pass-through add-ons are exempt (they have no real per-unit
// vendor cost). base_build is exempt (its $99/mo includes a fixed compute
// budget, no usage cap).
// ─────────────────────────────────────────────────────────────────────────

const MARGIN_FLOOR = 0.3

// Pass-through / unlimited add-ons (no real per-unit vendor cost) and the
// base build are exempt from the per-add-on margin floor — they're priced
// for engineering+support time, not per-call vendor cost.
const MARGIN_EXEMPT_KEYS: AddonKey[] = [
  'base_build',
  'addon_ghl_crm',
  'addon_hubspot_crm',
  'addon_pipedrive_crm',
  'addon_salesforce_crm',
  'addon_wavv_kpi',
  'addon_team_leaderboard',
  'addon_white_label',
  'addon_bluebubbles',
  'addon_fathom',
]

export function assertMarginFloor(floor: number = MARGIN_FLOOR): void {
  const violations: string[] = []
  for (const def of Object.values(ADDON_CATALOG)) {
    if (MARGIN_EXEMPT_KEYS.includes(def.key)) continue
    if (def.monthly_price_cents <= 0) continue
    const margin = (def.monthly_price_cents - def.our_cost_at_cap_cents) / def.monthly_price_cents
    if (margin < floor) {
      const pct = (margin * 100).toFixed(1)
      violations.push(
        `[addons] ${def.key} margin ${pct}% < floor ${(floor * 100).toFixed(0)}% ` +
          `(price ${def.monthly_price_cents}¢, cost ${def.our_cost_at_cap_cents}¢ at cap ${def.cap_value} ${def.cap_unit})`,
      )
    }
  }
  if (violations.length > 0) {
    throw new Error('Add-on margin floor violation:\n' + violations.join('\n'))
  }
}

// Run at load — fail fast on pricing drift.
assertMarginFloor()

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

export function formatPriceCents(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`
  return `$${(cents / 100).toFixed(2)}`
}

export function formatCap(def: AddonDef): string | null {
  if (def.cap_unit === 'unlimited' || def.cap_value === null) return null
  switch (def.cap_unit) {
    case 'appts_confirmed':
      return `${def.cap_value} confirmed appts / month`
    case 'roleplay_minutes':
      return `${def.cap_value} minutes / month (org-wide pool)`
    case 'wavv_dials':
      return `${def.cap_value} dials / month`
    default:
      return null
  }
}

export function publicAddons(): AddonDef[] {
  return Object.values(ADDON_CATALOG).filter((d) => d.public && d.key !== 'base_build')
}

export function getAddon(key: AddonKey | string): AddonDef | null {
  return (ADDON_CATALOG as Record<string, AddonDef>)[key] ?? null
}
