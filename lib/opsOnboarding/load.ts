/**
 * Loads the facts lib/opsOnboarding/shared.ts derives Suite CXO onboarding
 * from. One query per table for every tenant at once; a table we cannot read
 * becomes UNREADABLE (the step says "we could not read"), never "missing".
 *
 * Columns are picked by name: no token, password, settings blob or Pinnacle
 * business row is ever loaded here. Pinnacle is the latest sync run's
 * ok/started/finished, read only when a tenant on the Pinnacle allow-list is
 * in the answer.
 */
import { supabase } from '@/lib/supabase'
import { HOST_RENAMES } from '@/lib/hostRenames'
import { pinnacleAllowed } from '@/lib/pinnacle/access'
import { isPinnacleEdition, isStoreReviewTenant } from '@/lib/storeDemo'
import {
  UNREADABLE,
  buildCxoBoard,
  type CxoOnboardingBoard,
  type DayOneFact,
  type GoogleFact,
  type MemberFact,
  type RepFact,
  type SyncRunFact,
  type TenantFacts,
  type TokenFact,
  type Unreadable,
} from '@/lib/opsOnboarding/shared'

type Res<T> = { data: T[] | null; error: { message: string } | null }

async function rows<T>(q: PromiseLike<Res<T>>, label: string): Promise<T[] | Unreadable> {
  try {
    const { data, error } = await q
    if (error) {
      console.error(`[ops/onboarding] ${label}`, error.message)
      return UNREADABLE
    }
    return data ?? []
  } catch (err) {
    console.error(`[ops/onboarding] ${label}`, err instanceof Error ? err.message : err)
    return UNREADABLE
  }
}

const isU = (v: unknown): v is Unreadable => !!v && typeof v === 'object' && (v as Unreadable).unreadable === true

function byRep<T extends { rep_id: string }>(list: T[] | Unreadable): (repId: string) => T[] | Unreadable {
  if (isU(list)) return () => UNREADABLE
  const m = new Map<string, T[]>()
  for (const r of list) m.set(r.rep_id, [...(m.get(r.rep_id) ?? []), r])
  return (repId) => m.get(repId) ?? []
}

const REP_COLS = 'id, slug, display_name, company, email, is_active, billing_status, created_at'
const MEMBER_COLS =
  'id, rep_id, role, created_at, invited_at, accepted_at, last_login_at, login_link_sent_at, about_at:settings->>ciao_about_at, about_skipped_at:settings->>ciao_about_skipped_at'

/** Every Suite CXO tenant (reps.brand = 'cxo'), or one by id. Null when the reps table cannot be read. */
export async function loadCxoTenants(repId?: string): Promise<RepFact[] | null> {
  let q = supabase.from('reps').select(REP_COLS).eq('brand', 'cxo')
  if (repId) q = q.eq('id', repId)
  const { data, error } = await q.order('created_at', { ascending: true }).limit(1000)
  if (error) {
    console.error('[ops/onboarding] reps', error.message)
    return null
  }
  return (data ?? []) as RepFact[]
}

async function loadGoogle(ids: string[]): Promise<Array<GoogleFact & { rep_id: string }> | Unreadable> {
  const first = await rows<GoogleFact & { rep_id: string }>(
    supabase.from('google_tokens').select('rep_id, member_id, needs_reconnect').in('rep_id', ids).limit(10000) as unknown as PromiseLike<Res<GoogleFact & { rep_id: string }>>,
    'google_tokens',
  )
  if (!isU(first)) return first
  // Before the health migration the column is missing: every row counts as healthy.
  const plain = await rows<{ rep_id: string; member_id: string | null }>(
    supabase.from('google_tokens').select('rep_id, member_id').in('rep_id', ids).limit(10000) as unknown as PromiseLike<Res<{ rep_id: string; member_id: string | null }>>,
    'google_tokens (plain)',
  )
  return isU(plain) ? plain : plain.map((r) => ({ ...r, needs_reconnect: false }))
}

async function loadSync(): Promise<SyncRunFact | null | Unreadable> {
  const r = await rows<SyncRunFact>(
    supabase
      .from('pinnacle_airtable_sync_runs')
      .select('started_at, finished_at, ok')
      .order('started_at', { ascending: false })
      .limit(1) as unknown as PromiseLike<Res<SyncRunFact>>,
    'pinnacle sync runs',
  )
  if (isU(r)) return r
  const run = r[0]
  return run ? { started_at: run.started_at, finished_at: run.finished_at, ok: run.ok } : null
}

export async function loadCxoFacts(reps: RepFact[]): Promise<TenantFacts[]> {
  if (!reps.length) return []
  const ids = reps.map((r) => r.id)
  const anyPinnacle = reps.some((r) => pinnacleAllowed(r.id))
  const q = <T>(p: unknown) => p as PromiseLike<Res<T>>

  const [tokens, members, google, dayOne, qbo, slack, plaud, book, sync] = await Promise.all([
    rows<TokenFact & { rep_id: string }>(
      q(supabase.from('onboarding_tokens').select('rep_id, signed_at, paid_at, build_fee_cents, expires_at, welcome_sent_at, created_at').in('rep_id', ids).order('created_at', { ascending: false }).limit(5000)),
      'onboarding_tokens',
    ),
    rows<MemberFact & { rep_id: string }>(
      q(supabase.from('members').select(MEMBER_COLS).in('rep_id', ids).eq('is_active', true).limit(10000)),
      'members',
    ),
    loadGoogle(ids),
    rows<DayOneFact & { rep_id: string }>(q(supabase.from('cxo_onboarding').select('rep_id, member_id, completed_at').in('rep_id', ids).limit(10000)), 'cxo_onboarding'),
    rows<{ rep_id: string; needs_reconnect: boolean | null }>(q(supabase.from('cxo_qbo_connections').select('rep_id, needs_reconnect').in('rep_id', ids)), 'cxo_qbo_connections'),
    rows<{ rep_id: string }>(q(supabase.from('cxo_slack_installs').select('rep_id').in('rep_id', ids)), 'cxo_slack_installs'),
    rows<{ rep_id: string }>(q(supabase.from('plaud_settings').select('rep_id').in('rep_id', ids)), 'plaud_settings'),
    // One id per tenant is enough to know a book exists; no producer detail is read.
    rows<{ rep_id: string }>(q(supabase.from('cxo_book_producers').select('rep_id').in('rep_id', ids).limit(20000)), 'cxo_book_producers'),
    anyPinnacle ? loadSync() : Promise.resolve(undefined),
  ])

  const tokenOf = byRep(tokens)
  const membersOf = byRep(members)
  const googleOf = byRep(google)
  const dayOneOf = byRep(dayOne)
  const has = (list: Array<{ rep_id: string }> | Unreadable) => (repId: string): boolean | Unreadable =>
    isU(list) ? UNREADABLE : list.some((r) => r.rep_id === repId)

  return reps.map((rep): TenantFacts => {
    const t = tokenOf(rep.id)
    const q1 = isU(qbo) ? null : qbo.find((r) => r.rep_id === rep.id)
    const facts: TenantFacts = {
      rep,
      edition: isPinnacleEdition(rep.id) ? 'pinnacle' : 'suitecxo',
      review_demo: isStoreReviewTenant(rep.id),
      // Newest first: the latest link is the one that counts.
      token: isU(t) ? t : t[0] ?? null,
      members: membersOf(rep.id) as MemberFact[] | Unreadable,
      google: googleOf(rep.id),
      dayOne: dayOneOf(rep.id),
      optional: {
        quickbooks: isU(qbo) ? UNREADABLE : { connected: !!q1, needs_reconnect: !!q1?.needs_reconnect },
        slack: has(slack)(rep.id),
        plaud: has(plaud)(rep.id),
        producer_book: has(book)(rep.id),
      },
    }
    // The real Pinnacle book only; its review account never reads it.
    if (pinnacleAllowed(rep.id)) facts.sync = sync
    return facts
  })
}

/** The whole board, or one tenant (`repId`). Null when the tenants cannot be read. */
export async function loadCxoBoard(opts: { repId?: string; now?: Date } = {}): Promise<CxoOnboardingBoard | null> {
  const reps = await loadCxoTenants(opts.repId)
  if (!reps) return null
  const facts = await loadCxoFacts(reps)
  return buildCxoBoard(facts, opts.now ?? new Date(), HOST_RENAMES)
}
