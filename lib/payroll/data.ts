// Payroll / commissions data layer (v0). Everything is rep-scoped.

import { supabase } from '@/lib/supabase'

export type CommissionStatus = 'expected' | 'matched' | 'paid'

export type CommissionEntry = {
  id: string
  rep_id: string
  agent_name: string | null
  client_name: string | null
  carrier: string | null
  product: string | null
  premium: number
  commission_amount: number
  commission_rate: number | null
  status: CommissionStatus
  deposit_id: string | null
  sale_date: string | null
  paid_on: string | null
  notes: string | null
  created_at: string
}

export type Deposit = {
  id: string
  rep_id: string
  carrier: string | null
  amount: number
  deposited_on: string | null
  matched: boolean
  notes: string | null
  created_at: string
}

export async function listCommissions(repId: string): Promise<CommissionEntry[]> {
  const { data } = await supabase
    .from('commission_entries')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(1000)
  return (data ?? []) as CommissionEntry[]
}

export async function listDeposits(repId: string): Promise<Deposit[]> {
  const { data } = await supabase
    .from('payroll_deposits')
    .select('*')
    .eq('rep_id', repId)
    .order('deposited_on', { ascending: false, nullsFirst: false })
    .limit(500)
  return (data ?? []) as Deposit[]
}

export async function getWorkflowNotes(repId: string): Promise<string> {
  const { data } = await supabase
    .from('payroll_settings')
    .select('workflow_notes')
    .eq('rep_id', repId)
    .maybeSingle()
  return (data as { workflow_notes?: string | null } | null)?.workflow_notes ?? ''
}

export async function saveWorkflowNotes(repId: string, notes: string): Promise<void> {
  await supabase
    .from('payroll_settings')
    .upsert({ rep_id: repId, workflow_notes: notes.slice(0, 8000), updated_at: new Date().toISOString() }, { onConflict: 'rep_id' })
}

export async function addCommission(
  repId: string,
  input: Partial<Pick<CommissionEntry, 'agent_name' | 'client_name' | 'carrier' | 'product' | 'premium' | 'commission_amount' | 'commission_rate' | 'sale_date' | 'notes'>>,
): Promise<void> {
  await supabase.from('commission_entries').insert({
    rep_id: repId,
    agent_name: input.agent_name ?? null,
    client_name: input.client_name ?? null,
    carrier: input.carrier ?? null,
    product: input.product ?? null,
    premium: input.premium ?? 0,
    commission_amount: input.commission_amount ?? 0,
    commission_rate: input.commission_rate ?? null,
    sale_date: input.sale_date ?? null,
    notes: input.notes ?? null,
  })
}

export async function setCommissionStatus(
  repId: string,
  id: string,
  status: CommissionStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  patch.paid_on = status === 'paid' ? new Date().toISOString().slice(0, 10) : null
  await supabase.from('commission_entries').update(patch).eq('id', id).eq('rep_id', repId)
}

export async function deleteCommission(repId: string, id: string): Promise<void> {
  await supabase.from('commission_entries').delete().eq('id', id).eq('rep_id', repId)
}

export async function addDeposit(
  repId: string,
  input: Partial<Pick<Deposit, 'carrier' | 'amount' | 'deposited_on' | 'notes'>>,
): Promise<void> {
  await supabase.from('payroll_deposits').insert({
    rep_id: repId,
    carrier: input.carrier ?? null,
    amount: input.amount ?? 0,
    deposited_on: input.deposited_on ?? null,
    notes: input.notes ?? null,
  })
}

export async function setDepositMatched(repId: string, id: string, matched: boolean): Promise<void> {
  await supabase
    .from('payroll_deposits')
    .update({ matched, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('rep_id', repId)
}

// ── Derived summaries (pure) ──────────────────────────────────────────────

export type AgentRow = { agent: string; count: number; premium: number; commission: number; paid: number; unpaid: number }

export function agentSummary(entries: CommissionEntry[]): AgentRow[] {
  const by = new Map<string, AgentRow>()
  for (const e of entries) {
    const agent = (e.agent_name ?? '').trim() || '(unassigned)'
    const row = by.get(agent) ?? { agent, count: 0, premium: 0, commission: 0, paid: 0, unpaid: 0 }
    row.count++
    row.premium += Number(e.premium) || 0
    row.commission += Number(e.commission_amount) || 0
    if (e.status === 'paid') row.paid += Number(e.commission_amount) || 0
    else row.unpaid += Number(e.commission_amount) || 0
    by.set(agent, row)
  }
  return Array.from(by.values()).sort((a, b) => b.commission - a.commission)
}

export type MoneySummary = {
  depositsTotal: number
  unmatchedDeposits: number
  commissionOwed: number
  commissionPaid: number
  commissionUnpaid: number
}

export function moneySummary(entries: CommissionEntry[], deposits: Deposit[]): MoneySummary {
  const depositsTotal = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const unmatchedDeposits = deposits.filter((d) => !d.matched).length
  let commissionOwed = 0
  let commissionPaid = 0
  for (const e of entries) {
    const c = Number(e.commission_amount) || 0
    commissionOwed += c
    if (e.status === 'paid') commissionPaid += c
  }
  return {
    depositsTotal,
    unmatchedDeposits,
    commissionOwed,
    commissionPaid,
    commissionUnpaid: commissionOwed - commissionPaid,
  }
}
