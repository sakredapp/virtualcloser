// Server-side cart for the offer page.
//
// The browser sends ITEM SHAPES (sku, qty), never amounts. We re-price
// everything from the catalog at checkout time so a tampered cart can't
// bypass server pricing.

import { supabase } from '@/lib/supabase'
import {
  resolvePriceId,
  sdrHoursPriceKey,
  trainerHoursPriceKey,
  sdrOveragePriceKey,
  trainerOveragePriceKey,
  tierForRepCount,
  type Tier,
} from './catalog'
import type { AddonKey } from './subscribe'

export type CartTier = 'individual' | 'team' | 'enterprise'

export type CartInput = {
  email?: string
  displayName?: string
  company?: string
  phone?: string
  tier: CartTier
  repCount: number
  weeklyHours: number          // SDR hours/week
  trainerWeeklyHours?: number  // 0 if not buying trainer
  overflowEnabled?: boolean
  addons?: AddonKey[]
  metadata?: Record<string, unknown>
}

export type CartRow = CartInput & {
  id: string
  computedTotalCents: number
  expiresAt: string
  checkoutSessionId: string | null
  convertedAt: string | null
}

export type CheckoutLineItem = {
  price: string
  quantity?: number
  /** Stripe line items in subscription mode default to qty 1 if omitted. */
}

export type PricedCart = {
  cart: CartRow
  tier: Tier
  lineItems: CheckoutLineItem[]
  subtotalCents: number
}

/** Persist a fresh cart from the offer page. */
export async function createCart(input: CartInput): Promise<CartRow> {
  const tier = tierForRepCount(input.repCount).key
  const subtotal = computeWeeklySubtotalCents({
    weeklyHours: input.weeklyHours,
    trainerWeeklyHours: input.trainerWeeklyHours ?? 0,
    overflowEnabled: !!input.overflowEnabled,
    addons: (input.addons ?? []) as string[],
    volumeTier: tier,
    repCount: input.repCount,
    tier: input.tier,
  })

  const { data, error } = await supabase
    .from('carts')
    .insert({
      email: input.email ?? null,
      display_name: input.displayName ?? null,
      company: input.company ?? null,
      phone: input.phone ?? null,
      tier: input.tier,
      rep_count: input.repCount,
      weekly_hours: input.weeklyHours,
      trainer_weekly_hours: input.trainerWeeklyHours ?? 0,
      overflow_enabled: !!input.overflowEnabled,
      addons: input.addons ?? [],
      computed_total_cents: subtotal,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single()
  if (error) throw error
  return mapCartRow(data)
}

export async function getCart(id: string): Promise<CartRow | null> {
  const { data, error } = await supabase.from('carts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? mapCartRow(data) : null
}

export async function markCartCheckoutSession(cartId: string, sessionId: string): Promise<void> {
  await supabase.from('carts').update({ checkout_session_id: sessionId }).eq('id', cartId)
}

export async function markCartConverted(args: {
  cartId: string
  repId: string
  memberId?: string | null
}): Promise<void> {
  await supabase
    .from('carts')
    .update({
      converted_rep_id: args.repId,
      converted_member_id: args.memberId ?? null,
      converted_at: new Date().toISOString(),
    })
    .eq('id', args.cartId)
}

/** Recompute the cart's price from catalog and produce the line items
 *  Stripe Checkout expects in subscription mode. NEVER trusts the
 *  computed_total_cents already on the row. */
export function priceCart(cart: CartRow): PricedCart {
  const tier = tierForRepCount(cart.repCount).key
  const items: CheckoutLineItem[] = []

  // Base build is included on every cart unless metadata disables it.
  if (cart.metadata && (cart.metadata as Record<string, unknown>).noBaseBuild === true) {
    // skip
  } else {
    items.push({ price: resolvePriceId('vc_base_build_weekly'), quantity: 1 })
  }

  if (cart.weeklyHours > 0) {
    items.push({ price: resolvePriceId(sdrHoursPriceKey(tier)), quantity: cart.weeklyHours })
  }
  if ((cart.trainerWeeklyHours ?? 0) > 0) {
    items.push({
      price: resolvePriceId(trainerHoursPriceKey(tier)),
      quantity: cart.trainerWeeklyHours,
    })
  }
  if (cart.overflowEnabled) {
    if (cart.weeklyHours > 0) {
      items.push({ price: resolvePriceId(sdrOveragePriceKey(tier)) })
    }
    if ((cart.trainerWeeklyHours ?? 0) > 0) {
      items.push({ price: resolvePriceId(trainerOveragePriceKey(tier)) })
    }
  }
  for (const a of cart.addons ?? []) {
    items.push({ price: resolvePriceId(`${a}_weekly`), quantity: 1 })
  }

  const subtotalCents = computeWeeklySubtotalCents({
    weeklyHours: cart.weeklyHours,
    trainerWeeklyHours: cart.trainerWeeklyHours ?? 0,
    overflowEnabled: !!cart.overflowEnabled,
    addons: (cart.addons ?? []) as string[],
    volumeTier: tier,
    repCount: cart.repCount,
    tier: cart.tier,
  })
  return { cart, tier, lineItems: items, subtotalCents }
}

// ── Pricing math (single source of truth, mirrors catalog rates) ───────

function computeWeeklySubtotalCents(input: {
  weeklyHours: number
  trainerWeeklyHours: number
  overflowEnabled: boolean
  addons: string[]
  volumeTier: Tier
  repCount: number
  tier: CartTier
}): number {
  // Pull cents-per-hour from the tier directly.
  const tierRow = tierForRepCount(input.repCount)
  let cents = 0
  cents += 2500 // base build weekly
  cents += input.weeklyHours * tierRow.pricePerHourCents
  cents += input.trainerWeeklyHours * tierRow.pricePerHourCents
  for (const a of input.addons) cents += addonWeeklyPriceCents(a)
  // Overflow has $0 upfront — only charged at end of week if used.
  return cents
}

function addonWeeklyPriceCents(key: string): number {
  switch (key) {
    case 'vc_crm_ghl':
    case 'vc_crm_hubspot':
    case 'vc_crm_pipedrive':
    case 'vc_crm_salesforce':  return 1000
    case 'vc_dialer_lite':     return 1000
    case 'vc_dialer_pro':      return 2500
    case 'vc_roleplay_lite':   return  750
    case 'vc_roleplay_pro':    return 2000
    default: return 0
  }
}

// ── DB row mapping ──────────────────────────────────────────────────────

type DbCartRow = {
  id: string
  email: string | null
  display_name: string | null
  company: string | null
  phone: string | null
  tier: string
  rep_count: number
  weekly_hours: number
  trainer_weekly_hours: number
  overflow_enabled: boolean
  addons: unknown
  computed_total_cents: number | null
  metadata: unknown
  expires_at: string
  checkout_session_id: string | null
  converted_at: string | null
}

function mapCartRow(d: DbCartRow): CartRow {
  return {
    id: d.id,
    email: d.email ?? undefined,
    displayName: d.display_name ?? undefined,
    company: d.company ?? undefined,
    phone: d.phone ?? undefined,
    tier: d.tier as CartTier,
    repCount: d.rep_count,
    weeklyHours: d.weekly_hours,
    trainerWeeklyHours: d.trainer_weekly_hours,
    overflowEnabled: d.overflow_enabled,
    addons: (Array.isArray(d.addons) ? d.addons : []) as AddonKey[],
    metadata: (d.metadata as Record<string, unknown>) ?? {},
    computedTotalCents: d.computed_total_cents ?? 0,
    expiresAt: d.expires_at,
    checkoutSessionId: d.checkout_session_id,
    convertedAt: d.converted_at,
  }
}
