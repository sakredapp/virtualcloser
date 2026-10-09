/**
 * What the AI sees of payroll (owner 10-09: no personal records into AI).
 * Agent, carrier, amount, status and totals. Never the client (policyholder)
 * name, product notes or anything else on the row. Pure.
 */
import { agentSummary, moneySummary, type CommissionEntry, type Deposit } from './data'

export type AiCommissionRow = { agent: string | null; carrier: string | null; commission: number; status: CommissionEntry['status'] }

export function commissionForAi(e: CommissionEntry): AiCommissionRow {
  return { agent: e.agent_name, carrier: e.carrier, commission: Number(e.commission_amount) || 0, status: e.status }
}

/** The payroll tool's result for one view. */
export function payrollToolResult(view: string, agentFilter: string, commissions: CommissionEntry[], deposits: Deposit[]): Record<string, unknown> {
  const m = moneySummary(commissions, deposits)
  let agents = agentSummary(commissions)
  if (agentFilter) agents = agents.filter((a) => a.agent.toLowerCase().includes(agentFilter))
  const result: Record<string, unknown> = { money: m }
  if (view === 'summary' || view === 'all' || view === 'by_agent') result.by_agent = agents.slice(0, 40)
  if (view === 'unpaid' || view === 'all') {
    const unpaid = commissions.filter((e) => e.status !== 'paid' && (!agentFilter || (e.agent_name ?? '').toLowerCase().includes(agentFilter)))
    result.unpaid = unpaid.slice(0, 100).map(commissionForAi)
    result.unpaid_total = unpaid.reduce((s, e) => s + (Number(e.commission_amount) || 0), 0)
    result.unpaid_count = unpaid.length
  }
  if (view === 'deposits' || view === 'all') {
    result.deposits = deposits.slice(0, 80).map((d) => ({ date: d.deposited_on, carrier: d.carrier, amount: d.amount, matched: d.matched }))
    result.unmatched_deposits = deposits.filter((d) => !d.matched).length
  }
  return result
}

const money = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** The payroll assistant's data context: totals, by agent, recent rows without client names. */
export function payrollContextLines(commissions: CommissionEntry[], deposits: Deposit[]): string[] {
  const agents = agentSummary(commissions)
  const m = moneySummary(commissions, deposits)
  return [
    `MONEY: deposits ${money(m.depositsTotal)} (${m.unmatchedDeposits} unmatched) · owed ${money(m.commissionOwed)} · paid ${money(m.commissionPaid)} · still to pay ${money(m.commissionUnpaid)}`,
    `BY AGENT:`,
    ...agents.slice(0, 40).map((a) => `  ${a.agent}: ${a.count} sales, owed ${money(a.unpaid)}, paid ${money(a.paid)}`),
    `RECENT COMMISSIONS:`,
    ...commissions.slice(0, 60).map((e) => `  [${e.status}] ${e.agent_name ?? '?'} / ${e.carrier ?? '?'} — ${money(e.commission_amount)}`),
    `DEPOSITS:`,
    ...deposits.slice(0, 40).map((d) => `  ${d.deposited_on ?? '?'} ${d.carrier ?? '?'} ${money(d.amount)} ${d.matched ? 'matched' : 'UNMATCHED'}`),
  ]
}
