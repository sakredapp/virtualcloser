// Small shared helper: turn a plaud_actions row into a one-line, human-readable
// description of what the assistant proposed. Used to give the guidance
// synthesizer (lib/plaud/guidance.ts) context about the action being dismissed
// or corrected, so the distilled rule generalizes correctly.

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function describeAction(
  kind: string,
  payload: Record<string, unknown> | null | undefined,
  targetEmail: string | null,
): string {
  const p = payload ?? {}
  const to = targetEmail || str(p.recipient) || str(p.assignee) || str(p.contact)
  const toPart = to ? ` to ${to}` : ''
  switch (kind) {
    case 'send_email':
      return `send_email${toPart} — subject "${str(p.subject)}"`
    case 'create_calendar_event':
      return `create_calendar_event${toPart} — "${str(p.title)}"${str(p.start_iso) ? ` at ${str(p.start_iso)}` : ''}`
    case 'create_task':
      return `create_task${toPart} — "${str(p.content)}"`
    case 'create_doc':
      return `create_doc (${str(p.doc_kind) || 'resource'}) — "${str(p.title)}"`
    case 'update_sheet':
      return `update_sheet${toPart} — "${str(p.status)}"`
    case 'notify_member':
      return `notify_member${toPart} — "${str(p.message).slice(0, 80)}"`
    default:
      return `${kind}${toPart}`
  }
}
