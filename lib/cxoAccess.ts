import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { isEmployeeOnlyMember } from '@/lib/employees/access'

export class NotExec extends Error {
  constructor() {
    super('Executive suite only.')
  }
}

/** Signed-in member on an executive (Suite CXO) tenant, or NotExec / the requireMember error. */
export async function requireExecMember() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) throw new NotExec()
  // Employee self-view logins never reach exec routes (belt and braces; middleware + getCurrentMember block first).
  if (isEmployeeOnlyMember(ctx.member, ctx.tenant)) throw new NotExec()
  return ctx
}
