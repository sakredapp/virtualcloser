// One number for "emails that need a reply", shared by Today (badge + morning
// brief) and the Inbox "Needs reply" bucket, so the two screens always agree.

import { supabase } from '@/lib/supabase'
import { scopeThreadQuery, type Mailbox, type MailboxScope } from '@/lib/email/mailboxAccess'

/** The Inbox bucket rule, as a predicate over one thread. */
export function threadNeedsReply(t: { status: string | null; needs_reply: boolean | null; priority: string | null }): boolean {
  return (t.status === 'new' || t.status === 'triaged') && !!t.needs_reply && t.priority !== 'noise'
}

/** Count of threads in `box` that need a reply (same rule as threadNeedsReply). Null when it can't be read. */
export async function countNeedsReply(scope: MailboxScope, box: Mailbox | null): Promise<number | null> {
  if (!box || !scope.mailboxes.some((m) => m.key === box.key)) return null
  let q = supabase.from('email_threads').select('id', { count: 'exact', head: true }).eq('rep_id', scope.tenantId)
  q = scopeThreadQuery(q, box)
  const { count, error } = await q.eq('needs_reply', true).in('status', ['new', 'triaged']).or('priority.is.null,priority.neq.noise')
  if (error) return null
  return count ?? 0
}
