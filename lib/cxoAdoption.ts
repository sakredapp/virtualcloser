/** Adoption (server, service role): the org's usage rollups → the Adoption page, the API and Mira's tool. */
import { supabase } from '@/lib/supabase'
import { dayInZone } from '@/lib/dueRemindersShared'
import { isAtLeast } from '@/lib/permissions'
import { adoptionSince, buildAdoption, type ActivityRow, type AdoptionData, type AdoptionMember, type MiraRow } from '@/lib/cxoAdoptionShared'

export class AdoptionForbidden extends Error {
  constructor() {
    super('forbidden')
  }
}

type Viewer = { role?: string | null; is_active?: boolean | null; acting_assistant?: unknown }

/**
 * Adoption is for the org's owner and admins only. An assistant acting for
 * an exec does not inherit it, and an employee login never sees it.
 */
export function canSeeAdoption(member: Viewer | null | undefined): boolean {
  if (!member || member.is_active === false || member.acting_assistant) return false
  return isAtLeast(String(member.role ?? '') as Parameters<typeof isAtLeast>[0], 'admin')
}

const PAGE = 1000

/** Every row for one org since `since`, 1,000 at a time (the API caps a page). Fails soft: a missing table reads as no rows. */
async function allRows<T>(table: string, cols: string, repId: string, since: string, order: string[]): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 60_000; from += PAGE) {
    let q = supabase.from(table).select(cols).eq('rep_id', repId).gte('day', since)
    for (const col of order) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) {
      console.error(`[adoption] ${table}`, error.message)
      break
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** One org's adoption: 12 weeks, every active member. Every query is scoped to `repId`. */
export async function orgAdoption(repId: string, tz: string | null | undefined): Promise<AdoptionData> {
  const today = dayInZone(new Date(), tz || 'America/New_York')
  const since = adoptionSince(today)
  const [membersQ, activity, mira] = await Promise.all([
    supabase.from('members').select('id, display_name, email, role, last_login_at, settings').eq('rep_id', repId).eq('is_active', true),
    allRows<ActivityRow>('cxo_activity', 'member_id, day, path, count, updated_at', repId, since, ['day', 'member_id', 'path']),
    allRows<MiraRow>('agent_usage', 'member_id, day, requests', repId, since, ['day', 'member_id']),
  ])
  if (membersQ.error) console.error('[adoption] members', membersQ.error.message)
  return buildAdoption((membersQ.data ?? []) as AdoptionMember[], activity, mira, today)
}

/** The gate + the read in one call: throws AdoptionForbidden unless the viewer is this org's owner or admin. */
export async function adoptionFor(ctx: { tenant: { id: string; timezone?: string | null }; member: Viewer & { timezone?: string | null } }): Promise<AdoptionData> {
  if (!canSeeAdoption(ctx.member)) throw new AdoptionForbidden()
  return orgAdoption(ctx.tenant.id, ctx.member.timezone || ctx.tenant.timezone)
}
