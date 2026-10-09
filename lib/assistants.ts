/**
 * Exec assistant seats: the server side. See lib/assistantsShared.ts for the
 * rules. The gate runs inside getCurrentTenant() (every page and API resolves
 * the tenant first), so a blocked path stops before any data is read, even on
 * routes that never look at the member.
 */
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabase } from './supabase'
import { getSessionPayload } from './client-auth'
import type { Member } from '@/types'
import {
  assistantPathKind,
  canHaveAssistant,
  describeAction,
  isApiPath,
  pickActiveExec,
  type ActivityArea,
} from './assistantsShared'

export const ASSIST_COOKIE = 'cx_assist_for'

export class AssistantBlocked extends Error {
  status = 403
  constructor() {
    super('That is for the executive only.')
  }
}

type MiniMember = { id: string; rep_id: string; role: string; is_active: boolean; display_name: string | null; email: string | null }

const sessionMember = cache(async (id: string): Promise<MiniMember | null> => {
  const { data } = await supabase.from('members').select('id, rep_id, role, is_active, display_name, email').eq('id', id).maybeSingle()
  return (data as MiniMember | null) ?? null
})

async function currentPath(): Promise<{ path: string | null; serverAction: boolean }> {
  const h = await headers()
  return { path: h.get('x-cx-path'), serverAction: !!h.get('next-action') }
}

/** The signed-in member when they are an active assistant, else null. */
export async function sessionAssistant(): Promise<MiniMember | null> {
  const payload = await getSessionPayload().catch(() => null)
  if (!payload?.memberId) return null
  const m = await sessionMember(payload.memberId)
  return m && m.is_active && m.role === 'assistant' ? m : null
}

function block(path: string | null): never {
  if (!path || isApiPath(path)) throw new AssistantBlocked()
  redirect(`/dashboard/assistant?blocked=${encodeURIComponent(path)}`)
}

/**
 * Called from getCurrentTenant(). Stops a signed-in assistant on any path that
 * is not theirs. Server actions are never run as the exec: on a work path they
 * are blocked (the work pages use the APIs, not actions).
 */
export async function assistantTenantGate(): Promise<void> {
  const a = await sessionAssistant()
  if (!a) return
  const { path, serverAction } = await currentPath()
  const kind = assistantPathKind(path)
  if (kind === 'blocked') block(path)
  if (kind === 'work' && serverAction) throw new AssistantBlocked()
}

export type ExecLinkRow = { exec_member_id: string; exec_name: string; exec_email: string | null }

/** The execs this assistant is actively linked to (and who can still have one), oldest link first. */
export const activeExecLinks = cache(async (repId: string, assistantId: string): Promise<ExecLinkRow[]> => {
  const { data: links, error } = await supabase
    .from('cxo_exec_assistants')
    .select('exec_member_id, created_at')
    .eq('rep_id', repId)
    .eq('assistant_member_id', assistantId)
    .eq('is_active', true)
    .order('created_at')
  if (error) throw error
  const ids = (links ?? []).map((l) => l.exec_member_id as string)
  if (!ids.length) return []
  const { data: execs, error: eErr } = await supabase.from('members').select('id, rep_id, role, is_active, display_name, email').in('id', ids)
  if (eErr) throw eErr
  const byId = new Map(((execs ?? []) as MiniMember[]).map((e) => [e.id, e]))
  return ids
    .map((id) => byId.get(id))
    .filter((e): e is MiniMember => !!e && canHaveAssistant(e, repId))
    .map((e) => ({ exec_member_id: e.id, exec_name: e.display_name || (e.email ?? '').split('@')[0], exec_email: e.email }))
})

/** The exec this assistant is working for right now (cookie pick, else the first link). */
export async function activeExecFor(repId: string, assistantId: string): Promise<{ active: ExecLinkRow | null; links: ExecLinkRow[] }> {
  const links = await activeExecLinks(repId, assistantId)
  const jar = await cookies()
  return { active: pickActiveExec(links, jar.get(ASSIST_COOKIE)?.value), links }
}

/**
 * getCurrentMember() hands an assistant's row here. On a work path the session
 * becomes the exec, carrying acting_assistant; everywhere else the assistant
 * stays themself.
 */
export async function resolveAssistantSession(m: Member, fetchMember: (id: string) => Promise<Member | null>): Promise<Member> {
  const { path, serverAction } = await currentPath()
  const kind = assistantPathKind(path)
  if (kind === 'blocked') block(path)
  if (kind !== 'work') return m
  if (serverAction) throw new AssistantBlocked()
  const { active } = await activeExecFor(m.rep_id, m.id)
  if (!active) {
    // No one to work for (removed by every exec): only the assistant home.
    if (!path || isApiPath(path)) throw new AssistantBlocked()
    redirect('/dashboard/assistant')
  }
  const exec = await fetchMember(active.exec_member_id)
  if (!exec || !canHaveAssistant(exec, m.rep_id)) {
    if (!path || isApiPath(path)) throw new AssistantBlocked()
    redirect('/dashboard/assistant')
  }
  return { ...exec, acting_assistant: { id: m.id, display_name: m.display_name, email: m.email } }
}

/** Label columns for a row an assistant creates while acting (empty when the exec does it). */
export function actedBy(member: Pick<Member, 'acting_assistant'>): { acted_by_member_id?: string; acted_by_name?: string } {
  const a = member.acting_assistant
  if (!a) return {}
  return { acted_by_member_id: a.id, acted_by_name: a.display_name || a.email.split('@')[0] }
}

/** The person really at the keyboard: the assistant while acting, else the member. */
export const actorId = (member: Pick<Member, 'id' | 'acting_assistant'>) => member.acting_assistant?.id ?? member.id

/**
 * One line in the exec's assistant activity feed. Best-effort: a failed write
 * never fails the action. Reads the request body the route already parsed.
 */
export async function noteAssistant(member: Pick<Member, 'id' | 'rep_id' | 'acting_assistant'>, area: ActivityArea, body: Record<string, unknown>): Promise<void> {
  const a = member.acting_assistant
  if (!a) return
  const d = describeAction(area, body)
  if (!d) return
  const { error } = await supabase.from('cxo_assistant_activity').insert({
    rep_id: member.rep_id,
    assistant_member_id: a.id,
    exec_member_id: member.id,
    area,
    action: d.action.slice(0, 60),
    summary: d.summary.slice(0, 300),
  })
  if (error) console.error('[assistants] activity', error.message)
}

export type ActivityRow = { id: string; assistant_member_id: string; exec_member_id: string; area: string; action: string; summary: string; created_at: string }

export async function recentActivity(repId: string, by: { execId?: string; assistantId?: string }, limit = 30): Promise<ActivityRow[]> {
  let q = supabase.from('cxo_assistant_activity').select('id, assistant_member_id, exec_member_id, area, action, summary, created_at').eq('rep_id', repId)
  if (by.execId) q = q.eq('exec_member_id', by.execId)
  if (by.assistantId) q = q.eq('assistant_member_id', by.assistantId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as ActivityRow[]
}

export type MyAssistant = { link_id: string; member_id: string; display_name: string; email: string; last_login_at: string | null; created_at: string }

/** The exec's active assistants. */
export async function assistantsOf(repId: string, execId: string): Promise<MyAssistant[]> {
  const { data: links, error } = await supabase
    .from('cxo_exec_assistants')
    .select('id, assistant_member_id, created_at')
    .eq('rep_id', repId)
    .eq('exec_member_id', execId)
    .eq('is_active', true)
    .order('created_at')
  if (error) throw error
  const ids = (links ?? []).map((l) => l.assistant_member_id as string)
  if (!ids.length) return []
  const { data: ms } = await supabase.from('members').select('id, display_name, email, last_login_at, is_active, role').in('id', ids)
  const byId = new Map(((ms ?? []) as Array<{ id: string; display_name: string | null; email: string; last_login_at: string | null; is_active: boolean; role: string }>).map((x) => [x.id, x]))
  return (links ?? []).flatMap((l) => {
    const x = byId.get(l.assistant_member_id as string)
    if (!x || !x.is_active || x.role !== 'assistant') return []
    return [{ link_id: l.id as string, member_id: x.id, display_name: x.display_name || x.email.split('@')[0], email: x.email, last_login_at: x.last_login_at, created_at: l.created_at as string }]
  })
}

/**
 * Wrap a POST route handler so every successful change an assistant makes
 * through it lands in the exec's assistant activity feed. Requests by
 * anyone else pass straight through.
 */
export function withAssistantLog<R extends Request>(area: ActivityArea, handler: (req: R) => Promise<Response>) {
  return async (req: R): Promise<Response> => {
    const body = (await req.clone().json().catch(() => null)) as Record<string, unknown> | null
    const res = await handler(req)
    if (res.ok && body && typeof body === 'object') {
      try {
        const { getCurrentMember } = await import('./tenant')
        const m = await getCurrentMember()
        if (m?.acting_assistant) await noteAssistant(m, area, body)
      } catch (err) {
        console.error('[assistants] log', err instanceof Error ? err.message : err)
      }
    }
    return res
  }
}
