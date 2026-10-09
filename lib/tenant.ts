import { headers } from 'next/headers'
import { supabase } from './supabase'
import { getSessionPayload } from './client-auth'
import { getMemberById, getOwnerMember } from './members'
import {
  brandFromHost,
  isAnyGatewayHost as brandIsGatewayHost,
  slugFromBrandedHost,
} from './brand'
import type { BrandKey } from './brand'
import type { Member } from '@/types'

export type Tenant = {
  id: string
  slug: string
  display_name: string
  company: string | null
  email: string | null
  claude_api_key: string | null
  telegram_chat_id: string | null
  telegram_link_code: string | null
  hubspot_token: string | null
  settings: Record<string, unknown>
  is_active: boolean
  tier: 'individual' | 'enterprise'
  monthly_fee: number
  build_fee: number
  start_date: string | null
  onboarding_steps: unknown
  build_notes: string | null
  integrations: Record<string, unknown>
  password_hash: string | null
  last_login_at: string | null
  timezone?: string | null
  host_aliases?: string[] | null
  max_seats?: number | null
  brand?: BrandKey
  created_at?: string
  updated_at?: string
}

const DEFAULT_DEV_SLUG = process.env.DEFAULT_REP_SLUG ?? 'demo'

/**
 * Returns true for hosts that are the "gateway" (apex, www, localhost, preview)
 * for ANY brand — i.e., no particular tenant is implied — where we show
 * login, landing, /offer, /admin.
 *
 * Delegates to `lib/brand.ts` so the list of recognized root domains stays
 * in one place. New brand → add it to the registry; this stays correct.
 */
export function isGatewayHost(host: string | null | undefined): boolean {
  return brandIsGatewayHost(host)
}

/**
 * Extract a tenant slug from a branded subdomain (e.g. `acme.virtualcloser.com`
 * or `spencer.suitecxo.com`). Falls back to DEFAULT_REP_SLUG on gateway hosts
 * or hosts that don't match any registered brand root.
 */
export function slugFromHost(host: string | null | undefined): string {
  if (isGatewayHost(host)) return DEFAULT_DEV_SLUG
  const branded = slugFromBrandedHost(host)
  if (branded) return branded
  // Fallback for legacy / custom domains: first DNS label.
  const clean = (host ?? '').split(':')[0].toLowerCase()
  return clean.split('.')[0] || DEFAULT_DEV_SLUG
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const { data, error } = await supabase
    .from('reps')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (data) return data as Tenant
  // Host alias: one agency can be reached on more than one subdomain (e.g.
  // pinnacle.suitecxo.com and spence.suitecxo.com are the same org), so each
  // exec can have their own address without splitting the org.
  const { data: aliased, error: aliasErr } = await supabase
    .from('reps')
    .select('*')
    .contains('host_aliases', [slug])
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (aliasErr) throw aliasErr
  return (aliased as Tenant | null) ?? null
}

/**
 * Resolve the current tenant from the incoming request host.
 * Safe to call from any server component or route handler.
 */
export async function getCurrentTenant(): Promise<Tenant | null> {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  const slug = slugFromHost(host)
  return getTenantBySlug(slug)
}

export async function requireTenant(): Promise<Tenant> {
  const tenant = await getCurrentTenant()
  if (!tenant) {
    throw new Error('No tenant found for this host. Add a row in the reps table.')
  }
  return tenant
}

export async function getAllActiveTenants(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from('reps')
    .select('*')
    .eq('is_active', true)

  if (error) throw error
  return (data ?? []) as Tenant[]
}

/**
 * Resolve the active member from the current session cookie.
 *
 *  - Current cookies (hosts list present) are signed with the canonical
 *    tenant slug, so the host's tenant must be exactly that tenant.
 *  - Older cookies may carry the org slug or one of its host aliases.
 *  - A cookie that names a memberId resolves to THAT member only: missing,
 *    inactive or belonging to another tenant → null. Never the owner.
 *  - Only a slug-only cookie (no memberId) falls back to the tenant's owner.
 */
export async function getCurrentMember(): Promise<Member | null> {
  const tenant = await getCurrentTenant()
  if (!tenant) return null
  const payload = await getSessionPayload()
  if (!payload) return null
  if (payload.hosts.length > 0) {
    if (payload.slug !== tenant.slug) return null
  } else if (payload.slug !== tenant.slug && !(tenant.host_aliases ?? []).includes(payload.slug)) {
    return null
  }

  if (payload.memberId) {
    const m = await getMemberById(payload.memberId)
    if (m && m.is_active && m.rep_id === tenant.id) return m
    return null
  }
  // Legacy fallback: slug-only cookie → owner of this tenant.
  return getOwnerMember(tenant.id)
}

/**
 * The host a member signs in to: their home_subdomain when it is really one
 * of this tenant's hosts (slug or alias), else the tenant slug.
 */
export function memberHomeHost(
  tenant: { slug: string; host_aliases?: string[] | null },
  home: string | null | undefined,
): string {
  const h = (home ?? '').trim().toLowerCase()
  if (h && (h === tenant.slug || (tenant.host_aliases ?? []).includes(h))) return h
  return tenant.slug
}

export async function requireMember(): Promise<{ tenant: Tenant; member: Member }> {
  const tenant = await requireTenant()
  const member = await getCurrentMember()
  if (!member) throw new Error('No active member for this session.')
  if (member.rep_id !== tenant.id) throw new Error('Session does not belong to this tenant.')
  return { tenant, member }
}
