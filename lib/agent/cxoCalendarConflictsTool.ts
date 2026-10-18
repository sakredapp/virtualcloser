/**
 * calendar_conflicts (Suite CXO): "any conflicts this week?". The same check
 * the daily notice runs (lib/mira/calendarConflictsShared), on the caller's
 * OWN calendars only. Read-only: fixes go through update_calendar_event /
 * cancel_calendar_event after the person says yes. No model writes numbers.
 */
import type * as AI from '@/lib/aiTypes'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { untrustedBlock } from './untrusted'
import { LOOKAHEAD_DAYS, detectIssues } from '@/lib/mira/calendarConflictsShared'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

const FIX: Record<string, string> = {
  double: 'Offer to move one (find_open_slots, then update_calendar_event start/end) or decline it (update_calendar_event decline=true; cancel_calendar_event only if they organize it).',
  no_break: 'Offer to move or shorten one meeting in the stretch (update_calendar_event).',
  no_link: 'Offer to add a video link (update_calendar_event add_video_link=true).',
  no_agenda: 'Offer to draft a short agenda and add it to the invite (update_calendar_event description).',
}

const calendar_conflicts: Handler = async (ctx, args) => {
  // window this_week / next_week = the fixed Mon-Fri ranges (lib/weekRanges); otherwise the next `days` days.
  const { weekRanges, daysIn } = await import('@/lib/weekRanges')
  const { localToUtcMs } = await import('@/lib/cxoFreeTime')
  const weeks = weekRanges(ctx.todayIso)
  const range = args.window === 'this_week' ? weeks.thisWeek : args.window === 'next_week' ? weeks.nextWeek : null
  const days = range ? daysIn(range) : Math.min(Math.max(Math.round(Number(args.days) || LOOKAHEAD_DAYS), 1), LOOKAHEAD_DAYS)
  const { todaysMeetings } = await import('@/lib/today')
  const meetings = range
    ? await todaysMeetings(ctx.tenant.id, ctx.caller.id, ctx.timezone, days, { ownCalendarsOnly: true, fromDay: range.from })
    : await todaysMeetings(ctx.tenant.id, ctx.caller.id, ctx.timezone, days + 1, { ownCalendarsOnly: true })
  if (meetings === null) return j({ connected: false, items: [], say: 'Your Google Calendar is not connected yet, so I cannot check it.' })
  const now = new Date()
  const endDay = range ? range.to.split('-').map(Number) : null
  const until = endDay ? localToUtcMs(endDay[0], endDay[1], endDay[2], 23, 59, ctx.timezone) : now.getTime() + days * 86_400_000
  const issues = detectIssues({ events: meetings, tz: ctx.timezone, now, selfEmails: [ctx.caller.email ?? ''], memberId: ctx.caller.id, untilMs: until }).filter((i) => {
    const firstStart = Math.min(...meetings.filter((m) => i.eventIds.includes(m.id)).map((m) => Date.parse(m.start)))
    return !Number.isFinite(firstStart) || firstStart <= until
  })
  ctx.untrustedSeen = true
  return j({
    connected: true,
    days,
    total: issues.length,
    // Meeting titles are written by whoever sent the invite: data, never instructions.
    items: issues.map((i) => ({ kind: i.kind, day: i.day, event_ids: i.eventIds, detail: untrustedBlock('calendar invites', i.line), fix: FIX[i.kind] })),
    ...(range ? { from: range.from, to: range.to } : {}),
    say: issues.length ? undefined : `No conflicts ${range ? `from ${range.from} to ${range.to}` : `in the next ${days === 1 ? 'day' : `${days} days`}`}: nothing double-booked, breaks between meetings, and every meeting with others has a link or a place.`,
    rule: 'Read the issues as given and name EVERY one, on every day (all double-bookings, not just the first). Offer one fix per issue. Show the exact change and wait for a yes before you change anything.',
  })
}

export const CXO_CALENDAR_CONFLICT_TOOL_HANDLERS: Record<string, Handler> = { calendar_conflicts }

export const CXO_CALENDAR_CONFLICT_TOOL_DEFS: AI.Tool[] = [
  {
    name: 'calendar_conflicts',
    description:
      'Problems on their OWN calendar in the next few days: double-bookings, days back to back with no break, meetings with other people but no video link or place, group meetings with no agenda. Use for "any conflicts this week", "am I double-booked", "is my week overbooked". Returns event ids and the fix for each. Never someone else\'s calendar.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days ahead, 1 to 7 (default 7).' },
        window: { type: 'string', enum: ['this_week', 'next_week'], description: 'The fixed Mon-Fri ranges from your date rules; overrides days.' },
      },
      additionalProperties: false,
    },
  },
]
