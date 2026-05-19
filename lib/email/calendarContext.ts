// Shared helper that pulls a rep's next-7-business-days free slots from
// Google Calendar so the email-reply drafter can suggest times that
// actually fit. Used by both the triage worker (lib/email/triageTick.ts)
// and the in-dashboard Regenerate server action
// (app/dashboard/inbox/EmailTab.tsx).
//
// Returns null when Calendar isn't connected so the caller can degrade
// gracefully — the drafter will then refuse to propose specific times
// instead of inventing them.

import { findFreeSlots } from '@/lib/google'
import type { AvailableSlot } from '@/lib/claude'

export type CalendarContext = { slots: AvailableSlot[]; timezone: string }

const LOOKAHEAD_DAYS = 7
const SLOT_DURATION_MINUTES = 30
const SLOT_COUNT = 12
const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 17

export async function loadCalendarContext(
  repId: string,
  memberId: string | null,
  timezone: string,
): Promise<CalendarContext | null> {
  const from = new Date()
  const to = new Date(from.getTime() + LOOKAHEAD_DAYS * 24 * 3600_000)
  const slots = await findFreeSlots(repId, {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    durationMinutes: SLOT_DURATION_MINUTES,
    count: SLOT_COUNT,
    tz: timezone,
    businessStartHour: BUSINESS_START_HOUR,
    businessEndHour: BUSINESS_END_HOUR,
    memberId,
  })
  if (slots === null) return null
  return { slots, timezone }
}
