// AI subagent over Lauren's payroll data. Read-only advisory v0: answers
// questions and flags issues (unmatched deposits, unpaid commissions, gaps)
// grounded in her commissions/deposits/sheets — it doesn't mutate yet.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { listCommissions, listDeposits, getWorkflowNotes, agentSummary, moneySummary } from '@/lib/payroll/data'
import { listSheets } from '@/lib/payroll/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'

function money(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export async function POST(req: NextRequest) {
  const ctx = await requireMember().catch(() => null)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const brand = (ctx.tenant as { brand?: string }).brand ?? 'virtualcloser'
  if (brand !== 'cxo' || !ctx.member || !isAtLeast(ctx.member.role, 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { question?: string }
  const question = (body.question ?? '').trim()
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

  const repId = ctx.tenant.id
  const [commissions, deposits, notes, sheets] = await Promise.all([
    listCommissions(repId),
    listDeposits(repId),
    getWorkflowNotes(repId),
    listSheets(repId),
  ])
  const agents = agentSummary(commissions)
  const m = moneySummary(commissions, deposits)

  const ctxBlock = [
    `MONEY: deposits ${money(m.depositsTotal)} (${m.unmatchedDeposits} unmatched) · commission owed ${money(m.commissionOwed)} · paid ${money(m.commissionPaid)} · still to pay ${money(m.commissionUnpaid)}`,
    ``,
    `BY AGENT:`,
    ...agents.slice(0, 40).map((a) => `  ${a.agent}: ${a.count} sales, commission ${money(a.commission)}, paid ${money(a.paid)}, owed ${money(a.unpaid)}`),
    ``,
    `COMMISSIONS (most recent ${Math.min(commissions.length, 80)}):`,
    ...commissions.slice(0, 80).map((e) =>
      `  [${e.status}] ${e.agent_name ?? '?'} / ${e.client_name ?? '?'} / ${e.carrier ?? '?'} — premium ${money(e.premium)}, commission ${money(e.commission_amount)}${e.deposit_id ? ' (matched to a deposit)' : ''}`,
    ),
    ``,
    `DEPOSITS (most recent ${Math.min(deposits.length, 50)}):`,
    ...deposits.slice(0, 50).map((d) => `  ${d.deposited_on ?? '?'} ${d.carrier ?? '?'} ${money(d.amount)} — ${d.matched ? 'matched' : 'UNMATCHED'}`),
    ``,
    sheets.length > 0 ? `CONNECTED SHEETS: ${sheets.map((s) => s.label || s.title || s.spreadsheet_id).join(', ')}` : `CONNECTED SHEETS: none`,
    notes ? `\nHER WORKFLOW NOTES:\n${notes.slice(0, 1500)}` : '',
  ].join('\n')

  const system = `You are ${ctx.member.display_name || 'the user'}'s payroll & commissions assistant. You help track carrier DEPOSITS, match them to the POLICIES/commissions they cover, and see what's OWED vs PAID — agent by agent.

Answer using ONLY the data below. Be concise and concrete — use real numbers and names. If she asks you to DO something (add an entry, mark paid, match a deposit), tell her which button/tab to use; you can't change data yet. Proactively flag anything that looks off: unmatched deposits, unpaid commissions, agents with large amounts owed, or mismatches between deposits and commissions.

DATA:
${ctxBlock}`

  try {
    const res = await runWithClaudeKey((ctx.tenant as { claude_api_key?: string | null }).claude_api_key, () =>
      getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: question }],
      }),
    )
    const text = res.content.find((b) => b.type === 'text')
    const answer = text && text.type === 'text' ? text.text : ''
    return NextResponse.json({ answer })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
