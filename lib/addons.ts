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
  // Deprecated fixed-price dialers — no longer public, kept for existing client_addons rows
  | 'addon_dialer_lite'
  | 'addon_dialer_pro'
  // Deprecated SDR keys (old 10hr-increment naming) — kept for backward compat
  | 'addon_ai_dialer_20h'
  | 'addon_ai_dialer_30h'
  | 'addon_ai_dialer_40h'
  | 'addon_ai_dialer_50h'
  | 'addon_ai_dialer_60h'
  | 'addon_ai_dialer_70h'
  | 'addon_ai_dialer_80h'
  // AI SDR — hourly, 5hr increments, 5–80 hrs/wk
  | 'addon_ai_sdr_5h'
  | 'addon_ai_sdr_10h'
  | 'addon_ai_sdr_15h'
  | 'addon_ai_sdr_20h'
  | 'addon_ai_sdr_25h'
  | 'addon_ai_sdr_30h'
  | 'addon_ai_sdr_35h'
  | 'addon_ai_sdr_40h'
  | 'addon_ai_sdr_45h'
  | 'addon_ai_sdr_50h'
  | 'addon_ai_sdr_55h'
  | 'addon_ai_sdr_60h'
  | 'addon_ai_sdr_65h'
  | 'addon_ai_sdr_70h'
  | 'addon_ai_sdr_75h'
  | 'addon_ai_sdr_80h'
  // AI Trainer — hourly, 5hr increments
  | 'addon_ai_trainer_5h'
  | 'addon_ai_trainer_10h'
  | 'addon_ai_trainer_15h'
  | 'addon_ai_trainer_20h'
  | 'addon_ai_trainer_25h'
  | 'addon_ai_trainer_30h'
  | 'addon_roleplay_lite'
  | 'addon_roleplay_pro'
  | 'addon_wavv_kpi'
  | 'addon_team_leaderboard'
  | 'addon_white_label'
  | 'addon_bluebubbles'
  | 'addon_fathom'
  // Deprecated flat-rate receptionist — no longer public, kept for existing client_addons rows
  | 'addon_ai_receptionist'
  // AI Receptionist — hourly, 5hr increments, 5–80 hrs/wk
  | 'addon_ai_receptionist_5h'
  | 'addon_ai_receptionist_10h'
  | 'addon_ai_receptionist_15h'
  | 'addon_ai_receptionist_20h'
  | 'addon_ai_receptionist_25h'
  | 'addon_ai_receptionist_30h'
  | 'addon_ai_receptionist_35h'
  | 'addon_ai_receptionist_40h'
  | 'addon_ai_receptionist_45h'
  | 'addon_ai_receptionist_50h'
  | 'addon_ai_receptionist_55h'
  | 'addon_ai_receptionist_60h'
  | 'addon_ai_receptionist_65h'
  | 'addon_ai_receptionist_70h'
  | 'addon_ai_receptionist_75h'
  | 'addon_ai_receptionist_80h'
  // addon_ai_sms_* keys added here once pricing is set

export type AddonCategory =
  | 'base'
  | 'crm'
  | 'sdr'           // AI SDR (outbound prospecting, appointment setting)
  | 'receptionist'  // AI Receptionist (operational calls, chargebacks, confirmations)
  | 'voice_training'
  | 'analytics'
  | 'team'
  | 'branding'
  | 'messaging'

export type CapUnit =
  | 'unlimited'
  | 'appts_confirmed'
  | 'roleplay_minutes'
  | 'wavv_dials'
  | 'hours_per_week'
  | 'sms_per_month'

// ── SDR hour packages (5hr increments, 5–80 hrs/wk) ──────────────────────
// Includes new addon_ai_sdr_* keys AND deprecated addon_ai_dialer_* for
// backward compat with existing client_addons rows. Used by entitlements.ts
// and admin client pages to locate active SDR addon rows.
export const HOUR_PACKAGE_KEYS = [
  'addon_ai_sdr_5h',  'addon_ai_sdr_10h', 'addon_ai_sdr_15h', 'addon_ai_sdr_20h',
  'addon_ai_sdr_25h', 'addon_ai_sdr_30h', 'addon_ai_sdr_35h', 'addon_ai_sdr_40h',
  'addon_ai_sdr_45h', 'addon_ai_sdr_50h', 'addon_ai_sdr_55h', 'addon_ai_sdr_60h',
  'addon_ai_sdr_65h', 'addon_ai_sdr_70h', 'addon_ai_sdr_75h', 'addon_ai_sdr_80h',
  // Deprecated — kept so existing client_addons rows still resolve
  'addon_ai_dialer_20h', 'addon_ai_dialer_30h', 'addon_ai_dialer_40h',
  'addon_ai_dialer_50h', 'addon_ai_dialer_60h', 'addon_ai_dialer_70h', 'addon_ai_dialer_80h',
] as const

// ── Receptionist hour packages (5hr increments, 5–80 hrs/wk) ─────────────
export const RECEPTIONIST_PACKAGE_KEYS = [
  'addon_ai_receptionist_5h',  'addon_ai_receptionist_10h', 'addon_ai_receptionist_15h',
  'addon_ai_receptionist_20h', 'addon_ai_receptionist_25h', 'addon_ai_receptionist_30h',
  'addon_ai_receptionist_35h', 'addon_ai_receptionist_40h', 'addon_ai_receptionist_45h',
  'addon_ai_receptionist_50h', 'addon_ai_receptionist_55h', 'addon_ai_receptionist_60h',
  'addon_ai_receptionist_65h', 'addon_ai_receptionist_70h', 'addon_ai_receptionist_75h',
  'addon_ai_receptionist_80h',
] as const

// ── Trainer hour packages (5hr increments) ───────────────────────────────
export const TRAINER_PACKAGE_KEYS = [
  'addon_ai_trainer_5h',
  'addon_ai_trainer_10h',
  'addon_ai_trainer_15h',
  'addon_ai_trainer_20h',
  'addon_ai_trainer_25h',
  'addon_ai_trainer_30h',
] as const

// ── AI SMS monthly message tiers ─────────────────────────────────────────
export const SMS_PACKAGE_KEYS = [
  'addon_ai_sms_500',
  'addon_ai_sms_1000',
  'addon_ai_sms_2000',
  'addon_ai_sms_3000',
  'addon_ai_sms_5000',
] as const

export type SmsPackageKey = (typeof SMS_PACKAGE_KEYS)[number]

export function isSmsPackage(key: string): key is SmsPackageKey {
  return (SMS_PACKAGE_KEYS as readonly string[]).includes(key)
}

export type HourPackageKey        = (typeof HOUR_PACKAGE_KEYS)[number]
export type ReceptionistPackageKey = (typeof RECEPTIONIST_PACKAGE_KEYS)[number]
export type TrainerPackageKey     = (typeof TRAINER_PACKAGE_KEYS)[number]

export function isHourPackage(key: string): key is HourPackageKey {
  return (HOUR_PACKAGE_KEYS as readonly string[]).includes(key)
}
export function isReceptionistPackage(key: string): key is ReceptionistPackageKey {
  return (RECEPTIONIST_PACKAGE_KEYS as readonly string[]).includes(key)
}
export function isTrainerPackage(key: string): key is TrainerPackageKey {
  return (TRAINER_PACKAGE_KEYS as readonly string[]).includes(key)
}

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
  our_cost_at_cap_cents: number
  our_cost_per_unit_cents?: number
  requires?: AddonKey[]
  excludes?: AddonKey[]
  public: boolean
  build_fee_tier: 'none' | 'small' | 'medium' | 'large'
}

// ─────────────────────────────────────────────────────────────────────────
// Hour-package helper
// ─────────────────────────────────────────────────────────────────────────
// All SDR / Receptionist / Trainer hour packages share the same $/hr model:
//   monthly_price_cents = h × 4.3 weeks × $6.00/hr  (individual t1 rate)
//   our_cost_at_cap_cents = h × 4.3 weeks × $3.30/hr (RevRing + Twilio + overhead)
//   margin at cap = 45% for every package at every hour count.

const SDR_STEPS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80] as const
const TRAINER_STEPS = [5, 10, 15, 20, 25, 30] as const

function makeHourPkg(
  keyBase: string,
  h: number,
  category: AddonCategory,
  allH: readonly number[],
  sectionLabel: string,
  salesBlurb: string,
  buildFeeTier: 'small' | 'medium' | 'large' = 'medium',
): AddonDef {
  const key = `${keyBase}_${h}h` as AddonKey
  const hrsMo = (h * 4.3).toFixed(0)
  return {
    key,
    label: `${h} hrs/wk`,
    category,
    description: `${sectionLabel} · ${h} active hours per week.`,
    sales_blurb: salesBlurb,
    whats_included: [
      `${h} hours/week of active dialer time (resets every Monday)`,
      'Allocate hours across call modes via the shift scheduler',
      'Real-time hour-usage gauge in the dashboard',
      `~${hrsMo} hrs/month at $6/hr`,
    ],
    monthly_price_cents: Math.round(h * 4.3 * 600),   // h × 4.3 × $6
    cap_unit: 'hours_per_week',
    cap_value: h,
    our_cost_at_cap_cents: Math.round(h * 4.3 * 330), // h × 4.3 × $3.30
    our_cost_per_unit_cents: 330,
    excludes: allH.filter((x) => x !== h).map((x) => `${keyBase}_${x}h` as AddonKey),
    public: true,
    build_fee_tier: buildFeeTier,
  }
}

const SDR_BLURBS: Record<number, string> = {
  5:  '5 hrs/week — light SDR presence.',
  10: '10 hrs/week — consistent daily outreach.',
  15: '15 hrs/week — solid part-time SDR block.',
  20: '20 hrs/week — your SDR clocks in 20 hours, you decide what they work on.',
  25: '25 hrs/week — above part-time, serious volume.',
  30: '30 hrs/week — between part-time and full.',
  35: '35 hrs/week — nearly full-time output.',
  40: '40 hrs/week — a full-time AI SDR.',
  45: '45 hrs/week — above full-time, real power dialing.',
  50: '50 hrs/week — beats a human SDR on volume and never gets tired.',
  55: '55 hrs/week — covers all peak calling hours across time zones.',
  60: '60 hrs/week — replaces 1.5 humans for less than one salary.',
  65: '65 hrs/week — equivalent to a full SDR team.',
  70: '70 hrs/week — covers both daytime + early evening prospecting blocks.',
  75: '75 hrs/week — runs around the clock.',
  80: '80 hrs/week — equivalent capacity of two full-time human SDRs, never sleeps.',
}

const RECEPTIONIST_BLURBS: Record<number, string> = {
  5:  '5 hrs/week — handles must-do confirmations and follow-ups.',
  10: '10 hrs/week — reliable daily operational coverage.',
  15: '15 hrs/week — part-time operational presence.',
  20: '20 hrs/week — dedicated ops block, works your book of business.',
  25: '25 hrs/week — above part-time operational coverage.',
  30: '30 hrs/week — strong ongoing retention and ops calls.',
  35: '35 hrs/week — nearly full-time operational coverage.',
  40: '40 hrs/week — full-time AI handling your book of business.',
  45: '45 hrs/week — intensive coverage across multiple time zones.',
  50: '50 hrs/week — replaces a full-time VA for operational calls.',
  55: '55 hrs/week — covers all operational calling hours.',
  60: '60 hrs/week — eliminates the need for a dedicated ops VA.',
  65: '65 hrs/week — equivalent to a full ops team.',
  70: '70 hrs/week — full daytime + evening operational coverage.',
  75: '75 hrs/week — around-the-clock operational calling.',
  80: '80 hrs/week — equivalent capacity of two full-time VAs, never sleeps.',
}

const TRAINER_BLURBS: Record<number, string> = {
  5:  '5 hrs/week — your reps practice between calls without thinking about it.',
  10: '10 hrs/week — daily practice baked into the routine.',
  15: '15 hrs/week — 2+ hours daily coaching.',
  20: '20 hrs/week — onboarding or ramp-up speed.',
  25: '25 hrs/week — intensive team coaching.',
  30: '30 hrs/week — for teams running a constant coaching loop.',
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
    our_cost_at_cap_cents: 1500,
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
    our_cost_at_cap_cents: 200,
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

  // ── DEPRECATED: fixed-price dialers ──────────────────────────────────
  // Replaced by addon_ai_sdr_*h hourly packages. Kept so existing
  // client_addons rows referencing these keys still resolve.
  addon_dialer_lite: {
    key: 'addon_dialer_lite',
    label: 'AI dialer (legacy)',
    category: 'sdr',
    description: 'Legacy fixed-price dialer — replaced by AI SDR hourly packages.',
    sales_blurb: 'Up to 100 confirmed appointments / month.',
    whats_included: [
      'Outbound confirmation calls 30–60 min before each meeting',
      'Real-time rescheduling on the call (DTMF + voice)',
      'CRM tag stamping on every outcome',
      'Recording + transcript on every call',
      'Cap: 100 confirmed appointments / month',
    ],
    monthly_price_cents: 5000,
    cap_unit: 'appts_confirmed',
    cap_value: 100,
    our_cost_at_cap_cents: 2200,
    our_cost_per_unit_cents: 20,
    excludes: ['addon_dialer_pro'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_dialer_pro: {
    key: 'addon_dialer_pro',
    label: 'AI dialer · Pro (legacy)',
    category: 'sdr',
    description: 'Legacy fixed-price dialer — replaced by AI SDR hourly packages.',
    sales_blurb: 'Up to 300 confirmed appointments / month.',
    whats_included: [
      'Everything in AI dialer Lite',
      'Cap: 300 confirmed appointments / month',
      'Priority support on dialer issues',
    ],
    monthly_price_cents: 9000,
    cap_unit: 'appts_confirmed',
    cap_value: 300,
    our_cost_at_cap_cents: 6200,
    our_cost_per_unit_cents: 20,
    excludes: ['addon_dialer_lite'],
    public: false,
    build_fee_tier: 'medium',
  },

  // ── DEPRECATED: old SDR 10hr-increment keys ───────────────────────────
  // Replaced by addon_ai_sdr_*h (5hr increments). Kept for backward compat.
  addon_ai_dialer_20h: {
    key: 'addon_ai_dialer_20h',
    label: 'AI SDR · 20 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_20h.',
    sales_blurb: '20 hrs/week — your SDR clocks in 20 hours, you decide what they work on.',
    whats_included: ['20 hours/week of dialer-active time', '~86 hrs/month at $6/hr'],
    monthly_price_cents: 51600,
    cap_unit: 'hours_per_week',
    cap_value: 20,
    our_cost_at_cap_cents: 28380,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_30h', 'addon_ai_dialer_40h', 'addon_ai_dialer_50h', 'addon_ai_dialer_60h', 'addon_ai_dialer_70h', 'addon_ai_dialer_80h'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_ai_dialer_30h: {
    key: 'addon_ai_dialer_30h',
    label: 'AI SDR · 30 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_30h.',
    sales_blurb: '30 hrs/week — between part-time and full.',
    whats_included: ['30 hours/week of dialer-active time', '~129 hrs/month at $6/hr'],
    monthly_price_cents: 77400,
    cap_unit: 'hours_per_week',
    cap_value: 30,
    our_cost_at_cap_cents: 42570,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_20h', 'addon_ai_dialer_40h', 'addon_ai_dialer_50h', 'addon_ai_dialer_60h', 'addon_ai_dialer_70h', 'addon_ai_dialer_80h'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_ai_dialer_40h: {
    key: 'addon_ai_dialer_40h',
    label: 'AI SDR · 40 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_40h.',
    sales_blurb: '40 hrs/week — a full-time AI SDR.',
    whats_included: ['40 hours/week of dialer-active time', '~172 hrs/month at $6/hr'],
    monthly_price_cents: 103200,
    cap_unit: 'hours_per_week',
    cap_value: 40,
    our_cost_at_cap_cents: 56760,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_20h', 'addon_ai_dialer_30h', 'addon_ai_dialer_50h', 'addon_ai_dialer_60h', 'addon_ai_dialer_70h', 'addon_ai_dialer_80h'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_ai_dialer_50h: {
    key: 'addon_ai_dialer_50h',
    label: 'AI SDR · 50 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_50h.',
    sales_blurb: '50 hrs/week — beats a human SDR on volume and never gets tired.',
    whats_included: ['50 hours/week of dialer-active time', '~215 hrs/month at $6/hr'],
    monthly_price_cents: 129000,
    cap_unit: 'hours_per_week',
    cap_value: 50,
    our_cost_at_cap_cents: 70950,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_20h', 'addon_ai_dialer_30h', 'addon_ai_dialer_40h', 'addon_ai_dialer_60h', 'addon_ai_dialer_70h', 'addon_ai_dialer_80h'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_ai_dialer_60h: {
    key: 'addon_ai_dialer_60h',
    label: 'AI SDR · 60 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_60h.',
    sales_blurb: '60 hrs/week — replaces 1.5 humans for less than one salary.',
    whats_included: ['60 hours/week of dialer-active time', '~258 hrs/month at $6/hr'],
    monthly_price_cents: 154800,
    cap_unit: 'hours_per_week',
    cap_value: 60,
    our_cost_at_cap_cents: 85140,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_20h', 'addon_ai_dialer_30h', 'addon_ai_dialer_40h', 'addon_ai_dialer_50h', 'addon_ai_dialer_70h', 'addon_ai_dialer_80h'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_ai_dialer_70h: {
    key: 'addon_ai_dialer_70h',
    label: 'AI SDR · 70 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_70h.',
    sales_blurb: '70 hrs/week — covers both daytime + early evening prospecting blocks.',
    whats_included: ['70 hours/week of dialer-active time', '~301 hrs/month at $6/hr'],
    monthly_price_cents: 180600,
    cap_unit: 'hours_per_week',
    cap_value: 70,
    our_cost_at_cap_cents: 99330,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_20h', 'addon_ai_dialer_30h', 'addon_ai_dialer_40h', 'addon_ai_dialer_50h', 'addon_ai_dialer_60h', 'addon_ai_dialer_80h'],
    public: false,
    build_fee_tier: 'medium',
  },

  addon_ai_dialer_80h: {
    key: 'addon_ai_dialer_80h',
    label: 'AI SDR · 80 hrs/wk (legacy)',
    category: 'sdr',
    description: 'Deprecated — use addon_ai_sdr_80h.',
    sales_blurb: '80 hrs/week — equivalent capacity of two full-time human SDRs, never sleeps.',
    whats_included: ['80 hours/week of dialer-active time', '~344 hrs/month at $6/hr'],
    monthly_price_cents: 206400,
    cap_unit: 'hours_per_week',
    cap_value: 80,
    our_cost_at_cap_cents: 113520,
    our_cost_per_unit_cents: 330,
    excludes: ['addon_ai_dialer_20h', 'addon_ai_dialer_30h', 'addon_ai_dialer_40h', 'addon_ai_dialer_50h', 'addon_ai_dialer_60h', 'addon_ai_dialer_70h'],
    public: false,
    build_fee_tier: 'medium',
  },

  // ── AI SDR · hourly, 5hr increments ──────────────────────────────────
  // Outbound prospecting, appointment setting, live-transfer dialing.
  // Sold like a human SDR's working hours: $6/hr individual (volume tiers
  // for enterprise). Monthly hours = hrs/wk × 4.3 weeks. Cost basis is
  // $3.30/hr (RevRing + Twilio + overhead). Cap is wall-clock
  // dialer-active seconds per ISO week. Mutually exclusive within family.
  addon_ai_sdr_5h:  makeHourPkg('addon_ai_sdr',  5,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[5]),
  addon_ai_sdr_10h: makeHourPkg('addon_ai_sdr', 10,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[10]),
  addon_ai_sdr_15h: makeHourPkg('addon_ai_sdr', 15,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[15]),
  addon_ai_sdr_20h: makeHourPkg('addon_ai_sdr', 20,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[20]),
  addon_ai_sdr_25h: makeHourPkg('addon_ai_sdr', 25,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[25]),
  addon_ai_sdr_30h: makeHourPkg('addon_ai_sdr', 30,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[30]),
  addon_ai_sdr_35h: makeHourPkg('addon_ai_sdr', 35,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[35]),
  addon_ai_sdr_40h: makeHourPkg('addon_ai_sdr', 40,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[40]),
  addon_ai_sdr_45h: makeHourPkg('addon_ai_sdr', 45,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[45]),
  addon_ai_sdr_50h: makeHourPkg('addon_ai_sdr', 50,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[50]),
  addon_ai_sdr_55h: makeHourPkg('addon_ai_sdr', 55,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[55]),
  addon_ai_sdr_60h: makeHourPkg('addon_ai_sdr', 60,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[60]),
  addon_ai_sdr_65h: makeHourPkg('addon_ai_sdr', 65,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[65]),
  addon_ai_sdr_70h: makeHourPkg('addon_ai_sdr', 70,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[70]),
  addon_ai_sdr_75h: makeHourPkg('addon_ai_sdr', 75,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[75]),
  addon_ai_sdr_80h: makeHourPkg('addon_ai_sdr', 80,  'sdr', SDR_STEPS, 'AI SDR', SDR_BLURBS[80]),

  // ── AI TRAINER · hourly, 5hr increments ──────────────────────────────
  // Roleplay coaching. Same $/hr tiers as SDR. Mutually exclusive within
  // trainer family. NOT mutually exclusive with SDR or Receptionist.
  addon_ai_trainer_5h:  makeHourPkg('addon_ai_trainer',  5, 'voice_training', TRAINER_STEPS, 'AI Trainer', TRAINER_BLURBS[5],  'small'),
  addon_ai_trainer_10h: makeHourPkg('addon_ai_trainer', 10, 'voice_training', TRAINER_STEPS, 'AI Trainer', TRAINER_BLURBS[10], 'small'),
  addon_ai_trainer_15h: makeHourPkg('addon_ai_trainer', 15, 'voice_training', TRAINER_STEPS, 'AI Trainer', TRAINER_BLURBS[15], 'small'),
  addon_ai_trainer_20h: makeHourPkg('addon_ai_trainer', 20, 'voice_training', TRAINER_STEPS, 'AI Trainer', TRAINER_BLURBS[20], 'small'),
  addon_ai_trainer_25h: makeHourPkg('addon_ai_trainer', 25, 'voice_training', TRAINER_STEPS, 'AI Trainer', TRAINER_BLURBS[25], 'small'),
  addon_ai_trainer_30h: makeHourPkg('addon_ai_trainer', 30, 'voice_training', TRAINER_STEPS, 'AI Trainer', TRAINER_BLURBS[30], 'small'),

  // ── ROLEPLAY · LEGACY (Vapi, ORG-WIDE pool) ──────────────────────────
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
    our_cost_at_cap_cents: 800,
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

  // ── DEPRECATED: flat-rate receptionist ───────────────────────────────
  // Replaced by addon_ai_receptionist_*h hourly packages.
  addon_ai_receptionist: {
    key: 'addon_ai_receptionist',
    label: 'AI Receptionist (legacy)',
    category: 'receptionist',
    description: 'Deprecated flat-rate receptionist — replaced by hourly packages.',
    sales_blurb: 'Never have a no-show again.',
    whats_included: [
      'Outbound confirmation call 30–60 min before every appointment',
      'Auto-reschedule if prospect can\'t make it',
      'Syncs with Google Calendar',
    ],
    monthly_price_cents: 5000,
    cap_unit: 'unlimited',
    cap_value: null,
    our_cost_at_cap_cents: 1000,
    public: false,
    build_fee_tier: 'small',
  },

  // ── AI RECEPTIONIST · hourly, 5hr increments ─────────────────────────
  // Operational outbound: appointment confirmations, chargeback follow-ups,
  // missed-payment calls, rescheduling, book-of-business management.
  // Same $/hr pricing as SDR. NOT mutually exclusive with SDR or Trainer.
  addon_ai_receptionist_5h:  makeHourPkg('addon_ai_receptionist',  5,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[5],  'small'),
  addon_ai_receptionist_10h: makeHourPkg('addon_ai_receptionist', 10,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[10], 'small'),
  addon_ai_receptionist_15h: makeHourPkg('addon_ai_receptionist', 15,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[15], 'small'),
  addon_ai_receptionist_20h: makeHourPkg('addon_ai_receptionist', 20,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[20], 'small'),
  addon_ai_receptionist_25h: makeHourPkg('addon_ai_receptionist', 25,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[25], 'small'),
  addon_ai_receptionist_30h: makeHourPkg('addon_ai_receptionist', 30,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[30], 'small'),
  addon_ai_receptionist_35h: makeHourPkg('addon_ai_receptionist', 35,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[35], 'small'),
  addon_ai_receptionist_40h: makeHourPkg('addon_ai_receptionist', 40,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[40], 'small'),
  addon_ai_receptionist_45h: makeHourPkg('addon_ai_receptionist', 45,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[45], 'small'),
  addon_ai_receptionist_50h: makeHourPkg('addon_ai_receptionist', 50,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[50], 'small'),
  addon_ai_receptionist_55h: makeHourPkg('addon_ai_receptionist', 55,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[55], 'small'),
  addon_ai_receptionist_60h: makeHourPkg('addon_ai_receptionist', 60,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[60], 'small'),
  addon_ai_receptionist_65h: makeHourPkg('addon_ai_receptionist', 65,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[65], 'small'),
  addon_ai_receptionist_70h: makeHourPkg('addon_ai_receptionist', 70,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[70], 'small'),
  addon_ai_receptionist_75h: makeHourPkg('addon_ai_receptionist', 75,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[75], 'small'),
  addon_ai_receptionist_80h: makeHourPkg('addon_ai_receptionist', 80,  'receptionist', SDR_STEPS, 'AI Receptionist', RECEPTIONIST_BLURBS[80], 'small'),
  // addon_ai_sms_* tiers go here once pricing is decided.
  // Keys are reserved in AddonKey; SMS_PACKAGE_KEYS + isSmsPackage() are ready.
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
  // Deprecated flat entries are exempt — priced before the floor rule existed
  'addon_ai_receptionist',
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
    case 'sms_per_month':
      return `${def.cap_value?.toLocaleString()} AI SMS / month`
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
