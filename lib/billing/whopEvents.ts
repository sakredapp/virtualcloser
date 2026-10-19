// Reading Whop webhook objects for Suite CXO: which app a payment belongs to
// and the CXO metadata on it. Pure, so the webhook route stays thin.

import { cxoWhopPlanId, cxoWhopProductId } from '@/lib/billing/whop'

export type Obj = Record<string, unknown>

export function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}
export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** The CXO metadata on a payment or membership, wherever Whop put it. */
export function cxoMetadata(data: Obj): Obj {
  const own = obj(data.metadata)
  if (str(own.kind) || str(own.rep_id)) return own
  const mem = obj(obj(data.membership).metadata)
  if (str(mem.kind) || str(mem.rep_id)) return mem
  return own
}

/** True when this object belongs to Suite CXO, not another app on the business. */
export function isCxoObject(data: Obj): boolean {
  const md = cxoMetadata(data)
  if (md.app === 'suitecxo') return true
  const kind = str(md.kind)
  if (kind && kind.startsWith('cxo_')) return true
  const productId = str(obj(data.product).id) ?? str(data.product_id)
  if (productId && productId === cxoWhopProductId()) return true
  const planId = str(obj(data.plan).id) ?? str(data.plan_id)
  const standing = cxoWhopPlanId()
  return !!(planId && standing && planId === standing)
}

