'use client'

import { useState } from 'react'

export function IntegrationAccordion({
  title,
  badge,
  status,
  statusOk,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string
  badge?: string
  status?: string
  statusOk?: boolean
  icon?: string
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
        {icon && (
          <span style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        )}
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
  icon,
  description,
  whatsIncluded,
  priceLabel,
}: {
  title: string
  badge?: string
  icon?: string
  description: string
  whatsIncluded: string[]
  priceLabel: string
}) {
  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid rgba(15,15,15,0.1)',
        borderRadius: 12,
        padding: '0.9rem 1rem',
        opacity: 0.78,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        {icon && (
          <span
            style={{
              fontSize: '1.25rem',
              lineHeight: 1,
              flexShrink: 0,
              marginTop: 2,
              filter: 'grayscale(1)',
              opacity: 0.55,
            }}
          >
            {icon}
          </span>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ink)' }}>
              {title}
            </span>
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
            <span
              style={{
                fontSize: '0.63rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '0.1rem 0.4rem',
                borderRadius: 999,
                background: 'rgba(255,40,0,0.07)',
                color: 'var(--red-deep)',
                border: '1px solid rgba(255,40,0,0.18)',
              }}
            >
              🔒 Not active
            </span>
          </div>

          <p className="meta" style={{ margin: '0.35rem 0 0' }}>
            {description}
          </p>

          <ul
            style={{
              margin: '0.45rem 0 0',
              paddingLeft: '1.1rem',
              display: 'grid',
              gap: '0.15rem',
            }}
          >
            {whatsIncluded.slice(0, 3).map((item) => (
              <li key={item} className="meta" style={{ fontSize: '0.8rem' }}>
                {item}
              </li>
            ))}
          </ul>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.85rem',
              marginTop: '0.65rem',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)' }}>
              {priceLabel}
            </span>
            <a
              href="#request-integration"
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--red)',
                textDecoration: 'none',
              }}
            >
              Request access →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
