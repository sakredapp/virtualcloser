/**
 * The settings and actions registry, server side: read a setting's current
 * value, change it, run an action, and report setup progress. The same code
 * serves Ciao (lib/agent/settingsTools.ts) and a connected Claude / ChatGPT
 * (lib/mcp/server.ts). Entries, role rules and validation are pure, in
 * lib/settings/registryShared.ts.
 *
 * Every change and every action writes a row to cxo_mira_audit (refusals
 * included), whether or not the employee-ops switch is on.
 *
 * Writes reuse the page's own logic (lib/team/coAdmins, lib/team/execAssistants,
 * lib/integrations/companySettings, lib/assistantNameServer, lib/dueReminders,
 * lib/dashboardPrefs, lib/employees/invite, lib/mcp/tokens, lib/icsFeeds), so
 * the rules are the same wherever a change comes from.
 */
import { supabase } from '@/lib/supabase'
import { recordAudit } from '@/lib/ops/audit'
import type { AuditResult } from '@/lib/ops/approvalsShared'
import type { Member } from '@/types'
import {
  REGISTRY,
  allowed,
  findEntry,
  searchEntries,
  validateSettingValue,
  describeSettingChange,
  displayValue,
  whoText,
  type RegistryEntry,
} from '@/lib/settings/registryShared'
import { companyAssistantName, personalAssistantName, saveCompanyAssistantName, savePersonalAssistantName } from '@/lib/assistantNameServer'
import { reminderPrefs } from '@/lib/dueRemindersShared'
import { setReminderPrefs } from '@/lib/dueReminders'
import { updateMember, listMembers } from '@/lib/members'
import { readCompanyLogo, rotateWisprLink, saveCompanyLogo } from '@/lib/integrations/companySettings'
import { workHours } from '@/lib/followups/shared'
import { companyValues } from '@/lib/people/shared'
import { canViewComp, matchEmployee } from '@/lib/employees/shared'
import { readAbout, roleLabel } from '@/lib/onboarding/aboutYouShared'
import { DASHBOARD_KPIS, DASHBOARD_TILES, DASHBOARD_TIMEFRAMES, getDashboardPrefs, setDashboardPrefs, type DashboardPrefsPatch } from '@/lib/dashboardPrefs'
import { inviteCoAdmin, removeCoAdmin } from '@/lib/team/coAdmins'
import { addExecAssistant, listExecAssistants, removeExecAssistant } from '@/lib/team/execAssistants'
import { listMcpTokens, mcpKeyScope, revokeMcpToken } from '@/lib/mcp/tokens'
import { listFeeds, removeFeed } from '@/lib/icsFeeds'
import { googleConnectedFor } from '@/lib/onboarding/dayOneShared'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { normalizePace, PACE_LABEL } from '@/lib/feedback/fixRequestUpdatesShared'

type TenantLike = {
  id: string
  slug: string
  display_name: string | null
  timezone?: string | null
  brand?: string | null
  settings?: Record<string, unknown> | null
}

export type RegistryCtx = {
  tenant: TenantLike
  member: Member
  via: 'ciao' | 'mcp'
  /** The person said yes to the readback (Ciao confirm gate, or MCP confirm: true). */
  confirmed: boolean
  /**
   * MCP only: run an existing tool for a `tool`-mode entry. Ciao leaves this
   * out and tells the model which tool to call, so that tool keeps its own gates.
   */
  runTool?: (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export type RegistryResult = Record<string, unknown> & { ok: boolean }

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/** The public face of an entry: what it is, where, who, risky, how. */
export function describeEntry(e: RegistryEntry): Record<string, unknown> {
  const how =
    e.how.mode === 'fn'
      ? { can_do_it: true }
      : e.how.mode === 'tool'
        ? { can_do_it: true, tool: e.how.tool, ...(e.how.args ? { tool_args: e.how.args } : {}) }
        : e.how.mode === 'link'
          ? { can_do_it: false, link: e.how.url, why_you_do_it: e.how.reason }
          : { can_do_it: false, why_you_do_it: e.how.reason }
  return {
    key: e.key,
    kind: e.kind,
    label: e.label,
    what: e.what,
    where: `${e.where.label} (${e.where.path})`,
    who_can_change: whoText(e.who),
    ...(e.inputs ? { inputs: e.inputs } : {}),
    needs_your_yes: e.risky && (e.how.mode === 'fn'),
    ...(e.risky && e.riskWhy ? { why_careful: e.riskWhy } : {}),
    ...how,
  }
}

/** list_settings: everything, or the entries matching a question. Each with whether THIS person may change it. */
export function listSettings(ctx: Pick<RegistryCtx, 'tenant' | 'member'>, q?: unknown, kind?: 'setting' | 'action'): RegistryResult {
  const found = searchEntries(q, kind)
  const items = found.slice(0, q ? 12 : REGISTRY.length).map((e) => ({
    key: e.key,
    kind: e.kind,
    label: e.label,
    where: e.where.label,
    you_can_change: allowed(e.who, ctx.member, ctx.tenant),
    ai_can_do_it: e.how.mode === 'fn' || e.how.mode === 'tool',
  }))
  return { ok: true, count: items.length, items, say: items.length ? undefined : 'Nothing matches that. Ask with other words, or list everything.' }
}

// ── Reading current values ──────────────────────────────────────────────────

async function freshMemberSettings(memberId: string): Promise<{ settings: Record<string, unknown>; timezone: string | null }> {
  const { data } = await supabase.from('members').select('settings, timezone').eq('id', memberId).maybeSingle()
  const row = (data ?? {}) as { settings?: Record<string, unknown> | null; timezone?: string | null }
  return { settings: row.settings ?? {}, timezone: row.timezone ?? null }
}

async function freshRep(repId: string): Promise<{ settings: Record<string, unknown>; timezone: string | null }> {
  const { data } = await supabase.from('reps').select('settings, timezone').eq('id', repId).maybeSingle()
  const row = (data ?? {}) as { settings?: Record<string, unknown> | null; timezone?: string | null }
  return { settings: row.settings ?? {}, timezone: row.timezone ?? null }
}

/** The current value, read fresh. undefined = not something we show (a link step, or a secret). */
export async function currentValue(ctx: Pick<RegistryCtx, 'tenant' | 'member'>, e: RegistryEntry): Promise<unknown> {
  const { tenant, member } = ctx
  switch (e.key) {
    case 'assistant_name.company':
      return companyAssistantName({ settings: (await freshRep(tenant.id)).settings }) ?? '(not set: the default name)'
    case 'assistant_name.personal':
      return (await personalAssistantName(member)) ?? '(not set: the company name)'
    case 'reminders.in_app':
      return reminderPrefs((await freshMemberSettings(member.id)).settings).inApp
    case 'reminders.email':
      return reminderPrefs((await freshMemberSettings(member.id)).settings).email
    case 'profile.timezone':
      return (await freshMemberSettings(member.id)).timezone ?? tenant.timezone ?? '(not set)'
    case 'schedule.work_hours':
      return workHours({ settings: (await freshMemberSettings(member.id)).settings } as Parameters<typeof workHours>[0])
    case 'notify.exec_email_digest':
      return (await freshMemberSettings(member.id)).settings.exec_email_digest === true
    case 'notify.ticket_update_pace':
      return normalizePace((await freshMemberSettings(member.id)).settings.ticket_update_pace) ?? '(not set: we ask on your next report)'
    case 'ai.nudges_paused_until':
      return (await freshMemberSettings(member.id)).settings.followups_paused_until ?? '(not paused)'
    case 'about.role_focus': {
      const a = readAbout((await freshMemberSettings(member.id)).settings)
      return { role: roleLabel(a) ?? '(not set)', focus: a.focus }
    }
    case 'company.logo_url':
      return readCompanyLogo((await freshRep(tenant.id)).settings) ?? '(no logo)'
    case 'company.values':
      return companyValues((await freshRep(tenant.id)).settings)
    case 'dashboard.prefs': {
      const p = await getDashboardPrefs(tenant.id)
      return { tiles: p.tiles, default_timeframe: p.default_timeframe, pinned_kpis: p.pinned_kpis, headline_note: p.headline_note }
    }
    case 'people.can_view_comp':
      return canViewComp(member) ? 'You can see pay.' : 'You cannot see pay.'
    case 'integrations.google': {
      const { data } = await supabase.from('google_tokens').select('member_id, needs_reconnect').eq('rep_id', tenant.id).or(`member_id.eq.${member.id},member_id.is.null`)
      return googleConnectedFor((data ?? []) as Array<{ member_id: string | null; needs_reconnect?: boolean | null }>, member.id) ? 'connected' : 'not connected'
    }
    case 'ai.mcp_keys': {
      const keys = await listMcpTokens(tenant.id, mcpKeyScope(member)).catch(() => [])
      const live = keys.filter((k) => !k.revoked_at)
      return live.length ? live.map((k) => k.label) : '(no keys)'
    }
    case 'team.exec_assistant.add':
    case 'team.exec_assistant.remove': {
      const list = await listExecAssistants(tenant.id, member.id).catch(() => [])
      return list.length ? list.map((a) => a.display_name || a.email) : '(no assistant)'
    }
    default:
      return undefined
  }
}

/** explain_setting: what it is, where, who may change it, the current value. */
export async function explainSetting(ctx: Pick<RegistryCtx, 'tenant' | 'member'>, keyOrWords: unknown): Promise<RegistryResult> {
  const e = findEntry(keyOrWords) ?? searchEntries(keyOrWords)[0] ?? null
  if (!e) return { ok: false, error: 'unknown_setting', say: 'I could not find that setting. Ask list_settings with a few words.' }
  let current: unknown
  try {
    current = await currentValue(ctx, e)
  } catch {
    current = undefined
  }
  return {
    ok: true,
    ...describeEntry(e),
    you_can_change: allowed(e.who, ctx.member, ctx.tenant),
    ...(current !== undefined ? { current } : {}),
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function mergeMemberSettings(memberId: string, patch: Record<string, unknown>): Promise<void> {
  const { settings } = await freshMemberSettings(memberId)
  const next: Record<string, unknown> = { ...settings }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k]
    else next[k] = v
  }
  const { error } = await supabase.from('members').update({ settings: next }).eq('id', memberId)
  if (error) throw error
}

async function mergeRepSettings(repId: string, patch: Record<string, unknown>): Promise<void> {
  const { settings } = await freshRep(repId)
  const { error } = await supabase.from('reps').update({ settings: { ...settings, ...patch } }).eq('id', repId)
  if (error) throw error
}

/** dashboard.prefs patch, checked against the catalog. */
export function checkDashboardPatch(raw: Record<string, unknown>): { ok: true; patch: DashboardPrefsPatch } | { ok: false; error: string } {
  const patch: DashboardPrefsPatch = {}
  const inList = (xs: unknown, allowedList: readonly string[], what: string): string[] | string => {
    if (!Array.isArray(xs)) return `${what} must be a list.`
    const bad = xs.filter((x) => !allowedList.includes(String(x)))
    return bad.length ? `Unknown ${what}: ${bad.join(', ')}. Choose from ${allowedList.join(', ')}.` : xs.map(String)
  }
  if (raw.tiles !== undefined) {
    const r = inList(raw.tiles, DASHBOARD_TILES, 'tiles')
    if (typeof r === 'string') return { ok: false, error: r }
    patch.tiles = r as DashboardPrefsPatch['tiles']
  }
  if (raw.pinned_kpis !== undefined) {
    const r = inList(raw.pinned_kpis, DASHBOARD_KPIS, 'KPIs')
    if (typeof r === 'string') return { ok: false, error: r }
    patch.pinned_kpis = r as DashboardPrefsPatch['pinned_kpis']
  }
  if (raw.default_timeframe !== undefined) {
    const tf = String(raw.default_timeframe)
    if (!(DASHBOARD_TIMEFRAMES as readonly string[]).includes(tf)) return { ok: false, error: `Timeframe is one of ${DASHBOARD_TIMEFRAMES.join(', ')}.` }
    patch.default_timeframe = tf as DashboardPrefsPatch['default_timeframe']
  }
  if (raw.headline_note !== undefined) {
    if (raw.headline_note !== null && typeof raw.headline_note !== 'string') return { ok: false, error: 'The headline note is text, or null to clear it.' }
    patch.headline_note = raw.headline_note === null ? null : String(raw.headline_note).slice(0, 200)
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to change: give tiles, default_timeframe, pinned_kpis or headline_note.' }
  return { ok: true, patch }
}

/** Find one teammate on this account by name or email. */
async function resolveMember(repId: string, who: unknown, opts: { includeAssistants?: boolean } = {}): Promise<{ ok: true; member: Member } | { ok: false; error: string; candidates?: string[] }> {
  const q = str(who).toLowerCase()
  if (!q) return { ok: false, error: 'Say who: a name or an email.' }
  const all = (await listMembers(repId, opts)).filter((m) => m.is_active !== false)
  const exact = all.filter((m) => (m.email ?? '').toLowerCase() === q || (m.display_name ?? '').toLowerCase() === q || m.id === q)
  const hits = exact.length ? exact : all.filter((m) => (m.display_name ?? '').toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q))
  if (hits.length === 1) return { ok: true, member: hits[0] }
  if (!hits.length) return { ok: false, error: `No active teammate matches "${str(who)}".` }
  return { ok: false, error: 'More than one teammate matches. Which one?', candidates: hits.slice(0, 6).map((m) => `${m.display_name} <${m.email}>`) }
}

async function audit(ctx: RegistryCtx, tool: string, args: Record<string, unknown>, result: AuditResult): Promise<void> {
  await recordAudit({
    repId: ctx.tenant.id,
    memberId: ctx.member.acting_assistant?.id ?? ctx.member.id,
    tool: `${ctx.via === 'mcp' ? 'mcp:' : ''}${tool}`,
    args,
    result,
    approved: ctx.confirmed ? true : null,
  })
}

const NEEDS_YES = (e: RegistryEntry, via: RegistryCtx['via']) =>
  via === 'mcp'
    ? `Not done. ${e.label} needs the person's yes first (${e.riskWhy ?? 'a careful change'}). Read back exactly what will happen, wait for them to agree, then call again with confirm: true.`
    : `Not done. ${e.label} needs your yes first (${e.riskWhy ?? 'a careful change'}).`

/** The common front of change_setting and do_action: find, check kind, check role, check risk. */
function front(ctx: RegistryCtx, key: unknown, kind: 'setting' | 'action'): { ok: true; e: RegistryEntry } | { ok: false; out: RegistryResult; result: AuditResult } {
  const e = findEntry(key)
  if (!e) return { ok: false, result: 'not_done', out: { ok: false, error: 'unknown_key', say: `I do not know "${str(key)}". Use list_settings to find the key.` } }
  if (e.kind !== kind) {
    const other = kind === 'setting' ? 'do_action' : 'change_setting'
    return { ok: false, result: 'not_done', out: { ok: false, error: 'wrong_tool', say: `${e.label} is ${e.kind === 'action' ? 'an action' : 'a setting'}: use ${other}.` } }
  }
  if (e.how.mode === 'link') return { ok: false, result: 'not_done', out: { ok: false, error: 'do_it_on_the_page', link: e.how.url, say: `${e.how.reason} Here is where: ${e.where.label} (${e.how.url}).` } }
  if (e.how.mode === 'operator') return { ok: false, result: 'not_done', out: { ok: false, error: 'our_team_changes_it', say: e.how.reason } }
  if (!allowed(e.who, ctx.member, ctx.tenant)) {
    return { ok: false, result: 'refused', out: { ok: false, refused: true, error: 'not_allowed_for_role', say: `Not done. ${whoText(e.who)} You can ask one of them.` } }
  }
  if (e.risky && e.how.mode === 'fn' && !ctx.confirmed) {
    return { ok: false, result: 'not_done', out: { ok: false, needs_confirmation: true, error: 'needs_confirmation', say: NEEDS_YES(e, ctx.via) } }
  }
  return { ok: true, e }
}

/** A `tool` entry: Ciao calls the tool itself (its gates apply); MCP forwards through ctx.runTool. */
async function viaTool(ctx: RegistryCtx, e: RegistryEntry & { how: { mode: 'tool'; tool: string } }, args: Record<string, unknown>): Promise<RegistryResult> {
  if (!ctx.runTool) {
    return {
      ok: false,
      use_tool: e.how.tool,
      ...(e.how.args ? { tool_args: e.how.args } : {}),
      say: `Call ${e.how.tool} to do this${e.how.args ? ` (${e.how.args})` : ''}.`,
    }
  }
  const out = await ctx.runTool(e.how.tool, args)
  return { ...out, ok: out.ok !== false, via_tool: e.how.tool }
}

/** change_setting: role check, validate, write, read back. Every call is audited. */
export async function changeSetting(ctx: RegistryCtx, key: unknown, value: unknown, extra: { target?: unknown } = {}): Promise<RegistryResult> {
  const f = front(ctx, key, 'setting')
  const auditKey = `change_setting:${f.ok ? f.e.key : str(key).slice(0, 40)}`
  const auditArgs = { value: typeof value === 'object' ? '[object]' : (value as unknown), ...(extra.target ? { target: str(extra.target) } : {}) } as Record<string, unknown>
  if (!f.ok) {
    await audit(ctx, auditKey, auditArgs, f.result)
    return f.out
  }
  const e = f.e
  if (e.how.mode === 'tool') {
    const out = await viaTool(ctx, e as RegistryEntry & { how: { mode: 'tool'; tool: string } }, asObj(value))
    if (ctx.runTool) await audit(ctx, auditKey, auditArgs, out.ok ? 'ok' : 'not_done')
    return out
  }
  const v = validateSettingValue(e.key, value)
  if (!v.ok) {
    await audit(ctx, auditKey, auditArgs, 'not_done')
    return { ok: false, error: 'invalid', say: v.error }
  }
  try {
    const out = await writeSetting(ctx, e, v.value, extra)
    await audit(ctx, auditKey, auditArgs, out.ok ? 'ok' : 'not_done')
    return out
  } catch (err) {
    console.error('[settings registry] write failed', e.key, err instanceof Error ? err.message : err)
    await audit(ctx, auditKey, auditArgs, 'error')
    return { ok: false, error: 'write_failed', say: 'Could not save that. Try again in a minute.' }
  }
}

async function writeSetting(ctx: RegistryCtx, e: RegistryEntry, value: unknown, extra: { target?: unknown }): Promise<RegistryResult> {
  const { tenant, member } = ctx
  const done = async (say: string): Promise<RegistryResult> => ({ ok: true, key: e.key, now: await currentValue(ctx, e).catch(() => value), say })
  switch (e.key) {
    case 'assistant_name.company': {
      const r = await saveCompanyAssistantName(tenant.id, value)
      if (!r.ok) return { ok: false, error: 'invalid', say: r.error }
      return { ok: true, key: e.key, now: r.name || '(the default name)', say: r.name ? `Everyone now calls the assistant ${r.name}.` : 'The company name for the assistant is back to the default.' }
    }
    case 'assistant_name.personal': {
      const r = await savePersonalAssistantName(member.acting_assistant?.id ?? member.id, value)
      if (!r.ok) return { ok: false, error: 'invalid', say: r.error }
      return { ok: true, key: e.key, now: r.name || '(the company name)', say: r.name ? `You now call me ${r.name}.` : 'Back to the company name.' }
    }
    case 'reminders.in_app': {
      const p = await setReminderPrefs(member.id, { inApp: value as boolean })
      return { ok: true, key: e.key, now: p.inApp, say: `In-app due reminders are ${p.inApp ? 'on' : 'off'}.` }
    }
    case 'reminders.email': {
      const p = await setReminderPrefs(member.id, { email: value as boolean })
      return { ok: true, key: e.key, now: p.email, say: `Email due reminders are ${p.email ? 'on' : 'off'}.` }
    }
    case 'profile.timezone': {
      const tz = String(value)
      await updateMember(member.id, { timezone: tz })
      // Same as the browser route: the owner fills the company zone when it was never set.
      if (member.role === 'owner' && (!tenant.timezone || tenant.timezone === 'UTC')) {
        await supabase.from('reps').update({ timezone: tz }).eq('id', tenant.id)
      }
      return done(`Your time zone is ${tz}.`)
    }
    case 'schedule.work_hours': {
      await mergeMemberSettings(member.id, { work_hours: value })
      return done('Working hours saved.')
    }
    case 'notify.exec_email_digest': {
      await mergeMemberSettings(member.id, { exec_email_digest: value === true ? true : null })
      return done(`The executive email digest is ${value ? 'on' : 'off'}.`)
    }
    case 'notify.ticket_update_pace': {
      const pace = normalizePace(value)
      if (!pace) return { ok: false, error: 'invalid', say: 'Say start and done, daily, or every step.' }
      await mergeMemberSettings(member.id, { ticket_update_pace: pace })
      return done(`Got it. We'll update you on reported issues ${PACE_LABEL[pace]}.`)
    }
    case 'company.logo_url': {
      const r = await saveCompanyLogo(tenant.id, member, value)
      if (!r.ok) return { ok: false, error: 'invalid', say: r.error }
      return { ok: true, key: e.key, now: r.url ?? '(no logo)', say: r.url ? 'The company logo is updated.' : 'The company logo is removed.' }
    }
    case 'company.values': {
      await mergeRepSettings(tenant.id, { cxo_values: value })
      return done('Company values saved.')
    }
    case 'dashboard.prefs': {
      const c = checkDashboardPatch(asObj(value))
      if (!c.ok) return { ok: false, error: 'invalid', say: c.error }
      await setDashboardPrefs(tenant.id, { ...c.patch, updated_by: ctx.via === 'mcp' ? 'mcp' : 'app' })
      return done('The dashboard is updated for everyone.')
    }
    case 'people.can_view_comp': {
      const t = await resolveMember(tenant.id, extra.target)
      if (!t.ok) return { ok: false, error: 'ambiguous_or_missing', say: t.error, ...(t.candidates ? { candidates: t.candidates } : {}) }
      if (t.member.role === 'owner') return { ok: false, error: 'invalid', say: 'The owner always sees pay.' }
      await mergeMemberSettings(t.member.id, { can_view_comp: value as boolean | null })
      const fresh = await freshMemberSettings(t.member.id)
      const now = canViewComp({ role: t.member.role, settings: fresh.settings })
      return { ok: true, key: e.key, target: t.member.display_name, now: now ? 'can see pay' : 'cannot see pay', say: `${t.member.display_name} ${now ? 'can' : 'cannot'} see pay now.` }
    }
    default:
      return { ok: false, error: 'not_writable', say: 'That one is not changed this way.' }
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────

/** do_action: role check, risky needs a yes, run, report. Every call is audited. */
export async function doAction(ctx: RegistryCtx, key: unknown, input: unknown): Promise<RegistryResult> {
  const f = front(ctx, key, 'action')
  const args = asObj(input)
  const auditKey = `do_action:${f.ok ? f.e.key : str(key).slice(0, 40)}`
  if (!f.ok) {
    await audit(ctx, auditKey, args, f.result)
    return f.out
  }
  const e = f.e
  if (e.how.mode === 'tool') {
    if (e.how.tool === 'setup_progress') {
      const out = await setupProgress(ctx)
      return out
    }
    const out = await viaTool(ctx, e as RegistryEntry & { how: { mode: 'tool'; tool: string } }, args)
    if (ctx.runTool) await audit(ctx, auditKey, args, out.ok ? 'ok' : 'not_done')
    return out
  }
  try {
    const out = await runAction(ctx, e, args)
    await audit(ctx, auditKey, args, out.ok ? 'ok' : 'not_done')
    return out
  } catch (err) {
    console.error('[settings registry] action failed', e.key, err instanceof Error ? err.message : err)
    await audit(ctx, auditKey, args, 'error')
    return { ok: false, error: 'action_failed', say: err instanceof Error && err.message.length < 160 ? err.message : 'That did not work. Try again in a minute.' }
  }
}

async function runAction(ctx: RegistryCtx, e: RegistryEntry, args: Record<string, unknown>): Promise<RegistryResult> {
  const { tenant, member } = ctx
  const source = ctx.via === 'mcp' ? 'mcp' : 'ciao'
  switch (e.key) {
    case 'team.co_admin.invite': {
      const r = await inviteCoAdmin(tenant, member, { email: args.email, displayName: args.name ?? args.display_name, source })
      return r.ok ? { ok: true, say: `${r.email} is ${r.reactivated ? 'back' : 'in'} as an admin. They have an email with their sign-in.` } : { ok: false, error: 'not_done', say: r.error }
    }
    case 'team.co_admin.remove': {
      const t = await resolveMember(tenant.id, args.who ?? args.email ?? args.name)
      if (!t.ok) return { ok: false, error: 'ambiguous_or_missing', say: t.error, ...(t.candidates ? { candidates: t.candidates } : {}) }
      const r = await removeCoAdmin(tenant, member, t.member.id, source)
      return r.ok ? { ok: true, say: `${t.member.display_name}'s login is off.` } : { ok: false, error: 'not_done', say: r.error }
    }
    case 'team.exec_assistant.add': {
      const r = await addExecAssistant(tenant, member, { email: args.email, displayName: args.name ?? args.display_name, sendEmail: args.send_email !== false, source })
      return r.ok
        ? { ok: true, say: `${r.email} is now your assistant.${r.emailed ? ' They have an email with a link to set their password.' : ' They can set a password from the sign-in page.'}` }
        : { ok: false, error: 'not_done', say: r.error }
    }
    case 'team.exec_assistant.remove': {
      const mine = await listExecAssistants(tenant.id, member.id)
      const q = str(args.who ?? args.email ?? args.name).toLowerCase()
      const hits = mine.filter((a) => !q || a.email.toLowerCase() === q || (a.display_name ?? '').toLowerCase().includes(q))
      if (hits.length !== 1) return { ok: false, error: 'ambiguous_or_missing', say: hits.length ? 'Which assistant?' : 'You have no assistant by that name.', candidates: (hits.length ? hits : mine).map((a) => `${a.display_name} <${a.email}>`) }
      const r = await removeExecAssistant(tenant, member, hits[0].id, source)
      return r.ok ? { ok: true, say: `${hits[0].display_name} no longer works for you.` } : { ok: false, error: 'not_done', say: r.error }
    }
    case 'team.employee.invite': {
      const { loadEmployees } = await import('@/lib/employees/data')
      const { inviteEmployee } = await import('@/lib/employees/invite')
      const data = await loadEmployees(tenant.id, false)
      const m = matchEmployee(data.employees as Array<{ id: string; name: string; email?: string | null }>, str(args.who ?? args.name), str(args.email) || null)
      if (!m.match) return { ok: false, error: 'ambiguous_or_missing', say: m.candidates.length ? 'Which employee?' : 'No employee by that name on the Employees page.', candidates: m.candidates.slice(0, 6).map((c) => c.name) }
      const r = await inviteEmployee(tenant, member, m.match.id, { email: str(args.email) || null })
      return { ok: true, say: r.linkedExisting ? `${m.match.name} already had a login; it is linked to their record.` : `${m.match.name} has an email with their sign-in.` }
    }
    case 'ai.mcp_key.revoke': {
      const scope = mcpKeyScope(member)
      const keys = (await listMcpTokens(tenant.id, scope)).filter((k) => !k.revoked_at)
      const q = str(args.key_id ?? args.label ?? args.name).toLowerCase()
      const hits = keys.filter((k) => k.id === q || (q && k.label.toLowerCase().includes(q)))
      if (hits.length !== 1) return { ok: false, error: 'ambiguous_or_missing', say: hits.length ? 'Which key?' : 'No live key by that name that you can turn off.', candidates: (hits.length ? hits : keys).map((k) => k.label) }
      const ok = await revokeMcpToken(tenant.id, hits[0].id, scope)
      return ok ? { ok: true, say: `The key "${hits[0].label}" is off. Any AI using it is disconnected now.` } : { ok: false, error: 'not_done', say: 'Could not turn that key off.' }
    }
    case 'integrations.wispr_link.rotate': {
      const r = await rotateWisprLink(tenant.id, member)
      return r.ok ? { ok: true, link: '/dashboard/integrations', say: 'Made a new meeting-notes inbox link; the old one has stopped. Copy the new link from Integrations into Wispr Flow or Plaud.' } : { ok: false, error: 'not_done', say: r.error }
    }
    case 'calendar.ics.remove': {
      const feeds = await listFeeds(tenant.id, member.id)
      const q = str(args.feed_id ?? args.label ?? args.name).toLowerCase()
      const hits = feeds.filter((f) => f.id === q || (q && f.label.toLowerCase().includes(q)))
      if (hits.length !== 1) return { ok: false, error: 'ambiguous_or_missing', say: hits.length ? 'Which calendar?' : 'No outside calendar by that name.', candidates: (hits.length ? hits : feeds).map((f) => f.label) }
      await removeFeed(tenant.id, member.id, hits[0].id)
      return { ok: true, say: `${hits[0].label} is no longer on your calendar.` }
    }
    case 'onboarding.abilities_seen': {
      const { markAbilitiesSeen } = await import('@/lib/onboarding/dayOne')
      await markAbilitiesSeen(tenant, member as unknown as Parameters<typeof markAbilitiesSeen>[1])
      return { ok: true, say: 'Ticked.' }
    }
    default:
      return { ok: false, error: 'not_runnable', say: 'That one is not run this way.' }
  }
}

// ── Onboarding as a conversation ────────────────────────────────────────────

export type SetupStep = { id: string; title: string; done: boolean; optional?: boolean; how: 'ask_me' | 'link'; key?: string; link?: string; say: string }

/**
 * setup_progress: what is set up and what is left, from the real state. Steps
 * the assistant can do say "ask_me" (with the registry key); steps only the
 * person can do carry a one-click link.
 */
export async function setupProgress(ctx: Pick<RegistryCtx, 'tenant' | 'member'>): Promise<RegistryResult> {
  const { tenant, member } = ctx
  const exec = allowed('owner_admin', member, tenant)
  const employee = isEmployeeOnlyMember(member, tenant)
  const safe = async <T,>(p: Promise<T>, d: T): Promise<T> => p.catch(() => d)

  const [ms, rep, google, signed, todos, team, keys, slack, qbo, assistants] = await Promise.all([
    safe(freshMemberSettings(member.id), { settings: {}, timezone: null }),
    safe(freshRep(tenant.id), { settings: {}, timezone: null }),
    safe(
      (async () => {
        const { data } = await supabase.from('google_tokens').select('member_id, needs_reconnect').eq('rep_id', tenant.id).or(`member_id.eq.${member.id},member_id.is.null`)
        return googleConnectedFor((data ?? []) as Array<{ member_id: string | null; needs_reconnect?: boolean | null }>, member.id)
      })(),
      false,
    ),
    safe(
      (async () => {
        const { hasMemberSignedCurrent } = await import('@/lib/liabilityAgreement')
        return hasMemberSignedCurrent(member.id, (tenant.brand ?? null) as Parameters<typeof hasMemberSignedCurrent>[1])
      })(),
      true,
    ),
    safe(
      (async () => {
        const { count } = await supabase.from('cxo_todos').select('id', { count: 'exact', head: true }).eq('rep_id', tenant.id).eq('member_id', member.id).is('deleted_at', null)
        return count ?? 0
      })(),
      0,
    ),
    exec ? safe(listMembers(tenant.id).then((xs) => xs.filter((m) => m.is_active !== false).length), 1) : Promise.resolve(1),
    safe(listMcpTokens(tenant.id, { memberId: member.id }).then((xs) => xs.filter((k) => !k.revoked_at).length), 0),
    exec ? safe(import('@/lib/slack/data').then((m) => m.getInstallForRep(tenant.id)).then((x) => !!x), false) : Promise.resolve(false),
    exec ? safe(import('@/lib/qbo/data').then((m) => m.getQboStatus(tenant.id)).then((s) => s.connected), false) : Promise.resolve(false),
    exec ? safe(listExecAssistants(tenant.id, member.id).then((xs) => xs.length), 0) : Promise.resolve(0),
  ])
  const about = readAbout(ms.settings)
  const steps: SetupStep[] = []
  steps.push({ id: 'agreement', title: 'Sign your user agreement', done: signed, how: 'link', link: '/dashboard', say: 'Only you can sign it, on the page.' })
  steps.push({ id: 'about', title: 'Tell me your role and what you watch', done: !!roleLabel(about), how: 'ask_me', key: 'about.role_focus', say: 'Tell me your role and the 2-3 things you watch most.' })
  steps.push({ id: 'google', title: 'Connect your Google calendar', done: google, how: 'link', link: '/api/google/oauth/start?return=/dashboard/integrations', say: 'One click: Google asks you to allow it.' })
  steps.push({ id: 'timezone', title: 'Check your time zone', done: !!ms.timezone && ms.timezone !== 'UTC', how: 'ask_me', key: 'profile.timezone', say: 'Tell me your time zone if it is not right.' })
  if (!employee) {
    steps.push({ id: 'first_todo', title: 'Add your first to-do', done: todos > 0, how: 'ask_me', key: 'todo.add', say: 'Tell me one thing you need to get done.' })
  }
  if (exec) {
    steps.push({ id: 'logo', title: 'Add the company logo', done: !!readCompanyLogo(rep.settings), optional: true, how: 'ask_me', key: 'company.logo_url', say: 'Send me an https link to the logo image.' })
    steps.push({ id: 'assistant_name', title: 'Name the assistant for the company', done: !!companyAssistantName({ settings: rep.settings }), optional: true, how: 'ask_me', key: 'assistant_name.company', say: 'Tell me what everyone should call me.' })
    steps.push({ id: 'team', title: 'Invite a co-admin or your team', done: team > 1, optional: true, how: 'ask_me', key: 'team.co_admin.invite', say: 'Give me their name and email.' })
    steps.push({ id: 'exec_assistant', title: 'Add your executive assistant', done: assistants > 0, optional: true, how: 'ask_me', key: 'team.exec_assistant.add', say: 'Give me their name and email.' })
    steps.push({ id: 'slack', title: 'Connect Slack', done: slack, optional: true, how: 'link', link: '/api/slack/oauth/start', say: 'One click: Slack asks an admin to approve the app.' })
    if (member.role === 'owner') steps.push({ id: 'quickbooks', title: 'Connect QuickBooks', done: qbo, optional: true, how: 'link', link: '/api/integrations/quickbooks/start', say: 'One click: Intuit asks you to allow it.' })
  }
  if (!employee) steps.push({ id: 'your_ai', title: 'Connect your own Claude or ChatGPT', done: keys > 0, optional: true, how: 'link', link: '/dashboard/integrations', say: 'Make a key on Integrations and paste it into your AI.' })

  const required = steps.filter((s) => !s.optional)
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done) ?? null
  return {
    ok: true,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    required_left: required.filter((s) => !s.done).length,
    steps,
    next: next ? { id: next.id, title: next.title, how: next.how, ...(next.key ? { key: next.key } : {}), ...(next.link ? { link: next.link } : {}), say: next.say } : null,
    say: next ? `Next: ${next.title}. ${next.say}` : 'You are all set up.',
  }
}

/** For the Ciao confirm gate: the readback lines for a risky change_setting / do_action, in plain words. */
export function describeRegistryCall(name: string, args: Record<string, unknown>, opts: { targetName?: string } = {}): string[] | null {
  const e = findEntry(args.key)
  if (!e) return null
  const why = e.riskWhy ? [`Why I am checking: ${e.riskWhy}`] : []
  if (name === 'change_setting' && e.kind === 'setting') {
    return [`${describeSettingChange(e, args.value, opts.targetName ?? args.target)}.`, ...why]
  }
  const shown = displayValue(asObj(args.input))
  return [`${e.label}${shown && shown !== 'nothing' ? `: ${shown}` : ''}.`, ...why]
}

/** The confirm gate, before proposing a change about a teammate: who exactly (or the question to ask). */
export async function resolveTargetName(repId: string, who: unknown): Promise<{ ok: true; name: string } | { ok: false; error: string; candidates?: string[] }> {
  const t = await resolveMember(repId, who)
  return t.ok ? { ok: true, name: t.member.display_name || t.member.email || str(who) } : t
}
