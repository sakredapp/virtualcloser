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
 * Like getMemberByEmail but includes soft-deleted (is_active=false) rows. The
 * unique index members(rep_id, lower(email)) ignores is_active, so re-inviting
 * someone who was removed must REACTIVATE the existing row, not insert a new one
 * (which would throw a unique violation). At most one row per (rep, email).
 */
export async function getMemberByEmailAnyStatus(repId: string, email: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
    .ilike('email', email)
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

/**
 * Every member of an account. Exec assistants (role 'assistant') are left out
 * unless asked for: they are not on the team, never get briefs, digests or
 * nudges, and never show up as people to assign or message.
 */
export async function listMembers(repId: string, opts: { includeAssistants?: boolean } = {}): Promise<Member[]> {
  let q = supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
  if (!opts.includeAssistants) q = q.neq('role', 'assistant')
  const { data, error } = await q
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Member[]
}

/** Find a member within a rep account by their slug (the URL handle for /u/<slug>). */
export async function findMemberBySlug(repId: string, slug: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('rep_id', repId)
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
}

/** Look up the member that owns a Telegram /link CODE (across all tenants). */
export async function findMemberByLinkCode(code: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('telegram_link_code', code)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
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

/**
 * Resolve the most-specific member for a Telegram chat.
 *  1. Member whose `telegram_chat_id` matches → that member.
 *  2. Otherwise, fall back to the owner of the rep that owns this chat (legacy path).
 *  3. Returns null if neither matches.
 */
export async function resolveMemberByTelegramChat(
  chatId: number | string,
  repId: string,
): Promise<Member | null> {
  const idStr = String(chatId)
  const { data: byMember } = await supabase
    .from('members')
    .select('*')
    .eq('telegram_chat_id', idStr)
    .eq('rep_id', repId)
    .eq('is_active', true)
    .maybeSingle()
  if (byMember) return byMember as Member
  return getOwnerMember(repId)
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

/**
 * Seat usage for a tenant. `max` is the super-admin-set cap (NULL = unlimited).
 * `used` counts active members regardless of role — owner counts as a seat
 * since they pay for that seat too. Callers can opt out of counting the
 * owner with `excludeOwner: true` if they want a "reps invited" count.
 */
export async function getSeatUsage(
  repId: string,
  opts: { excludeOwner?: boolean } = {},
): Promise<{ used: number; max: number | null }> {
  const [activeMembers, repRow] = await Promise.all([
    supabase
      .from('members')
      .select('id, role')
      .eq('rep_id', repId)
      .eq('is_active', true),
    supabase.from('reps').select('max_seats').eq('id', repId).maybeSingle(),
  ])
  if (activeMembers.error) throw activeMembers.error
  // Exec assistants ride on their exec's seat.
  const rows = ((activeMembers.data ?? []) as Array<{ id: string; role: string }>).filter((r) => r.role !== 'assistant')
  const used = opts.excludeOwner
    ? rows.filter((r) => r.role !== 'owner').length
    : rows.length
  const max = (repRow.data as { max_seats: number | null } | null)?.max_seats ?? null
  return { used, max }
}

/**
 * Throw if creating one more member would exceed the seat cap.
 * Owners + admins should call this *before* createMember in self-serve flows.
 * Returns silently when no cap is set or there's room.
 */
export async function assertSeatAvailable(repId: string): Promise<void> {
  const { used, max } = await getSeatUsage(repId)
  if (max !== null && used >= max) {
    throw new Error(
      `Seat cap reached (${used}/${max}). Contact your account manager to add more seats.`,
    )
  }
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
  if (patch.is_active === false) await disconnectMemberCalendars(id)
}

/**
 * Someone who left keeps no calendar here: their Google connection and any
 * subscribed calendar feeds are removed when they are deactivated, so their
 * events stop showing for the team and nothing syncs on their behalf.
 * Past meetings already on the CRM stay. Reactivating means connecting again.
 */
export async function disconnectMemberCalendars(memberId: string): Promise<void> {
  const [g, f] = await Promise.all([
    supabase.from('google_tokens').delete().eq('member_id', memberId),
    supabase.from('cxo_ics_feeds').delete().eq('member_id', memberId),
  ])
  if (g.error) console.error('[members] remove google calendar', g.error)
  if (f.error) console.error('[members] remove calendar feeds', f.error)
}

export async function recordMemberLogin(id: string): Promise<void> {
  await updateMember(id, { last_login_at: new Date().toISOString() })
  // Settings › Usage counts logins per day. Never blocks or fails a login.
  try {
    const { data } = await supabase.from('members').select('rep_id, timezone').eq('id', id).maybeSingle()
    if (data?.rep_id) {
      const { recordHit } = await import('@/lib/cxoUsage')
      await recordHit(data.rep_id as string, id, '/login', { tz: (data.timezone as string | null) ?? null, bump: true })
    }
  } catch (err) {
    console.error('[members] login count', err)
  }
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
