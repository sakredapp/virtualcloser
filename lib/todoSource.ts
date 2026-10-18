/**
 * Where a to-do came from, in words a person reads (Ciao QA 2026-10-18: the
 * to-dos the assistant added showed "(from Mira)" on Suite CXO). The stored
 * source key stays 'mira' (an internal identifier); what people see is the
 * assistant's own name for this account. Pure, no imports beyond the name
 * default, so client and server can both use it.
 */
import { ASSISTANT_NAME } from '@/lib/assistantName'

export type TodoSourceFields = {
  source?: string | null
  source_label?: string | null
  meeting_title?: string | null
  partner_name?: string | null
}

export function todoSourceLabel(t: TodoSourceFields, assistantName: string = ASSISTANT_NAME): string {
  const src = String(t.source ?? '').toLowerCase()
  if (src === 'meeting' && t.meeting_title) return `meeting: ${t.meeting_title}`
  if (src === 'partner' && t.partner_name) return t.partner_name
  if (t.source_label && t.source_label.trim()) return t.source_label.trim()
  if (src === 'mira') return assistantName
  if (src === 'meeting') return 'a meeting'
  if (src === 'manual' || !src) return 'you'
  return displaySourceKey(src, assistantName)
}

/** A raw source key shown to a person: the internal 'mira' becomes the assistant's name. */
export function displaySourceKey(source: string | null | undefined, assistantName: string = ASSISTANT_NAME): string {
  const s = String(source ?? '')
  return /^mira$/i.test(s) ? assistantName : s
}
