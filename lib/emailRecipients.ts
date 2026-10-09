/**
 * Who an email goes to, by name — a lead in `leads`, a partner in
 * `cxo_partners`, or a teammate in `members`. One resolver so the
 * send_email intent, Mira and the MCP server all agree on who "Dana" is.
 */

import { supabase } from '@/lib/supabase'

export type RecipientKind = 'lead' | 'partner' | 'member'
export type EmailRecipient = { kind: RecipientKind; id: string; name: string; email: string | null }

const like = (name: string) => `%${name.replace(/[%_]/g, '')}%`

async function findLead(repId: string, name: string): Promise<EmailRecipient | null> {
  const { data } = await supabase.from('leads').select('id, name, email').eq('rep_id', repId).ilike('name', like(name)).limit(1).maybeSingle()
  return data ? { kind: 'lead', id: String(data.id), name: String(data.name), email: (data.email as string | null) ?? null } : null
}

async function findPartner(repId: string, name: string): Promise<EmailRecipient | null> {
  const { data, error } = await supabase.from('cxo_partners').select('id, name, email').eq('rep_id', repId).or(`name.ilike.${like(name)},org.ilike.${like(name)}`).limit(1).maybeSingle()
  if (error) return null // table absent on tenants without the Partners migration
  return data ? { kind: 'partner', id: String(data.id), name: String(data.name), email: (data.email as string | null) ?? null } : null
}

async function findMember(repId: string, name: string): Promise<EmailRecipient | null> {
  const { data } = await supabase
    .from('members')
    .select('id, display_name, email')
    .eq('rep_id', repId)
    .eq('is_active', true)
    .or(`display_name.ilike.${like(name)},email.ilike.${like(name)}`)
    .limit(1)
    .maybeSingle()
  return data ? { kind: 'member', id: String(data.id), name: String(data.display_name ?? data.email), email: (data.email as string | null) ?? null } : null
}

/**
 * Resolve a name to a recipient. `hint` narrows to one kind; without it the
 * order is lead → partner → member (leads first because that is what every
 * sales tenant means by a name).
 */
export async function resolveEmailRecipient(repId: string, name: string, hint?: RecipientKind | null): Promise<EmailRecipient | null> {
  const q = name.trim()
  if (!q) return null
  const order: RecipientKind[] = hint ? [hint] : ['lead', 'partner', 'member']
  for (const kind of order) {
    const hit = kind === 'lead' ? await findLead(repId, q) : kind === 'partner' ? await findPartner(repId, q) : await findMember(repId, q)
    if (hit) return hit
  }
  return null
}
