'use client'

import { usePathname } from 'next/navigation'
import { useRef } from 'react'

export type AssistantBarExec = { id: string; name: string }

/**
 * Top of the panel while an exec's assistant is signed in: who they are
 * working for, and (when they assist more than one exec) a switcher.
 * Switching posts to /api/assistant/switch, which checks the link server-side.
 */
export default function AssistantBar({ assistantName, execs, activeId }: { assistantName: string; execs: AssistantBarExec[]; activeId: string | null }) {
  const pathname = usePathname() ?? '/dashboard'
  const formRef = useRef<HTMLFormElement>(null)
  const active = execs.find((e) => e.id === activeId) ?? null
  const first = (n: string) => n.trim().split(/\s+/)[0] || n
  if (!active) {
    return (
      <div className="cx-assist-bar" role="status">
        <span className="cx-assist-who">Signed in as {first(assistantName)}, assistant</span>
        <span className="cx-assist-note">No executive has you as their assistant right now.</span>
      </div>
    )
  }
  return (
    <div className="cx-assist-bar" role="status">
      <span className="cx-assist-dot" aria-hidden />
      {execs.length > 1 ? (
        <form ref={formRef} method="post" action="/api/assistant/switch" className="cx-assist-switch">
          <input type="hidden" name="return" value={pathname} />
          <label>
            <span className="cx-assist-who">Working for</span>
            <select name="exec" defaultValue={active.id} onChange={() => formRef.current?.requestSubmit()} aria-label="Working for">
              {execs.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <noscript><button type="submit" className="cx-btn cx-btn-sm">Switch</button></noscript>
        </form>
      ) : (
        <span className="cx-assist-who">Working for <strong>{active.name}</strong></span>
      )}
      <span className="cx-assist-note">Everything you do shows as by {first(assistantName)} for {first(active.name)}.</span>
    </div>
  )
}
