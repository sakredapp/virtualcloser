import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import PageHeader from '@/app/components/PageHeader'
import PayrollFeedback from './PayrollFeedback'
import PayrollSheets from './PayrollSheets'
import PayrollAssistant from './PayrollAssistant'
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
  type CommissionEntry,
} from '@/lib/payroll/data'
import { listSheets, connectSheet, removeSheet } from '@/lib/payroll/sheets'

export const dynamic = 'force-dynamic'

type Tab = 'overview' | 'deposits' | 'commissions' | 'sheets' | 'assistant' | 'notes'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'commissions', label: 'Commissions' },
  { key: 'sheets', label: 'Sheets' },
  { key: 'assistant', label: 'Assistant' },
  { key: 'notes', label: 'Notes' },
]

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
const inputStyle = { padding: '0.5rem 0.6rem', fontSize: '0.85rem' } as const

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireMember()
  const tenant = ctx.tenant
  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  if (brandKey !== 'cxo' || !ctx.member || !isAtLeast(ctx.member.role, 'admin')) {
    redirect('/dashboard')
  }
  const sp = await searchParams
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? 'overview') as Tab

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
      deposit_id: str(fd.get('deposit_id')),
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
  async function actConnectSheet(fd: FormData) {
    'use server'
    const c = await requireMember()
    await connectSheet(c.tenant.id, String(fd.get('url') ?? ''), str(fd.get('label')))
    revalidatePath('/dashboard/payroll')
  }
  async function actRemoveSheet(fd: FormData) {
    'use server'
    const c = await requireMember()
    const id = String(fd.get('id') ?? '')
    if (id) { await removeSheet(c.tenant.id, id); revalidatePath('/dashboard/payroll') }
  }

  const [commissions, deposits, workflowNotes, sheets, navTabs] = await Promise.all([
    listCommissions(tenant.id),
    listDeposits(tenant.id),
    getWorkflowNotes(tenant.id),
    listSheets(tenant.id),
    buildDashboardTabs(tenant.id, ctx.member),
  ])
  const agents = agentSummary(commissions)
  const m = moneySummary(commissions, deposits)
  const byDeposit = new Map<string, CommissionEntry[]>()
  for (const e of commissions) {
    if (!e.deposit_id) continue
    const arr = byDeposit.get(e.deposit_id) ?? []
    arr.push(e)
    byDeposit.set(e.deposit_id, arr)
  }

  return (
    <main className="wrap">
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <PageHeader
        eyebrow="Workstation"
        title="Payroll & Commissions"
        subtitle="Start with a deposit, match it to the policies + agents it covers, and track what's paid. Connect your Google Sheets to pull data in, and ask the assistant anything. This is yours to shape — use the feedback box on Notes."
      />

      {/* Sub-tabs */}
      <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '0.8rem 0 0.2rem' }}>
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <Link
              key={t.key}
              href={`/dashboard/payroll?tab=${t.key}`}
              style={{
                padding: '0.4rem 0.85rem', borderRadius: 8, fontSize: 13, textDecoration: 'none',
                fontWeight: active ? 700 : 500,
                background: active ? 'var(--ink)' : 'var(--paper-2, #f1efe9)',
                color: active ? 'var(--text-inv, #fff)' : 'var(--text)',
                border: '1px solid var(--border-soft)',
              }}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: '0.8rem' }}>
            <Stat label="Deposits logged" value={money(m.depositsTotal)} sub={`${m.unmatchedDeposits} unmatched`} />
            <Stat label="Commission owed" value={money(m.commissionOwed)} sub={`${commissions.length} entries`} />
            <Stat label="Paid out" value={money(m.commissionPaid)} accent="var(--signal-ok, #16a34a)" />
            <Stat label="Still to pay" value={money(m.commissionUnpaid)} accent="var(--red-deep, #dc2626)" />
          </section>
          {agents.length > 0 && (
            <section className="card" style={{ marginTop: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>By agent</h2>
              <Table head={['Agent', 'Sales', 'Premium', 'Commission', 'Paid', 'Owed']}>
                {agents.map((a) => (
                  <tr key={a.agent} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <Td bold>{a.agent}</Td><Td right>{a.count}</Td><Td right>{money(a.premium)}</Td>
                    <Td right>{money(a.commission)}</Td>
                    <Td right color="var(--signal-ok, #16a34a)">{money(a.paid)}</Td>
                    <Td right color={a.unpaid > 0 ? 'var(--red-deep, #dc2626)' : 'var(--muted)'}>{money(a.unpaid)}</Td>
                  </tr>
                ))}
              </Table>
            </section>
          )}
          {commissions.length === 0 && deposits.length === 0 && (
            <section className="card" style={{ marginTop: '1rem' }}>
              <p className="meta">Start on the <strong>Deposits</strong> tab — log a carrier deposit, then match the policies it covers. Or connect a Google Sheet on the <strong>Sheets</strong> tab to pull existing data in.</p>
            </section>
          )}
        </>
      )}

      {/* DEPOSITS (deposit-first flow) */}
      {tab === 'deposits' && (
        <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>New deposit</h2>
            <p className="meta" style={{ margin: '0.2rem 0 0.6rem', fontSize: '0.82rem' }}>Log a carrier deposit as it hits the bank — then match the policies it covers below.</p>
            <form action={actAddDeposit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <input name="amount" placeholder="Deposit amount $" inputMode="decimal" style={inputStyle} autoFocus />
              <input name="carrier" placeholder="Carrier" style={inputStyle} />
              <input name="deposited_on" type="date" style={inputStyle} />
              <input name="notes" placeholder="Notes" style={inputStyle} />
              <button className="btn approve" type="submit" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>New deposit</button>
            </form>
          </section>

          {deposits.length === 0 ? (
            <section className="card" style={{ marginTop: '1rem' }}><p className="meta">No deposits yet.</p></section>
          ) : (
            deposits.map((d) => {
              const linked = byDeposit.get(d.id) ?? []
              const covered = linked.reduce((s, e) => s + (Number(e.commission_amount) || 0), 0)
              return (
                <section key={d.id} className="card" style={{ marginTop: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1.05rem' }}>{money(d.amount)}</strong>
                    <span className="meta">{d.carrier || 'carrier?'} · {d.deposited_on || 'no date'}</span>
                    <span className="status" style={{ background: d.matched ? 'var(--signal-ok, #16a34a)' : 'var(--paper-2)', color: d.matched ? '#fff' : 'var(--muted)', fontSize: '0.68rem' }}>
                      {d.matched ? 'matched' : 'unmatched'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className="meta" style={{ fontSize: '0.78rem' }}>{linked.length} policies · {money(covered)} commission</span>
                    <form action={actToggleDeposit} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="matched" value={(!d.matched).toString()} />
                      <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>{d.matched ? 'Unmatch' : 'Mark matched'}</button>
                    </form>
                  </div>

                  {linked.length > 0 && (
                    <ul style={{ margin: '0.6rem 0 0', paddingLeft: 18, fontSize: 13 }}>
                      {linked.map((e) => (
                        <li key={e.id} style={{ marginBottom: 3 }}>
                          {e.agent_name || '?'} — {e.client_name || '?'} ({e.carrier || '?'}) · {money(e.commission_amount)}
                          <span className="status" style={{ marginLeft: 6, background: STATUS_COLOR[e.status], color: '#fff', fontSize: '0.62rem' }}>{e.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <details style={{ marginTop: '0.6rem' }}>
                    <summary className="hint" style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>+ Match a policy to this deposit</summary>
                    <form action={actAddCommission} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: '0.5rem' }}>
                      <input type="hidden" name="deposit_id" value={d.id} />
                      <input name="agent_name" placeholder="Agent" style={inputStyle} />
                      <input name="client_name" placeholder="Client / policy" style={inputStyle} />
                      <input name="carrier" placeholder="Carrier" defaultValue={d.carrier ?? ''} style={inputStyle} />
                      <input name="premium" placeholder="Premium $" inputMode="decimal" style={inputStyle} />
                      <input name="commission_amount" placeholder="Commission $" inputMode="decimal" style={inputStyle} />
                      <button className="btn approve" type="submit" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>Add policy</button>
                    </form>
                  </details>
                </section>
              )
            })
          )}
        </>
      )}

      {/* COMMISSIONS */}
      {tab === 'commissions' && (
        <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Add commission</h2>
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
          <section className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Commissions ({commissions.length})</h2>
            <Table head={['Agent', 'Client', 'Carrier', 'Premium', 'Commission', 'Status', '']}>
              {commissions.length === 0 && <tr><td colSpan={7} style={{ padding: '12px 8px', color: 'var(--muted)' }}>No entries yet.</td></tr>}
              {commissions.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <Td bold>{e.agent_name || '—'}</Td><Td>{e.client_name || '—'}</Td><Td>{e.carrier || '—'}</Td>
                  <Td right>{money(e.premium)}</Td><Td right>{money(e.commission_amount)}</Td>
                  <Td><span className="status" style={{ background: STATUS_COLOR[e.status], color: '#fff', fontSize: '0.68rem' }}>{e.status}</span></Td>
                  <Td>
                    {e.status !== 'paid' && (
                      <form action={actSetStatus} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={e.id} /><input type="hidden" name="status" value="paid" />
                        <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>Mark paid</button>
                      </form>
                    )}
                    <form action={actDeleteCommission} style={{ display: 'inline', marginLeft: 4 }}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn" type="submit" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', color: 'var(--red-deep, #dc2626)' }}>✕</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}

      {/* SHEETS */}
      {tab === 'sheets' && (
        <div style={{ marginTop: '0.8rem' }}>
          <PayrollSheets
            sheets={sheets.map((s) => ({ id: s.id, title: s.title, label: s.label, default_tab: s.default_tab }))}
            connectAction={actConnectSheet}
            removeAction={actRemoveSheet}
          />
        </div>
      )}

      {/* ASSISTANT */}
      {tab === 'assistant' && <div style={{ marginTop: '0.8rem' }}><PayrollAssistant /></div>}

      {/* NOTES + feedback */}
      {tab === 'notes' && (
        <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>How you run payroll (your notes)</h2>
            <p className="meta" style={{ margin: '0.2rem 0 0.6rem', fontSize: '0.82rem' }}>Write out your actual process — what you check, in what order, what feeds what. This is how we learn your workflow.</p>
            <form action={actSaveNotes} style={{ display: 'grid', gap: '0.45rem' }}>
              <textarea name="workflow_notes" defaultValue={workflowNotes} rows={7} placeholder="e.g. Every morning I log into the bank, note each carrier deposit, match it to the sales that produced it, then…" />
              <button className="btn approve" type="submit" style={{ justifySelf: 'start' }}>Save notes</button>
            </form>
          </section>
          <PayrollFeedback />
        </>
      )}
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

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: '0.6rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-soft)', color: 'var(--muted)' }}>
            {head.map((h, i) => <th key={i} style={{ padding: '6px 8px', textAlign: i >= 3 && i <= 5 ? 'right' : 'left' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, bold, right, color }: { children: React.ReactNode; bold?: boolean; right?: boolean; color?: string }) {
  return <td style={{ padding: '6px 8px', textAlign: right ? 'right' : 'left', fontWeight: bold ? 600 : 400, color, whiteSpace: 'nowrap' }}>{children}</td>
}
