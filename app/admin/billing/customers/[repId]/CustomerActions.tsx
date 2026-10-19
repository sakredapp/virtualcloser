'use client'

// Admin billing actions for one Suite CXO customer, all on Whop.
//
// Every button posts { action, ... } to /api/admin/billing/[repId]/whop
// (lib/billing/cxoBillingActions). Each action writes billing_audit on the
// server. Payment state itself arrives by the Whop webhook.

import { useState, useTransition } from 'react'

type Props = {
  repId: string
  membershipId: string | null
  billingStatus: string | null
}

export function CustomerActions({ repId, membershipId, billingStatus }: Props) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const live = billingStatus === 'active' || billingStatus === 'comped'

  function call(action: string, body: Record<string, unknown> = {}) {
    return start(async () => {
      setMsg(null)
      try {
        const r = await fetch(`/api/admin/billing/${repId}/whop`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...body }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.message ?? j.error ?? `${r.status}`)
        const link = typeof j.checkout_url === 'string' ? ` ${j.checkout_url}` : ''
        setMsg(`✓ ${action}${link}`)
        if (!link) setTimeout(() => location.reload(), 800)
      } catch (e) {
        setMsg(`✗ ${action}: ${(e as Error).message}`)
      }
    })
  }

  function seatCheckout() {
    if (!confirm('Email the owner a Whop seat checkout ($60 a seat a month)? They are active once Whop confirms the payment.')) return
    call('seat_checkout')
  }
  function chargeLink() {
    const dollars = prompt('One-time charge in dollars (setup fee, custom invoice):')
    if (!dollars) return
    const title = prompt('What it is for:') ?? 'Suite CXO charge'
    call('charge_link', { amount_cents: Math.round(Number(dollars) * 100), title })
  }
  function comp() {
    const reason = prompt('Why is this client comped? (required)')
    if (!reason) return
    const dollars = prompt('Dollars waived per month, for the record (blank = 0):') ?? ''
    call('comp', { reason, amount_cents: dollars ? Math.round(Number(dollars) * 100) : 0 })
  }
  function refund() {
    const paymentId = prompt('Whop payment id (pay_...) to refund:')
    if (!paymentId) return
    const dollars = prompt('Dollars to refund (blank = full):') ?? ''
    const reason = prompt('Reason (required):')
    if (!reason) return
    call('refund', { payment_id: paymentId.trim(), partial_cents: dollars ? Math.round(Number(dollars) * 100) : null, reason })
  }
  function cancel(now: boolean) {
    if (!confirm(now ? 'Cancel the Whop membership NOW? Access ends immediately.' : 'Cancel at the end of the paid period?')) return
    call(now ? 'cancel_now' : 'cancel_at_period_end')
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-soft)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {!live && <Btn onClick={seatCheckout} disabled={pending} primary>Send seat checkout</Btn>}
        <Btn onClick={chargeLink} disabled={pending}>+ One-time charge link</Btn>
        {billingStatus !== 'comped' && <Btn onClick={comp} disabled={pending}>Comp (no charge)</Btn>}
        <Btn onClick={refund} disabled={pending}>Refund a payment</Btn>
        {membershipId && <Btn onClick={() => call('pause')} disabled={pending}>Pause</Btn>}
        {membershipId && <Btn onClick={() => call('resume')} disabled={pending}>Resume</Btn>}
        {membershipId && <Btn onClick={() => cancel(false)} disabled={pending}>Cancel at period end</Btn>}
        {membershipId && <Btn onClick={() => call('uncancel')} disabled={pending}>Undo cancel</Btn>}
        {membershipId && <Btn onClick={() => cancel(true)} disabled={pending}>Cancel now</Btn>}
        {membershipId && <Btn onClick={() => call('sync')} disabled={pending}>Read from Whop</Btn>}
      </div>
      {msg && <p style={{ marginTop: 8, fontSize: 12, wordBreak: 'break-all', color: msg.startsWith('✓') ? '#065f46' : 'var(--red)' }}>{msg}</p>}
      {!membershipId && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>No Whop membership yet. It appears when the first seat payment lands.</p>}
    </div>
  )
}

function Btn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 600,
        background: primary ? 'var(--red)' : 'var(--paper-2)',
        border: primary ? 'none' : '1px solid var(--ink-soft)',
        borderRadius: 6,
        color: primary ? '#fff' : 'var(--ink)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >{children}</button>
  )
}
