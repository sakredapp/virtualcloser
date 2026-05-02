import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { listClients } from '@/lib/admin-db'
import { TIER_INFO, type OnboardingStep } from '@/lib/onboarding'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type Bucket = 'prospect' | 'pending_build' | 'active' | 'inactive'

function bucketOf(c: { billing_status?: string | null; stripe_subscription_id?: string | null; build_fee_paid_at?: string | null }): Bucket {
  if (c.billing_status === 'active' || c.stripe_subscription_id) return 'active'
  if (c.billing_status === 'pending_activation' || c.build_fee_paid_at) return 'pending_build'
  if (c.billing_status === 'canceled' || c.billing_status === 'past_due') return 'inactive'
  return 'prospect'
}

const BUCKET_LABEL: Record<Bucket, string> = {
  prospect: 'Prospect',
  pending_build: 'Paid · build pending',
  active: 'Active',
  inactive: 'Inactive',
}
const BUCKET_TONE: Record<Bucket, { bg: string; bd: string; fg: string }> = {
  prospect:      { bg: '#f3f4f6', bd: '#d1d5db', fg: '#374151' },
  pending_build: { bg: '#fef3c7', bd: '#f59e0b', fg: '#7c4a03' },
  active:        { bg: '#ecfdf5', bd: '#16a34a', fg: '#065f46' },
  inactive:      { bg: '#fee2e2', bd: '#dc2626', fg: '#7f1d1d' },
}

export default async function ClientsListPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const clients = await listClients()
  const { data: prospects } = await supabase
    .from('prospects')
    .select('id, name, email, status, rep_id, meeting_at, build_summary, build_cost_estimate')
    .is('rep_id', null)
    .neq('status', 'lost')
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(50)

  // Bucket the clients.
  const buckets: Record<Bucket, typeof clients> = { prospect: [], pending_build: [], active: [], inactive: [] }
  for (const c of clients) {
    const b = bucketOf(c as Record<string, unknown> as { billing_status?: string; stripe_subscription_id?: string; build_fee_paid_at?: string })
    buckets[b].push(c)
  }

  const counts = {
    prospect: (prospects?.length ?? 0) + buckets.prospect.length,
    pending_build: buckets.pending_build.length,
    active: buckets.active.length,
    inactive: buckets.inactive.length,
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Clients</p>
        <h1>Pipeline</h1>
        <p className="sub">Lifecycle from booked call → paid build fee → live subscription.</p>
        <p className="nav">
          <Link href="/admin/clients/new">+ New client</Link>
          <span>·</span>
          <Link href="/admin/prospects">Prospects (bookings)</Link>
          <span>·</span>
          <Link href="/admin/billing/customers">Customers (Stripe)</Link>
          <span>·</span>
          <Link href="/admin/billing">Cost & margin</Link>
          <span>·</span>
          <Link href="/offer">Public offer page</Link>
        </p>
      </header>

      {/* Bucket counts */}
      <section className="card" style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {(['prospect', 'pending_build', 'active', 'inactive'] as Bucket[]).map((b) => (
          <div key={b} style={{
            padding: '10px 12px',
            background: BUCKET_TONE[b].bg,
            border: `1.5px solid ${BUCKET_TONE[b].bd}`,
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: BUCKET_TONE[b].fg }}>
              {BUCKET_LABEL[b]}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: BUCKET_TONE[b].fg, marginTop: 2 }}>
              {counts[b]}
            </div>
          </div>
        ))}
      </section>

      {/* Prospects (no rep_id yet — booked but not paid) */}
      {(prospects ?? []).length > 0 && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="section-head">
            <h2>Prospects (no payment yet)</h2>
            <p>{(prospects ?? []).length}</p>
          </div>
          <ul className="list">
            {((prospects ?? []) as Record<string, unknown>[]).map((p) => (
              <li key={p.id as string} className="row">
                <div>
                  <p className="name">
                    <Link href={`/admin/prospects/${p.id}`}>{(p.name as string) ?? (p.email as string) ?? '?'}</Link>
                  </p>
                  <p className="meta">
                    {(p.email as string) ?? 'no email'}{p.meeting_at ? ` · meeting ${new Date(p.meeting_at as string).toLocaleDateString()}` : ''}
                  </p>
                  {p.build_summary ? (
                    <p className="meta" style={{ marginTop: 4, fontSize: 11, fontStyle: 'italic' }}>
                      {String(p.build_summary).slice(0, 140)}{String(p.build_summary).length > 140 ? '…' : ''}
                    </p>
                  ) : null}
                </div>
                <div className="right">
                  <span className="status" style={{ background: BUCKET_TONE.prospect.bg, borderColor: BUCKET_TONE.prospect.bd, color: BUCKET_TONE.prospect.fg }}>
                    {String(p.status ?? 'new')}
                  </span>
                  {p.build_cost_estimate ? <p className="meta">est ${Number(p.build_cost_estimate)}/mo</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(['pending_build', 'active', 'inactive', 'prospect'] as Bucket[]).map((b) => {
        const list = buckets[b]
        if (list.length === 0) return null
        return (
          <section key={b} className="card" style={{ marginBottom: 12 }}>
            <div className="section-head">
              <h2>{BUCKET_LABEL[b]} <span style={{ color: BUCKET_TONE[b].fg }}>({list.length})</span></h2>
            </div>
            <ul className="list">
              {list.map((c) => {
                const steps = (c.onboarding_steps ?? []) as OnboardingStep[]
                const done = steps.filter((s) => s.done).length
                const total = steps.length || 1
                const pct = Math.round((done / total) * 100)
                const info = TIER_INFO[c.tier] ?? TIER_INFO.individual
                const tone = BUCKET_TONE[b]
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
                      <span className="status" style={{ background: tone.bg, borderColor: tone.bd, color: tone.fg }}>
                        {BUCKET_LABEL[b]} · {info.label}
                      </span>
                      <p className="meta">
                        ${c.monthly_fee}/mo · onboarding {pct}%
                        {b === 'pending_build' ? (
                          <> · <Link href={`/admin/billing/customers/${c.id}`} style={{ color: '#ff2800', fontWeight: 700 }}>Activate →</Link></>
                        ) : null}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {clients.length === 0 && (prospects ?? []).length === 0 && (
        <section className="card">
          <p className="empty">No clients or prospects yet.</p>
        </section>
      )}
    </main>
  )
}
