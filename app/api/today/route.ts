import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import * as T from '@/lib/today'
import { cardsAssignedTo, updateCard, deleteCard, boardsMissing } from '@/lib/boards'
import { supabase } from '@/lib/supabase'
import { addCard, logCorrection, loopInbox, patchDigest, scanMeetingNotes, type MeetingDigest } from '@/lib/meetingLoop'
import { draftList, pickers, searchAgents, writeEmail } from '@/lib/todayMira'
import { createPartnerDraft, getPartner } from '@/lib/partners'
import { actedBy, withAssistantLog } from '@/lib/assistants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')
const sn = (v: unknown, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const memberId = ctx.member.id as string
  const tz = (ctx.member as { timezone?: string | null }).timezone || ctx.tenant.timezone || 'America/New_York'
  const sp = req.nextUrl.searchParams
  if (sp.get('pickers') === '1') return NextResponse.json(await pickers(repId, memberId, tz))
  if (sp.has('agents')) return NextResponse.json({ agents: await searchAgents(repId, sp.get('agents') ?? '').catch(() => []) })
  const withPartners = sp.get('partners') === '1'
  const [todos, cards, suggestions, inbox] = await Promise.all([
    T.listTodos(repId, memberId).catch((err) => (T.todosMissing(err) ? [] : Promise.reject(err))),
    cardsAssignedTo(repId, memberId).catch((err) => (boardsMissing(err) ? [] : [])),
    withPartners ? T.partnerSuggestions(repId, memberId, tz).catch(() => null) : Promise.resolve(undefined),
    loopInbox(repId, memberId).catch(() => null),
  ]).catch((err) => {
    console.error('[today] get', err)
    return [[], [], undefined, null] as const
  })
  return NextResponse.json({ todos, cards, suggestions, inbox })
}

/** Fields a to-do can be created with (Create task, Mira drafts). */
function todoFields(b: Record<string, unknown>) {
  const linkKind = ['partner', 'agent', 'meeting', 'card'].includes(s(b.link_kind)) ? (s(b.link_kind) as 'partner' | 'agent' | 'meeting' | 'card') : null
  const due = s(b.due_date)
  return {
    kind: T.asKind(b.kind),
    priority: T.asPriority(b.priority),
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    assignee_partner_id: sn(b.assignee_partner_id, 60),
    assignee_name: sn(b.assignee_name, 120),
    link_kind: linkKind,
    link_id: linkKind ? sn(b.link_id, 200) : null,
    link_label: linkKind ? sn(b.link_label, 200) : null,
    link_url: sn(b.link_url, 1000),
    link_phone: sn(b.link_phone, 40),
    link_email: sn(b.link_email, 200),
    source_label: sn(b.source_label, 200),
    note_id: sn(b.note_id, 60),
    partner_id: sn(b.partner_id, 60) ?? (linkKind === 'partner' ? sn(b.link_id, 60) : null),
    partner_name: sn(b.partner_name, 120) ?? (linkKind === 'partner' ? sn(b.link_label, 120) : null),
  }
}

async function ownTodo(repId: string, memberId: string, id: string) {
  const { data } = await supabase.from('cxo_todos').select('*').eq('rep_id', repId).eq('member_id', memberId).eq('id', id).maybeSingle()
  return data as (T.Todo & { note_id: string | null }) | null
}

/** A meeting note this member may see: shared (no owner) or their own. */
const ownNote = (memberId: string) => `owner_member_id.is.null,owner_member_id.eq.${memberId}`

async function noteContext(repId: string, noteId: string | null, memberId: string) {
  if (!noteId) return null
  const { data } = await supabase.from('plaud_notes').select('title, summary, transcript').eq('rep_id', repId).eq('id', noteId).or(ownNote(memberId)).maybeSingle()
  const n = data as { title: string | null; summary: string | null; transcript: string | null } | null
  return n ? `${n.title ?? ''}\n${n.summary || (n.transcript ?? '').slice(0, 3000)}` : null
}

async function handlePost(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    return denied(err)
  }
  const repId = ctx.tenant.id
  const memberId = ctx.member.id as string
  const tz = (ctx.member as { timezone?: string | null }).timezone || ctx.tenant.timezone || 'America/New_York'
  const sender = ctx.member.display_name as string
  const company = (ctx.tenant.company || ctx.tenant.display_name) as string
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    switch (b.op) {
      case 'scan':
        return NextResponse.json(await scanMeetingNotes(repId, memberId))
      case 'draftList':
        return NextResponse.json(await draftList(repId, memberId, tz))
      case 'add': {
        const f = todoFields(b)
        // Project: a card on the exec's To-do board instead of a to-do.
        if (b.kind === 'project') {
          const id = await addCard(repId, memberId, s(b.body), sn(b.notes, 2000), f.assignee_partner_id)
          if (!id) throw new Error('Make a board first.')
          return NextResponse.json({ card: id })
        }
        const source = b.source === 'mira' ? 'mira' : 'manual'
        return NextResponse.json({ todo: await T.addTodo(repId, memberId, s(b.body), { ...f, source, ...actedBy(ctx.member) }) })
      }
      case 'set': {
        const before = b.kind !== undefined || b.priority !== undefined || b.assignee_partner_id !== undefined ? await ownTodo(repId, memberId, s(b.id)) : null
        await T.updateTodo(repId, memberId, s(b.id), {
          done: typeof b.done === 'boolean' ? b.done : undefined,
          body: typeof b.body === 'string' ? b.body : undefined,
          kind: b.kind,
          priority: b.priority,
          due_date: b.due_date === undefined ? undefined : (b.due_date as string | null),
          assignee_partner_id: b.assignee_partner_id === undefined ? undefined : (b.assignee_partner_id as string | null),
          assignee_name: typeof b.assignee_name === 'string' ? b.assignee_name : null,
        })
        // Mira learns from changes to what she filed.
        if (before && (before.source === 'meeting' || before.source === 'mira')) {
          if (b.kind !== undefined && b.kind !== before.kind) await logCorrection(repId, memberId, 'retyped', before.body, `type ${before.kind} -> ${String(b.kind)}`)
          if (b.priority !== undefined && b.priority !== before.priority) await logCorrection(repId, memberId, 'reprioritised', before.body, `priority ${before.priority} -> ${String(b.priority)}`)
          if (b.assignee_partner_id !== undefined) await logCorrection(repId, memberId, 'reassign', before.body, `to ${s(b.assignee_name) || 'me'}`)
        }
        break
      }
      case 'delete': {
        const before = await ownTodo(repId, memberId, s(b.id))
        await T.deleteTodo(repId, memberId, s(b.id))
        if (before && (before.source === 'meeting' || before.source === 'mira')) await logCorrection(repId, memberId, 'deleted_todo', before.body)
        break
      }
      case 'toCard': {
        const t = await ownTodo(repId, memberId, s(b.id))
        if (!t) throw new Error('That to-do is gone.')
        const id = await addCard(repId, memberId, t.body, t.meeting_title ? `From ${t.meeting_title}` : t.source_label, t.assignee_partner_id ?? null)
        if (!id) throw new Error('Make a board first.')
        await T.deleteTodo(repId, memberId, t.id)
        if (t.source === 'meeting' || t.source === 'mira') await logCorrection(repId, memberId, 'todo_to_card', t.body)
        return NextResponse.json({ card: id })
      }
      case 'cardToTodo': {
        const { data: card } = await supabase.from('cxo_board_cards').select('id, title, created_by, notes').eq('rep_id', repId).eq('id', s(b.id)).maybeSingle()
        const c = card as { id: string; title: string; notes: string | null } | null
        if (!c) throw new Error('That card is gone.')
        const todo = await T.addTodo(repId, memberId, c.title, { source: 'manual', source_label: 'moved from the board', ...actedBy(ctx.member) })
        await deleteCard(repId, c.id)
        if ((c.notes ?? '').startsWith('From ')) await logCorrection(repId, memberId, 'card_to_todo', c.title)
        return NextResponse.json({ todo })
      }
      case 'draftEmail': {
        // One-tap Draft email on an email to-do: Mira writes it, it is saved as
        // a draft (Gmail Drafts when connected) through the partner compose
        // path. Never sent from here.
        const t = await ownTodo(repId, memberId, s(b.id))
        if (!t) throw new Error('That to-do is gone.')
        const pid = t.link_kind === 'partner' ? t.link_id : t.partner_id
        const ctxText = await noteContext(repId, t.note_id, memberId)
        if (pid) {
          const partner = await getPartner(repId, pid)
          if (!partner) throw new Error('That partner is gone.')
          const mail = await writeEmail({ to: partner.name, about: t.body, context: ctxText, sender, company })
          const draft = await createPartnerDraft({ repId, memberId, partnerId: partner.id, kind: 'email', subject: mail.subject, body: mail.body, to: partner.email, senderName: sender, senderEmail: ctx.member.email, createdBy: memberId })
          return NextResponse.json({ ...mail, to: partner.email, gmail: draft.channel === 'gmail', partner: partner.name })
        }
        const to = t.link_label || 'there'
        const mail = await writeEmail({ to, about: t.body, context: ctxText, sender, company })
        // No address on file: still hand back a mailto so the exec picks the
        // recipient in their own email app. Never sent from here.
        return NextResponse.json({ ...mail, to: t.link_email, gmail: false, mailto: `mailto:${t.link_email ? encodeURIComponent(t.link_email) : ''}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}` })
      }
      case 'draftFollowup': {
        const noteId = s(b.noteId)
        const idx = Number(b.idx)
        const { data } = await supabase.from('plaud_notes').select('title, summary, transcript, mira_digest').eq('rep_id', repId).eq('id', noteId).or(ownNote(memberId)).maybeSingle()
        const n = data as { title: string | null; summary: string | null; transcript: string | null; mira_digest: MeetingDigest | null } | null
        const f = n?.mira_digest?.followups?.[idx]
        if (!f) throw new Error('That follow-up is gone.')
        const partner = await getPartner(repId, f.partner_id)
        if (!partner) throw new Error('That partner is gone.')
        const mail = await writeEmail({ to: partner.name, about: f.about, context: `${n?.title ?? ''}\n${n?.summary || (n?.transcript ?? '').slice(0, 3000)}`, sender, company })
        const draft = await createPartnerDraft({ repId, memberId, partnerId: partner.id, kind: 'email', subject: mail.subject, body: mail.body, to: partner.email, senderName: sender, senderEmail: ctx.member.email, createdBy: memberId })
        await patchDigest(repId, noteId, 'followups', idx, { drafted_at: new Date().toISOString() }, memberId)
        return NextResponse.json({ ...mail, to: partner.email, gmail: draft.channel === 'gmail', partner: partner.name })
      }
      case 'dismissFollowup':
        await patchDigest(repId, s(b.noteId), 'followups', Number(b.idx), { dismissed: true }, memberId)
        break
      case 'confirmDone': {
        // Mira was not sure a meeting closed this item: the exec decides.
        const noteId = s(b.noteId)
        const idx = Number(b.idx)
        const { data } = await supabase.from('plaud_notes').select('mira_digest').eq('rep_id', repId).eq('id', noteId).or(ownNote(memberId)).maybeSingle()
        const d = (data as { mira_digest: MeetingDigest | null } | null)?.mira_digest?.done_suggestions?.[idx]
        if (!d) throw new Error('That is gone.')
        if (b.yes === true) {
          if (d.kind === 'todo') await T.updateTodo(repId, memberId, d.id, { done: true })
          else await updateCard(repId, d.id, { done: true })
        } else {
          await logCorrection(repId, memberId, 'not_done', d.text, d.evidence)
        }
        await patchDigest(repId, noteId, 'done_suggestions', idx, { dismissed: true }, memberId)
        break
      }
      case 'fromPartner':
        return NextResponse.json({
          todo: await T.addFromPartner(repId, memberId, { partner_id: s(b.partnerId), partner_name: s(b.partnerName), thread_id: s(b.threadId), body: s(b.body) }),
        })
      case 'cardDone':
        await updateCard(repId, s(b.id), { done: b.done !== false })
        break
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[today] post', b.op, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'That did not save.' }, { status: 400 })
  }
}

/** Every change an assistant makes here shows in the exec's assistant feed. */
export const POST = withAssistantLog('todos', handlePost)
