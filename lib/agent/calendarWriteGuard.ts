/**
 * More than two calendar writes in one turn needs the person's yes first
 * (QA X-calendar-08, 2026-10-18: "every Monday for 10 weeks" became ten
 * create_calendar_event calls with no confirmation).
 *
 * runAgent tells the context how many calendar writes the model asked for in
 * the current batch (noteCalendarBatch) before any handler runs, so a batch of
 * ten is held as a whole, not after the first two already went out. Each
 * write handler calls calendarWriteGate first: null means go, otherwise it
 * returns the confirmation ask. A repeat should be one event with a
 * recurrence, so the ask says so.
 */

import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'

export const CALENDAR_WRITE_TOOLS = new Set(['create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'schedule_call_with_partner'])

/** Writes allowed in one turn before the person has to say yes. */
export const CALENDAR_WRITES_FREE = 2

/** Called by runAgent once per model response, before any tool in it runs. */
export function noteCalendarBatch(ctx: AgentContext, toolNames: string[]): void {
  const n = toolNames.filter((t) => CALENDAR_WRITE_TOOLS.has(t)).length
  if (n) ctx.calendarWritesProjected = (ctx.calendarWrites ?? 0) + n
}

export function calendarWriteGate(ctx: AgentContext, args: Record<string, unknown>, what: string): ToolHandlerResult | null {
  const done = ctx.calendarWrites ?? 0
  const projected = Math.max(ctx.calendarWritesProjected ?? 0, done + 1)
  if (projected > CALENDAR_WRITES_FREE && args.confirmed !== true) {
    return {
      text: JSON.stringify({
        ok: false,
        needs_confirmation: true,
        held: what,
        calendar_writes_this_turn: projected,
        say: `That is ${projected} calendar changes in one go, so nothing past the first ${CALENDAR_WRITES_FREE} is done yet. If this is a repeating meeting, it should be ONE event with a recurrence (create_calendar_event with recurrence), not one event per date.`,
        ask: `I'm about to make ${projected} calendar changes. Should I go ahead? (If these are the same meeting repeating, I'll book it as one repeating event instead.)`,
      }),
    }
  }
  // Counted before any await, so two calls in the same batch can never both slip under the line.
  ctx.calendarWrites = done + 1
  return null
}
