'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PlaudToProjectButton({ noteId }: { noteId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function turnIntoProject() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/projects/from-plaud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; projectId?: string; error?: string }
      if (!res.ok || !json.ok || !json.projectId) {
        setError(typeof json.error === 'string' ? json.error : `Failed (${res.status})`)
        return
      }
      router.push(`/dashboard/projects/${json.projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <button
        type="button"
        onClick={turnIntoProject}
        disabled={busy}
        style={{
          fontSize: '0.74rem',
          border: '1px solid var(--line, #e5e5e5)',
          background: '#fff',
          borderRadius: 8,
          padding: '0.28rem 0.6rem',
          cursor: busy ? 'default' : 'pointer',
        }}
        title="Build a project from this note"
      >
        {busy ? 'Building…' : '📋 Turn into project'}
      </button>
      {error && <span style={{ fontSize: '0.72rem', color: 'var(--red-deep, #b00020)' }}>{error}</span>}
    </span>
  )
}
