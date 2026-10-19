/**
 * Suite CXO onboarding, read by Accounts (owner 2026-10-19: every client's
 * onboarding lives in one place, accounts.virtualcloser.com).
 *
 * Accounts (crmbuilds) has the onboarding board for Virtual Closer, Sakred
 * and Run My Ads (crmbuilds shared/onboarding-board.ts). Suite CXO lives in
 * this repo and its own database, so Accounts reads it through
 * GET /api/ops/onboarding, which answers in the SAME shape: the same six step
 * keys, the same six statuses, `reason` + `href`/`href_label` on every step.
 * Package A renders it with no translation.
 *
 * The six steps, as Suite CXO reads them:
 *   1. pay        Sign and pay     onboarding_tokens signed_at / paid_at, or reps.billing_status = active
 *   2. account    Account          the owner login exists, the login email went out, the owner signed in
 *   3. intake     About you        the owner's members.settings ciao_about_at / ciao_about_skipped_at
 *   4. addresses  Team seats       every invited seat has signed in (exec assistants are not seats)
 *   5. connect    Connect Google   every signed-in seat has a healthy google_tokens row
 *   6. go_live    Day one          the owner's cxo_onboarding.completed_at. Pinnacle edition: and the
 *                                  latest Airtable book sync succeeded
 *
 * EVERYTHING IS DERIVED. Nothing is stored. A source we could not read makes
 * the step `unknown`, never done and never "missing".
 *
 * Pinnacle: this module only ever sees the sync run's ok/started/finished.
 * No policy, producer or client detail reaches it, so none can be returned.
 *
 * Pure: no I/O, no clock of its own (`now` is passed in).
 */
import { isSeatRole } from '@/lib/cxoUsageShared'
import { ONBOARD_WINDOW_DAYS, joinedAt } from '@/lib/onboarding/dayOneShared'

// ── vocabulary (identical to crmbuilds shared/onboarding-board.ts) ─────────

export const ONBOARDING_STEP_KEYS = ['pay', 'account', 'intake', 'addresses', 'connect', 'go_live'] as const
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number]

export type OnboardingStatus = 'done' | 'waiting_on_customer' | 'waiting_on_us' | 'blocked' | 'not_needed' | 'unknown'
export type OnboardingWaitingOn = 'us' | 'customer' | 'nobody' | 'unknown'

/** The Suite CXO titles for the six shared keys. */
export const CXO_STEP_TITLES: Record<OnboardingStepKey, string> = {
  pay: 'Sign and pay',
  account: 'Account',
  intake: 'About you',
  addresses: 'Team seats',
  connect: 'Connect Google',
  go_live: 'Day one',
}

export const OPS_ACTION_IDS = ['create_client', 'resend_login_link', 'issue_sign_and_pay_link'] as const
export type OpsActionId = (typeof OPS_ACTION_IDS)[number]

export type StepAction =
  | { kind: 'url'; href: string; label: string }
  | { kind: 'action'; id: OpsActionId; label: string }

export type OnboardingStep = {
  key: OnboardingStepKey
  /** 1 to 6. */
  number: number
  /** Same as `label` (crmbuilds board field name). */
  title: string
  label: string
  status: OnboardingStatus
  /** One plain sentence: what is missing, or what is true. Same as `detail`. */
  reason: string
  detail: string
  /** The client-facing page where this step is done. */
  href: string
  href_label: string
  /** What an operator can do about it from Accounts. null = nothing to do. */
  action: StepAction | null
}

// ── facts (already loaded; nothing here reads anything) ─────────────────────

export type Unreadable = { unreadable: true }
export const UNREADABLE: Unreadable = { unreadable: true }
export function isUnreadable(v: unknown): v is Unreadable {
  return !!v && typeof v === 'object' && (v as { unreadable?: unknown }).unreadable === true
}

export type RepFact = {
  id: string
  slug: string
  display_name: string | null
  company: string | null
  email: string | null
  is_active: boolean | null
  billing_status: string | null
  created_at: string | null
}

export type TokenFact = {
  signed_at: string | null
  paid_at: string | null
  build_fee_cents: number | null
  expires_at: string | null
  welcome_sent_at: string | null
  created_at: string | null
}

export type MemberFact = {
  id: string
  role: string
  created_at: string | null
  invited_at: string | null
  accepted_at: string | null
  last_login_at: string | null
  login_link_sent_at: string | null
  about_at: string | null
  about_skipped_at: string | null
}

export type GoogleFact = { member_id: string | null; needs_reconnect: boolean | null }
export type DayOneFact = { member_id: string; completed_at: string | null }

export type OptionalFacts = {
  quickbooks: { connected: boolean; needs_reconnect: boolean } | Unreadable
  slack: boolean | Unreadable
  plaud: boolean | Unreadable
  producer_book: boolean | Unreadable
}

/** The latest Airtable sync run, reduced to what Accounts may see. */
export type SyncRunFact = { started_at: string; finished_at: string | null; ok: boolean | null }

export type TenantFacts = {
  rep: RepFact
  edition: 'suitecxo' | 'pinnacle'
  review_demo: boolean
  token: TokenFact | null | Unreadable
  members: MemberFact[] | Unreadable
  google: GoogleFact[] | Unreadable
  dayOne: DayOneFact[] | Unreadable
  optional: OptionalFacts
  /** Pinnacle edition (real book) only. null = no run ever. Absent for others. */
  sync?: SyncRunFact | null | Unreadable
}

// ── helpers ─────────────────────────────────────────────────────────────────

type Part = { status: OnboardingStatus; reason: string; action?: StepAction | null }
const part = (status: OnboardingStatus, reason: string, action: StepAction | null = null): Part => ({ status, reason, action })

/** When a step has several parts, the one that most needs a person decides it. */
const WEIGHT: Record<OnboardingStatus, number> = { blocked: 5, waiting_on_us: 4, waiting_on_customer: 3, unknown: 2, done: 1, not_needed: 0 }

function combine(parts: Part[], allDone: string): Part {
  const open = parts.filter((p) => p.status !== 'done' && p.status !== 'not_needed')
  if (!open.length) return parts.some((p) => p.status === 'done') ? part('done', allDone) : part('not_needed', allDone)
  const worst = [...open].sort((a, b) => WEIGHT[b.status] - WEIGHT[a.status])[0]
  const more = open.length - 1
  return {
    ...worst,
    reason: more > 0 ? `${worst.reason} ${more} more thing${more === 1 ? '' : 's'} still open on this step.` : worst.reason,
  }
}

export function dayWords(iso: string | null | undefined): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}
const on = (iso: string | null | undefined) => {
  const d = dayWords(iso)
  return d ? ` on ${d}` : ''
}
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const signedIn = (m: Pick<MemberFact, 'accepted_at' | 'last_login_at'>) => !!(m.accepted_at || m.last_login_at)

/** The owner login: the oldest active member with role owner. */
export function ownerOf(members: readonly MemberFact[]): MemberFact | null {
  const owners = members.filter((m) => m.role === 'owner')
  owners.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  return owners[0] ?? null
}

/** Same rule as the integrations page: own row, else the company-level row; a row Google stopped honouring does not count. */
export function googleHealthyFor(rows: readonly GoogleFact[], memberId: string): boolean {
  return rows.some((r) => (r.member_id === memberId || r.member_id == null) && !r.needs_reconnect)
}

export const tenantHost = (slug: string, renames: Readonly<Record<string, string>> = {}) => {
  const s = slug.trim().toLowerCase()
  return `${renames[s] ?? s}.suitecxo.com`
}

const SYNC_STALE_MS = 36 * 3600_000

// ── member summary ──────────────────────────────────────────────────────────

export type MemberSummary = {
  /** Active logins that pay a seat (exec assistants are not seats). */
  seats: number
  /** Seats other than the owner. */
  invited: number
  /** Seats that have signed in at least once. */
  signed_in: number
  /** Seats that have never signed in. */
  pending: number
  /** Exec assistants (ride on someone else's seat). */
  assistants: number
  google_healthy: number
  google_needs_reconnect: number
  about_you_done: number
  day_one_done: number
} | null

export function memberSummary(f: Pick<TenantFacts, 'members' | 'google' | 'dayOne'>): MemberSummary {
  if (isUnreadable(f.members)) return null
  const seats = f.members.filter((m) => isSeatRole(m.role))
  const owner = ownerOf(f.members)
  const google = isUnreadable(f.google) ? [] : f.google
  const done = isUnreadable(f.dayOne) ? new Set<string>() : new Set(f.dayOne.filter((d) => d.completed_at).map((d) => d.member_id))
  const ids = new Set(seats.map((m) => m.id))
  return {
    seats: seats.length,
    invited: seats.filter((m) => m.id !== owner?.id).length,
    signed_in: seats.filter(signedIn).length,
    pending: seats.filter((m) => !signedIn(m)).length,
    assistants: f.members.length - seats.length,
    google_healthy: seats.filter((m) => googleHealthyFor(google, m.id)).length,
    google_needs_reconnect: google.filter((g) => g.needs_reconnect && (g.member_id == null || ids.has(g.member_id))).length,
    about_you_done: seats.filter((m) => m.about_at || m.about_skipped_at).length,
    day_one_done: seats.filter((m) => done.has(m.id)).length,
  }
}

// ── the steps ───────────────────────────────────────────────────────────────

const ISSUE: StepAction = { kind: 'action', id: 'issue_sign_and_pay_link', label: 'Issue a sign-and-pay link' }
const RESEND: StepAction = { kind: 'action', id: 'resend_login_link', label: 'Resend the login email' }

function payStep(f: TenantFacts, now: Date): Part {
  if (f.rep.billing_status === 'active') return part('done', 'Billing is active in Stripe.')
  if (isUnreadable(f.token)) return part('unknown', 'We could not read the sign-and-pay link.')
  const t = f.token
  if (!t) return part('waiting_on_us', 'No sign-and-pay link has been issued.', ISSUE)
  const fee = Number(t.build_fee_cents) || 0
  if (t.paid_at) return part('done', `Build fee paid${on(t.paid_at)}.`)
  if (t.signed_at && fee <= 0) return part('done', `Agreement signed${on(t.signed_at)}; there is no build fee.`)
  if (t.signed_at) return part('waiting_on_customer', `Signed${on(t.signed_at)}; the ${dollars(fee)} build fee is not paid yet.`, ISSUE)
  const expired = !!t.expires_at && Date.parse(t.expires_at) <= now.getTime()
  if (expired) return part('waiting_on_us', `The sign-and-pay link expired${on(t.expires_at)} without a signature. Issue a new one.`, ISSUE)
  return part('waiting_on_customer', `Sign-and-pay link sent${on(t.created_at)}; not signed yet.`, ISSUE)
}

function accountStep(f: TenantFacts): Part {
  if (isUnreadable(f.members)) return part('unknown', 'We could not read the logins.')
  const owner = ownerOf(f.members)
  if (!owner) {
    if (!f.rep.email) return part('blocked', 'There is no owner login and no owner email on file to create one from.')
    return part('waiting_on_us', 'No owner login exists yet. Sending the login email creates it.', RESEND)
  }
  if (signedIn(owner)) return part('done', `The owner signed in${on(owner.accepted_at || owner.last_login_at)}.`)
  const tokenWelcome = !isUnreadable(f.token) && f.token?.welcome_sent_at ? f.token.welcome_sent_at : null
  const sent = owner.login_link_sent_at || tokenWelcome
  if (sent) return part('waiting_on_customer', `Login email sent${on(sent)}; the owner has not signed in yet.`, RESEND)
  return part('waiting_on_us', 'The login email has not gone out.', RESEND)
}

function intakeStep(f: TenantFacts, host: string): Part {
  if (isUnreadable(f.members)) return part('unknown', 'We could not read the owner\'s answers.')
  const owner = ownerOf(f.members)
  const go: StepAction = { kind: 'url', href: `https://${host}/dashboard`, label: 'Open their home page' }
  if (!owner) return part('waiting_on_customer', 'Starts once the owner has a login.')
  if (owner.about_at) return part('done', `The owner answered About you${on(owner.about_at)}.`)
  if (owner.about_skipped_at) return part('done', `The owner skipped About you${on(owner.about_skipped_at)}.`)
  if (!signedIn(owner)) return part('waiting_on_customer', 'Starts once the owner signs in.', go)
  return part('waiting_on_customer', 'The owner has not answered About you yet.', go)
}

function seatsStep(f: TenantFacts, host: string): Part {
  if (isUnreadable(f.members)) return part('unknown', 'We could not read the seats.')
  const seats = f.members.filter((m) => isSeatRole(m.role))
  const go: StepAction = { kind: 'url', href: `https://${host}/dashboard/execs`, label: 'Open their team' }
  if (!seats.length) return part('waiting_on_customer', 'No one has a seat yet.', go)
  if (seats.length === 1) return part('done', 'Only the owner has a seat so far; no one else is invited.')
  const pending = seats.filter((m) => !signedIn(m)).length
  if (pending) return part('waiting_on_customer', `${pending} of ${plural(seats.length, 'seat')} ${pending === 1 ? 'has' : 'have'} not signed in yet.`, go)
  return part('done', `All ${plural(seats.length, 'seat')} have signed in.`)
}

function connectStep(f: TenantFacts, host: string): Part {
  if (isUnreadable(f.members) || isUnreadable(f.google)) return part('unknown', 'We could not read the Google connections.')
  const go: StepAction = { kind: 'url', href: `https://${host}/dashboard/integrations`, label: 'Open their integrations' }
  const owner = ownerOf(f.members)
  if (!owner) return part('waiting_on_customer', 'Starts once the owner has a login.')
  const google = f.google
  const parts: Part[] = []
  const ownerOk = googleHealthyFor(google, owner.id)
  const ownerBroken = !ownerOk && google.some((r) => (r.member_id === owner.id || r.member_id == null) && r.needs_reconnect)
  parts.push(
    ownerOk
      ? part('done', '')
      : ownerBroken
        ? part('waiting_on_customer', 'The owner\'s Google connection needs a reconnect.', go)
        : part('waiting_on_customer', 'The owner has not connected Google.', go),
  )
  const others = f.members.filter((m) => isSeatRole(m.role) && m.id !== owner.id && signedIn(m))
  const missing = others.filter((m) => !googleHealthyFor(google, m.id)).length
  if (missing) parts.push(part('waiting_on_customer', `${missing} of ${plural(others.length, 'signed-in teammate')} ${missing === 1 ? 'has' : 'have'} no working Google connection.`, go))
  if (!isUnreadable(f.optional.quickbooks) && f.optional.quickbooks.connected && f.optional.quickbooks.needs_reconnect) {
    parts.push(part('waiting_on_customer', 'QuickBooks is connected but needs a reconnect.', go))
  }
  const healthy = 1 + others.length - missing
  return combine(parts, `Google is connected for ${plural(healthy, 'person', 'people')}.`)
}

function goLiveStep(f: TenantFacts, host: string, now: Date): Part {
  const parts: Part[] = []
  const go: StepAction = { kind: 'url', href: `https://${host}/dashboard`, label: 'Open their home page' }
  if (isUnreadable(f.members) || isUnreadable(f.dayOne)) {
    parts.push(part('unknown', 'We could not read the day-one checklist.'))
  } else {
    const owner = ownerOf(f.members)
    const row = owner ? f.dayOne.find((d) => d.member_id === owner.id) : undefined
    if (!owner) parts.push(part('waiting_on_customer', 'Starts once the owner has a login.'))
    else if (row?.completed_at) parts.push(part('done', ''))
    else if (row) parts.push(part('waiting_on_customer', 'The owner\'s day-one checklist is not finished.', go))
    else if (!signedIn(owner)) parts.push(part('waiting_on_customer', 'Starts once the owner signs in.', go))
    else {
      const joined = joinedAt(owner)
      const old = !!joined && now.getTime() - Date.parse(joined) > ONBOARD_WINDOW_DAYS * 86_400_000
      parts.push(old
        ? part('not_needed', 'The owner joined before the day-one checklist window.')
        : part('unknown', 'There is no day-one record for the owner yet.'))
    }
  }
  if (f.edition === 'pinnacle') parts.push(syncPart(f, now))
  const reason = f.edition === 'pinnacle' ? 'Day one is done and the book synced.' : 'The owner finished day one.'
  return combine(parts, reason)
}

function syncPart(f: TenantFacts, now: Date): Part {
  if (f.review_demo || f.sync === undefined) return part('not_needed', 'This account has no book to sync.')
  const s = f.sync
  if (isUnreadable(s)) return part('unknown', 'We could not read the book sync.')
  if (!s) return part('waiting_on_us', 'The book has never synced from Airtable.')
  if (s.ok === false) return part('blocked', `The last book sync failed${on(s.finished_at || s.started_at)}.`)
  if (s.ok !== true) return part('unknown', `A book sync started${on(s.started_at)} and has not finished.`)
  const at = s.finished_at || s.started_at
  if (now.getTime() - Date.parse(at) > SYNC_STALE_MS) return part('waiting_on_us', `The book has not synced since${on(at).replace(' on', '')}.`)
  return part('done', '')
}

const SCREENS: Record<OnboardingStepKey, (host: string) => { href: string; label: string }> = {
  pay: (h) => ({ href: `https://${h}/dashboard/billing`, label: 'Their billing' }),
  account: (h) => ({ href: `https://${h}/login`, label: 'Their sign-in page' }),
  intake: (h) => ({ href: `https://${h}/dashboard`, label: 'Their home page' }),
  addresses: (h) => ({ href: `https://${h}/dashboard/execs`, label: 'Their team' }),
  connect: (h) => ({ href: `https://${h}/dashboard/integrations`, label: 'Their integrations' }),
  go_live: (h) => ({ href: `https://${h}/dashboard`, label: 'Their home page' }),
}

export function deriveCxoSteps(f: TenantFacts, now: Date, host: string): OnboardingStep[] {
  const parts: Record<OnboardingStepKey, Part> = {
    pay: payStep(f, now),
    account: accountStep(f),
    intake: intakeStep(f, host),
    addresses: seatsStep(f, host),
    connect: connectStep(f, host),
    go_live: goLiveStep(f, host, now),
  }
  return ONBOARDING_STEP_KEYS.map((key, i) => {
    const p = parts[key]
    const screen = SCREENS[key](host)
    const done = p.status === 'done' || p.status === 'not_needed'
    // A review demo is never acted on: no action ids are handed out for it.
    const action = done || (f.review_demo && p.action?.kind === 'action') ? null : (p.action ?? null)
    return {
      key,
      number: i + 1,
      title: CXO_STEP_TITLES[key],
      label: CXO_STEP_TITLES[key],
      status: p.status,
      reason: p.reason,
      detail: p.reason,
      href: screen.href,
      href_label: screen.label,
      action,
    }
  })
}

export function currentStep(steps: readonly OnboardingStep[]): OnboardingStep | null {
  return steps.find((s) => s.status !== 'done' && s.status !== 'not_needed') ?? null
}

export function waitingOnFor(step: OnboardingStep | null): OnboardingWaitingOn {
  if (!step) return 'nobody'
  if (step.status === 'waiting_on_customer') return 'customer'
  if (step.status === 'unknown') return 'unknown'
  return 'us'
}

// ── the tenant row ──────────────────────────────────────────────────────────

export type OptionalStatus = { key: 'quickbooks' | 'slack' | 'plaud' | 'producer_book'; label: string; status: OnboardingStatus }

export function optionalStatuses(o: OptionalFacts): OptionalStatus[] {
  const yes = (v: boolean | Unreadable): OnboardingStatus => (isUnreadable(v) ? 'unknown' : v ? 'done' : 'not_needed')
  const qbo: OnboardingStatus = isUnreadable(o.quickbooks)
    ? 'unknown'
    : !o.quickbooks.connected ? 'not_needed' : o.quickbooks.needs_reconnect ? 'waiting_on_customer' : 'done'
  return [
    { key: 'quickbooks', label: 'QuickBooks', status: qbo },
    { key: 'slack', label: 'Slack', status: yes(o.slack) },
    { key: 'plaud', label: 'Plaud', status: yes(o.plaud) },
    { key: 'producer_book', label: 'Producer book', status: yes(o.producer_book) },
  ]
}

export type SyncStatus = { status: 'ok' | 'failed' | 'running' | 'never' | 'unknown'; at: string | null }

export function syncStatus(s: SyncRunFact | null | Unreadable | undefined): SyncStatus {
  if (s === undefined || isUnreadable(s)) return { status: 'unknown', at: null }
  if (!s) return { status: 'never', at: null }
  const at = s.finished_at || s.started_at
  if (s.ok === true) return { status: 'ok', at }
  if (s.ok === false) return { status: 'failed', at }
  return { status: 'running', at: s.started_at }
}

export type CxoOnboardingTenant = {
  rep_id: string
  slug: string
  name: string | null
  company: string | null
  host: string
  edition: 'suitecxo' | 'pinnacle'
  /** App Store / Play review accounts: shown, never acted on. */
  review_demo: boolean
  is_active: boolean
  created_at: string | null
  steps: OnboardingStep[]
  current_step: OnboardingStepKey | null
  current_step_number: number | null
  waiting_on: OnboardingWaitingOn
  members: MemberSummary
  optional: OptionalStatus[]
  /** Pinnacle edition only: the Airtable book sync, status and time. Nothing else. */
  pinnacle: { sync: SyncStatus } | null
}

export function cxoTenantRow(f: TenantFacts, now: Date, renames: Readonly<Record<string, string>> = {}): CxoOnboardingTenant {
  const host = tenantHost(f.rep.slug, renames)
  const steps = deriveCxoSteps(f, now, host)
  const cur = currentStep(steps)
  return {
    rep_id: f.rep.id,
    slug: f.rep.slug,
    name: f.rep.display_name,
    company: f.rep.company,
    host,
    edition: f.edition,
    review_demo: f.review_demo,
    is_active: f.rep.is_active !== false,
    created_at: f.rep.created_at,
    steps,
    current_step: cur?.key ?? null,
    current_step_number: cur?.number ?? null,
    waiting_on: waitingOnFor(cur),
    members: memberSummary(f),
    optional: optionalStatuses(f.optional),
    pinnacle: f.edition === 'pinnacle' ? { sync: syncStatus(f.review_demo ? undefined : f.sync) } : null,
  }
}

const WAITING_ORDER: Record<OnboardingWaitingOn, number> = { us: 0, unknown: 1, customer: 2, nobody: 3 }

export type CxoOnboardingBoard = {
  ok: true
  brand: 'suitecxo'
  generated_at: string
  tenants: CxoOnboardingTenant[]
  counts: Record<OnboardingWaitingOn, number>
}

export function buildCxoBoard(facts: readonly TenantFacts[], now: Date, renames: Readonly<Record<string, string>> = {}): CxoOnboardingBoard {
  const tenants = facts.map((f) => cxoTenantRow(f, now, renames))
  tenants.sort((a, b) => Number(a.review_demo) - Number(b.review_demo)
    || WAITING_ORDER[a.waiting_on] - WAITING_ORDER[b.waiting_on]
    || String(a.company ?? a.name ?? '').localeCompare(String(b.company ?? b.name ?? '')))
  const counts: Record<OnboardingWaitingOn, number> = { us: 0, customer: 0, nobody: 0, unknown: 0 }
  for (const t of tenants) if (!t.review_demo) counts[t.waiting_on] += 1
  return { ok: true, brand: 'suitecxo', generated_at: now.toISOString(), tenants, counts }
}
