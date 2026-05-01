'use client'

// MobileCartDrawer — bottom-sheet that slides up when the user taps the
// "Cart" button in the mobile sticky bar. Shows itemized line items +
// a Book a Call CTA. Used by both /offer and /offer/enterprise so the
// UX is identical on both pages.

import Link from 'next/link'
import { useEffect } from 'react'

export type DrawerItem = {
  label: string
  /** Optional second-line caption (e.g. tier band, hours, "Not in cart"). */
  sub?: string
  /** Cents — rendered as $X. Pass null/undefined to render an em-dash. */
  cents: number | null
  /** When false, the row renders muted (out-of-cart hint). */
  inCart?: boolean
  /** When true, the row renders with a "Required" tag. */
  required?: boolean
}

export default function MobileCartDrawer({
  open,
  onClose,
  totalCents,
  items,
  bookHref,
  noteHtml,
}: {
  open: boolean
  onClose: () => void
  totalCents: number
  items: DrawerItem[]
  bookHref: string
  /** Optional helper paragraph below the items list. */
  noteHtml?: string
}) {
  // Close on Escape so keyboard / detached BT keyboard users can dismiss.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Lock body scroll while the drawer is up so the backdrop swipe
    // doesn't bleed through to the page underneath.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const fmt = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <>
      <div
        className={`mcd-backdrop ${open ? 'mcd-open' : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`mcd-sheet ${open ? 'mcd-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Cart summary"
        aria-hidden={!open}
      >
        <div className="mcd-handle" aria-hidden />
        <div className="mcd-head">
          <div>
            <p className="mcd-kicker">Your monthly</p>
            <p className="mcd-total">
              {fmt(totalCents)}<span className="mcd-mo">/mo</span>
            </p>
          </div>
          <button type="button" className="mcd-close" onClick={onClose} aria-label="Close cart">
            ×
          </button>
        </div>

        <ul className="mcd-list">
          {items.map((item, i) => {
            const inCart = item.inCart !== false
            return (
              <li key={i} className={`mcd-item ${inCart ? '' : 'mcd-item-out'}`}>
                <div>
                  <span className="mcd-item-label">
                    {item.label}
                    {item.required && (
                      <span className="mcd-item-req">Required</span>
                    )}
                  </span>
                  {item.sub && <span className="mcd-item-sub">{item.sub}</span>}
                </div>
                <strong>{item.cents != null && inCart ? fmt(item.cents) : '—'}</strong>
              </li>
            )
          })}
        </ul>

        {noteHtml && (
          <p className="mcd-note" dangerouslySetInnerHTML={{ __html: noteHtml }} />
        )}

        <div className="mcd-actions">
          <Link href={bookHref} className="mcd-book">
            Book a call with this quote
          </Link>
          <button type="button" onClick={onClose} className="mcd-continue">
            Keep building
          </button>
        </div>
      </div>
    </>
  )
}
