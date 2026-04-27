import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getProspect, updateProspect, type ProspectStatus } from '@/lib/prospects'
import BuildPlan from './BuildPlan'

export const dynamic = 'force-dynamic'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return s
  }
}

const STATUS_OPTIONS: ProspectStatus[] = ['new', 'contacted', 'booked', 'won', 'lost', 'canceled']

function statusColor(s: ProspectStatus) {
  switch (s) {
    case 'won':      return { background: 'rgba(16,185,129,0.15)', color: '#065f46', border: 'rgba(16,185,129,0.4)' }
    case 'booked':   return { background: 'rgba(37,99,235,0.12)', color: '#1e40af', border: 'rgba(37,99,235,0.3)' }
    case 'lost':
    case 'canceled': return { background: 'rgba(239,68,68,0.12)', color: '#991b1b', border: 'rgba(239,68,68,0.3)' }
    case 'contacted':return { background: 'rgba(245,158,11,0.12)', color: '#92400e', border: 'rgba(245,158,11,0.3)' }
    default:         return { background: 'var(--paper-2)', color: 'var(--muted)', border: 'var(--ink-soft)' }
  }
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { id } = await params
  const prospect = await getProspect(id)
  if (!prospect) notFound()

  async function saveBasic(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const status = String(formData.get('status') ?? prospect!.status) as ProspectStatus
    const tier_interest = String(formData.get('tier_interest') ?? '').trim() || null
    const notes = String(formData.get('notes') ?? '').trim() || null
    await updateProspect(id, { status, tier_interest, notes })
    revalidatePath(`/admin/prospects/${id}`)
  }

  async function saveCosts(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const buildCost = parseFloat(String(formData.get('build_cost') ?? '')) || null
    const maintenanceCost = parseFloat(String(formData.get('maintenance_cost') ?? '')) || null
    await updateProspect(id, {
      build_cost_estimate: buildCost,
      maintenance_estimate: maintenanceCost,
    })
    revalidatePath(`/admin/prospects/${id}`)
  }

  const sc = statusColor(prospect.status)

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Prospects</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>
          {prospect.name ?? prospect.email ?? 'Unnamed prospect'}
        </h1>
        {prospect.company && (
          <p className="sub" style={{ margin: '0 0 0.5rem' }}>{prospect.company}</p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{
            padding: '3px 12px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 700,
            border: `1px solid ${sc.border}`,
            background: sc.background,
            color: sc.color,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {prospect.status}
          </span>
          {prospect.tier_interest && (
            <span style={{ padding: '3px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, background: 'rgba(255,40,0,0.1)', color: 'var(--red)', border: '1px solid rgba(255,40,0,0.2)' }}>
              {prospect.tier_interest}
            </span>
          )}
        </div>
        <p className="nav">
          <Link href="/admin/prospects">← All prospects</Link>
          <span>·</span>
          <Link href="/admin/clients">Clients</Link>
        </p>
      </header>

      {/* Prospect info */}
      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div className="section-head">
          <h2>Contact info</h2>
          <p>from booking</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.6rem' }}>
          {[
            { label: 'Email', value: prospect.email },
            { label: 'Phone', value: prospect.phone },
            { label: 'Company', value: prospect.company },
            { label: 'Source', value: prospect.source },
            { label: 'Meeting', value: fmtDate(prospect.meeting_at) },
            { label: 'Booked', value: fmtDate(prospect.created_at) },
            { label: 'Timezone', value: prospect.timezone },
          ].map(({ label, value }) => value ? (
            <div key={label} style={{ background: 'var(--paper-2)', borderRadius: '8px', padding: '0.6rem 0.85rem' }}>
              <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>{label}</p>
              <p style={{ margin: '0.2rem 0 0', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>{value}</p>
            </div>
          ) : null)}
        </div>
        {prospect.notes && (
          <blockquote style={{ margin: '0.75rem 0 0', padding: '0.65rem 0.9rem', borderLeft: '3px solid var(--ink-soft)', background: 'var(--paper-2)', borderRadius: '0 6px 6px 0', fontSize: '13px', color: 'var(--ink)', fontStyle: 'italic', lineHeight: 1.55 }}>
            {prospect.notes}
          </blockquote>
        )}
      </section>

      {/* Edit basic fields */}
      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div className="section-head">
          <h2>Status &amp; qualification</h2>
        </div>
        <form action={saveBasic} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                Status
              </label>
              <select
                name="status"
                defaultValue={prospect.status}
                style={{ width: '100%', padding: '0.55rem 0.75rem', border: '1px solid var(--ink-soft)', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', background: 'var(--paper)', fontFamily: 'inherit' }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                Tier interest
              </label>
              <input
                name="tier_interest"
                defaultValue={prospect.tier_interest ?? ''}
                placeholder="salesperson / team_builder / executive"
                style={{ width: '100%', padding: '0.55rem 0.75rem', border: '1px solid var(--ink-soft)', borderRadius: '8px', fontSize: '13px', color: 'var(--ink)', background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.3rem' }}>
              Notes
            </label>
            <textarea
              name="notes"
              defaultValue={prospect.notes ?? ''}
              rows={3}
              placeholder="Qualification notes, follow-up actions, context…"
              style={{ width: '100%', padding: '0.65rem 0.75rem', border: '1px solid var(--ink-soft)', borderRadius: '8px', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', color: 'var(--ink)', background: 'var(--paper)', lineHeight: 1.5, boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <button
              type="submit"
              style={{ padding: '8px 20px', background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: '999px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
            >
              Save
            </button>
          </div>
        </form>
      </section>

      {/* AI Build Planner */}
      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div className="section-head" style={{ marginBottom: '1rem' }}>
          <h2>Build planner</h2>
          <p>AI-powered</p>
        </div>
        <BuildPlan prospect={prospect} />
      </section>

      {/* Manual cost override */}
      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div className="section-head">
          <h2>Cost estimates</h2>
          <p>override AI figures</p>
        </div>
        <form action={saveCosts} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                Build cost ($)
              </label>
              <input
                name="build_cost"
                type="number"
                min="0"
                step="50"
                defaultValue={prospect.build_cost_estimate ?? ''}
                placeholder="e.g. 3500"
                style={{ width: '100%', padding: '0.55rem 0.75rem', border: '1px solid var(--ink-soft)', borderRadius: '8px', fontSize: '13px', color: 'var(--ink)', background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                Monthly maintenance ($)
              </label>
              <input
                name="maintenance_cost"
                type="number"
                min="0"
                step="10"
                defaultValue={prospect.maintenance_estimate ?? ''}
                placeholder="e.g. 150"
                style={{ width: '100%', padding: '0.55rem 0.75rem', border: '1px solid var(--ink-soft)', borderRadius: '8px', fontSize: '13px', color: 'var(--ink)', background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              style={{ padding: '8px 20px', background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: '999px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
            >
              Save costs
            </button>
          </div>
        </form>
      </section>

      {/* Raw payload (collapsed) */}
      {prospect.payload && Object.keys(prospect.payload).length > 0 && (
        <section className="card">
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '14px', color: 'var(--muted)', userSelect: 'none', listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>
              Raw booking payload
              <span style={{ fontSize: '18px', color: 'var(--red)' }}>+</span>
            </summary>
            <pre style={{ marginTop: '0.75rem', padding: '0.85rem', background: 'var(--ink)', color: '#d8d8d8', borderRadius: '8px', fontSize: '11px', overflowX: 'auto', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(prospect.payload, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </main>
  )
}
