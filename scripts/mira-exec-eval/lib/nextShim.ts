/**
 * Lets the app's data layer run under plain `tsx` (no Next runtime).
 *
 * `lib/pinnacle/rollup.ts` and `lib/pinnacle/cache.ts` wrap loaders in
 * `unstable_cache` from `next/cache`, which throws "incrementalCache missing"
 * outside a Next request. Import this module FIRST (before anything under
 * `@/lib`) and `next/cache` resolves to a pass-through instead.
 */
import Module from 'node:module'
import path from 'node:path'

const SHIM = path.join(__dirname, 'nextCacheShim.cjs')

type Resolver = (request: string, ...rest: unknown[]) => string
const mod = Module as unknown as { _resolveFilename: Resolver }
const original = mod._resolveFilename
mod._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === 'next/cache') return SHIM
  return original.call(this, request, ...rest)
}
