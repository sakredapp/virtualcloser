import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import PageHeader from '@/app/components/PageHeader'
import PayrollFeedback from './PayrollFeedback'
import { type BrandKey } from '@/lib/brand'
import {
  listCommissions,
  listDeposits,
  getWorkflowNotes,
  addCommission,
  setCommissionStatus,
  deleteCommission,
  addDeposit,
  setDepositMatched,
  saveWorkflowNotes,
  agentSummary,
  moneySummary,
  type CommissionStatus,
} from '@/lib/payroll/data'

export const dynamic = 'force-dynamic'

function money(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function num(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

const STATUS_COLOR: Record<CommissionStatus, string> = {
  expected: 'var(--muted)',
  matched: 'var(--signal-info, #2563eb)',
  paid: 'var(--signal-ok, #16a34a)',
}

export default async function PayrollPage() {
  const ctx = await requireMember()
  const tenant = ctx.tenant
  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  // CXO workstation. Open to admins/owners (Lauren is an admin).
  if (brandKey !== 'cxo' || !ctx.member || !isAtLeast(ctx.member.role, 'admin')) {
    redirect('/dashboard')
  }

  // ── Server actions ──────────────────────────────────────────────────────
  async function actAddCommission(fd: FormData) {
    'use server'
    const c = await requireMember()
    await addCommission(c.tenant.id, {
      agent_name: str(fd.get('agent_name')),
      client_name: str(fd.get('client_name')),
      carrier: str(fd.get('carrier')),
      product: str(fd.get('product')),
      premium: num(fd.get('premium')),
      commission_amount: num(fd.get('commission_amount')),
      sale_date: str(fd.get('sale_date')),
      notes: str(fd.get('notes')),
    })
    revalidatePath('/dashboard/payroll')
  }
  async function actSetStatus(fd: FormData) {
    'use server'
    const c = await requireMember()
    const id = String(fd.get('id') ?? '')
    const status = String(fd.get('status') ?? '') as CommissionStatus
    if (id && ['expected', 'matched', 'paid'].includes(status)) {
      await setCommissionStatus(c.tenant.id, id, status)
      revalidatePath('/dashboard/payroll')
    }
  }
  async function actDeleteCommission(fd: FormData) {
    'use server'
    const c = await requireMember()
    const id = String(fd.get('id') ?? '')
    if (id) { await deleteCommission(c.tenant.id, id); revalidatePath('/dashboard/payroll') }
  }
  async function actAddDeposit(fd: FormData) {
    'use server'
    const c = await requireMember()
    await addDeposit(c.tenant.id, {
      carrier: str(fd.get('carrier')),
      amount: num(fd.get('amount')),
      deposited_on: str(fd.get('deposited_on')),
      notes: str(fd.get('notes')),
    })
    revalidatePath('/dashboard/payroll')
  }
  async function actToggleDeposit(fd: FormData) {
    'use server'
    const c = await requireMember()
    const id = String(fd.get('id') ?? '')
    const matched = String(fd.get('matched') ?? '') === 'true'
    if (id) { await setDepositMatched(c.tenant.id, id, matched); revalidatePath('/dashboard/payroll') }
  }
  async function actSaveNotes(fd: FormData) {
    'use server'
    const c = await requireMember()
    await saveWorkflowNotes(c.tenant.id, String(fd.get('workflow_notes') ?? ''))
    revalidatePath('/dashboard/payroll')
  }

  const [commissions, deposits, workflowNotes, navTabs] = await Promise.all([
    listCommissions(tenant.id),
    listDeposits(tenant.id),
    getWorkflowNotes(tenant.id),
    buildDashboardTabs(tenant.id, ctx.member),
  ])
  const agents = agentSummary(commissions)
  const m = moneySummary(commissions, deposits)

  const inputStyle = { padding: '0.5rem 0.6rem', fontSize: '0.85rem' } as const

  return (
    <main className="wrap">
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <PageHeader
        eyebrow="Workstation"
        title="Payroll & Commissions"
        subtitle="Track carrier deposits, the commissions they cover, and what's been paid out — agent by agent. This is a v0 we're shaping to your workflow; use the feedback box anytime."
      />

      {/* Money in / out */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: '0.8rem' }}>
        <Stat label="Deposits logged" value={money(m.depositsTotal)} sub={`${m.unmatchedDeposits} unmatched`} />
        <Stat label="Commission owed" value={money(m.commissionOwed)} sub={`${commissions.length} entries`} />
        <Stat label="Paid out" value={money(m.commissionPaid)} accent="var(--signal-ok, #16a34a)" />
        <Stat label="Still to pay" value={money(m.commissionUnpaid)} accent="var(--red-deep, #dc2626)" />
      </section>

      {/* Add commission */}
      <section className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Log a sale / commission</h2>
        <form action={actAddCommission} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: '0.7rem' }}>
          <input name="agent_name" placeholder="Agent" style={inputStyle} />
          <input name="client_name" placeholder="Client" style={inputStyle} />
          <input name="carrier" placeholder="Carrier" style={inputStyle} />
          <input name="product" placeholder="Product" style={inputStyle} />
          <input name="premium" placeholder="Premium $" inputMode="decimal" style={inputStyle} />
          <input name="commission_amount" placeholder="Commission $" inputMode="decimal" style={inputStyle} />
          <input name="sale_date" type="date" style={inputStyle} />
          <input name="notes" placeholder="Notes" style={inputStyle} />
          <button className="btn approve" type="submit" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>Add entry</button>
        </form>
      </section>

      {/* Commissions table */}
      <section className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Commissions</h2>
        <div style={{ overflowX: 'auto', marginTop: '0.6rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-soft)', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px' }}>Agent</th>
                <th style={{ padding: '6px 8px' }}>Client</th>
                <th style={{ padding: '6px 8px' }}>Carrier</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Premium</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Commission</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {commissions.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '12px 8px', color: 'var(--muted)' }}>No entries yet — add one above.</td></tr>
              )}
              {commissions.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{e.agent_name || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{e.client_name || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{e.carrier || '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(e.premium)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(e.commission_amount)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span className="status" style={{ background: STATUS_COLOR[e.status], color: '#fff', fontSize: '0.68rem' }}>{e.status}</span>
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {e.status !== 'paid' && (
                      <form action={actSetStatus} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="paid" />
                        <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>Mark paid</button>
                      </form>
                    )}
                    {e.status === 'expected' && (
                      <form action={actSetStatus} style={{ display: 'inline', marginLeft: 4 }}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="matched" />
                        <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>Matched</button>
                      </form>
                    )}
                    <form action={actDeleteCommission} style={{ display: 'inline', marginLeft: 4 }}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', color: 'var(--red-deep, #dc2626)' }}>✕</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agent-by-agent */}
      {agents.length > 0 && (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>By agent</h2>
          <div style={{ overflowX: 'auto', marginTop: '0.6rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-soft)', color: 'var(--muted)' }}>
                  <th style={{ padding: '6px 8px' }}>Agent</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Sales</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Premium</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Commission</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Paid</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{a.agent}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{a.count}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(a.premium)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(a.commission)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--signal-ok, #16a34a)' }}>{money(a.paid)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: a.unpaid > 0 ? 'var(--red-deep, #dc2626)' : 'var(--muted)' }}>{money(a.unpaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Deposits */}
      <section className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Carrier deposits</h2>
        <form action={actAddDeposit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: '0.7rem' }}>
          <input name="carrier" placeholder="Carrier" style={inputStyle} />
          <input name="amount" placeholder="Amount $" inputMode="decimal" style={inputStyle} />
          <input name="deposited_on" type="date" style={inputStyle} />
          <input name="notes" placeholder="Notes" style={inputStyle} />
          <button className="btn approve" type="submit" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>Add deposit</button>
        </form>
        <div style={{ overflowX: 'auto', marginTop: '0.7rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {deposits.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '10px 8px', color: 'var(--muted)' }}>No deposits logged yet.</td></tr>
              )}
              {deposits.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.carrier || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{d.deposited_on || '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(d.amount)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span className="status" style={{ background: d.matched ? 'var(--signal-ok, #16a34a)' : 'var(--paper-2)', color: d.matched ? '#fff' : 'var(--muted)', fontSize: '0.68rem' }}>
                      {d.matched ? 'matched' : 'unmatched'}
                    </span>
                    <form action={actToggleDeposit} style={{ display: 'inline', marginLeft: 6 }}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="matched" value={(!d.matched).toString()} />
                      <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>{d.matched ? 'Unmatch' : 'Mark matched'}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Workflow notes */}
      <section className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>How you run payroll (your notes)</h2>
        <p className="meta" style={{ margin: '0.2rem 0 0.6rem', fontSize: '0.82rem' }}>
          Write out your actual process — what you check, in what order, what feeds what. This is how we learn your workflow.
        </p>
        <form action={actSaveNotes} style={{ display: 'grid', gap: '0.45rem' }}>
          <textarea name="workflow_notes" defaultValue={workflowNotes} rows={6} placeholder="e.g. Every morning I log into the bank, note each carrier deposit, match it to the sales that produced it, then…" />
          <button className="btn approve" type="submit" style={{ justifySelf: 'start' }}>Save notes</button>
        </form>
      </section>

      <PayrollFeedback />
    </main>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card" style={{ padding: 16, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}
