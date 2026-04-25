import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isAdminAuthed } from '@/lib/admin-auth'
import { createClientRow, addClientEvent, setOnboardingStep } from '@/lib/admin-db'
import { TIER_INFO } from '@/lib/onboarding'
import { addProjectDomain, rootDomain, vercelConfigured } from '@/lib/vercel'
import TierFeeInputs from './TierFeeInputs'

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
    const monthlyDefault = TIER_INFO[tier]?.monthly ?? 50
    const buildDefault = TIER_INFO[tier]?.build?.[0] ?? 2000
    const monthlyRaw = formData.get('monthly_fee')
    const buildRaw = formData.get('build_fee')
    const monthly_fee = monthlyRaw === null || monthlyRaw === '' ? monthlyDefault : Number(monthlyRaw)
    const build_fee = buildRaw === null || buildRaw === '' ? buildDefault : Number(buildRaw)
    const timezone = String(formData.get('timezone') ?? 'America/New_York').trim() || 'America/New_York'

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
      timezone,
    })

    // Best-effort: ask Vercel to add slug.virtualcloser.com to the project.
    if (vercelConfigured()) {
      const domain = `${slug}.${rootDomain()}`
      const result = await addProjectDomain(domain)
      if (result.ok) {
        await addClientEvent({
          repId: id,
          kind: 'integration',
          title: result.alreadyExists
            ? `Vercel domain ${domain} already attached`
            : `Vercel domain ${domain} added (DNS resolves automatically)`,
        })
        // Auto-tick the "Add subdomain in Vercel" step.
        await setOnboardingStep(id, 'add_subdomain', true).catch(() => {})
      } else {
        await addClientEvent({
          repId: id,
          kind: 'integration',
          title: `Vercel auto-add FAILED for ${domain}: ${result.error} — add manually`,
        })
      }
    }

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
              pattern="[a-z0-9][a-z0-9\-]*"
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
            <span>Timezone</span>
            <select name="timezone" defaultValue="America/New_York" style={inputStyle}>
              <option value="America/New_York">America/New_York (Eastern)</option>
              <option value="America/Chicago">America/Chicago (Central)</option>
              <option value="America/Denver">America/Denver (Mountain)</option>
              <option value="America/Phoenix">America/Phoenix (Arizona)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
              <option value="America/Anchorage">America/Anchorage (Alaska)</option>
              <option value="Pacific/Honolulu">Pacific/Honolulu (Hawaii)</option>
              <option value="America/Toronto">America/Toronto</option>
              <option value="America/Mexico_City">America/Mexico_City</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Europe/Madrid">Europe/Madrid</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
              <option value="Asia/Tokyo">Asia/Tokyo</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
              <option value="UTC">UTC</option>
            </select>
            <small className="meta">Used for Monday kickoffs and end-of-day pulses. Rep can change with /timezone in Telegram.</small>
          </label>
          <TierFeeInputs
            tiers={(['salesperson', 'team_builder', 'executive'] as const).map((t) => ({
              key: t,
              label: TIER_INFO[t].label,
              monthly: TIER_INFO[t].monthly,
              build: TIER_INFO[t].build[0],
            }))}
          />
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
