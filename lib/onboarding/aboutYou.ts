/**
 * About you (Suite CXO): the database half of lib/onboarding/aboutYouShared.
 * Everything lives on the person's OWN members row (settings JSON, merged),
 * so there is no new table. Reads the two tenant facts the questions depend
 * on: does the tenant have an insurance producer book, and is QuickBooks
 * connected. Both are cached for a few minutes per tenant.
 */
import { supabase } from '@/lib/supabase'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import {
  ABOUT_KEYS,
  aboutView,
  applyAbout,
  readAbout,
  type AboutPatch,
  type AboutSaveResult,
  type AboutView,
  type Audience,
  type Flavor,
} from './aboutYouShared'

type TenantLike = { id: string; brand?: string | null }
type MemberLike = { id: string; role?: string | null; settings?: Record<string, unknown> | null }

const TTL_MS = 5 * 60_000
const memo = new Map<string, { at: number; flavor: Flavor }>()

/** Insurance book (Pinnacle mirror or the tenant's own cxo_book_* rows) and QuickBooks, for this tenant. Never throws. */
export async function flavorFor(tenantId: string): Promise<Flavor> {
  const hit = memo.get(tenantId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flavor
  const [insurance, quickbooks] = await Promise.all([
    pinnacleAllowed(tenantId)
      ? Promise.resolve(true)
      : Promise.resolve(supabase.from('cxo_book_producers').select('id', { count: 'exact', head: true }).eq('rep_id', tenantId))
          .then((r) => !r.error && (r.count ?? 0) > 0)
          .catch(() => false),
    Promise.resolve(supabase.from('cxo_qbo_connections').select('needs_reconnect').eq('rep_id', tenantId).limit(1))
      .then((r) => !r.error && ((r.data ?? []) as Array<{ needs_reconnect?: boolean | null }>).some((x) => !x.needs_reconnect))
      .catch(() => false),
  ])
  const flavor = { insurance, quickbooks }
  memo.set(tenantId, { at: Date.now(), flavor })
  return flavor
}

export const audienceFor = (member: Pick<MemberLike, 'role'>, tenant: TenantLike): Audience => (isEmployeeOnlyMember(member, tenant) ? 'employee' : 'exec')

/** Their own settings, fresh from the row (the session copy may be a request old). */
async function settingsOf(memberId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('members').select('settings').eq('id', memberId).maybeSingle()
  if (error) throw new Error(`members: ${error.message}`)
  return { ...(((data as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}) }
}

/** What the card and Profile show for this person. */
export async function getAboutView(tenant: TenantLike, member: MemberLike): Promise<AboutView> {
  const [flavor, settings] = await Promise.all([flavorFor(tenant.id), settingsOf(member.id)])
  return aboutView(readAbout(settings), audienceFor(member, tenant), flavor)
}

/** Save an answer (or a skip) on their own row. Returns the new view. */
export async function saveAbout(tenant: TenantLike, member: MemberLike, patch: AboutPatch, now = new Date()): Promise<{ ok: true; view: AboutView; result: Extract<AboutSaveResult, { ok: true }> } | { ok: false; error: string }> {
  const [flavor, settings] = await Promise.all([flavorFor(tenant.id), settingsOf(member.id)])
  const who = audienceFor(member, tenant)
  const r = applyAbout(settings, patch, who, flavor, now)
  if (!r.ok) return r
  const { error } = await supabase.from('members').update({ settings: r.settings }).eq('id', member.id).eq('rep_id', tenant.id)
  if (error) return { ok: false, error: 'Could not save that.' }
  return { ok: true, view: aboutView(r.about, who, flavor), result: r }
}

/** Ciao asked the role question once in chat: never again. */
export async function markAboutAsked(tenantId: string, memberId: string, now = new Date()): Promise<void> {
  const settings = await settingsOf(memberId)
  if (settings[ABOUT_KEYS.askedAt]) return
  settings[ABOUT_KEYS.askedAt] = now.toISOString()
  const { error } = await supabase.from('members').update({ settings }).eq('id', memberId).eq('rep_id', tenantId)
  if (error) throw new Error(`members: ${error.message}`)
}
