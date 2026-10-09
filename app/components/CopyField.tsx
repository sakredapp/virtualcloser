'use client'

import type { CSSProperties } from 'react'

/** Read-only value that selects itself on click (webhook URLs, keys). */
export default function CopyField({ value, style, label }: { value: string; style?: CSSProperties; label?: string }) {
  return <input readOnly value={value} style={style} aria-label={label} onClick={(e) => (e.target as HTMLInputElement).select()} />
}
