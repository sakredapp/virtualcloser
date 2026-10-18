/**
 * "What do I need to follow up on?" when the caller's own follow-up list is
 * empty: the business items worth a look instead of a bare "nothing open".
 * Book-of-business execs only (canSeeBook), read only, rollups only.
 *
 * These are business signals, not tasks. Ciao never presents them as open
 * follow-ups and never invents a task from them.
 */
import type { AgentContext } from '@/lib/agent/tools'
import { canSeeBook } from '@/lib/book/access'
import { bookStatus, fetchRetention } from '@/lib/book/data'
import { addDays, DRIFTING_DEFINITION } from '@/lib/book/retention'
import { pinnacleAllowed } from '@/lib/pinnacle/access'

export const ATTENTION_NOTE =
  'Their own follow-up list is empty: say that first, plainly. These are business items from the book worth a look, not tasks or follow-ups. Never call them open follow-ups, never turn them into tasks, never add a number that is not here.'

export type BusinessAttention = {
  drifting_agents: { count: number; days_30_59: number; days_60_89: number; definition: string; top: Array<{ name: string; agency: string | null; days_since_last_sale: number }> } | null
  stopped_writing_last_30_days: number | null
  slipping: string[]
  note: string
}

/** Shape the reads into the block (pure, for tests). */
export function shapeAttention(o: {
  drifting: { days_30_59: number; days_60_89: number; top: Array<{ name: string; team: string | null; days_since: number }> } | null
  wentQuiet: number | null
  slipping: string[]
}): BusinessAttention | null {
  const count = o.drifting ? o.drifting.days_30_59 + o.drifting.days_60_89 : 0
  const drifting = o.drifting && count > 0
    ? { count, days_30_59: o.drifting.days_30_59, days_60_89: o.drifting.days_60_89, definition: DRIFTING_DEFINITION, top: o.drifting.top.slice(0, 3).map((d) => ({ name: d.name, agency: d.team, days_since_last_sale: d.days_since })) }
    : null
  const stopped = o.wentQuiet && o.wentQuiet > 0 ? o.wentQuiet : null
  const slipping = o.slipping.slice(0, 3)
  if (!drifting && !stopped && !slipping.length) return null
  return { drifting_agents: drifting, stopped_writing_last_30_days: stopped, slipping, note: ATTENTION_NOTE }
}

export async function loadBusinessAttention(ctx: AgentContext): Promise<BusinessAttention | null> {
  if (ctx.selfOnly || !canSeeBook(ctx.caller, ctx.tenant)) return null
  const status = await bookStatus(ctx.tenant.id).catch(() => null)
  if (!status?.connected) return null
  const today = ctx.todayIso
  const win = { start: addDays(today, -29), end: today }
  const prior = { start: addDays(today, -59), end: addDays(today, -30) }
  const slipRead = pinnacleAllowed(ctx.tenant.id)
    ? (async () => {
        const [{ Loader }, { loadSlipInput }, { detectSlipping }] = await Promise.all([import('@/lib/mcp/data'), import('@/lib/pinnacle/slippingData'), import('@/lib/pinnacle/slipping')])
        const input = await loadSlipInput(new Loader(ctx.tenant))
        return input ? detectSlipping(input).map((i) => i.line) : []
      })().catch(() => [] as string[])
    : Promise.resolve([] as string[])
  const [ret, slipping] = await Promise.all([fetchRetention(ctx.tenant.id, win, prior, today, { limit: 3 }).catch(() => null), slipRead])
  return shapeAttention({ drifting: ret?.drifting ?? null, wentQuiet: ret ? ret.went_quiet_count : null, slipping })
}
