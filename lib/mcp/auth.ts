/**
 * Authentication for /api/mcp.
 *
 * Accepts the key two ways, because the two assistants differ:
 *   - `Authorization: Bearer cxo_…`   (Claude Code, API clients, anything that can set a header)
 *   - `?k=cxo_…` on the URL           (claude.ai custom connectors and ChatGPT "No authentication",
 *                                       neither of which has a bearer-token box)
 *
 * Resolves to the key's account (tenant) and member. The member is the one
 * who made the key; if that member is gone, the account owner stands in.
 */

import { supabase } from '@/lib/supabase'
import type { Tenant } from '@/lib/tenant'
import { getMemberById, getOwnerMember } from '@/lib/members'
import type { Member } from '@/types'
import { findLiveMcpToken, MCP_TOKEN_RE } from './tokens'
import { isEmployeeOnlyMember } from '@/lib/employees/access'

export type McpAuthContext = {
  tenant: Tenant
  member: Member
  tokenId: string
  tokenLabel: string
}

export class McpUnauthorized extends Error {
  constructor(message = 'Missing or invalid key. Create one on the Integrations page under "Connect your AI".') {
    super(message)
    this.name = 'McpUnauthorized'
  }
}

/** Pull the raw key out of the request, header first, then the URL. */
export function extractMcpToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const m = auth.match(/^Bearer\s+(\S+)$/i)
  if (m && MCP_TOKEN_RE.test(m[1])) return m[1]
  try {
    const u = new URL(req.url)
    const q = u.searchParams.get('k') ?? u.searchParams.get('key') ?? u.searchParams.get('token')
    if (q && MCP_TOKEN_RE.test(q)) return q
  } catch {
    /* unparsable url → no key */
  }
  return null
}

export async function requireMcpAuth(req: Request): Promise<McpAuthContext> {
  const raw = extractMcpToken(req)
  if (!raw) throw new McpUnauthorized()

  const row = await findLiveMcpToken(raw)
  if (!row) throw new McpUnauthorized('This key is not valid or has been turned off.')

  const { data: tenant, error } = await supabase
    .from('reps')
    .select('*')
    .eq('id', row.rep_id)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(`reps lookup: ${error.message}`)
  if (!tenant) throw new McpUnauthorized('The account behind this key is no longer active.')

  let member: Member | null = null
  if (row.member_id) {
    const m = await getMemberById(row.member_id)
    // A key made by a member who has left (or moved) dies with them. It never
    // falls through to the owner's data.
    if (!m || !m.is_active || m.rep_id !== row.rep_id) throw new McpUnauthorized('The person behind this key no longer has access.')
    member = m
  }
  if (!member) member = await getOwnerMember(row.rep_id)
  if (!member) throw new McpUnauthorized('No active member for this key.')
  // Employee logins see their own page only; they never get the org's data over MCP.
  if (isEmployeeOnlyMember(member, tenant as Tenant)) throw new McpUnauthorized('This login can only see its own page.')

  return { tenant: tenant as Tenant, member, tokenId: row.id, tokenLabel: row.label }
}
