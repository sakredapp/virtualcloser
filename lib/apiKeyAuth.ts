import { createHash, randomBytes } from 'crypto'
import { supabase } from './supabase'
import type { Tenant } from './tenant'
import type { Member } from '@/types'

export type ApiKeyContext = { tenant: Tenant; member: Member }

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateApiKey(): { raw: string; hash: string } {
  const raw = 'vc_' + randomBytes(32).toString('hex')
  return { raw, hash: hashKey(raw) }
}

export async function requireApiKeyAuth(req: Request): Promise<ApiKeyContext> {
  const authHeader = req.headers.get('authorization') ?? ''
  const match = authHeader.match(/^Bearer\s+(vc_[0-9a-f]{64})$/i)
  if (!match) throw new Error('missing_api_key')

  const hash = hashKey(match[1])

  const { data: keyRow } = await supabase
    .from('rep_api_keys')
    .select('id, rep_id')
    .eq('key_hash', hash)
    .is('revoked_at', null)
    .maybeSingle()

  if (!keyRow) throw new Error('invalid_api_key')

  // Update last_used_at non-blocking
  supabase
    .from('rep_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)
    .then(() => {})

  const { data: tenant } = await supabase
    .from('reps')
    .select('*')
    .eq('id', keyRow.rep_id)
    .maybeSingle()

  if (!tenant) throw new Error('tenant_not_found')

  // Use the owner member as the auth identity for API key calls
  const { data: member } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', keyRow.rep_id)
    .eq('role', 'owner')
    .eq('is_active', true)
    .maybeSingle()

  if (!member) throw new Error('no_owner_member')

  return { tenant: tenant as Tenant, member: member as Member }
}

export async function requireMemberOrApiKey(req: Request): Promise<ApiKeyContext> {
  // Try API key first (for machine-to-machine calls)
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer vc_')) {
    return requireApiKeyAuth(req)
  }

  // Fall back to session auth
  const { requireMember } = await import('./tenant')
  return requireMember()
}
