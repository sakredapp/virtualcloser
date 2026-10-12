/**
 * The line a connected Claude may not cross on its own (owner 10-11).
 *
 * Anything that leaves the person's hands (sending an email or a message,
 * booking, moving or cancelling a calendar event, approving a daily queue
 * item) runs over MCP only with `confirm: true`, which the model is told to
 * pass only after the person has said yes to a readback. Without it the
 * server refuses and nothing happens. Pure, so the rule is unit-tested.
 */

/** Tools that always leave the person's hands. */
const ALWAYS = new Set(['send_partner_message', 'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event', 'approve_queue_item'])

/** Would this call send or book something? */
export function isOutbound(tool: string, args: Record<string, unknown> = {}): boolean {
  if (ALWAYS.has(tool)) return true
  // A reply is a Gmail draft unless it is told to send.
  if (tool === 'reply_to_thread') return args.mode === 'send'
  // With only a window it lists open times; with a start, or pick_first, it books.
  if (tool === 'schedule_call_with_partner') return !!args.start || args.pick_first === true
  return false
}

export const CONFIRM_REFUSAL =
  "Not done. This would send or book something, so it needs the person's yes first. Read back exactly what will happen (to whom, what, when), wait for them to agree, then call again with confirm: true."

/** null = go ahead; a string = refuse with these words. Only the literal `true` counts. */
export function outboundRefusal(tool: string, args: Record<string, unknown> = {}): string | null {
  if (!isOutbound(tool, args)) return null
  return args.confirm === true ? null : CONFIRM_REFUSAL
}

/** The handlers behind the tools never see `confirm`. */
export function withoutConfirm(args: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...args }
  delete rest.confirm
  return rest
}
