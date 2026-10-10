import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { runAgent, type AgentHistoryEntry } from '@/lib/agent/runAgent'
import { executeIntent } from '@/lib/mira/intents'
import { createBrainDump, createBrainItems, getRecentLeadNames, supabase } from '@/lib/supabase'
import { updateMember } from '@/lib/members'
import { isEmployeeCaller } from '@/lib/agent/access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Mira in the dashboard. runAgent plus the intent dispatcher, behind an
 * HTTP route the MiraDock panel calls:
 *
 *   GET  → the member's recent agent_history turns, oldest first
 *   POST { text, display? } → runAgent → execute its intents → persist the
 *          turn → { reply, choice?, error? }
 *
 * `display` is what the person saw themselves tap (a choice chip's label)
 * when `text` is the chip's machine value; it is what gets stored as their
 * turn so the thread reads back the way it looked.
 */

const HISTORY_WINDOW = 40

type HistoryRow = { role: 'user' | 'assistant'; content: string; listed_tasks?: Array<{ id: string; content: string }> | null; created_at?: string }

async function loadHistory(memberId: string): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from('agent_history')
    .select('role, content, listed_tasks, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_WINDOW)
  return ((data ?? []) as HistoryRow[]).reverse()
}

export async function GET() {
  let member
  try {
    member = (await requireMember()).member
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const rows = await loadHistory(member.id)
  return NextResponse.json({
    ok: true,
    messages: rows.filter((r) => r.content).map((r) => ({ role: r.role, content: r.content })),
  })
}

const FRIENDLY: Record<string, string> = {
  no_api_key: "I'm not switched on for this workspace yet. Ask your admin to add the AI key and I'll be right here.",
  quota_exceeded: "You've hit today's limit on questions for me. I'll be back tomorrow, or your admin can raise it.",
  timeout: 'That one took longer than I allow myself. Ask it again, or break it into smaller steps.',
  api_error: "Couldn't reach my brain just now. Give it a few seconds and ask again.",
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; display?: unknown } = {}
  try {
    body = (await req.json()) as { text?: unknown; display?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : ''
  const display = typeof body.display === 'string' ? body.display.trim().slice(0, 500) : ''
  if (!text) return NextResponse.json({ ok: false, error: 'missing text' }, { status: 400 })

  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { tenant, member } = ctx

  try {
    const history: AgentHistoryEntry[] = (await loadHistory(member.id)).map((h) => ({
      role: h.role,
      content: h.content,
      listed_tasks: h.listed_tasks ?? undefined,
      at: h.created_at,
    }))

    const result = await runAgent({ tenant, caller: member, text, history })

    // A choice: show the prompt and the chips, run nothing yet. The tap comes
    // back as the next POST with the chosen value as `text`.
    if (result.choice) {
      await persistTurn(member.id, tenant.id, display || text, result.choice.prompt)
      return NextResponse.json({ ok: true, reply: result.choice.prompt, choice: result.choice })
    }

    let reply = result.replyText || ''
    if (result.error) {
      reply = FRIENDLY[result.error] ?? reply ?? FRIENDLY.api_error
      // Never write on a failed turn: partial writes leave inconsistent state.
      return NextResponse.json({ ok: true, reply, error: result.error })
    }

    // Execute the agent's write intents through the Mira dispatcher.
    // Never for an employee login: delegate_intents is refused for them in
    // the tool executor; this is the second lock (owner 10-10).
    const receipts: string[] = []
    const intents = isEmployeeCaller(member, tenant) ? [] : result.intentsToExecute
    if (intents.length > 0) {
      const knownLeads = await getRecentLeadNames(tenant.id, 40)
      const queued: Array<{
        item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
        content: string
        priority?: 'low' | 'normal' | 'high'
        horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
        due_date?: string | null
        lead_id?: string | null
      }> = []
      for (const intent of intents) {
        try {
          const r = await executeIntent(intent, tenant, knownLeads, queued, member.id, member, text)
          if (r) receipts.push(r)
        } catch (err) {
          console.error('[mira/ask] intent failed', intent, err)
          receipts.push("Couldn't process one item. Check your dashboard.")
        }
      }
      if (queued.length > 0) {
        const dump = await createBrainDump({
          repId: tenant.id,
          rawText: text,
          summary: reply,
          source: 'mic',
          ownerMemberId: member.id,
        })
        await createBrainItems(tenant.id, dump.id, queued, member.id)
      }
    }

    if (receipts.length > 0) reply = [reply, ...receipts].filter(Boolean).join('\n')
    if (!reply) reply = 'Done.'

    await persistTurn(member.id, tenant.id, display || text, reply, result.listedItems)
    if (result.listedItems && result.listedItems.length > 0) {
      await updateMember(member.id, {
        settings: {
          ...(member.settings ?? {}),
          last_listed_tasks: result.listedItems,
          last_listed_tasks_at: new Date().toISOString(),
        },
      }).catch((e: unknown) => console.error('[mira/ask] settings persist failed', e))
    }

    return NextResponse.json({ ok: true, reply })
  } catch (err) {
    console.error('[mira/ask] failed', err)
    return NextResponse.json(
      { ok: true, reply: 'Something hiccuped on my end. Ask me that again in a moment.', error: 'api_error' },
      { status: 200 },
    )
  }
}

async function persistTurn(
  memberId: string,
  repId: string,
  userText: string,
  assistantText: string,
  listed?: Array<{ id: string; content: string }>,
): Promise<void> {
  const { error } = await supabase.from('agent_history').insert([
    { member_id: memberId, rep_id: repId, role: 'user', content: userText },
    { member_id: memberId, rep_id: repId, role: 'assistant', content: assistantText, listed_tasks: listed && listed.length > 0 ? listed : null },
  ])
  if (error) console.error('[mira/ask] history persist failed', error.message)
}
