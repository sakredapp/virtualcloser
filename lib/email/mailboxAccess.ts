// Who may see which synced mailbox (owner 10-09, security).
//
// Every member sees ONLY mail from their own connected Google account. There
// is no workspace-wide "All" view and no general "Shared" view:
//
//   • Their own mailbox: email_threads.owner_member_id = member.id, and only
//     while the member has a google_tokens row of their own (member_id).
//   • The tenant-level mailbox (google_tokens.member_id null, threads with
//     owner_member_id null): only the member who genuinely owns it, meaning
//     the connected address is their login email, or they are the workspace
//     owner (the OAuth callback stores the owner's account at tenant level).
//     Only threads synced since that account was connected count: older
//     tenant-level threads came from a previous, now-disconnected mailbox
//     (e.g. a former member's) and are visible to nobody.
//   • An inactive or removed member's mailbox is visible to nobody.
//
// Nothing here deletes mail; it only decides access. Every Inbox read and
// action, Mira's Gmail tools and the MCP inbox tools go through it.

import { supabase } from '@/lib/supabase'

export type MailboxMember = {
  id: string
  rep_id: string
  email: string | null
  role: string | null
  is_active?: boolean | null
}

export type MailboxTokenRow = {
  id: string
  member_id: string | null
  email: string | null
  created_at: string | null
}

export type Mailbox = {
  /** Picker key: the member's own id, or 'workspace' for the tenant-level box they own. */
  key: string
  kind: 'own' | 'workspace'
  /** google_tokens row id (pass as accountId to Gmail helpers). */
  accountId: string
  /** owner_member_id the threads carry: member id, or null for the tenant-level box. */
  memberId: string | null
  email: string | null
  label: string
  /** Only threads created at/after this count (tenant-level box only). */
  since: string | null
}

export type MailboxScope = {
  tenantId: string
  memberId: string
  mailboxes: Mailbox[]
}

export const WORKSPACE_KEY = 'workspace'

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Pure: the mailboxes `member` may see, given the tenant's google_tokens rows. */
export function computeMailboxScope(
  tenantId: string,
  member: MailboxMember | null,
  tokens: MailboxTokenRow[],
): MailboxScope {
  const empty: MailboxScope = { tenantId, memberId: member?.id ?? '', mailboxes: [] }
  if (!member || member.rep_id !== tenantId || member.is_active === false) return empty

  const mailboxes: Mailbox[] = []
  // Synced threads carry the member, not the Google account, so a member's
  // own connections are one mailbox (their oldest account sends/reads).
  const own = tokens
    .filter((t) => t.member_id === member.id)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .slice(0, 1)
  own.forEach((t) => {
    mailboxes.push({
      key: member.id,
      kind: 'own',
      accountId: t.id,
      memberId: member.id,
      email: t.email,
      label: t.email ? `My inbox · ${t.email}` : 'My inbox',
      since: null,
    })
  })

  const workspace = tokens
    .filter((t) => t.member_id === null)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const isOwner = member.role === 'owner'
  const mine = workspace.filter((t) => isOwner || (lower(t.email) !== '' && lower(t.email) === lower(member.email)))
  if (mine.length > 0) {
    const first = mine[0]
    mailboxes.push({
      key: WORKSPACE_KEY,
      kind: 'workspace',
      accountId: first.id,
      memberId: null,
      email: first.email,
      label: first.email ? `My workspace inbox · ${first.email}` : 'My workspace inbox',
      // Threads synced before the CURRENT tenant-level account was connected
      // belong to an earlier mailbox. Missing created_at = trust nothing old.
      since: first.created_at ?? new Date().toISOString(),
    })
  }
  return { tenantId, memberId: member.id, mailboxes }
}

async function loadTokens(tenantId: string): Promise<MailboxTokenRow[]> {
  const { data } = await supabase
    .from('google_tokens')
    .select('id, member_id, email, created_at')
    .eq('rep_id', tenantId)
  return (data ?? []) as MailboxTokenRow[]
}

/** The logged-in member's mailboxes. */
export async function getMailboxScope(tenantId: string, member: MailboxMember): Promise<MailboxScope> {
  return computeMailboxScope(tenantId, member, await loadTokens(tenantId))
}

/** Same, when only the member id is known (Mira, partner sends, digests). */
export async function getMailboxScopeById(tenantId: string, memberId: string | null | undefined): Promise<MailboxScope> {
  if (!memberId) return { tenantId, memberId: '', mailboxes: [] }
  const { data } = await supabase
    .from('members')
    .select('id, rep_id, email, role, is_active')
    .eq('id', memberId)
    .eq('rep_id', tenantId)
    .maybeSingle()
  const member = (data as MailboxMember | null) ?? null
  if (!member) return { tenantId, memberId, mailboxes: [] }
  return computeMailboxScope(tenantId, member, await loadTokens(tenantId))
}

export function hasMailbox(scope: MailboxScope): boolean {
  return scope.mailboxes.length > 0
}

/**
 * Which mailbox a request asks for. Missing / 'all' → the member's default
 * (own first, else their workspace box). Their own id or 'workspace' → that
 * box if they own it. Anything else ('shared', another member's id, a box
 * they don't own) → null: the caller returns nothing / 403.
 */
export function resolveMailbox(scope: MailboxScope, requested?: string | null): Mailbox | null {
  if (scope.mailboxes.length === 0) return null
  const r = (requested ?? '').trim()
  if (!r || r === 'all') return scope.mailboxes[0]
  return scope.mailboxes.find((m) => m.key === r) ?? null
}

/** Picker options: only the member's own boxes. Never "All", never a general "Shared". */
export function mailboxOptions(scope: MailboxScope): Array<{ key: string; label: string }> {
  return scope.mailboxes.map((m) => ({ key: m.key, label: m.label }))
}

type ThreadLike = { rep_id?: string | null; owner_member_id: string | null; created_at?: string | null }

/** Is this one thread inside `box`? */
export function threadInMailbox(box: Mailbox, scope: MailboxScope, t: ThreadLike): boolean {
  if (t.rep_id != null && t.rep_id !== scope.tenantId) return false
  if (box.kind === 'own') return t.owner_member_id === box.memberId
  if (t.owner_member_id !== null) return false
  if (!box.since) return true
  if (!t.created_at) return false
  return Date.parse(t.created_at) >= Date.parse(box.since)
}

/** Is this thread inside ANY mailbox the member may see? Returns that box. */
export function mailboxForThread(scope: MailboxScope, t: ThreadLike): Mailbox | null {
  return scope.mailboxes.find((b) => threadInMailbox(b, scope, t)) ?? null
}

/**
 * Narrow an email_threads query to one mailbox. The query must already be
 * filtered by rep_id. Works on any PostgREST builder (email_threads or
 * email_drafts, both carry owner_member_id + created_at).
 */
type ScopeBuilder = {
  eq: (c: string, v: string) => ScopeBuilder
  is: (c: string, v: null) => ScopeBuilder
  gte: (c: string, v: string) => ScopeBuilder
}

export function scopeThreadQuery<Q>(q: Q, box: Mailbox): Q {
  const b = q as unknown as ScopeBuilder
  if (box.kind === 'own') return b.eq('owner_member_id', box.memberId as string) as unknown as Q
  let out = b.is('owner_member_id', null)
  if (box.since) out = out.gte('created_at', box.since)
  return out as unknown as Q
}

/**
 * Load one thread by id and return it only when it sits in a mailbox the
 * member may see. Every server action that reads, drafts, sends, snoozes,
 * archives or dismisses a thread calls this first.
 */
export async function loadThreadForMember<T extends ThreadLike & { id: string }>(
  scope: MailboxScope,
  threadId: string,
  columns: string,
): Promise<{ thread: T; mailbox: Mailbox } | null> {
  if (!threadId || scope.mailboxes.length === 0) return null
  const cols = Array.from(new Set(['id', 'rep_id', 'owner_member_id', 'created_at', ...columns.split(',').map((c) => c.trim()).filter(Boolean)])).join(', ')
  const { data } = await supabase
    .from('email_threads')
    .select(cols)
    .eq('id', threadId)
    .eq('rep_id', scope.tenantId)
    .maybeSingle()
  const thread = (data as unknown as T | null) ?? null
  if (!thread) return null
  const mailbox = mailboxForThread(scope, thread)
  return mailbox ? { thread, mailbox } : null
}
