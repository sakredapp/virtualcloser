'use client'

import { useRouter } from 'next/navigation'

type Board = { id: string; name: string }

export default function TrelloBoardSelect({
  boards,
  selectedBoardId,
}: {
  boards: Board[]
  selectedBoardId: string | null
}) {
  const router = useRouter()

  if (boards.length <= 1) return null

  return (
    <div style={{ marginTop: '1.2rem' }}>
      <select
        value={selectedBoardId ?? ''}
        onChange={(e) => router.push(`/dashboard/trello?board=${e.target.value}`)}
        style={{
          padding: '0.45rem 0.75rem',
          borderRadius: 8,
          border: '1.5px solid rgba(15,15,15,0.18)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          fontSize: '0.9rem',
          fontWeight: 600,
          cursor: 'pointer',
          minWidth: 180,
        }}
      >
        {boards.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    </div>
  )
}
