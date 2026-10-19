import { supabase } from './supabase'
import type { Tenant } from './tenant'

export async function listClients(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from('reps')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Tenant[]
}

export async function createClientRow(input: {
  id: string
  slug: string
  display_name: string
  email?: string
  company?: string
  tier: 'individual' | 'enterprise'
  monthly_fee?: number
  build_fee?: number
  timezone?: string
}): Promise<Tenant> {
  // reps.onboarding_steps is no longer written (owner 2026-10-19): Suite CXO
  // onboarding is derived and read by Accounts (lib/opsOnboarding). The
  // column keeps its '[]' default until it is dropped.
  const { data, error } = await supabase
    .from('reps')
    .insert({
      id: input.id,
      slug: input.slug,
      display_name: input.display_name,
      email: input.email,
      company: input.company,
      tier: input.tier,
      monthly_fee: input.monthly_fee ?? 50,
      build_fee: input.build_fee ?? 1500,
      timezone: input.timezone || 'America/New_York',
      start_date: new Date().toISOString().slice(0, 10),
      is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as Tenant
}

export async function updateClientRow(id: string, patch: Partial<Tenant>): Promise<void> {
  const { error } = await supabase.from('reps').update(patch).eq('id', id)
  if (error) throw error
}

export async function addClientEvent(input: {
  repId: string
  kind: 'note' | 'onboarding_step' | 'billing' | 'integration' | 'email'
  title: string
  body?: string
}): Promise<void> {
  const { error } = await supabase.from('client_events').insert({
    rep_id: input.repId,
    kind: input.kind,
    title: input.title,
    body: input.body,
  })
  if (error) throw error
}
