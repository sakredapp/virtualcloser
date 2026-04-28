import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { listClients } from '@/lib/admin-db'
import { TIER_INFO, type OnboardingStep } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function ClientsListPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const clients = await listClients()

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Clients</p>
        <h1>Client Base</h1>
        <p className="sub">Every tenant you&apos;ve onboarded, with build status and fees.</p>
        <p className="nav">
          <Link href="/admin/clients/new">+ New client</Link>
          <span>·</span>
          <Link href="/admin/prospects">Prospects (bookings)</Link>
          <span>·</span>
          <Link href="/admin/billing">Billing & usage</Link>
          <span>·</span>
          <Link href="/offer">Public offer page</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head">
          <h2>All clients</h2>
          <p>{clients.length}</p>
        </div>

        {clients.length === 0 ? (
          <p className="empty">No clients yet. Create your first one.</p>
        ) : (
          <ul className="list">
            {clients.map((c) => {
              const steps = (c.onboarding_steps ?? []) as OnboardingStep[]
              const done = steps.filter((s) => s.done).length
              const total = steps.length || 1
              const pct = Math.round((done / total) * 100)
              const info = TIER_INFO[c.tier] ?? TIER_INFO.salesperson
              return (
                <li key={c.id} className="row">
                  <div>
                    <p className="name">
                      <Link href={`/admin/clients/${c.id}`}>{c.display_name}</Link>
                    </p>
                    <p className="meta">
                      {c.slug}.virtualcloser.com · {c.email || 'no email'}
                    </p>
                  </div>
                  <div className="right">
                    <span className="status hot" style={{ background: 'var(--royal-soft)', borderColor: 'var(--royal-ring)', color: 'var(--royal)' }}>
                      {info.label}
                    </span>
                    <p className="meta">
                      ${c.monthly_fee}/mo · onboarding {pct}%
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
