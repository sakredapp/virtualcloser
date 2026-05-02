#!/usr/bin/env tsx
/**
 * Stripe object bootstrap.
 *
 * Reads lib/billing/catalog.ts and idempotently provisions matching
 * Products + Prices in Stripe. Writes the resolved IDs to
 * lib/billing/stripe_object_ids.json which runtime code reads via
 * lib/billing/catalog.ts:resolvePriceId().
 *
 * Re-run any time the catalog changes. Safe to run multiple times.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-bootstrap.ts
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-bootstrap.ts --dry-run
 *
 * Behavior on re-run:
 *   - Product exists (matched by metadata vc_product_key) -> update name/desc.
 *   - Price exists with same unit_amount -> reuse.
 *   - Price exists with different amount -> create NEW Price (Stripe Prices
 *     are immutable), archive the old one. Subscription items keep working
 *     until you migrate them; new subs use the new Price.
 *
 * The output JSON is checked in (so deploys have the IDs without running
 * the script). Re-running on a deploy is fine; if no diffs, it no-ops.
 */

import fs from 'node:fs'
import path from 'node:path'
import Stripe from 'stripe'
import { CATALOG, type CatalogProduct, type CatalogPrice, type StripeIdMap } from '../lib/billing/catalog'

const DRY_RUN = process.argv.includes('--dry-run')

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set.')
    process.exit(1)
  }
  return new Stripe(key, {
    // @ts-expect-error pinned API version may lag SDK types
    apiVersion: '2024-12-18.acacia',
    appInfo: { name: 'VirtualCloser bootstrap', version: '1.0.0' },
  })
}

const OUT_FILE = path.join(__dirname, '..', 'lib', 'billing', 'stripe_object_ids.json')

type Mode = 'create' | 'update' | 'reuse' | 'replace'
function logChange(mode: Mode, kind: string, label: string, id?: string) {
  const tag = DRY_RUN ? '[dry-run]' : '[bootstrap]'
  const arrow = mode === 'create' ? '+' : mode === 'update' ? '~' : mode === 'replace' ? '↻' : '='
  console.log(`${tag} ${arrow} ${kind.padEnd(8)} ${label}${id ? `  (${id})` : ''}`)
}

// ── Product upsert ──────────────────────────────────────────────────────

async function upsertProduct(stripe: Stripe, p: CatalogProduct): Promise<string> {
  // Idempotency key: metadata.vc_product_key. Search first.
  const existing = await stripe.products.search({
    query: `metadata['vc_product_key']:'${p.productKey}'`,
    limit: 1,
  })
  const meta = { ...(p.metadata ?? {}), vc_product_key: p.productKey }

  if (existing.data[0]) {
    const cur = existing.data[0]
    const needsUpdate =
      cur.name !== p.name || cur.description !== p.description || !shallowEqual(cur.metadata, meta)
    if (needsUpdate) {
      logChange('update', 'product', p.productKey, cur.id)
      if (!DRY_RUN) {
        await stripe.products.update(cur.id, {
          name: p.name,
          description: p.description,
          metadata: meta,
        })
      }
    } else {
      logChange('reuse', 'product', p.productKey, cur.id)
    }
    return cur.id
  }

  logChange('create', 'product', p.productKey)
  if (DRY_RUN) return `prod_DRYRUN_${p.productKey}`
  const created = await stripe.products.create({
    name: p.name,
    description: p.description,
    metadata: meta,
  })
  return created.id
}

// ── Price upsert ────────────────────────────────────────────────────────

async function upsertPrice(
  stripe: Stripe,
  product: CatalogProduct,
  productId: string,
  price: CatalogPrice,
): Promise<string> {
  // Idempotency key: metadata.vc_price_key. Search active first, fall back
  // to inactive if we need to revive (we don't auto-revive — we'd just
  // create new). Stripe Prices are immutable — to change amount we archive
  // the old one and create a new one.
  const found = await stripe.prices.search({
    query: `metadata['vc_price_key']:'${price.priceKey}' AND active:'true'`,
    limit: 1,
  })

  const meta = {
    vc_price_key: price.priceKey,
    vc_product_key: product.productKey,
    ...(price.tier ? { vc_tier: price.tier } : {}),
  }

  if (found.data[0]) {
    const cur = found.data[0]
    const matches =
      cur.unit_amount === price.unitAmountCents &&
      cur.currency === 'usd' &&
      stripeRecurringMatches(cur, product.kind)
    if (matches) {
      // Update nickname / metadata in place if drifted (allowed on Price).
      const nickDrift = cur.nickname !== price.nickname
      const metaDrift = !shallowEqual(cur.metadata, meta)
      if (nickDrift || metaDrift) {
        logChange('update', 'price', price.priceKey, cur.id)
        if (!DRY_RUN) {
          await stripe.prices.update(cur.id, { nickname: price.nickname, metadata: meta })
        }
      } else {
        logChange('reuse', 'price', price.priceKey, cur.id)
      }
      return cur.id
    }
    // Mismatch — archive the old, create a new.
    logChange('replace', 'price', price.priceKey, cur.id)
    if (!DRY_RUN) {
      await stripe.prices.update(cur.id, { active: false })
    }
  } else {
    logChange('create', 'price', price.priceKey)
  }

  if (DRY_RUN) return `price_DRYRUN_${price.priceKey}`

  const params: Stripe.PriceCreateParams = {
    product: productId,
    currency: 'usd',
    unit_amount: price.unitAmountCents,
    nickname: price.nickname,
    metadata: meta,
  }
  if (product.kind === 'flat_weekly' || product.kind === 'per_unit_weekly') {
    params.recurring = { interval: 'week' }
  } else if (product.kind === 'metered_weekly') {
    params.recurring = {
      interval: 'week',
      usage_type: 'metered',
    }
  }
  // 'one_time' — no recurring block.
  const created = await stripe.prices.create(params)
  return created.id
}

function stripeRecurringMatches(cur: Stripe.Price, kind: CatalogProduct['kind']): boolean {
  const r = cur.recurring
  switch (kind) {
    case 'one_time':
      return r === null
    case 'flat_weekly':
    case 'per_unit_weekly':
      return r?.interval === 'week' && r?.usage_type === 'licensed'
    case 'metered_weekly':
      return r?.interval === 'week' && r?.usage_type === 'metered'
  }
}

function shallowEqual(a: Record<string, string> | null | undefined, b: Record<string, string>): boolean {
  if (!a) return Object.keys(b).length === 0
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of bk) if (a[k] !== b[k]) return false
  return true
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const stripe = getStripe()
  // Fetch the connected (authenticated) account. Older signature accepted no
  // args; v22 typed surface wants an id, but the runtime resolves the
  // current account when we omit it.
  const account = await (stripe.accounts as unknown as {
    retrieve: () => Promise<{ id: string; email?: string }>
  }).retrieve()
  console.log(`[bootstrap] connected to Stripe account ${account.id} (${account.email ?? 'no email'})`)
  console.log(`[bootstrap] mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE WRITES'}`)
  // Detect livemode from the secret key prefix without an extra API call.
  const livemode = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_')
  console.log(`[bootstrap] livemode: ${livemode}`)
  console.log('')

  const products: Record<string, string> = {}
  const prices: Record<string, string> = {}

  for (const p of CATALOG) {
    const productId = await upsertProduct(stripe, p)
    products[p.productKey] = productId
    for (const price of p.prices) {
      const priceId = await upsertPrice(stripe, p, productId, price)
      prices[price.priceKey] = priceId
    }
  }

  const map: StripeIdMap = {
    generatedAt: new Date().toISOString(),
    livemode,
    products,
    prices,
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] Would write:', OUT_FILE)
    console.log(JSON.stringify(map, null, 2))
    return
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(map, null, 2) + '\n')
  console.log(`\n[bootstrap] wrote ${OUT_FILE}`)
  console.log(`[bootstrap] ${Object.keys(products).length} products, ${Object.keys(prices).length} prices`)
}

main().catch((err) => {
  console.error('[bootstrap] FAILED:', err)
  process.exit(1)
})
