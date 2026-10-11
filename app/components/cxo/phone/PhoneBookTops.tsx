'use client'

/**
 * Top agencies, producers and carriers for the month so far, on the phone
 * Home of a book-of-business version. Same source as the Revenue page's
 * breakdown tables (/api/pinnacle/breakdown, which only answers a tenant on
 * the Pinnacle book). Asked for only at phone width, so the desktop Today
 * page makes no extra request.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { PHONE_QUERY } from './PhoneTabBar'

type Row = { label: string; premium: number; policies: number }
type Dim = 'team' | 'agent' | 'carrier'

function money(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `$${Math.round(abs / 1_000)}K`
  return `$${Math.round(abs).toLocaleString('en-US')}`
}

export default function PhoneBookTops({ start, end, scope, lists }: { start: string; end: string; scope: string; lists: Array<{ dim: Dim; title: string }> }) {
  const [rows, setRows] = useState<Partial<Record<Dim, Row[] | null>>>({})
  const dims = lists.map((l) => l.dim).join(',')

  useEffect(() => {
    if (!window.matchMedia(PHONE_QUERY).matches) return
    let alive = true
    for (const dim of dims.split(',') as Dim[]) {
      fetch(`/api/pinnacle/breakdown?dim=${dim}&line=All&start=${start}&end=${end}&limit=3`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j: { rows?: Row[] }) => {
          if (alive) setRows((cur) => ({ ...cur, [dim]: (j.rows ?? []).filter((x) => x.label && x.premium > 0).slice(0, 3) }))
        })
        .catch(() => {
          if (alive) setRows((cur) => ({ ...cur, [dim]: [] }))
        })
    }
    return () => {
      alive = false
    }
  }, [dims, start, end])

  return (
    <>
      {lists.map((l) => {
        const list = rows[l.dim]
        return (
          <section key={l.dim} aria-label={l.title}>
            <div className="cxph-sec">
              <b>{l.title}</b>
              <Link href="/dashboard/revenue">This month</Link>
            </div>
            <div className="cxph-card cxph-rank">
              {list == null ? (
                <p className="cxph-quiet">Loading…</p>
              ) : list.length === 0 ? (
                <p className="cxph-quiet">Nothing for this month yet.</p>
              ) : (
                list.map((r, i) => (
                  <div className="row" key={r.label}>
                    <span className="n">{i + 1}</span>
                    <span className="t">
                      <b>{r.label}</b>
                      <small>{r.policies.toLocaleString('en-US')} {r.policies === 1 ? 'policy' : 'policies'}</small>
                    </span>
                    <span className="v">{money(r.premium)}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )
      })}
      <p className="cxph-conn">{scope}. <Link href="/dashboard/revenue">Open Revenue</Link></p>
    </>
  )
}
