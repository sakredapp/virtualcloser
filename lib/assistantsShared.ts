/**
 * Exec assistant seats: the pure rules (no I/O), shared by the server gate,
 * the UI and the tests.
 *
 * An assistant is a member with role 'assistant', linked to one or more execs
 * (cxo_exec_assistants). On WORK paths the session acts as the exec they are
 * working for; on SELF paths it is the assistant themself; every other path
 * is BLOCKED (default deny), so a new page is closed to assistants until it is
 * added here on purpose.
 */

export type AssistantPathKind = 'work' | 'self' | 'blocked'

/** Pages and APIs where the assistant works as the exec. */
export const WORK_EXACT = ['/dashboard'] as const
export const WORK_PREFIXES = [
  '/dashboard/calendar',
  '/dashboard/boards',
  '/dashboard/meetings',
  '/api/today',
  '/api/messages',
  '/api/boards',
  '/api/calendar/ics',
] as const

/** Pages and APIs where the assistant is themself (their own login). */
export const SELF_EXACT = ['/', '/login', '/logout', '/set-password', '/reset-password', '/forgot-password'] as const
export const SELF_PREFIXES = [
  '/dashboard/settings',
  '/dashboard/assistant',
  '/api/assistant',
  '/api/me/liability',
  '/login',
  '/logout',
  '/set-password',
  '/reset-password',
  '/forgot-password',
] as const

/** Segment-boundary prefix match: /api/today matches /api/today and /api/today/x, never /api/todayx. */
export function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function normalize(path: string | null | undefined): string | null {
  if (!path || typeof path !== 'string') return null
  let p = path.split('?')[0].split('#')[0]
  if (!p.startsWith('/')) return null
  // Collapse duplicate slashes and refuse dot segments outright.
  p = p.replace(/\/{2,}/g, '/')
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return null
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p.toLowerCase()
}

/** What an assistant may do on this path. Unknown or missing paths are blocked. */
export function assistantPathKind(path: string | null | undefined): AssistantPathKind {
  const p = normalize(path)
  if (!p) return 'blocked'
  if ((SELF_EXACT as readonly string[]).includes(p)) return 'self'
  if (SELF_PREFIXES.some((x) => underPrefix(p, x))) return 'self'
  if ((WORK_EXACT as readonly string[]).includes(p)) return 'work'
  if (WORK_PREFIXES.some((x) => underPrefix(p, x))) return 'work'
  return 'blocked'
}

export const isApiPath = (path: string | null | undefined) => !!path && (path === '/api' || path.startsWith('/api/'))

export type ExecLink = { exec_member_id: string; exec_name: string; exec_email?: string | null }

/** The exec the assistant is working for: the cookie's pick when it is still an active link, else the first. */
export function pickActiveExec<T extends { exec_member_id: string }>(links: T[], cookieId: string | null | undefined): T | null {
  if (!links.length) return null
  if (cookieId) {
    const hit = links.find((l) => l.exec_member_id === cookieId)
    if (hit) return hit
  }
  return links[0]
}

/** First name, or the email's local part. */
export function shortName(name: string | null | undefined, email?: string | null): string {
  const n = (name || '').trim()
  if (n) return n.split(/\s+/)[0]
  return (email || '').split('@')[0] || 'Someone'
}

/** "by Pat for Mike" — the label shown wherever an assistant's work appears. */
export function actingLabel(assistantName: string | null | undefined, execName: string | null | undefined): string {
  const a = shortName(assistantName)
  const e = (execName || '').trim() ? shortName(execName) : ''
  return e ? `by ${a} for ${e}` : `by ${a}`
}

export type Eligible = { id: string; rep_id: string; role: string; is_active: boolean }

/** Who can have an assistant: an active owner/admin in the same org. Assistants never have assistants. */
export function canHaveAssistant(exec: Eligible | null | undefined, repId: string): boolean {
  return !!exec && exec.is_active && exec.rep_id === repId && (exec.role === 'owner' || exec.role === 'admin')
}

/**
 * Can this email become (or be re-linked as) an assistant? A brand-new email is
 * fine; an existing member in the org only when they already are an assistant
 * (so an exec's own login is never turned into an assistant), never across orgs.
 */
export function canLinkAssistant(
  existing: { rep_id: string; role: string } | null | undefined,
  repId: string,
  execId: string,
  existingId?: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (!existing) return { ok: true }
  if (existingId && existingId === execId) return { ok: false, reason: 'That is your own login.' }
  if (existing.rep_id !== repId) return { ok: false, reason: 'That email already has a login somewhere else. Use a different email.' }
  if (existing.role !== 'assistant') return { ok: false, reason: 'That person already has their own login here, so they cannot be an assistant.' }
  return { ok: true }
}

export type ActivityArea = 'boards' | 'messages' | 'todos' | 'calendar' | 'meetings'

const clip = (v: unknown, n = 80) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** One readable line for the activity feed, from the API body the assistant sent. Null = not worth a line (reads, reorders). */
export function describeAction(area: ActivityArea, body: Record<string, unknown>): { action: string; summary: string } | null {
  const op = typeof body.op === 'string' ? body.op : ''
  const q = (v: unknown) => (clip(v) ? ` "${clip(v)}"` : '')
  if (area === 'todos') {
    switch (op) {
      case 'add': return { action: op, summary: `Added a to-do${q(body.body)}` }
      case 'set': return { action: op, summary: typeof body.done === 'boolean' ? (body.done ? 'Checked off a to-do' : 'Reopened a to-do') : 'Edited a to-do' }
      case 'delete': return { action: op, summary: 'Removed a to-do' }
      case 'toCard': return { action: op, summary: 'Moved a to-do to a board' }
      case 'cardToTodo': return { action: op, summary: 'Moved a board card to the to-dos' }
      case 'cardDone': return { action: op, summary: 'Finished a board card' }
      case 'confirmDone': return { action: op, summary: 'Confirmed a to-do as done' }
      case 'fromPartner': return { action: op, summary: 'Added a partner follow-up to the to-dos' }
      case 'draftEmail':
      case 'draftFollowup': return { action: op, summary: 'Drafted an email' }
      default: return null
    }
  }
  if (area === 'messages') {
    switch (op) {
      case 'send': return { action: op, summary: `Sent a message${q(body.body)}` }
      case 'reply': return { action: op, summary: `Replied${q(body.body)}` }
      case 'todo': return { action: op, summary: 'Put a message on the to-dos' }
      default: return null
    }
  }
  if (area === 'boards') {
    switch (op) {
      case 'board.create': return { action: op, summary: `Made a board${q(body.name)}` }
      case 'board.rename': return { action: op, summary: `Renamed a board${q(body.name)}` }
      case 'board.delete': return { action: op, summary: 'Deleted a board' }
      case 'board.import': return { action: op, summary: 'Imported a board' }
      case 'card.create': return { action: op, summary: `Added a card${q(body.title)}` }
      case 'card.update': return { action: op, summary: 'Edited a card' }
      case 'card.delete': return { action: op, summary: 'Deleted a card' }
      case 'card.assign': return { action: op, summary: 'Assigned a card' }
      case 'list.create': return { action: op, summary: `Added a column${q(body.title)}` }
      case 'list.delete': return { action: op, summary: 'Deleted a column' }
      case 'check.add': return { action: op, summary: 'Added a checklist item' }
      default: return null
    }
  }
  if (area === 'calendar') {
    if (op === 'add') return { action: op, summary: `Added a calendar${q(body.label)}` }
    if (op === 'remove') return { action: op, summary: 'Removed a calendar' }
    return null
  }
  return null
}
