/**
 * Brand-scoped request context for Telegram webhook handling.
 *
 * The legacy /api/telegram/webhook route is a single 6k-line POST handler
 * that fires many outbound `sendTelegramMessage(...)` calls deep inside its
 * intent dispatcher. Threading an explicit `brand` parameter through every
 * call site would be a 200-line patch.
 *
 * Instead we wrap each route's POST entrypoint in `runWithBrand(brand, fn)`
 * (Node AsyncLocalStorage). Anywhere in the call tree, `currentBrand()`
 * returns the active brand. `lib/telegram.ts` reads this as the fallback
 * when no explicit brand opt is passed — so the same shared handler logic
 * automatically sends via the right bot (VC vs CXO) per request.
 *
 * Safety: when no ALS frame is active (everything outside the webhook path
 * — emails, settings page, scheduled jobs), `currentBrand()` returns
 * undefined and helpers fall back to the VC default. No existing call site
 * needs to change.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { BrandKey } from './brand'

const als = new AsyncLocalStorage<{ brand: BrandKey }>()

export function runWithBrand<T>(brand: BrandKey, fn: () => Promise<T>): Promise<T> {
  return als.run({ brand }, fn)
}

export function currentBrand(): BrandKey | undefined {
  return als.getStore()?.brand
}
