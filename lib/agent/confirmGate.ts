/**
 * Confirm before write, the server side (rules in lib/agent/confirmGateShared).
 *
 *  - proposeGated: called by lib/ops/agentGate.runToolWithOps INSTEAD of the
 *    handler for a gated call. Resolves the exact details (read-only), puts
 *    the proposal on ctx.proposals and returns "not done, needs a yes".
 *  - savePending / loadPending / claimPending / clearPending: the one pending
 *    record per person (cxo_ciao_pending), keyed to the conversation, with a
 *    short expiry.
 *  - executePending: the yes. Runs exactly the stored actions, each through
 *    the same role wall and ops layer as a normal call, with
 *    ctx.userConfirmed so the gate lets it through.
 */
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { supabase } from '@/lib/supabase'
import { PENDING_TTL_MS, type PendingAction, type PendingRecord } from '@/lib/agent/confirmGateShared'

type Described = { ok: true; lines: string[]; args: Record<string, unknown> } | { ok: false; result: ToolHandlerResult }

const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Read-only: the exact proposal for a gated call, or the ask/error to hand back. */
export async function describeGatedCall(ctx: AgentContext, name: string, args: Record<string, unknown>): Promise<Described> {
  const { describeCxoCall } = await import('@/lib/agent/cxoTools')
  const cxo = await describeCxoCall(ctx, name, args)
  if (cxo) return cxo
  const { describePeopleCall } = await import('@/lib/agent/cxoPeopleTools')
  const people = await describePeopleCall(ctx, name, args)
  if (people) return people

  if (name === 'change_setting' || name === 'do_action') {
    // Settings registry: refuse before proposing when the person may not do it.
    const { findEntry, allowed, whoText } = await import('@/lib/settings/registryShared')
    const e = findEntry(args.key)
    if (e && !allowed(e.who, ctx.caller, ctx.tenant)) return { ok: false, result: j({ ok: false, refused: true, error: 'not_allowed_for_role', say: `Not done. ${whoText(e.who)}` }) }
    const { describeRegistryCall, resolveTargetName } = await import('@/lib/settings/registry')
    // A change about a teammate: name them exactly on the card, or ask which one before any yes.
    let targetName: string | undefined
    if (name === 'change_setting' && e?.scope === 'member' && e.kind === 'setting') {
      const t = await resolveTargetName(ctx.tenant.id, args.target)
      if (!t.ok) return { ok: false, result: j({ ok: false, error: 'ambiguous_or_missing', say: t.error, ...(t.candidates ? { candidates: t.candidates } : {}) }) }
      targetName = t.name
    }
    const lines = describeRegistryCall(name, args, { targetName })
    if (lines) return { ok: true, lines, args: { ...args, key: e?.key ?? args.key } }
  }

  if (name === 'decide_approval') {
    const { isApprover } = await import('@/lib/ops/approvalsShared')
    if (!isApprover(ctx.caller, ctx.tenant)) return { ok: false, result: j({ ok: false, say: 'Only an executive can approve or decline requests.' }) }
    const id = str(args.id, 80)
    const decision = str(args.decision, 20).toLowerCase()
    if (!id) return { ok: false, result: j({ ok: false, error: 'id required: call list_approvals first and use the item id.' }) }
    if (decision !== 'approve' && decision !== 'decline') return { ok: false, result: j({ ok: false, error: "decision must be 'approve' or 'decline'." }) }
    const { listApprovals } = await import('@/lib/ops/approvals')
    const row = (await listApprovals(ctx.tenant.id, 'pending', 200)).find((r) => r.id === id && r.reason !== 'slack_hold')
    if (!row) return { ok: false, result: j({ ok: false, say: 'That request was already decided or does not exist.' }) }
    return {
      ok: true,
      lines: [`${decision === 'approve' ? 'Approve' : 'Decline'}: ${row.summary}`, decision === 'approve' ? 'Approving runs it right away.' : 'The person who asked is told.'],
      args: { ...args, id, decision },
    }
  }

  if (name === 'leadership_agenda') {
    const { AGENDA_ROLES, startLabel } = await import('@/lib/meetings/agendaShared')
    const exec = !ctx.selfOnly && (AGENDA_ROLES as readonly string[]).includes(String((ctx.caller as { role?: string | null }).role ?? ''))
    if (!exec) return { ok: false, result: j({ ok: false, say: 'The leadership agenda is for the owner and admins.' }) }
    const id = str(args.agenda_id, 60)
    if (!id) return { ok: false, result: j({ ok: false, error: 'agenda_id required (from draft)' }) }
    const A = await import('@/lib/meetings/agenda')
    const row = await A.getAgenda(ctx.tenant.id, id)
    if (!row) return { ok: false, result: j({ ok: false, say: 'I could not find that agenda.' }) }
    return {
      ok: true,
      lines: [`Add this agenda to the invite for "${row.title}" (${startLabel(row.starts_at, ctx.timezone)}). Everyone on the invite gets the update.`, `Agenda:\n${row.body}`],
      args: { ...args, action: 'add_to_invite', agenda_id: id },
    }
  }

  return { ok: true, lines: [`Run ${name.replace(/_/g, ' ')} with: ${JSON.stringify(args).slice(0, 600)}`], args }
}

/** The gate's answer to a gated call: a proposal, never the write. */
export async function proposeGated(name: string, ctx: AgentContext, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const { confirmed: _ignored, ...clean } = args
  const d = await describeGatedCall(ctx, name, clean)
  if (!d.ok) return d.result
  const action: PendingAction = { kind: 'tool', tool: name, args: d.args, summary: d.lines.join('\n') }
  if (!ctx.proposals) ctx.proposals = []
  ctx.proposals.push(action)
  return {
    text: JSON.stringify({
      ok: false,
      needs_confirmation: true,
      not_done: true,
      proposal: d.lines,
      say: 'NOT done. Nothing was written or sent. The app shows them this exact proposal and asks for a yes; it runs only after their yes in their next message. Do not say it is done, booked or sent, and do not call this tool again.',
    }),
    finalize: true,
  }
}

// ── The pending record ──────────────────────────────────────────────────────

const TABLE = 'cxo_ciao_pending'
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? ''))

export async function loadPending(repId: string, memberId: string): Promise<PendingRecord | null> {
  const { data, error } = await supabase.from(TABLE).select('id, conversation_id, actions, proposal, expires_at').eq('rep_id', repId).eq('member_id', memberId).order('created_at', { ascending: false }).limit(1)
  if (error) {
    if (!isMissing(error)) console.error('[confirmGate] load', error.message)
    return null
  }
  return ((data ?? [])[0] as PendingRecord | undefined) ?? null
}

/** One pending proposal per person: a new one replaces the old. */
export async function savePending(input: { repId: string; memberId: string; conversationId: string | null; actions: PendingAction[]; proposal: string; now?: number }): Promise<boolean> {
  const now = input.now ?? Date.now()
  await clearPending(input.repId, input.memberId)
  const { error } = await supabase.from(TABLE).insert({
    rep_id: input.repId,
    member_id: input.memberId,
    conversation_id: input.conversationId,
    actions: input.actions,
    proposal: input.proposal,
    expires_at: new Date(now + PENDING_TTL_MS).toISOString(),
  })
  if (error) {
    console.error('[confirmGate] save', error.message)
    return false
  }
  return true
}

/** Take the record exactly once: only the request whose delete returns the row may run it. */
export async function claimPending(repId: string, memberId: string, id: string): Promise<PendingRecord | null> {
  const { data, error } = await supabase.from(TABLE).delete().eq('rep_id', repId).eq('member_id', memberId).eq('id', id).select('id, conversation_id, actions, proposal, expires_at')
  if (error) {
    console.error('[confirmGate] claim', error.message)
    return null
  }
  return ((data ?? [])[0] as PendingRecord | undefined) ?? null
}

export async function clearPending(repId: string, memberId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('rep_id', repId).eq('member_id', memberId)
  if (error && !isMissing(error)) console.error('[confirmGate] clear', error.message)
}

// ── The yes ─────────────────────────────────────────────────────────────────

function lineFrom(text: string, fallback: string): { ok: boolean; line: string } {
  try {
    const r = JSON.parse(text) as { ok?: boolean; readback?: string; say?: string; ask?: string; error?: string; queued?: boolean }
    const ok = r.ok !== false
    return { ok, line: r.readback || r.say || r.ask || (ok ? fallback : `That did not go through${r.error ? ` (${r.error})` : ''}.`) }
  } catch {
    return { ok: true, line: text.slice(0, 400) || fallback }
  }
}

/** Run exactly the stored actions, in order. Returns one line per action for the reply. */
export async function executePending(input: { tenant: Tenant; member: Member; actions: PendingAction[]; text: string }): Promise<string[]> {
  const { tenant, member } = input
  const [{ TOOL_HANDLERS }, { authorizeToolCall, isEmployeeCaller }, { runToolWithOps }] = await Promise.all([
    import('@/lib/agent/tools'),
    import('@/lib/agent/access'),
    import('@/lib/ops/agentGate'),
  ])
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  const ctx: AgentContext = {
    tenant,
    caller: member,
    timezone: tz,
    todayIso: new Date().toLocaleDateString('en-CA', { timeZone: tz }),
    ownerMemberId: member.id,
    selfOnly: isEmployeeCaller(member, tenant),
    channel: 'app',
    held: [],
    userConfirmed: true,
  }
  const lines: string[] = []
  const intents: Array<Record<string, unknown>> = []
  for (const a of input.actions) {
    if (a.kind === 'intent') {
      intents.push(a.intent)
      continue
    }
    const handler = TOOL_HANDLERS[a.tool]
    const refusal = authorizeToolCall(a.tool, ctx)
    if (!handler || refusal) {
      lines.push(`I could not do "${a.summary.split('\n')[0]}": that is not allowed for your login.`)
      continue
    }
    try {
      const out = await runToolWithOps(a.tool, ctx, { ...a.args, confirmed: true }, handler)
      lines.push(lineFrom(out.text, `Done: ${a.summary.split('\n')[0]}.`).line)
    } catch (err) {
      console.error('[confirmGate] execute', a.tool, err instanceof Error ? err.message : err)
      lines.push(`That did not go through: ${a.summary.split('\n')[0]}. Nothing else was changed.`)
    }
  }
  if (intents.length && !isEmployeeCaller(member, tenant)) {
    const [{ executeIntent }, { getRecentLeadNames }] = await Promise.all([import('@/lib/mira/intents'), import('@/lib/supabase')])
    const knownLeads = await getRecentLeadNames(tenant.id, 40)
    for (const intent of intents) {
      try {
        const r = await executeIntent(intent as never, tenant, knownLeads, [], member.id, member, input.text)
        if (r) lines.push(r)
      } catch (err) {
        console.error('[confirmGate] intent failed', err instanceof Error ? err.message : err)
        lines.push("Couldn't do one item. Check your dashboard.")
      }
    }
  }
  return lines
}
