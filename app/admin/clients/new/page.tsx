import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isAdminAuthed } from '@/lib/admin-auth'
import { createClientRow, addClientEvent, setOnboardingStep, updateClientRow } from '@/lib/admin-db'
import { TIER_INFO } from '@/lib/onboarding'
import { addProjectDomain, rootDomain, vercelConfigured } from '@/lib/vercel'
import { ADDON_CATALOG, HOUR_PACKAGE_KEYS, isHourPackage } from '@/lib/addons'
import { createMember, logAuditEvent } from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { sendEmail, welcomeEmail, generatePassword } from '@/lib/email'
import { telegramBotUsername } from '@/lib/telegram'
import { supabase } from '@/lib/supabase'
import NewClientPlanFields from './TierFeeInputs'

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
    const tier = String(formData.get('tier') ?? 'individual') as 'individual' | 'enterprise'
    const monthlyDefault = TIER_INFO[tier]?.monthly ?? 50
    const buildDefault = TIER_INFO[tier]?.build?.[0] ?? 2000
    const monthlyRaw = formData.get('monthly_fee')
    const buildRaw = formData.get('build_fee')
    const monthly_fee = monthlyRaw === null || monthlyRaw === '' ? monthlyDefault : Number(monthlyRaw)
    const build_fee = buildRaw === null || buildRaw === '' ? buildDefault : Number(buildRaw)
    const timezone = String(formData.get('timezone') ?? 'America/New_York').trim() || 'America/New_York'

    // Enterprise-only knobs.
    const maxSeatsRaw = String(formData.get('max_seats') ?? '').trim()
    const maxSeats =
      tier === 'enterprise' && maxSeatsRaw !== ''
        ? Math.max(1, Math.min(10000, Math.floor(Number(maxSeatsRaw))))
        : null
    const hourPackageKey = String(formData.get('hour_package_key') ?? '').trim()
    const sendWelcome = formData.get('send_welcome') === '1'

    if (!slug || !display_name) return
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return

    const id = `rep_${slug.replace(/-/g, '_')}`
    // Hash the auto-generated password ONCE up front so it travels into both
    // the rep row (legacy login) and the owner member row (new flow).
    const ownerPassword = generatePassword()
    const ownerHash = await hashPassword(ownerPassword)

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

    // Persist the password + max_seats on the rep row.
    await updateClientRow(id, {
      password_hash: ownerHash,
      ...(maxSeats !== null ? { max_seats: maxSeats } : {}),
    } as Parameters<typeof updateClientRow>[1])

    // The schema's owner backfill only runs at migration time. Make sure
    // every freshly created rep has its owner member NOW so the admin doesn't
    // have to bounce to /members. The rep email is the owner's email.
    if (email) {
      try {
        const { data: existing } = await supabase
          .from('members')
          .select('id')
          .eq('rep_id', id)
          .eq('role', 'owner')
          .maybeSingle()
        if (!existing) {
          const ownerMember = await createMember({
            repId: id,
            email,
            displayName: display_name,
            role: 'owner',
            passwordHash: ownerHash,
            timezone,
          })
          await logAuditEvent({
            repId: id,
            memberId: null,
            action: 'member.invite',
            entityType: 'member',
            entityId: ownerMember.id,
            diff: { email, role: 'owner', source: 'admin_new_client' },
          })
        }
      } catch (err) {
        console.error('[admin/new] auto-create owner failed', err)
      }
    }

    // Activate hour package addon if one was picked. Mutually exclusive — we
    // remove any existing hour package row first so the picker can be used as
    // a "swap" affordance later from the client detail page too.
    if (hourPackageKey && isHourPackage(hourPackageKey)) {
      const def = ADDON_CATALOG[hourPackageKey]
      await supabase
        .from('client_addons')
        .delete()
        .eq('rep_id', id)
        .in('addon_key', HOUR_PACKAGE_KEYS as unknown as string[])
      await supabase.from('client_addons').upsert(
        {
          rep_id: id,
          addon_key: def.key,
          status: 'active',
          monthly_price_cents: def.monthly_price_cents,
          cap_value: def.cap_value,
          cap_unit: def.cap_unit,
          source: 'admin_new_client',
        },
        { onConflict: 'rep_id,addon_key' },
      )
      await addClientEvent({
        repId: id,
        kind: 'billing',
        title: `Hour package activated: ${def.label} (${def.cap_value} hrs/wk)`,
      })
    }

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

    // Send the owner the welcome email with login + telegram code so they
    // can log in immediately. Best-effort — failures don't block creation.
    if (sendWelcome && email) {
      try {
        const { data: rep } = await supabase
          .from('reps')
          .select('telegram_link_code')
          .eq('id', id)
          .maybeSingle()
        const { data: owner } = await supabase
          .from('members')
          .select('telegram_link_code')
          .eq('rep_id', id)
          .eq('role', 'owner')
          .maybeSingle()
        const tierLabel = (TIER_INFO[tier] ?? TIER_INFO.individual).label
        const linkCode =
          (owner?.telegram_link_code as string | null | undefined) ??
          (rep?.telegram_link_code as string | null | undefined) ??
          null
        const tpl = welcomeEmail({
          toEmail: email,
          displayName: display_name,
          slug,
          password: ownerPassword,
          telegramLinkCode: linkCode,
          telegramBotUsername: telegramBotUsername(),
          tierLabel,
        })
        const result = await sendEmail({
          to: email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        await addClientEvent({
          repId: id,
          kind: 'email',
          title: result.ok
            ? `Welcome email sent to ${email} (Resend id ${result.id ?? '?'})`
            : `Welcome email FAILED: ${result.error ?? 'unknown'}`,
          body: result.ok
            ? 'Resend accepted the email. Owner can log in with the password above.'
            : undefined,
        })
        if (result.ok) {
          await setOnboardingStep(id, 'set_client_login', true).catch(() => {})
        }
      } catch (err) {
        console.error('[admin/new] welcome email failed', err)
      }
    }

    redirect(`/admin/clients/${id}`)
  }

  const hourPackages = HOUR_PACKAGE_KEYS.map((key) => {
    const def = ADDON_CATALOG[key]
    return {
      key,
      label: def.label,
      hours: def.cap_value ?? 0,
      monthly_price_cents: def.monthly_price_cents,
    }
  })

  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <header className="hero">
        <p className="eyebrow">Admin · New client</p>
        <h1>Create a client</h1>
        <p className="sub">
          One form, one click. Owner member is auto-created, welcome email goes out, hour package
          activates, seat cap stamped — then you&apos;re on the client detail page.
        </p>
        <p className="nav">
          <Link href="/admin/clients">← Back to clients</Link>
        </p>
      </header>

      <section className="card">
        <form action={onCreate} style={{ display: 'grid', gap: '0.7rem' }}>
          <label style={labelStyle}>
            <span>Owner display name</span>
            <input name="display_name" required style={inputStyle} placeholder="Jane Doe" />
          </label>
          <label style={labelStyle}>
            <span>Owner email (login + welcome destination)</span>
            <input name="email" type="email" required style={inputStyle} placeholder="jane@acme.com" />
          </label>
          <label style={labelStyle}>
            <span>Slug (subdomain)</span>
            <input
              name="slug"
              required
              style={inputStyle}
              pattern="[a-z0-9][a-z0-9\-]*"
              placeholder="acme"
            />
            <small className="meta">Becomes acme.virtualcloser.com</small>
          </label>
          <label style={labelStyle}>
            <span>Company (optional)</span>
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
              <option value="UTC">UTC</option>
            </select>
            <small className="meta">Used for Monday kickoffs, dialer shifts, and end-of-day pulses.</small>
          </label>
          <NewClientPlanFields
            tiers={(['individual', 'enterprise'] as const).map((t) => ({
              key: t,
              label: TIER_INFO[t].label,
              monthly: TIER_INFO[t].monthly,
              build: TIER_INFO[t].build[0],
            }))}
            hourPackages={hourPackages}
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              padding: '8px 10px',
              background: '#fef9c3',
              border: '1px solid #fde68a',
              borderRadius: 8,
            }}
          >
            <input type="checkbox" name="send_welcome" value="1" defaultChecked />
            <span style={{ fontSize: 13, color: '#0b1f5c' }}>
              Send the owner their welcome email immediately (login + Telegram /link code + Connect Google CTA)
            </span>
          </label>
          <button type="submit" className="btn approve" style={{ marginTop: '0.4rem' }}>
            Create client + send welcome
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
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
