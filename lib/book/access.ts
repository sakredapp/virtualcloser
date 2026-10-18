/**
 * Who may read the producer book (agent production) — one rule for Ciao's
 * producer_production tool and the recurring production report.
 *
 * Which book: a tenant on the Pinnacle allow-list (PINNACLE_VIEWER_REP_IDS,
 * lib/pinnacle/access) reads Pinnacle's agent rollup; any other tenant reads
 * its own cxo_book_* rows (empty = not set up). Nothing is keyed to one
 * person or one account id here.
 *
 * Who inside the tenant: the same people who see the Book card on Today and
 * the Revenue page — any executive member (owner, admin, manager, ...). Not
 * an employee login (rep/observer on an exec tenant), not an assistant, and
 * not an assistant acting as their executive.
 */
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { isEmployeeOnlyMember } from '@/lib/employees/access'

export type BookSource = 'pinnacle' | 'tenant'

type TenantLike = { id: string; brand?: string | null }
type MemberLike = { role?: string | null; acting_assistant?: unknown }

export function bookSourceFor(tenantId: string | null | undefined): BookSource {
  return pinnacleAllowed(tenantId) ? 'pinnacle' : 'tenant'
}

export function canSeeBook(member: MemberLike | null | undefined, tenant: TenantLike | null | undefined, env?: Record<string, string | undefined>): boolean {
  if (!member || !tenant?.id) return false
  if (isEmployeeOnlyMember(member, tenant, env)) return false
  if (member.role === 'assistant' || member.acting_assistant) return false
  return true
}
