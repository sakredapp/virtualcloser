/**
 * Day one with Ciao (Suite CXO): the database half. The checklist card on the
 * person's home (/dashboard/me for an employee, Today for an exec) reads it
 * through /api/employees/me/onboarding; the Hetzner worker runs the tick
 * (hetzner-worker/index.ts, CXO_ONBOARDING_EVERY_N_TICKS).
 *
 *  - The tick finds logins made in the last 14 days on every Suite CXO
 *    tenant, starts their cxo_onboarding row and sends ONE welcome notice
 *    (in-app) with what is left.
 *  - When every step is done (seen on the card or by the tick), their
 *    manager gets one in-app notice: "<name> is set up". If their first day
 *    passes with steps still open, the manager gets that one notice instead,
 *    saying what is left. Never both, never twice (one key per person).
 *
 * Rules kept here:
 *  - Every read and write carries rep_id and the member's own id.
 *  - In-app only. No email, text or push. Model-free, cost 0.
 *  - Long-time logins are never onboarded; a recent one who already has
 *    everything is marked done quietly.
 *  - Kill switch CXO_ONBOARDING=off. Until the table exists, a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices } from '@/lib/followups/engine'
import { nameOf } from '@/lib/followups/shared'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { inboxAllowed } from '@/lib/cxoFeatures'
import { addTodo } from '@/lib/today'
import { assistantNameFromSettings } from '@/lib/assistantNameFromRows'
import {
  DAY_ONE_ANCHOR,
  ONBOARD_WINDOW_DAYS,
  allDone,
  dayOneSteps,
  firstDayOver,
  googleConnectedFor,
  isNewMember,
  joinedAt,
  managerNoticeText,
  readyKey,
  welcomeKey,
  welcomeNoticeText,
  type DayOneFacts,
  type Step,
} from './dayOneShared'

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

export function onboardingOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CXO_ONBOARDING ?? '').trim().toLowerCase() !== 'off'
}

export type OnboardTenant = { id: string; brand?: string | null; settings?: unknown }
export type OnboardMember = {
  id: string
  rep_id: string
  role: string | null
  email: string | null
  display_name: string | null
  is_active?: boolean
  invited_by?: string | null
  created_at?: string | null
  invited_at?: string | null
  accepted_at?: string | null
  last_login_at?: string | null
  settings?: Record<string, unknown> | null
}
const MEMBER_COLS = 'id, rep_id, role, email, display_name, is_active, invited_by, created_at, invited_at, accepted_at, last_login_at, settings'

/** The assistant's name as this person sees it (their pick, else the company's, else the default). No extra read. */
function nameFor(tenant: OnboardTenant, member: Pick<OnboardMember, 'settings'>): string {
  return assistantNameFromSettings(tenant.settings, member.settings)
}

export type OnboardRow = {
  id: string
  rep_id: string
  member_id: string
  joined_at: string | null
  started_at: string
  backfilled: boolean
  welcomed_at: string | null
  abilities_seen_at: string | null
  completed_at: string | null
  manager_notified_at: string | null
  manager_member_id: string | null
}
const ROW_COLS = 'id, rep_id, member_id, joined_at, started_at, backfilled, welcomed_at, abilities_seen_at, completed_at, manager_notified_at, manager_member_id'

/** Assistants work someone else's seat; they never get a first day of their own. */
const eligibleRole = (m: Pick<OnboardMember, 'role'>) => String(m.role ?? '') !== 'assistant'

export const homeFor = (member: Pick<OnboardMember, 'role'>, tenant: OnboardTenant) => (isEmployeeOnlyMember(member, { id: tenant.id, brand: tenant.brand }) ? '/dashboard/me' : '/dashboard')

type Facts = DayOneFacts & { managerMemberId: string | null }

/** Their real state, from their own rows only. */
export async function loadFacts(tenant: OnboardTenant, member: OnboardMember, row: Pick<OnboardRow, 'abilities_seen_at'> | null): Promise<Facts> {
  const repId = tenant.id
  const [emp, tok, todos] = await Promise.all([
    supabase.from('cxo_employees').select('id, manager_id').eq('rep_id', repId).eq('member_id', member.id).eq('active', true).limit(1),
    // Their own Google connection or the company-level one (member_id null), the
    // same rule the integrations page uses to show "Connected". '*' so a tenant
    // without the needs_reconnect column still reads.
    supabase.from('google_tokens').select('*').eq('rep_id', repId).or(`member_id.eq.${member.id},member_id.is.null`),
    supabase.from('cxo_todos').select('id', { count: 'exact', head: true }).eq('rep_id', repId).eq('member_id', member.id).is('deleted_at', null),
  ])
  const e = ((emp.data ?? []) as Array<{ id: string; manager_id: string | null }>)[0] ?? null
  let managerName: string | null = null
  let managerMemberId: string | null = null
  let oneOnOneDate: string | null = null
  let hasOneOnOne = false
  if (e) {
    const [mgr, oo] = await Promise.all([
      e.manager_id ? supabase.from('cxo_employees').select('name, member_id').eq('rep_id', repId).eq('id', e.manager_id).limit(1) : Promise.resolve({ data: [] as unknown[] }),
      supabase.from('cxo_one_on_ones').select('next_date, last_date').eq('rep_id', repId).eq('employee_id', e.id).limit(1),
    ])
    const m = ((mgr.data ?? []) as Array<{ name: string | null; member_id: string | null }>)[0]
    if (m) {
      managerName = (m.name || '').trim() || null
      managerMemberId = m.member_id
    }
    const o = ((oo.data ?? []) as Array<{ next_date: string | null; last_date: string | null }>)[0]
    if (o && (o.next_date || o.last_date)) {
      hasOneOnOne = true
      oneOnOneDate = o.next_date
    }
  }
  return {
    employeeOnly: isEmployeeOnlyMember(member, { id: tenant.id, brand: tenant.brand }),
    role: String(member.role ?? ''),
    hasEmployeeRow: !!e,
    managerName,
    managerMemberId,
    calendarConnected: googleConnectedFor((tok.data ?? []) as Array<{ member_id: string | null; needs_reconnect?: boolean | null }>, member.id),
    inbox: inboxAllowed({ id: tenant.id, brand: tenant.brand }),
    oneOnOneDate,
    hasOneOnOne,
    todoCount: todos.count ?? 0,
    abilitiesSeen: !!row?.abilities_seen_at,
  }
}

async function getRow(repId: string, memberId: string): Promise<OnboardRow | null> {
  const { data, error } = await supabase.from('cxo_onboarding').select(ROW_COLS).eq('rep_id', repId).eq('member_id', memberId).limit(1)
  if (error) {
    if (missing(error)) throw new TableMissing()
    throw new Error(`cxo_onboarding: ${error.message}`)
  }
  return ((data ?? []) as OnboardRow[])[0] ?? null
}

/** Start their row (once). `welcomed` = they are looking at the card right now, so no welcome notice is needed. */
async function startRow(repId: string, member: OnboardMember, now: Date, welcomed: boolean): Promise<OnboardRow | null> {
  const joined = joinedAt(member)
  const backfilled = !!joined && now.getTime() - Date.parse(joined) > 24 * 3600_000
  const { error } = await supabase
    .from('cxo_onboarding')
    .upsert([{ rep_id: repId, member_id: member.id, joined_at: joined, started_at: now.toISOString(), backfilled, welcomed_at: welcomed ? now.toISOString() : null }], { onConflict: 'rep_id,member_id', ignoreDuplicates: true })
  if (error) {
    if (missing(error)) throw new TableMissing()
    throw new Error(`cxo_onboarding: ${error.message}`)
  }
  return getRow(repId, member.id)
}

async function patchRow(row: OnboardRow, patch: Partial<OnboardRow>): Promise<OnboardRow> {
  const { data, error } = await supabase
    .from('cxo_onboarding')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('rep_id', row.rep_id)
    .eq('member_id', row.member_id)
    .select(ROW_COLS)
  if (error) throw new Error(`cxo_onboarding: ${error.message}`)
  return ((data ?? []) as OnboardRow[])[0] ?? { ...row, ...patch }
}

/** Who hears about it: their manager's login, else whoever invited them. Never themselves. */
async function recipientFor(tenant: OnboardTenant, member: OnboardMember, facts: Facts): Promise<OnboardMember | null> {
  const ids = [facts.managerMemberId, member.invited_by].filter((x): x is string => !!x && x !== member.id)
  for (const id of ids) {
    const { data } = await supabase.from('members').select(MEMBER_COLS).eq('rep_id', tenant.id).eq('id', id).eq('is_active', true).limit(1)
    const m = ((data ?? []) as OnboardMember[])[0]
    if (m && eligibleRole(m)) return m
  }
  return null
}

async function tellManager(tenant: OnboardTenant, member: OnboardMember, facts: Facts, steps: Step[], row: OnboardRow, now: Date): Promise<{ row: OnboardRow; sent: number }> {
  const to = await recipientFor(tenant, member, facts)
  let sent = 0
  if (to) {
    const text = managerNoticeText(nameOf(member), steps, nameFor(tenant, to))
    const rows = await insertNotices([
      {
        rep_id: tenant.id,
        member_id: to.id,
        key: readyKey(member.id),
        kind: 'report',
        item_kind: 'report',
        item_id: member.id,
        title: text.title.slice(0, 300),
        body: text.body.slice(0, 8000),
        href: isEmployeeOnlyMember(to, { id: tenant.id, brand: tenant.brand }) ? '/dashboard/me' : '/dashboard/employees',
        due_date: null,
      },
    ])
    sent = rows.length
  }
  // Marked even with nobody to tell, so it is never tried again.
  return { row: await patchRow(row, { manager_notified_at: now.toISOString(), manager_member_id: to?.id ?? null }), sent }
}

async function clearWelcome(repId: string, memberId: string) {
  const { error } = await supabase
    .from('cxo_followup_notices')
    .update({ read_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('key', welcomeKey(memberId))
    .is('read_at', null)
  if (error && !missing(error)) console.error('[onboarding] clear welcome', error.message)
}

/** The welcome notice lists only what is still open: a step done since it was sent (Google connected) drops off. */
async function refreshWelcome(tenant: OnboardTenant, member: OnboardMember, steps: Step[]) {
  const text = welcomeNoticeText((member.display_name || '').trim().split(/\s+/)[0] || '', steps, nameFor(tenant, member))
  if (!text) return
  const { error } = await supabase
    .from('cxo_followup_notices')
    .update({ title: text.title.slice(0, 300), body: text.body.slice(0, 8000) })
    .eq('rep_id', tenant.id)
    .eq('member_id', member.id)
    .eq('key', welcomeKey(member.id))
    .is('read_at', null)
  if (error && !missing(error)) console.error('[onboarding] refresh welcome', error.message)
}

export type Settled = { row: OnboardRow; steps: Step[]; facts: Facts; welcomed: number; told: number }

/**
 * Bring one person's row up to date with their real state: finish it when
 * every step is done (manager told once), or tell the manager how the first
 * day went once it is over. Shared by the card and the tick.
 */
async function settle(tenant: OnboardTenant, member: OnboardMember, row: OnboardRow, now: Date, opts: { fresh: boolean; abilities?: string[]; sendWelcome: boolean; roleLabel?: string | null }): Promise<Settled> {
  const facts = await loadFacts(tenant, member, row)
  const steps = dayOneSteps(facts, { home: homeFor(member, tenant), abilities: opts.abilities, assistantName: nameFor(tenant, member), roleLabel: opts.roleLabel })
  let welcomed = 0
  let told = 0
  if (row.completed_at) return { row, steps, facts, welcomed, told }
  if (allDone(steps)) {
    // Already had everything when Ciao first looked and joined a while ago: done, quietly.
    const quiet = opts.fresh && row.backfilled
    row = await patchRow(row, { completed_at: now.toISOString(), ...(quiet && !row.manager_notified_at ? { manager_notified_at: now.toISOString() } : {}) })
    if (!row.manager_notified_at) {
      const r = await tellManager(tenant, member, facts, steps, row, now)
      row = r.row
      told = r.sent
    }
    await clearWelcome(tenant.id, member.id)
    return { row, steps, facts, welcomed, told }
  }
  if (opts.sendWelcome && !row.welcomed_at) {
    const text = welcomeNoticeText((member.display_name || '').trim().split(/\s+/)[0] || '', steps, nameFor(tenant, member))
    if (text) {
      const rows = await insertNotices([
        { rep_id: tenant.id, member_id: member.id, key: welcomeKey(member.id), kind: 'report', item_kind: 'report', item_id: null, title: text.title.slice(0, 300), body: text.body.slice(0, 8000), href: `${homeFor(member, tenant)}#${DAY_ONE_ANCHOR}`, due_date: null },
      ])
      welcomed = rows.length
    }
    row = await patchRow(row, { welcomed_at: now.toISOString() })
  } else if (row.welcomed_at) {
    await refreshWelcome(tenant, member, steps)
  }
  if (!row.manager_notified_at && !row.backfilled && firstDayOver(member, now)) {
    const r = await tellManager(tenant, member, facts, steps, row, now)
    row = r.row
    told = r.sent
  }
  return { row, steps, facts, welcomed, told }
}

export type DayOneView = { steps: Step[]; done: number; total: number; abilities: string[]; home: string }

/**
 * The signed-in person's checklist, or null when there is none for them
 * (joined long ago, already finished, an assistant, not Suite CXO, switched
 * off, or the table is not there yet). Starts their row on first look.
 */
export async function getMyDayOne(tenant: OnboardTenant, member: OnboardMember, abilities: string[], now = new Date(), opts: { roleLabel?: string | null } = {}): Promise<DayOneView | null> {
  if (!onboardingOn() || tenant.brand !== 'cxo' || !eligibleRole(member)) return null
  try {
    let row = await getRow(tenant.id, member.id)
    let fresh = false
    if (!row) {
      if (!isNewMember(member, now)) return null
      row = await startRow(tenant.id, member, now, true)
      fresh = true
      if (!row) return null
    }
    if (row.completed_at) return null
    // Past the two-week window the card is gone, done or not.
    if (!isNewMember({ created_at: row.joined_at ?? row.started_at }, now)) return null
    const s = await settle(tenant, member, row, now, { fresh, abilities, sendWelcome: false, roleLabel: opts.roleLabel })
    if (s.row.completed_at) return null
    const done = s.steps.filter((x) => x.done).length
    return { steps: s.steps, done, total: s.steps.length, abilities, home: homeFor(member, tenant) }
  } catch (err) {
    if (err instanceof TableMissing) return null
    throw err
  }
}

/** "Got it" on the abilities step. */
export async function markAbilitiesSeen(tenant: OnboardTenant, member: OnboardMember): Promise<void> {
  try {
    const row = await getRow(tenant.id, member.id)
    if (row && !row.abilities_seen_at) await patchRow(row, { abilities_seen_at: new Date().toISOString() })
  } catch (err) {
    if (!(err instanceof TableMissing)) throw err
  }
}

/** Their first to-do, typed on the card. Their own list only. */
export async function addFirstTodo(tenant: OnboardTenant, member: OnboardMember, body: string): Promise<void> {
  await addTodo(tenant.id, member.id, body, { source: 'manual' })
}

export type OnboardingTickResult = { tenants: number; started: number; welcomed: number; told: number; errors: number }

/** One check across every Suite CXO tenant. Never throws. */
export async function runOnboardingTick(now = new Date()): Promise<OnboardingTickResult> {
  const out: OnboardingTickResult = { tenants: 0, started: 0, welcomed: 0, told: 0, errors: 0 }
  if (!onboardingOn()) return out
  const { data, error } = await supabase.from('reps').select('id, brand, settings').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[onboarding] tenants', error.message)
    out.errors++
    return out
  }
  const since = new Date(now.getTime() - ONBOARD_WINDOW_DAYS * 86_400_000).toISOString()
  for (const tenant of (data ?? []) as OnboardTenant[]) {
    try {
      const { data: ms, error: mErr } = await supabase
        .from('members')
        .select(MEMBER_COLS)
        .eq('rep_id', tenant.id)
        .eq('is_active', true)
        .neq('role', 'assistant')
        .or(`created_at.gte.${since},invited_at.gte.${since}`)
        .limit(500)
      if (mErr) throw new Error(mErr.message)
      const members = ((ms ?? []) as OnboardMember[]).filter((m) => eligibleRole(m) && isNewMember(m, now))
      if (!members.length) continue
      out.tenants++
      for (const member of members) {
        try {
          let row = await getRow(tenant.id, member.id)
          let fresh = false
          if (!row) {
            row = await startRow(tenant.id, member, now, false)
            if (!row) continue
            fresh = true
            out.started++
          }
          if (row.completed_at) continue
          const s = await settle(tenant, member, row, now, { fresh, sendWelcome: true })
          out.welcomed += s.welcomed
          out.told += s.told
        } catch (err) {
          if (err instanceof TableMissing) throw err
          out.errors++
          console.error('[onboarding] member', tenant.id, member.id, err instanceof Error ? err.message : err)
        }
      }
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[onboarding] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
