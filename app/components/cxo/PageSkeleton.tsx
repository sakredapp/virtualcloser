'use client'

import { useEffect, useState } from 'react'

/**
 * Suite-style loading state for the executive pages. After a couple of
 * seconds it says what is happening: the first load of the day builds the
 * numbers, which takes about a minute.
 */
export default function PageSkeleton({ eyebrow, title }: { eyebrow: string; title: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 2500)
    return () => clearTimeout(t)
  }, [])
  return (
    <main className="wrap" aria-busy="true">
      <header className="hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="sub cx-skel-note">{slow ? 'Building today’s numbers, about a minute.' : ' '}</p>
      </header>
      <div className="cx-grid" style={{ marginTop: 16 }}>
        <section className="cx-panel cx-skel-panel">
          <span className="cx-skel cx-skel-line" style={{ width: 160 }} />
          <span className="cx-skel cx-skel-figure" style={{ width: 240 }} />
          <span className="cx-skel cx-skel-chart" />
        </section>
        <div className="cx-grid cx-grid-4">
          {[0, 1, 2, 3].map((i) => (
            <section key={i} className="cx-panel cx-skel-panel">
              <span className="cx-skel cx-skel-line" style={{ width: 120 }} />
              <span className="cx-skel cx-skel-figure" style={{ width: 140 }} />
              <span className="cx-skel cx-skel-line" style={{ width: '70%' }} />
            </section>
          ))}
        </div>
        <div className="cx-grid cx-grid-2">
          {[0, 1].map((i) => (
            <section key={i} className="cx-panel cx-skel-panel">
              <span className="cx-skel cx-skel-line" style={{ width: 180 }} />
              <span className="cx-skel cx-skel-chart" style={{ height: 160 }} />
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
