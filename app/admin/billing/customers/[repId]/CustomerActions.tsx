'use client'

// Admin write actions for a single customer.
//
// Buttons fire fetch() to /api/admin/billing/[repId]/<action>. Every action
// records to billing_audit on the server.

import { useState, useTransition } from 'react'

type Props = {
  repId: string
  subscriptionId: string | null
  customerId: string | null
  tier: string
}

export function CustomerActions({ repId, subscriptionId, customerId, tier }: Props) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function call(path: string, body: Record<string, unknown> = {}) {
    return start(async () => {
      setMsg(null)
      try {
        const r = await fetch(`/api/admin/billing/${repId}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.reason ?? `${r.status}`)
        setMsg(`✓ ${path}: ${JSON.stringify(j).slice(0, 120)}`)
        // Reload to pick up state changes from webhooks.
        setTimeout(() => location.reload(), 800)
      } catch (e) {
        setMsg(`✗ ${path}: ${(e as Error).message}`)
      }
    })
  }

  function refund() {
    const invoice = prompt('Stripe invoice id (in_xxx) to refund:')
    if (!invoice) return
    const amount = prompt('Amount in cents (blank = full):')
    const reason = prompt('Reason (optional):') ?? ''
    call('refund', { invoiceId: invoice, amountCents: amount ? Number(amount) : null, reason })
  }
  function comp() {
    const cents = prompt('Credit amount in cents:')
    const reason = prompt('Reason:') ?? 'admin comp'
    if (!cents) return
    call('comp', { amountCents: Number(cents), reason })
  }
  function cancel() {
    if (!confirm('Cancel subscription at end of current week?')) return
    call('cancel-at-week-end')
  }
  function uncancel() {
    if (!confirm('Undo cancel-at-week-end?')) return
    call('uncancel')
  }
  function setupFee() {
    const cents = prompt('Setup fee amount in cents:')
    const desc = prompt('Description:') ?? 'Custom setup fee'
    if (!cents) return
    call('setup-fee', { amountCents: Number(cents), description: desc })
  }
  function sync() {
    call('sync')
  }
  function pause() {
    if (!confirm('Pause subscription (stops dialer, no charges until resumed)?')) return
    call('pause')
  }
  function resume() {
    call('resume')
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-soft)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {customerId && <Btn onClick={setupFee} disabled={pending}>+ Custom setup fee</Btn>}
        {customerId && <Btn onClick={comp} disabled={pending}>+ Credit / comp</Btn>}
        {customerId && <Btn onClick={refund} disabled={pending}>Refund invoice</Btn>}
        {subscriptionId && <Btn onClick={pause} disabled={pending}>Pause sub</Btn>}
        {subscriptionId && <Btn onClick={resume} disabled={pending}>Resume sub</Btn>}
        {subscriptionId && <Btn onClick={cancel} disabled={pending}>Cancel @ week end</Btn>}
        {subscriptionId && <Btn onClick={uncancel} disabled={pending}>Undo cancel</Btn>}
        {customerId && <Btn onClick={sync} disabled={pending}>Sync from Stripe</Btn>}
      </div>
      {msg && <p style={{ marginTop: 8, fontSize: 12, color: msg.startsWith('✓') ? '#065f46' : 'var(--red)' }}>{msg}</p>}
      {!customerId && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>No Stripe customer attached at the {tier} scope yet.</p>}
    </div>
  )
}

function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 600,
        background: 'var(--paper-2)',
        border: '1px solid var(--ink-soft)',
        borderRadius: 6,
        color: 'var(--ink)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >{children}</button>
  )
}
