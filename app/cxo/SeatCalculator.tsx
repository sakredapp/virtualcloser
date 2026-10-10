'use client'

import { useState } from 'react'
import { cxoQuote } from '@/lib/cxoSite'

/** People slider: the monthly price and the shared question pool for that team. */
export default function SeatCalculator() {
  const [people, setPeople] = useState(10)
  const q = cxoQuote(people)
  return (
    <div className="cxs-calc">
      <label htmlFor="cxs-people">How many people on your team?</label>
      <div className="cxs-calc-row">
        <input
          id="cxs-people"
          type="range"
          min={1}
          max={100}
          value={people}
          onChange={(e) => setPeople(Number(e.target.value))}
        />
        <output htmlFor="cxs-people">{q.people}</output>
      </div>
      <dl className="cxs-calc-out">
        <div>
          <dt>Per month</dt>
          <dd>${q.monthly.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Shared questions a month</dt>
          <dd>{q.pool.toLocaleString('en-US')}</dd>
        </div>
      </dl>
    </div>
  )
}
