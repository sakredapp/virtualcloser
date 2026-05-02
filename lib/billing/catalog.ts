// Virtual Closer Stripe price catalog.
//
// Single source of truth for every Product + Price the offer page,
// dashboard, and admin tools sell. The bootstrap script in
// scripts/stripe-bootstrap.ts reads this file and provisions matching
// objects in Stripe; runtime code reads stripe_object_ids.json (written
// by the bootstrap script) to resolve names -> Stripe IDs.
//
// Design rules:
//   - WEEKLY billing cycle for everything. interval: 'week', anchor Monday.
//     Cash collected upfront every Monday.
//   - Hour packs are PER-UNIT pricing — one Price per volume tier, qty on
//     the subscription item == hours/week. No SKU explosion.
//   - Overage = a separate metered Price subscription item, only attached
//     when the customer toggles overflow on. When off, dialer hard-stops.
//   - 1-hour buffer per pack is enforced in the shift-assignment UI, not
//     in Stripe (Stripe just bills the pack).
//   - All cents values are USD. Pricing changes here = re-run bootstrap
//     script which patches Prices in place (Stripe Prices are immutable
//     so we archive + create; the script handles that).

export type Tier = 't1' | 't2' | 't3' | 't4' | 't5'

export type CatalogTier = {
  key: Tier
  // Volume tier rate $/hr (same rate is used for SDR + Trainer).
  pricePerHourCents: number
  // Customer-facing label.
  label: string
  // Org seat-count threshold (lower bound, inclusive). t1 starts at 1.
  minReps: number
}

export const VOLUME_TIERS: CatalogTier[] = [
  { key: 't1', pricePerHourCents: 600, label: '1–5 reps',     minReps: 1 },
  { key: 't2', pricePerHourCents: 550, label: '6–25 reps',    minReps: 6 },
  { key: 't3', pricePerHourCents: 500, label: '26–50 reps',   minReps: 26 },
  { key: 't4', pricePerHourCents: 450, label: '51–100 reps',  minReps: 51 },
  { key: 't5', pricePerHourCents: 415, label: '100+ reps',    minReps: 101 },
]

export function tierForRepCount(repCount: number): CatalogTier {
  let chosen = VOLUME_TIERS[0]
  for (const t of VOLUME_TIERS) if (repCount >= t.minReps) chosen = t
  return chosen
}

// ── Catalog entry shape ─────────────────────────────────────────────────
//
// Each entry corresponds to ONE Stripe Product + ONE or more Prices.
// `key` is the stable internal name we use in code. `priceKey` (on Price
// entries) is how we look up the Stripe Price ID at runtime.

export type CatalogProductKind =
  | 'flat_weekly'        // single weekly recurring Price, qty=1
  | 'per_unit_weekly'    // weekly recurring Price, qty=hours
  | 'metered_weekly'     // weekly metered overage Price, qty pushed via usage records
  | 'one_time'           // one-off invoice item (setup fees)

export type CatalogPrice = {
  // Stable lookup key — what runtime code asks for.
  priceKey: string
  // Stripe nickname (UI-only label inside Stripe dashboard).
  nickname: string
  unitAmountCents: number
  // Only set when product kind is metered or per-unit and we want a tier
  // attached. Lets us swap to a different tier's overage Price when the
  // customer's seat count crosses a threshold.
  tier?: Tier
}

export type CatalogProduct = {
  productKey: string
  name: string
  description: string
  kind: CatalogProductKind
  // For 'metered_weekly' the Price is treated as `usage_type: 'metered'`.
  prices: CatalogPrice[]
  // Free-form metadata copied to Stripe Product.metadata so it's queryable.
  metadata?: Record<string, string>
}

// ── BASE BUILD ──────────────────────────────────────────────────────────
// Foundation subscription, every account pays this. $99/mo -> $25/wk.
const BASE_BUILD: CatalogProduct = {
  productKey: 'vc_base_build',
  name: 'Base Build',
  description: 'Virtual Closer foundation — subdomain, dashboard, integrations, support.',
  kind: 'flat_weekly',
  prices: [
    { priceKey: 'vc_base_build_weekly', nickname: 'Base Build · weekly', unitAmountCents: 2500 },
  ],
  metadata: { vc_kind: 'base' },
}

// ── HOUR PACK PRICES (SDR + TRAINER) ────────────────────────────────────
// One Price per volume tier. Subscription item quantity == hours/week.
// e.g. tier t1 ($6/hr) with qty=20 -> $120/week billed to the customer.
function hourPriceForEachTier(prefix: 'sdr' | 'trainer'): CatalogPrice[] {
  return VOLUME_TIERS.map((t) => ({
    priceKey: `vc_${prefix}_hours_${t.key}`,
    nickname: `${prefix === 'sdr' ? 'AI SDR' : 'AI Trainer'} hours · ${t.label} · $${(t.pricePerHourCents / 100).toFixed(2)}/hr · weekly`,
    unitAmountCents: t.pricePerHourCents,
    tier: t.key,
  }))
}

const SDR_HOURS: CatalogProduct = {
  productKey: 'vc_sdr_hours',
  name: 'AI SDR Hours',
  description: 'Outbound dialer hours per week. Quantity on the subscription item = hours allotted.',
  kind: 'per_unit_weekly',
  prices: hourPriceForEachTier('sdr'),
  metadata: { vc_kind: 'sdr_hours' },
}

const TRAINER_HOURS: CatalogProduct = {
  productKey: 'vc_trainer_hours',
  name: 'AI Trainer Hours',
  description: 'Roleplay coaching hours per week. Quantity = hours allotted.',
  kind: 'per_unit_weekly',
  prices: hourPriceForEachTier('trainer'),
  metadata: { vc_kind: 'trainer_hours' },
}

// ── OVERAGE (METERED, OPT-IN) ───────────────────────────────────────────
// Only added to the subscription when the customer toggles overflow ON.
// Charged at end of the weekly cycle based on usage records pushed by the
// Monday rollover cron. Same $/hr as the pack itself for the customer's
// volume tier (we update the subscription item's Price when the tier
// changes — see scripts/swap-overage-tier.ts).
const SDR_OVERAGE: CatalogProduct = {
  productKey: 'vc_sdr_overage',
  name: 'AI SDR Overage',
  description: 'Per-hour overage when the customer has opted into overflow billing.',
  kind: 'metered_weekly',
  prices: VOLUME_TIERS.map((t) => ({
    priceKey: `vc_sdr_overage_${t.key}`,
    nickname: `AI SDR overage · ${t.label} · $${(t.pricePerHourCents / 100).toFixed(2)}/hr · metered weekly`,
    unitAmountCents: t.pricePerHourCents,
    tier: t.key,
  })),
  metadata: { vc_kind: 'sdr_overage' },
}

const TRAINER_OVERAGE: CatalogProduct = {
  productKey: 'vc_trainer_overage',
  name: 'AI Trainer Overage',
  description: 'Per-hour overage for trainer time when overflow billing is enabled.',
  kind: 'metered_weekly',
  prices: VOLUME_TIERS.map((t) => ({
    priceKey: `vc_trainer_overage_${t.key}`,
    nickname: `AI Trainer overage · ${t.label} · $${(t.pricePerHourCents / 100).toFixed(2)}/hr · metered weekly`,
    unitAmountCents: t.pricePerHourCents,
    tier: t.key,
  })),
  metadata: { vc_kind: 'trainer_overage' },
}

// ── CRM INTEGRATIONS ────────────────────────────────────────────────────
// $40/mo originally → $10/week to keep the cycle uniform.
function crmProduct(slug: string, label: string): CatalogProduct {
  return {
    productKey: `vc_crm_${slug}`,
    name: `${label} Integration`,
    description: `Two-way sync with ${label}. Contacts, calls, notes.`,
    kind: 'flat_weekly',
    prices: [
      { priceKey: `vc_crm_${slug}_weekly`, nickname: `${label} integration · weekly`, unitAmountCents: 1000 },
    ],
    metadata: { vc_kind: 'crm', vc_crm: slug },
  }
}

const CRM_GHL       = crmProduct('ghl',       'GoHighLevel')
const CRM_HUBSPOT   = crmProduct('hubspot',   'HubSpot')
const CRM_PIPEDRIVE = crmProduct('pipedrive', 'Pipedrive')
const CRM_SALESFORCE= crmProduct('salesforce','Salesforce')

// ── DIALER + ROLEPLAY ADD-ONS ───────────────────────────────────────────
const DIALER_LITE: CatalogProduct = {
  productKey: 'vc_dialer_lite',
  name: 'Dialer · Lite',
  description: 'Click-to-dial with voicemail drop. No power dialing.',
  kind: 'flat_weekly',
  prices: [{ priceKey: 'vc_dialer_lite_weekly', nickname: 'Dialer Lite · weekly', unitAmountCents: 1000 }],
  metadata: { vc_kind: 'dialer', vc_tier: 'lite' },
}

const DIALER_PRO: CatalogProduct = {
  productKey: 'vc_dialer_pro',
  name: 'Dialer · Pro',
  description: 'Power dialer with parallel lines, local presence, and AI scoring.',
  kind: 'flat_weekly',
  prices: [{ priceKey: 'vc_dialer_pro_weekly', nickname: 'Dialer Pro · weekly', unitAmountCents: 2500 }],
  metadata: { vc_kind: 'dialer', vc_tier: 'pro' },
}

const ROLEPLAY_LITE: CatalogProduct = {
  productKey: 'vc_roleplay_lite',
  name: 'Roleplay · Lite',
  description: 'Basic AI roleplay scenarios.',
  kind: 'flat_weekly',
  prices: [{ priceKey: 'vc_roleplay_lite_weekly', nickname: 'Roleplay Lite · weekly', unitAmountCents: 750 }],
  metadata: { vc_kind: 'roleplay', vc_tier: 'lite' },
}

const ROLEPLAY_PRO: CatalogProduct = {
  productKey: 'vc_roleplay_pro',
  name: 'Roleplay · Pro',
  description: 'Advanced roleplay with custom scenarios, scoring rubrics, manager reviews.',
  kind: 'flat_weekly',
  prices: [{ priceKey: 'vc_roleplay_pro_weekly', nickname: 'Roleplay Pro · weekly', unitAmountCents: 2000 }],
  metadata: { vc_kind: 'roleplay', vc_tier: 'pro' },
}

// Setup fees are intentionally NOT in the catalog. Each one is custom-quoted
// and added to a customer's first invoice as a one-off invoice item from
// the admin UI. See app/admin/billing/[repId]/SetupFeeForm.tsx.

// ── EXPORT ──────────────────────────────────────────────────────────────

export const CATALOG: CatalogProduct[] = [
  BASE_BUILD,
  SDR_HOURS,
  TRAINER_HOURS,
  SDR_OVERAGE,
  TRAINER_OVERAGE,
  CRM_GHL,
  CRM_HUBSPOT,
  CRM_PIPEDRIVE,
  CRM_SALESFORCE,
  DIALER_LITE,
  DIALER_PRO,
  ROLEPLAY_LITE,
  ROLEPLAY_PRO,
]

// ── Runtime ID resolver ─────────────────────────────────────────────────
// The bootstrap script writes the resolved Stripe IDs to this file. Runtime
// code calls `resolvePriceId('vc_sdr_hours_t1')` etc. to get the live ID.

export type StripeIdMap = {
  generatedAt: string
  livemode: boolean
  products: Record<string, string>            // productKey -> prod_xxx
  prices:   Record<string, string>            // priceKey   -> price_xxx
}

let _idMapCache: StripeIdMap | null = null

export function loadIdMap(): StripeIdMap {
  if (_idMapCache) return _idMapCache
  // Lazy import so client bundles don't pull in fs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const file = path.join(process.cwd(), 'lib', 'billing', 'stripe_object_ids.json')
  if (!fs.existsSync(file)) {
    throw new Error(
      `[catalog] stripe_object_ids.json not found. Run: npx tsx scripts/stripe-bootstrap.ts`,
    )
  }
  _idMapCache = JSON.parse(fs.readFileSync(file, 'utf8')) as StripeIdMap
  return _idMapCache
}

export function resolvePriceId(priceKey: string): string {
  const map = loadIdMap()
  const id = map.prices[priceKey]
  if (!id) throw new Error(`[catalog] no Stripe price id for "${priceKey}" — re-run bootstrap script`)
  return id
}

export function resolveProductId(productKey: string): string {
  const map = loadIdMap()
  const id = map.products[productKey]
  if (!id) throw new Error(`[catalog] no Stripe product id for "${productKey}" — re-run bootstrap script`)
  return id
}

// ── Helpers used by checkout / subscribe routes ─────────────────────────

export function sdrHoursPriceKey(tier: Tier): string {
  return `vc_sdr_hours_${tier}`
}
export function trainerHoursPriceKey(tier: Tier): string {
  return `vc_trainer_hours_${tier}`
}
export function sdrOveragePriceKey(tier: Tier): string {
  return `vc_sdr_overage_${tier}`
}
export function trainerOveragePriceKey(tier: Tier): string {
  return `vc_trainer_overage_${tier}`
}
