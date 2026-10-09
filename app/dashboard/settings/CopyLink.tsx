'use client'

import { useState } from 'react'

/** The assistant's set-password link, for the exec to copy and send themselves. */
export default function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="cx-ea-link">
      <input readOnly value={url} aria-label="Set-password link" onFocus={(e) => e.currentTarget.select()} data-testid="assistant-link" />
      <button
        type="button"
        className="cx-btn cx-btn-sm cx-btn-ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {})
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </span>
  )
}
