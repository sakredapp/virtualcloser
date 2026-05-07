import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { listClients } from '@/lib/admin-db'
import { TIER_INFO, type OnboardingStep } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

type Bucket = 'active' | 'pending_build' | 'inactive'

function bucketOf(c: { billing_status?: string | null; stripe_subscription_id?: string | null; build_fee_paid_at?: string | null }): Bucket | null {
  if (c.billing_status === 'active' || c.stripe_subscription_id) return 'active'
  if (c.billing_status === 'pending_activation' || c.build_fee_paid_at) return 'pending_build'
  if (c.billing_status === 'canceled' || c.billing_status === 'past_due') return 'inactive'
  return null
}

const BUCKET_LABEL: Record<Bucket, string> = {
  active:        'Active',
  pending_build: 'Build pending',
  inactive:      'Inactive',
}
const BUCKET_TONE: Record<Bucket, { bg: string; bd: string; fg: string }> = {
  active:        { bg: '#ecfdf5', bd: '#16a34a', fg: '#065f46' },
  pending_build: { bg: '#fef3c7', bd: '#f59e0b', fg: '#7c4a03' },
  inactive:      { bg: '#fee2e2', bd: '#dc2626', fg: '#7f1d1d' },
}

export default async function ClientsListPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const clients = await listClients()
  const buckets: Record<Bucket, typeof clients> = { active: [], pending_build: [], inactive: [] }
  const uncategorized: typeof clients = []

  for (const c of clients) {
    const b = bucketOf(c as Record<string, unknown> as { billing_status?: string; stripe_subscription_id?: string; build_fee_paid_at?: string })
    if (b) buckets[b].push(c)
    else uncategorized.push(c)
  }

  const counts = {
    active: buckets.active.length,
    pending_build: buckets.pending_build.length,
    inactive: buckets.inactive.length,
  }
  const total = clients.length

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Clients</p>
        <h1>Clients</h1>
        <p className="sub">Paying and build-pending accounts. Prospects live on the <Link href="/admin/prospects">Prospects</Link> page.</p>
        <p className="nav">
          <Link href="/admin/clients/new">+ New client</Link>
          <span>·</span>
          <Link href="/admin/billing/customers">Stripe customers</Link>
          <span>·</span>
          <Link href="/admin/billing">Cost &amp; margin</Link>
        </p>
      </header>

      {/* Summary strip */}
      <section className="card" style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div style={{ padding: '10px 12px', background: '#f3f4f6', border: '1.5px solid #d1d5db', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#374151' }}>Total</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#111', marginTop: 2 }}>{total}</div>
        </div>
        {(['active', 'pending_build', 'inactive'] as Bucket[]).map((b) => (
          <div key={b} style={{ padding: '10px 12px', background: BUCKET_TONE[b].bg, border: `1.5px solid ${BUCKET_TONE[b].bd}`, borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: BUCKET_TONE[b].fg }}>
              {BUCKET_LABEL[b]}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: BUCKET_TONE[b].fg, marginTop: 2 }}>{counts[b]}</div>
          </div>
        ))}
      </section>

      {(['active', 'pending_build', 'inactive'] as Bucket[]).map((b) => {
        const list = buckets[b]
        if (list.length === 0) return null
        const tone = BUCKET_TONE[b]
        return (
          <section key={b} className="card" style={{ marginBottom: 12 }}>
            <div className="section-head">
              <h2>{BUCKET_LABEL[b]} <span style={{ color: tone.fg }}>({list.length})</span></h2>
            </div>
            <ul className="list">
              {list.map((c) => {
                const steps = (c.onboarding_steps ?? []) as OnboardingStep[]
                const done = steps.filter((s) => s.done).length
                const pct = steps.length ? Math.round((done / steps.length) * 100) : 0
                const info = TIER_INFO[c.tier] ?? TIER_INFO.individual
                return (
                  <li key={c.id} className="row">
                    <div>
                      <p className="name">
                        <Link href={`/admin/clients/${c.id}`}>{c.display_name}</Link>
                      </p>
                      <p className="meta">{c.slug}.virtualcloser.com · {c.email || 'no email'}</p>
                    </div>
                    <div className="right">
                      <span className="status" style={{ background: tone.bg, borderColor: tone.bd, color: tone.fg }}>
                        {BUCKET_LABEL[b]} · {info.label}
                      </span>
                      <p className="meta">
                        ${c.monthly_fee}/mo · onboarding {pct}%
                        {b === 'pending_build' && (
                          <> · <Link href={`/admin/billing/customers/${c.id}`} style={{ color: '#ff2800', fontWeight: 700 }}>Activate →</Link></>
                        )}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {uncategorized.length > 0 && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="section-head"><h2>Unclassified ({uncategorized.length})</h2></div>
          <ul className="list">
            {uncategorized.map((c) => (
              <li key={c.id} className="row">
                <div>
                  <p className="name"><Link href={`/admin/clients/${c.id}`}>{c.display_name}</Link></p>
                  <p className="meta">{c.slug}.virtualcloser.com · {c.email || 'no email'}</p>
                </div>
                <div className="right">
                  <span className="status">{(c as Record<string, unknown>).billing_status as string ?? 'no billing'}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {clients.length === 0 && (
        <section className="card">
          <p className="empty">No clients yet. <Link href="/admin/clients/new">Create the first one →</Link></p>
        </section>
      )}
    </main>
  )
}
