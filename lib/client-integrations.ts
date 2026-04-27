import { supabase } from './supabase'

// ── Types ─────────────────────────────────────────────────────────────────

export type IntegrationKind =
  | 'api'
  | 'oauth'
  | 'webhook_inbound'
  | 'webhook_outbound'
  | 'zapier'

export type ClientIntegration = {
  id: string
  rep_id: string
  key: string
  label: string
  kind: IntegrationKind
  /** Credentials / URLs. Shape varies by kind — see schema.sql for docs. */
  config: Record<string, unknown>
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function listClientIntegrations(repId: string): Promise<ClientIntegration[]> {
  const { data, error } = await supabase
    .from('client_integrations')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ClientIntegration[]
}

export async function upsertClientIntegration(
  repId: string,
  key: string,
  payload: {
    label: string
    kind: IntegrationKind
    config: Record<string, unknown>
    is_active?: boolean
    notes?: string | null
  },
): Promise<ClientIntegration> {
  const { data, error } = await supabase
    .from('client_integrations')
    .upsert(
      {
        rep_id: repId,
        key,
        label: payload.label,
        kind: payload.kind,
        config: payload.config,
        is_active: payload.is_active ?? true,
        notes: payload.notes ?? null,
      },
      { onConflict: 'rep_id,key' },
    )
    .select()
    .single()
  if (error) throw error
  return data as ClientIntegration
}

export async function toggleClientIntegration(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('client_integrations')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}

export async function deleteClientIntegration(id: string): Promise<void> {
  const { error } = await supabase.from('client_integrations').delete().eq('id', id)
  if (error) throw error
}

// ── Credential resolver ───────────────────────────────────────────────────
// Checks client_integrations first, then falls back to reps.integrations JSONB.
// Use this in service factories (makeBlueBubbles, makeAgentCRM, etc.) so both
// old JSONB-stored and new table-stored credentials work transparently.

export async function getIntegrationConfig(
  repId: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  // 1. Check client_integrations table
  const { data } = await supabase
    .from('client_integrations')
    .select('config, is_active')
    .eq('rep_id', repId)
    .eq('key', key)
    .maybeSingle()

  if (data && data.is_active) {
    return (data.config as Record<string, unknown>) ?? null
  }

  // 2. Fall back to reps.integrations JSONB (legacy storage)
  const { data: rep } = await supabase
    .from('reps')
    .select('integrations')
    .eq('id', repId)
    .maybeSingle()

  if (!rep?.integrations) return null
  const blob = rep.integrations as Record<string, unknown>

  // Map well-known keys to their JSONB sub-objects
  const legacyMap: Record<string, Record<string, unknown>> = {
    bluebubbles: {
      url: blob.bluebubbles_url,
      password: blob.bluebubbles_password,
    },
    ghl: {
      api_key: blob.ghl_api_key,
      location_id: blob.ghl_location_id,
    },
    hubspot: { api_key: blob.hubspot_token },
  }

  return legacyMap[key] ?? null
}
