'use client'

/**
 * A fenced code block from an answer (lib/markdown.ts 'code'), shown exactly
 * as written with a small Copy button. Rendered by Markdown.tsx; the only
 * client piece of it, so Markdown itself still works in server components.
 */
import { useEffect, useState } from 'react'

export default function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <div className="cx-md-code">
      <div className="cx-md-code__bar">
        <span className="cx-md-code__lang">{lang || 'code'}</span>
        <button type="button" className="cx-md-code__copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy code'}>
          {copied ? (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}
