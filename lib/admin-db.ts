import { supabase } from './supabase'
import type { Tenant } from './tenant'
import { defaultOnboardingSteps, type OnboardingStep } from './onboarding'
import { generateLinkCode } from './random'

export async function listClients(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from('reps')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Tenant[]
}

export async function getClient(id: string): Promise<Tenant | null> {
  const { data, error } = await supabase.from('reps').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Tenant | null) ?? null
}

export async function createClientRow(input: {
  id: string
  slug: string
  display_name: string
  email?: string
  company?: string
  tier: 'salesperson' | 'team_builder' | 'executive'
  monthly_fee?: number
  build_fee?: number
}): Promise<Tenant> {
  const steps = defaultOnboardingSteps(input.tier)
  const linkCode = generateLinkCode()
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
      start_date: new Date().toISOString().slice(0, 10),
      onboarding_steps: steps,
      telegram_link_code: linkCode,
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

export async function setOnboardingStep(
  repId: string,
  key: string,
  done: boolean
): Promise<void> {
  const { data, error } = await supabase
    .from('reps')
    .select('onboarding_steps')
    .eq('id', repId)
    .single()
  if (error) throw error
  const steps = (data?.onboarding_steps ?? []) as OnboardingStep[]
  const next = steps.map((s) =>
    s.key === key ? { ...s, done, done_at: done ? new Date().toISOString() : null } : s,
  )
  const { error: upErr } = await supabase
    .from('reps')
    .update({ onboarding_steps: next })
    .eq('id', repId)
  if (upErr) throw upErr
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

export async function listClientEvents(repId: string, limit = 30) {
  const { data, error } = await supabase
    .from('client_events')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function getClientSummary(repId: string): Promise<{
  leads: number
  drafts: number
  runs: number
}> {
  const [{ count: leads }, { count: drafts }, { count: runs }] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('rep_id', repId),
    supabase
      .from('agent_actions')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', repId)
      .eq('status', 'pending'),
    supabase.from('agent_runs').select('id', { count: 'exact', head: true }).eq('rep_id', repId),
  ])
  return { leads: leads ?? 0, drafts: drafts ?? 0, runs: runs ?? 0 }
}
