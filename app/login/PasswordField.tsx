'use client'

import { useState } from 'react'

const inputStyle: React.CSSProperties = {
  padding: '0.65rem',
  paddingRight: '3.4rem',
  borderRadius: 10,
  border: '1px solid var(--ink-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  textTransform: 'none',
  letterSpacing: 'normal',
  width: '100%',
  boxSizing: 'border-box',
}

const toggleStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'transparent',
  border: 'none',
  padding: '0.3rem 0.5rem',
  fontSize: '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  cursor: 'pointer',
}

export default function PasswordField() {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        name="password"
        type={show ? 'text' : 'password'}
        required
        style={inputStyle}
        autoComplete="current-password"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        style={toggleStyle}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
