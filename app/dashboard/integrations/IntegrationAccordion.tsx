'use client'

import { useState } from 'react'

export function IntegrationAccordion({
  title,
  badge,
  status,
  statusOk,
  defaultOpen = false,
  children,
}: {
  title: string
  badge?: string
  status?: string
  statusOk?: boolean
  icon?: string  // accepted but unused — kept for back-compat with existing callers
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid rgba(15,15,15,0.12)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.9rem 1rem',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--ink)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</span>
            {badge && (
              <span
                style={{
                  fontSize: '0.63rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '0.1rem 0.4rem',
                  borderRadius: 999,
                  background: 'var(--paper-2)',
                  color: 'var(--muted)',
                  border: '1px solid rgba(15,15,15,0.1)',
                }}
              >
                {badge}
              </span>
            )}
          </div>
          {status && (
            <span
              style={{
                display: 'block',
                fontSize: '0.78rem',
                color: statusOk ? '#1a7a42' : '#888',
                fontWeight: 500,
                marginTop: '0.1rem',
              }}
            >
              {statusOk ? '● ' : '○ '}
              {status}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: '1rem',
            color: '#aaa',
            flexShrink: 0,
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            borderTop: '1px solid rgba(15,15,15,0.08)',
            padding: '1rem',
            background: 'var(--paper)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function LockedIntegrationCard({
  title,
  badge,
  description,
  whatsIncluded,
  priceLabel,
}: {
  title: string
  badge?: string
  icon?: string  // accepted but unused — kept for back-compat with existing callers
  description: string
  whatsIncluded: string[]
  priceLabel: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid rgba(15,15,15,0.12)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.9rem 1rem',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--ink)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</span>
            {badge && (
              <span
                style={{
                  fontSize: '0.63rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '0.1rem 0.4rem',
                  borderRadius: 999,
                  background: 'var(--paper-2)',
                  color: 'var(--muted)',
                  border: '1px solid rgba(15,15,15,0.1)',
                }}
              >
                {badge}
              </span>
            )}
          </div>
          <span
            style={{
              display: 'block',
              fontSize: '0.78rem',
              color: '#999',
              fontWeight: 500,
              marginTop: '0.1rem',
            }}
          >
            ○ Locked — {priceLabel}
          </span>
        </div>
        <span
          style={{
            fontSize: '1rem',
            color: '#aaa',
            flexShrink: 0,
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            borderTop: '1px solid rgba(15,15,15,0.08)',
            padding: '1rem',
            background: 'var(--paper)',
          }}
        >
          <p className="meta" style={{ margin: 0 }}>
            {description}
          </p>
          <ul
            style={{
              margin: '0.55rem 0 0',
              paddingLeft: '1.1rem',
              display: 'grid',
              gap: '0.15rem',
            }}
          >
            {whatsIncluded.slice(0, 3).map((item) => (
              <li key={item} className="meta" style={{ fontSize: '0.82rem' }}>
                {item}
              </li>
            ))}
          </ul>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.85rem',
              marginTop: '0.85rem',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{priceLabel}</span>
            <a
              href="#request-integration"
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--red)',
                textDecoration: 'none',
              }}
            >
              Request access →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
