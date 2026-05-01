'use client'

import { useState } from 'react'

type Row = {
  memberId: string
  email: string
  displayName: string
  role: string
  payerModel: 'self' | 'org'
  status: string
  planHoursPerMonth: number
  planPrice: string
  card: string
}

export default function TeamBillingClient({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function flip(memberId: string, payerModel: 'self' | 'org') {
    setBusy(memberId)
    setErr(null)
    try {
      const res = await fetch('/api/billing/agent-payer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, payerModel }),
      })
      const json = (await res.json()) as { ok: boolean; reason?: string }
      if (!json.ok) throw new Error(json.reason ?? 'flip failed')
      setRows((prev) =>
        prev.map((r) =>
          r.memberId === memberId
            ? { ...r, payerModel, status: payerModel === 'org' ? 'active' : 'pending_setup' }
            : r,
        ),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'flip failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {err && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
          {err}
        </div>
      )}
      <div style={{ background: '#fff', border: '1px solid #e6e1d8', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
              <Th>Agent</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Plan</Th>
              <Th>Card</Th>
              <Th>Pays</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} style={{ borderTop: '1px solid #f1f5f9' }}>
                <Td>
                  <strong>{r.displayName}</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.email}</div>
                </Td>
                <Td>{r.role}</Td>
                <Td>
                  <StatusPill status={r.status} />
                </Td>
                <Td>{r.planHoursPerMonth ? `${r.planHoursPerMonth} hrs/mo · ${r.planPrice}` : '—'}</Td>
                <Td>{r.card}</Td>
                <Td>
                  <div style={{ display: 'inline-flex', borderRadius: 999, background: '#f1f5f9', padding: 3 }}>
                    <SegBtn
                      active={r.payerModel === 'self'}
                      onClick={() => flip(r.memberId, 'self')}
                      disabled={busy === r.memberId}
                    >
                      Self
                    </SegBtn>
                    <SegBtn
                      active={r.payerModel === 'org'}
                      onClick={() => flip(r.memberId, 'org')}
                      disabled={busy === r.memberId}
                    >
                      Org
                    </SegBtn>
                  </div>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <Td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '20px 0' }}>
                  No team members yet.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 11, color: '#94a3b8' }}>
        Flipping to <strong>Org</strong> immediately activates that agent&rsquo;s
        dialer and cancels any per-agent Stripe subscription. Flipping back to{' '}
        <strong>Self</strong> requires the rep to re-add a card via their own{' '}
        <code>/dashboard/billing</code> page.
      </p>
    </>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748b' }}>
      {children}
    </th>
  )
}

function Td({ children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#0f172a' }} {...rest}>
      {children}
    </td>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active: { bg: '#dcfce7', fg: '#15803d', label: 'Active' },
    pending_setup: { bg: '#f1f5f9', fg: '#64748b', label: 'Setup needed' },
    past_due: { bg: '#fef2f2', fg: '#991b1b', label: 'Past due' },
    cancelled: { bg: '#f5f5f4', fg: '#57534e', label: 'Cancelled' },
  }
  const m = map[status] ?? { bg: '#f1f5f9', fg: '#64748b', label: status }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: m.bg, color: m.fg, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
      {m.label}
    </span>
  )
}

function SegBtn({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 12px',
        fontSize: 12,
        fontWeight: 800,
        borderRadius: 999,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? '#0f172a' : 'transparent',
        color: active ? '#fff' : '#64748b',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {children}
    </button>
  )
}
