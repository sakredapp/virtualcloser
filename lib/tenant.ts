import { headers } from 'next/headers'
import { supabase } from './supabase'

export type Tenant = {
  id: string
  slug: string
  display_name: string
  company: string | null
  email: string | null
  claude_api_key: string | null
  slack_webhook: string | null
  hubspot_token: string | null
  settings: Record<string, unknown>
  is_active: boolean
  tier: 'starter' | 'pro' | 'space_station'
  monthly_fee: number
  build_fee: number
  start_date: string | null
  onboarding_steps: unknown
  build_notes: string | null
  integrations: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

const DEFAULT_ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
const DEFAULT_DEV_SLUG = process.env.DEFAULT_REP_SLUG ?? 'demo'

/**
 * Extract a tenant slug from a host like `acme.virtualcloser.com`.
 * Falls back to DEFAULT_REP_SLUG on localhost / preview deployments.
 */
export function slugFromHost(host: string | null | undefined): string {
  if (!host) return DEFAULT_DEV_SLUG

  const clean = host.split(':')[0].toLowerCase()

  // localhost, 127.0.0.1, bare IPs → dev fallback
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
    return DEFAULT_DEV_SLUG
  }

  // Vercel preview URLs (something.vercel.app) → dev fallback
  if (clean.endsWith('.vercel.app')) {
    return DEFAULT_DEV_SLUG
  }

  // If host is the root domain itself (no subdomain) → dev fallback
  if (clean === DEFAULT_ROOT_DOMAIN || clean === `www.${DEFAULT_ROOT_DOMAIN}`) {
    return DEFAULT_DEV_SLUG
  }

  // Strip the root domain and take the leftmost label as the slug.
  if (clean.endsWith(`.${DEFAULT_ROOT_DOMAIN}`)) {
    return clean.slice(0, -1 * (DEFAULT_ROOT_DOMAIN.length + 1)).split('.')[0]
  }

  // Fallback: first label
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
