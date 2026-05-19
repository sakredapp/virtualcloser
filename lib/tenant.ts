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
  return (data as Tenant | null) ?? null
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
 * Backwards-compatible:
 *  - If the cookie carries a memberId, we load it and verify it belongs to
 *    the host's tenant.
 *  - Older cookies (slug only) fall back to the tenant's owner member.
 *  - Returns null if there's no session or the member is inactive / mismatched.
 */
export async function getCurrentMember(): Promise<Member | null> {
  const tenant = await getCurrentTenant()
  if (!tenant) return null
  const payload = await getSessionPayload()
  if (!payload) return null
  if (payload.slug !== tenant.slug) return null

  if (payload.memberId) {
    const m = await getMemberById(payload.memberId)
    if (m && m.is_active && m.rep_id === tenant.id) return m
  }
  // Legacy fallback: slug-only cookie → owner of this tenant.
  return getOwnerMember(tenant.id)
}

export async function requireMember(): Promise<{ tenant: Tenant; member: Member }> {
  const tenant = await requireTenant()
  const member = await getCurrentMember()
  if (!member) throw new Error('No active member for this session.')
  if (member.rep_id !== tenant.id) throw new Error('Session does not belong to this tenant.')
  return { tenant, member }
}
