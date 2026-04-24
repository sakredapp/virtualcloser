import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isAdminAuthed } from '@/lib/admin-auth'
import { createClientRow } from '@/lib/admin-db'
import { TIER_INFO } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function NewClientPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  async function onCreate(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')

    const slug = String(formData.get('slug') ?? '').trim().toLowerCase()
    const display_name = String(formData.get('display_name') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim() || undefined
    const company = String(formData.get('company') ?? '').trim() || undefined
    const tier = String(formData.get('tier') ?? 'salesperson') as 'salesperson' | 'team_builder' | 'executive'
    const monthly_fee = Number(formData.get('monthly_fee') ?? 50)
    const build_fee = Number(formData.get('build_fee') ?? 1500)

    if (!slug || !display_name) return
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return

    const id = `rep_${slug.replace(/-/g, '_')}`
    await createClientRow({
      id,
      slug,
      display_name,
      email,
      company,
      tier,
      monthly_fee,
      build_fee,
    })
    redirect(`/admin/clients/${id}`)
  }

  return (
    <main className="wrap" style={{ maxWidth: 640 }}>
      <header className="hero">
        <p className="eyebrow">Admin · New client</p>
        <h1>Create a client</h1>
        <p className="sub">This inserts a tenant row, seeds onboarding steps, and picks a tier.</p>
        <p className="nav">
          <Link href="/admin/clients">← Back to clients</Link>
        </p>
      </header>

      <section className="card">
        <form action={onCreate} style={{ display: 'grid', gap: '0.7rem' }}>
          <label style={labelStyle}>
            <span>Display name</span>
            <input name="display_name" required style={inputStyle} placeholder="Jane Doe" />
          </label>
          <label style={labelStyle}>
            <span>Slug (subdomain)</span>
            <input
              name="slug"
              required
              style={inputStyle}
              pattern="[a-z0-9][a-z0-9-]*"
              placeholder="janedoe"
            />
            <small className="meta">Becomes janedoe.virtualcloser.com</small>
          </label>
          <label style={labelStyle}>
            <span>Email</span>
            <input name="email" type="email" style={inputStyle} placeholder="jane@example.com" />
          </label>
          <label style={labelStyle}>
            <span>Company</span>
            <input name="company" style={inputStyle} placeholder="Acme Co" />
          </label>
          <label style={labelStyle}>
            <span>Tier</span>
            <select name="tier" defaultValue="salesperson" style={inputStyle}>
              {(['salesperson', 'team_builder', 'executive'] as const).map((t) => (
                <option key={t} value={t}>
                  {TIER_INFO[t].label} — ${TIER_INFO[t].monthly}/mo
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <label style={labelStyle}>
              <span>Monthly fee ($)</span>
              <input name="monthly_fee" type="number" defaultValue={50} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              <span>Build fee ($)</span>
              <input name="build_fee" type="number" defaultValue={1500} style={inputStyle} />
            </label>
          </div>
          <button type="submit" className="btn approve" style={{ marginTop: '0.4rem' }}>
            Create client
          </button>
        </form>
      </section>
    </main>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  fontSize: '0.85rem',
  color: '#5a6aa6',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
  padding: '0.65rem',
  borderRadius: 10,
  border: '1px solid #e6d9ac',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
