import { supabase } from './supabase'
import { generateLinkCode, slugify } from './random'
import type { Member, MemberRole } from '@/types'

/**
 * Members = humans inside an account. Every account (rep) has exactly one
 * 'owner' member (auto-created on signup via the schema backfill / trigger).
 * Additional members are invited by owners/admins.
 */

export async function getMemberById(id: string): Promise<Member | null> {
  const { data, error } = await supabase.from('members').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
}

/** Look up a member by email within an account. Email match is case-insensitive. */
export async function getMemberByEmail(repId: string, email: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
    .ilike('email', email)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
}

/**
 * Find which account an email belongs to (used at login when we don't yet
 * know the tenant). Returns the first active member match.
 */
export async function findMemberByEmailGlobal(email: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .ilike('email', email)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
}

export async function listMembers(repId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Member[]
}

export async function getOwnerMember(repId: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
}

export async function getMemberTeamIds(memberId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('member_id', memberId)
  if (error) throw error
  return (data ?? []).map((r) => (r as { team_id: string }).team_id)
}

/** Teams that this member manages (teams.manager_member_id = member.id). */
export async function getManagedTeamIds(memberId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id')
    .eq('manager_member_id', memberId)
  if (error) throw error
  return (data ?? []).map((r) => (r as { id: string }).id)
}

export type CreateMemberInput = {
  repId: string
  email: string
  displayName: string
  role: MemberRole
  invitedBy?: string | null
  passwordHash?: string | null
  timezone?: string | null
  slug?: string | null
}

/** Pick a slug for a member that's unique within the rep account. */
async function pickUniqueSlug(repId: string, base: string): Promise<string> {
  const root = slugify(base)
  let candidate = root
  for (let n = 2; n < 100; n++) {
    const { data } = await supabase
      .from('members')
      .select('id')
      .eq('rep_id', repId)
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
    candidate = `${root}-${n}`
  }
  // Extremely unlikely fallthrough — append a short random tag.
  return `${root}-${Math.random().toString(36).slice(2, 6)}`
}

export async function createMember(input: CreateMemberInput): Promise<Member> {
  const linkCode = generateLinkCode()
  const slugSeed = input.slug ?? input.email.split('@')[0] ?? input.displayName
  const slug = await pickUniqueSlug(input.repId, slugSeed)
  const { data, error } = await supabase
    .from('members')
    .insert({
      rep_id: input.repId,
      email: input.email.toLowerCase().trim(),
      display_name: input.displayName,
      role: input.role,
      password_hash: input.passwordHash ?? null,
      invited_by: input.invitedBy ?? null,
      invited_at: new Date().toISOString(),
      timezone: input.timezone ?? null,
      telegram_link_code: linkCode,
      slug,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Member
}

export async function updateMember(
  id: string,
  patch: Partial<{
    email: string
    display_name: string
    role: MemberRole
    is_active: boolean
    password_hash: string | null
    telegram_chat_id: string | null
    telegram_link_code: string | null
    timezone: string | null
    last_login_at: string
    accepted_at: string
    settings: Record<string, unknown>
  }>,
): Promise<void> {
  const { error } = await supabase.from('members').update(patch).eq('id', id)
  if (error) throw error
}

export async function recordMemberLogin(id: string): Promise<void> {
  await updateMember(id, { last_login_at: new Date().toISOString() })
}

export async function logAuditEvent(input: {
  repId: string
  memberId: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  diff?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const { error } = await supabase.from('audit_events').insert({
    rep_id: input.repId,
    member_id: input.memberId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    diff: input.diff ?? null,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  })
  if (error) {
    // Don't blow up the calling action just because we couldn't log; warn instead.
    console.warn('[audit] failed to log event', { action: input.action, error: error.message })
  }
}
