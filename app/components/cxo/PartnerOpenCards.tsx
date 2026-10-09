'use client'

import { useEffect, useState } from 'react'
import { isOverdue } from '@/lib/boardsShared'

type Card = { id: string; title: string; due_date: string | null; board_id: string; board_name: string; list_title: string }

/** "Open cards" on a partner: board cards they hold that are not done. Renders nothing when there are none. */
export default function PartnerOpenCards({ partnerId }: { partnerId: string }) {
  const [cards, setCards] = useState<Card[] | null>(null)
  useEffect(() => {
    let live = true
    setCards(null)
    fetch(`/api/boards?partner=${encodeURIComponent(partnerId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((j: { cards?: Card[] }) => live && setCards(j.cards ?? []))
      .catch(() => live && setCards([]))
    return () => {
      live = false
    }
  }, [partnerId])
  if (!cards?.length) return null
  return (
    <div className="cx-partner-cards">
      <p className="cx-eyebrow">Open cards</p>
      <ul>
        {cards.slice(0, 8).map((c) => (
          <li key={c.id}>
            <a href={`/dashboard/boards?board=${encodeURIComponent(c.board_id)}`}>{c.title}</a>
            <small>
              {c.board_name}
              {c.list_title ? ` · ${c.list_title}` : ''}
              {c.due_date ? (
                <span className={isOverdue(c.due_date) ? 'is-late' : ''}>
                  {' · '}
                  {isOverdue(c.due_date) ? 'Overdue ' : 'Due '}
                  {new Date(c.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              ) : null}
            </small>
          </li>
        ))}
      </ul>
    </div>
  )
}
