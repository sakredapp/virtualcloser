/**
 * MCP access keys — table `mcp_tokens` (supabase/mcp_tokens_migration.sql).
 *
 * A key is `cxo_` + 64 hex chars. The plaintext is returned exactly once at
 * creation; only its sha256 is stored. Fails soft (McpTokensNotReady) when the
 * table has not been created yet, so the Integrations page and /api/mcp say
 * what to do instead of 500ing.
 */

import { createHash, randomBytes } from 'crypto'
import { supabase } from '@/lib/supabase'

export const MCP_TOKEN_PREFIX = 'cxo_'
export const MCP_TOKEN_RE = /^cxo_[0-9a-f]{64}$/i

export class McpTokensNotReady extends Error {
  constructor() {
    super('MCP keys are not set up on this database yet. Run supabase/mcp_tokens_migration.sql in the Supabase SQL editor, then try again.')
    this.name = 'McpTokensNotReady'
  }
}

export type McpTokenRow = {
  id: string
  rep_id: string
  member_id: string | null
  label: string
  token_hash: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export type McpTokenPublic = Pick<McpTokenRow, 'id' | 'label' | 'created_at' | 'last_used_at' | 'revoked_at'>

export function hashMcpToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function tableMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === 'PGRST204') return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('mcp_tokens') && (m.includes('does not exist') || m.includes('not find') || m.includes('schema cache'))
}

function toPublic(r: McpTokenRow): McpTokenPublic {
  return { id: r.id, label: r.label, created_at: r.created_at, last_used_at: r.last_used_at, revoked_at: r.revoked_at }
}

export async function createMcpToken(args: {
  repId: string
  memberId: string | null
  label?: string
}): Promise<{ token: string; row: McpTokenPublic }> {
  const token = MCP_TOKEN_PREFIX + randomBytes(32).toString('hex')
  const label = (args.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'My AI'
  const { data, error } = await supabase
    .from('mcp_tokens')
    .insert({ rep_id: args.repId, member_id: args.memberId, label, token_hash: hashMcpToken(token) })
    .select('id, rep_id, member_id, label, token_hash, created_at, last_used_at, revoked_at')
    .single()
  if (error) {
    if (tableMissing(error)) throw new McpTokensNotReady()
    throw new Error(`mcp_tokens insert: ${error.message}`)
  }
  return { token, row: toPublic(data as McpTokenRow) }
}

/** Live (unrevoked) keys for an account, newest first. */
export async function listMcpTokens(repId: string): Promise<McpTokenPublic[]> {
  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('id, label, created_at, last_used_at, revoked_at')
    .eq('rep_id', repId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    if (tableMissing(error)) throw new McpTokensNotReady()
    throw new Error(`mcp_tokens list: ${error.message}`)
  }
  return (data ?? []) as McpTokenPublic[]
}

/** Revoke one key. Scoped to the account so a member can only revoke their own account's keys. */
export async function revokeMcpToken(repId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('mcp_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('id', id)
    .is('revoked_at', null)
    .select('id')
  if (error) {
    if (tableMissing(error)) throw new McpTokensNotReady()
    throw new Error(`mcp_tokens revoke: ${error.message}`)
  }
  return (data ?? []).length > 0
}

/** Resolve a plaintext key to its live row, or null. Touches last_used_at without blocking. */
export async function findLiveMcpToken(raw: string): Promise<McpTokenRow | null> {
  if (!MCP_TOKEN_RE.test(raw)) return null
  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('id, rep_id, member_id, label, token_hash, created_at, last_used_at, revoked_at')
    .eq('token_hash', hashMcpToken(raw))
    .is('revoked_at', null)
    .maybeSingle()
  if (error) {
    if (tableMissing(error)) throw new McpTokensNotReady()
    throw new Error(`mcp_tokens lookup: ${error.message}`)
  }
  const row = (data as McpTokenRow | null) ?? null
  if (row) {
    void supabase
      .from('mcp_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(() => {})
  }
  return row
}
