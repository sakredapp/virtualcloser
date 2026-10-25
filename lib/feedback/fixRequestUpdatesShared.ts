// Client updates on a "Request a change / report an issue" (fix_requests), at
// the pace the member chose. Pure: no I/O, so the rules are testable. The send
// path is lib/feedback/fixRequestUpdates.ts.
//
// Same rules as Virtual Closer's ticket updates (crmbuilds
// api/_lib/support-ticket-client-update.ts):
//   - ack, started and done always go; only "progress" is paced;
//   - start_done: never a progress update; daily: one per 24h; every_step: all;
//   - not asked yet: every update goes, and the ack asks which pace they want.
// The title names the report by a short ref, never by what they wrote: the
// body is the member's own free text and is never echoed back in a notice or
// email subject.

export const TICKET_UPDATE_PACES = ['start_done', 'daily', 'every_step'] as const
export type TicketUpdatePace = (typeof TICKET_UPDATE_PACES)[number]
export type FixRequestUpdateKind = 'ack' | 'started' | 'progress' | 'done'

import { FIX_REQUEST_NOTICE_PREFIX } from '@/lib/followups/noticeActionsShared'
/** Notice keys start with this (in ALWAYS_SHOWN_PREFIXES), so they show whether or not employee ops is on. */
export { FIX_REQUEST_NOTICE_PREFIX }

export const PACE_LABEL: Record<TicketUpdatePace, string> = {
  start_done: 'when we start and when it is fixed',
  daily: 'a short update once a day',
  every_step: 'every step',
}

export function normalizePace(v: unknown): TicketUpdatePace | null {
  return typeof v === 'string' && (TICKET_UPDATE_PACES as readonly string[]).includes(v) ? (v as TicketUpdatePace) : null
}

/** Accepts the pace ids and plain words ("daily", "every step", "just start and done"). */
export function parsePace(v: unknown): TicketUpdatePace | null {
  const exact = normalizePace(v)
  if (exact) return exact
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/every|each|all/.test(s)) return 'every_step'
  if (/daily|day/.test(s)) return 'daily'
  if (/start|done|fixed|finish|only/.test(s)) return 'start_done'
  return null
}

const DAY_MS = 24 * 3600_000

export function paceAllows(
  kind: FixRequestUpdateKind,
  pace: TicketUpdatePace | null,
  lastUpdateAt: string | null,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (kind !== 'progress') return { ok: true }
  if (pace === 'start_done') return { ok: false, reason: 'pace_start_done' }
  if (pace === 'daily' && lastUpdateAt) {
    const last = Date.parse(lastUpdateAt)
    if (Number.isFinite(last) && now.getTime() - last < DAY_MS) return { ok: false, reason: 'pace_daily_already_sent' }
  }
  return { ok: true }
}

export function fixRequestRef(id: string): string {
  return `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

export function titleFor(kind: FixRequestUpdateKind, id: string): string {
  const ref = fixRequestRef(id)
  switch (kind) {
    case 'ack': return `Got your report ${ref}`
    case 'started': return `We're working on your report ${ref}`
    case 'progress': return `Update on your report ${ref}`
    case 'done': return `Your report ${ref} is fixed`
  }
}

const ASK_PACE = 'How do you want updates on this: just when we start and when it is fixed, a short update once a day, or every step? Tell Ciao, for example "send me ticket updates daily".'
const ASK_AGAIN = 'Want a different pace for updates next time? Tell Ciao, for example "ticket updates every step".'

/**
 * The casual line the member reads. `note` is IT's "Customer note:" (already
 * plain and client-safe); without one each kind has a default line.
 */
export function bodyFor(kind: FixRequestUpdateKind, note: string | null, pace: TicketUpdatePace | null): string {
  const n = (note ?? '').trim().slice(0, 600)
  switch (kind) {
    case 'ack':
      return `Thanks, it's logged and the team has it.${pace ? ` We'll update you ${PACE_LABEL[pace]}.` : ` ${ASK_PACE}`}`
    case 'started':
      return n || "We've started on it. We'll let you know when it's done."
    case 'progress':
      return n || 'Still on it.'
    case 'done':
      return `${n || "This one's fixed."} ${ASK_AGAIN}`
  }
}

/** One notice per kind; progress notes get their own key each time. */
export function noticeKey(kind: FixRequestUpdateKind, id: string, now: Date = new Date()): string {
  return `${FIX_REQUEST_NOTICE_PREFIX}${id}:${kind}${kind === 'progress' ? `:${now.getTime()}` : ''}`
}
