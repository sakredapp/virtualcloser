// AI subagent over Lauren's payroll data. Now action-capable: it can add
// commissions, log deposits, and mark commissions paid via tools — grounded in
// the live data — and explains what it did. Anything it can't do, it advises on.

import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import {
  listCommissions, listDeposits, getWorkflowNotes, agentSummary, moneySummary,
  addCommission, addDeposit, setCommissionStatus,
} from '@/lib/payroll/data'
import { listSheets } from '@/lib/payroll/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'

function money(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function n(v: unknown): number {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(x) ? x : 0
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'add_commission',
    description: 'Add a commission entry (a sale and the commission owed on it).',
    input_schema: {
      type: 'object',
      properties: {
        agent_name: { type: 'string' }, client_name: { type: 'string' }, carrier: { type: 'string' },
        product: { type: 'string' }, premium: { type: 'number' }, commission_amount: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_deposit',
    description: 'Log a carrier deposit that hit the bank.',
    input_schema: {
      type: 'object',
      properties: { carrier: { type: 'string' }, amount: { type: 'number' }, deposited_on: { type: 'string', description: 'YYYY-MM-DD' } },
      additionalProperties: false,
    },
  },
  {
    name: 'mark_paid',
    description: 'Mark outstanding (unpaid) commissions as paid. Filter by agent and/or client name. Returns how many were marked.',
    input_schema: {
      type: 'object',
      properties: { agent: { type: 'string' }, client: { type: 'string' } },
      additionalProperties: false,
    },
  },
]

export async function POST(req: NextRequest) {
  const ctx = await requireMember().catch(() => null)
  const brand = (ctx?.tenant as { brand?: string } | undefined)?.brand ?? ''
  if (!ctx || brand !== 'cxo' || !ctx.member || !isAtLeast(ctx.member.role, 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { question?: string }
  const question = (body.question ?? '').trim()
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

  const repId = ctx.tenant.id
  const claudeKey = (ctx.tenant as { claude_api_key?: string | null }).claude_api_key

  async function loadContext(): Promise<string> {
    const [commissions, deposits, notes, sheets] = await Promise.all([
      listCommissions(repId), listDeposits(repId), getWorkflowNotes(repId), listSheets(repId),
    ])
    const agents = agentSummary(commissions)
    const m = moneySummary(commissions, deposits)
    return [
      `MONEY: deposits ${money(m.depositsTotal)} (${m.unmatchedDeposits} unmatched) · owed ${money(m.commissionOwed)} · paid ${money(m.commissionPaid)} · still to pay ${money(m.commissionUnpaid)}`,
      `BY AGENT:`, ...agents.slice(0, 40).map((a) => `  ${a.agent}: ${a.count} sales, owed ${money(a.unpaid)}, paid ${money(a.paid)}`),
      `RECENT COMMISSIONS:`, ...commissions.slice(0, 60).map((e) => `  [${e.status}] ${e.agent_name ?? '?'} / ${e.client_name ?? '?'} / ${e.carrier ?? '?'} — ${money(e.commission_amount)}`),
      `DEPOSITS:`, ...deposits.slice(0, 40).map((d) => `  ${d.deposited_on ?? '?'} ${d.carrier ?? '?'} ${money(d.amount)} ${d.matched ? 'matched' : 'UNMATCHED'}`),
      sheets.length ? `CONNECTED SHEETS: ${sheets.map((x) => x.label || x.title).join(', ')}` : '',
      notes ? `\nWORKFLOW NOTES:\n${notes.slice(0, 1200)}` : '',
    ].join('\n')
  }

  const system = `You are ${ctx.member.display_name || 'the user'}'s payroll & commissions assistant. You track carrier DEPOSITS, the POLICIES/commissions they cover, and what's OWED vs PAID — agent by agent.

You can take actions with tools: add_commission, add_deposit, mark_paid. Use them when she clearly asks you to. Confirm exactly what you did in one or two sentences (with the numbers/names). For matching a specific deposit to specific policies, tell her to use the Deposits tab — you can't link them yet. Be concise and concrete; flag unmatched deposits or large unpaid balances when relevant.

CURRENT DATA:
${await loadContext()}`

  let didMutate = false
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }]

  try {
    for (let turn = 0; turn < 4; turn++) {
      const res = await runWithClaudeKey(claudeKey, () =>
        getAnthropic().messages.create({ model: MODEL, max_tokens: 900, system, tools: TOOLS, messages }),
      )
      if (res.stop_reason !== 'tool_use') {
        const text = res.content.find((b) => b.type === 'text')
        return NextResponse.json({ answer: text && text.type === 'text' ? text.text : '', didMutate })
      }
      messages.push({ role: 'assistant', content: res.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        const a = (block.input ?? {}) as Record<string, unknown>
        let out: Record<string, unknown> = { ok: false }
        if (block.name === 'add_commission') {
          await addCommission(repId, {
            agent_name: s(a.agent_name), client_name: s(a.client_name), carrier: s(a.carrier),
            product: s(a.product), premium: n(a.premium), commission_amount: n(a.commission_amount),
          })
          didMutate = true; out = { ok: true, added: 'commission' }
        } else if (block.name === 'add_deposit') {
          await addDeposit(repId, { carrier: s(a.carrier), amount: n(a.amount), deposited_on: s(a.deposited_on) })
          didMutate = true; out = { ok: true, added: 'deposit' }
        } else if (block.name === 'mark_paid') {
          const agent = s(a.agent)?.toLowerCase() ?? null
          const client = s(a.client)?.toLowerCase() ?? null
          const fresh = await listCommissions(repId)
          const targets = fresh.filter((e) =>
            e.status !== 'paid' &&
            (!agent || (e.agent_name ?? '').toLowerCase().includes(agent)) &&
            (!client || (e.client_name ?? '').toLowerCase().includes(client)),
          )
          for (const t of targets) await setCommissionStatus(repId, t.id, 'paid')
          didMutate = didMutate || targets.length > 0
          out = { ok: true, marked_paid: targets.length }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) })
      }
      messages.push({ role: 'user', content: toolResults })
    }
    return NextResponse.json({ answer: 'That took more steps than I can do in one go — try breaking it down.', didMutate })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
